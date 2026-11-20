"""
Execution gate for every paper order, buy or sell.

Usage before submit_order:

    from execution_gate import should_execute

    if not should_execute(ticker, "buy", investment_amount, weight, reason="buy-signal",
                          risk_state=state, settings=settings):
        continue

Order of checks:
  1. Daily loss halt (blocks every side and reason until the next session day)
  2. Per-trade notional cap
  3. TRADE_MODE confirm prompt, or auto approval

The gate does not submit orders and does not select a live endpoint.
"""

from __future__ import annotations

from dataclasses import dataclass

from config import Settings, load_settings
from confirm import confirm_trade, get_trade_mode
from risk import OrderCheck, RiskState, check_order, empty_state


@dataclass(frozen=True)
class GateResult:
    proceed: bool
    status: str
    message: str


def evaluate_execution(
    ticker: str,
    side: str,
    amount: float,
    weight: float,
    reason: str = "",
    risk_state: RiskState | None = None,
    settings: Settings | None = None,
    confirmer=None,
    announce: bool = True,
) -> GateResult:
    """Risk-check the order, then ask confirm mode. Does not talk to a broker."""
    active_settings = settings if settings is not None else load_settings()
    state = risk_state if risk_state is not None else empty_state()
    check: OrderCheck = check_order(
        side=side,
        amount=amount,
        reason=reason,
        state=state,
        settings=active_settings,
    )
    if not check.allowed:
        if announce:
            print(f"[GATE] Blocked {side.upper()} {ticker}: {check.message}")
        return GateResult(False, "blocked", check.message)

    if announce:
        print(f"[MODE] {get_trade_mode()}")
    approve = confirmer if confirmer is not None else confirm_trade
    approved = approve(ticker, side, amount, weight, reason)
    if not approved:
        return GateResult(False, "skipped", "confirmation declined")
    return GateResult(True, "approved", "")


def should_execute(
    ticker: str,
    side: str,
    amount: float,
    weight: float,
    reason: str = "",
    risk_state: RiskState | None = None,
    settings: Settings | None = None,
    confirmer=None,
    announce: bool = True,
) -> bool:
    """
    Returns True if the order should be submitted.
    - blocked by the daily loss halt or the size cap: False, no prompt
    - auto mode: True when the risk checks pass
    - confirm mode: True only on explicit y/yes
    """
    return evaluate_execution(
        ticker,
        side,
        amount,
        weight,
        reason=reason,
        risk_state=risk_state,
        settings=settings,
        confirmer=confirmer,
        announce=announce,
    ).proceed
