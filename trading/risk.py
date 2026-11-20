"""Per-trade size cap and daily loss halt.

A halt blocks every new order until the next session day. It does not
liquidate the book. Stop-loss, sell-signal, and rebalance sells are ordinary
orders and are refused while the halt is on.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, replace
from pathlib import Path

from config import Settings


@dataclass(frozen=True)
class RiskState:
    day: str
    start_equity: float
    halted: bool
    halt_reason: str
    last_rebalance_day: str


@dataclass(frozen=True)
class OrderCheck:
    allowed: bool
    code: str
    message: str


def empty_state() -> RiskState:
    return RiskState("", 0.0, False, "", "")


def refresh_day(state: RiskState, day: str, equity: float) -> RiskState:
    """Start a session day. The halt clears; the last rebalance date is kept."""
    if state.day == day and state.day:
        return state
    return RiskState(
        day=day,
        start_equity=equity,
        halted=False,
        halt_reason="",
        last_rebalance_day=state.last_rebalance_day,
    )


def mark_halt_if_needed(state: RiskState, equity: float, daily_loss_limit: float) -> RiskState:
    """Latch the halt for this session day once the loss limit is reached.

    A limit of 0 disables the check. Recovery later the same day does not
    clear the latch; the next session day does.
    """
    if state.halted or daily_loss_limit <= 0:
        return state
    loss = state.start_equity - equity
    if loss + 1e-9 >= daily_loss_limit:
        reason = f"daily loss ${loss:,.2f} reached limit ${daily_loss_limit:,.2f}"
        return replace(state, halted=True, halt_reason=reason)
    return state


def check_order(
    *,
    side: str,
    amount: float,
    reason: str,
    state: RiskState,
    settings: Settings,
) -> OrderCheck:
    """Risk backstop used by the execution gate for buys and sells."""
    del reason  # reason is logged by the caller; the halt is reason-agnostic
    if amount <= 0:
        return OrderCheck(False, "bad_amount", f"{side} amount must be positive")
    if state.halted:
        return OrderCheck(
            False,
            "daily_loss_halt",
            state.halt_reason or "daily loss limit reached",
        )
    cap = settings.max_trade_notional
    if amount > cap + 0.01:
        return OrderCheck(
            False,
            "over_cap",
            f"notional ${amount:,.2f} exceeds cap ${cap:,.2f}",
        )
    return OrderCheck(True, "ok", "")


def load_state(path: str) -> RiskState:
    file = Path(path)
    if not file.exists():
        return empty_state()
    try:
        data = json.loads(file.read_text(encoding="utf-8"))
        return RiskState(
            day=str(data.get("day") or ""),
            start_equity=float(data.get("start_equity") or 0),
            halted=bool(data.get("halted")),
            halt_reason=str(data.get("halt_reason") or ""),
            last_rebalance_day=str(data.get("last_rebalance_day") or ""),
        )
    except (OSError, ValueError, TypeError) as exc:
        print(f"[PORTFOLIO] Ignoring unreadable state file {path}: {exc}")
        return empty_state()


def save_state(path: str, state: RiskState) -> None:
    file = Path(path)
    if file.parent and str(file.parent) not in ("", "."):
        file.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "day": state.day,
        "start_equity": state.start_equity,
        "halted": state.halted,
        "halt_reason": state.halt_reason,
        "last_rebalance_day": state.last_rebalance_day,
    }
    temporary = file.with_suffix(file.suffix + ".tmp")
    temporary.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    temporary.replace(file)
