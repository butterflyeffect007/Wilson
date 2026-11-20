"""One paper-trading pass: decide, gate, then hand an approved order to the broker.

The broker is any object with market_open, session_day, snapshot, price, submit,
and optionally pending_symbols. Tests pass a fake. The Alpaca adapter lives in
the portfolio manager and always uses the paper endpoint.
"""

from __future__ import annotations

from datetime import datetime, timezone

from config import Settings
from confirm import get_trade_mode
from decisions import decide_orders
from execution_gate import evaluate_execution
from models import PositionView, Snapshot
from risk import RiskState, mark_halt_if_needed, refresh_day
from signals import normalize_signal
from trade_log import append_trade


def run_cycle(
    *,
    broker,
    signal_fn,
    settings: Settings,
    state: RiskState,
    log_path: str,
    now=None,
    confirmer=None,
) -> tuple[RiskState, bool]:
    """Run a single cycle. Returns the updated risk state and whether the market was open."""
    if not broker.market_open():
        print("[PORTFOLIO] Market closed.")
        return state, False

    snap: Snapshot = broker.snapshot()
    day = str(broker.session_day())
    equity = float(snap.equity)
    print(f"[PORTFOLIO] Equity: ${equity:.2f}")

    state = refresh_day(state, day, equity)
    was_halted = state.halted
    state = mark_halt_if_needed(state, equity, settings.daily_loss_limit)
    if state.halted:
        print(f"[PORTFOLIO] Trading halted: {state.halt_reason}")
        if not was_halted:
            _log(
                log_path,
                now,
                reason="daily-loss-halt",
                status="halted",
                pnl=f"{equity - state.start_equity:.2f}",
                note=state.halt_reason,
            )
        return state, True

    universe = _universe(settings, snap.positions)
    try:
        raw_signals = signal_fn(universe) or {}
    except Exception as exc:
        print(f"[PORTFOLIO] Signal error: {exc}")
        raw_signals = {}
    signals = {symbol: normalize_signal(raw_signals.get(symbol, "HOLD")) for symbol in universe}
    for symbol, signal in signals.items():
        print(f"[PORTFOLIO] {symbol}: {signal}")

    prices = {position.symbol: position.price for position in snap.positions}
    prices.update(dict(snap.prices))
    for symbol, signal in list(signals.items()):
        if signal != "BUY":
            continue
        try:
            quote = float(broker.price(symbol))
        except Exception as exc:
            print(f"[PORTFOLIO] Quote error on {symbol}: {exc}")
            quote = 0.0
        if quote > 0:
            prices[symbol] = quote
        else:
            signals[symbol] = "HOLD"
            print(f"[PORTFOLIO] {symbol}: HOLD (no price)")

    rebalance_due = state.last_rebalance_day != state.day
    orders = decide_orders(
        equity=equity,
        cash=float(snap.cash),
        positions=snap.positions,
        prices=prices,
        signals=signals,
        settings=settings,
        rebalance_due=rebalance_due,
        universe=universe,
    )
    if rebalance_due:
        state = RiskState(
            day=state.day,
            start_equity=state.start_equity,
            halted=state.halted,
            halt_reason=state.halt_reason,
            last_rebalance_day=state.day,
        )

    pending = _pending(broker)
    held = {position.symbol: position for position in snap.positions}
    for intent in orders:
        if intent.symbol in pending:
            print(f"[PORTFOLIO] Skip {intent.symbol}: an order is already working")
            _log(
                log_path,
                now,
                symbol=intent.symbol,
                side=intent.side,
                qty=intent.qty,
                price=f"{intent.price:.4f}",
                notional=f"{intent.notional:.2f}",
                reason=intent.reason,
                status="blocked",
                note="open order already working",
            )
            continue

        weight = (intent.notional / equity) if equity > 0 else 0.0
        gate = evaluate_execution(
            intent.symbol,
            intent.side,
            intent.notional,
            weight,
            reason=intent.reason,
            risk_state=state,
            settings=settings,
            confirmer=confirmer,
        )
        if not gate.proceed:
            _log(
                log_path,
                now,
                symbol=intent.symbol,
                side=intent.side,
                qty=intent.qty,
                price=f"{intent.price:.4f}",
                notional=f"{intent.notional:.2f}",
                reason=intent.reason,
                status=gate.status,
                note=gate.message,
            )
            continue

        try:
            order_id = broker.submit(intent)
        except Exception as exc:
            print(f"[PORTFOLIO] Submit error on {intent.symbol}: {exc}")
            _log(
                log_path,
                now,
                symbol=intent.symbol,
                side=intent.side,
                qty=intent.qty,
                price=f"{intent.price:.4f}",
                notional=f"{intent.notional:.2f}",
                reason=intent.reason,
                status="error",
                note=str(exc),
            )
            continue

        pnl = ""
        if intent.side == "sell" and intent.symbol in held and held[intent.symbol].avg_price > 0:
            estimated = (intent.price - held[intent.symbol].avg_price) * intent.qty
            pnl = f"{estimated:.2f}"
        print(
            f"[PORTFOLIO] Submitted {intent.side} {intent.qty} {intent.symbol} "
            f"@ ~{intent.price:.2f} ({intent.reason})"
        )
        _log(
            log_path,
            now,
            symbol=intent.symbol,
            side=intent.side,
            qty=intent.qty,
            price=f"{intent.price:.4f}",
            notional=f"{intent.notional:.2f}",
            reason=intent.reason,
            status="submitted",
            pnl=pnl,
            note=f"estimated at decision price; order {order_id}",
        )
    return state, True


def _universe(settings: Settings, positions: tuple[PositionView, ...]) -> list[str]:
    symbols: list[str] = []
    for symbol in list(settings.watchlist) + [position.symbol for position in positions]:
        if symbol not in symbols:
            symbols.append(symbol)
    return symbols


def _pending(broker) -> set[str]:
    getter = getattr(broker, "pending_symbols", None)
    if getter is None:
        return set()
    try:
        return {str(symbol) for symbol in (getter() or [])}
    except Exception as exc:
        print(f"[PORTFOLIO] Could not read open orders: {exc}")
        return set()


def _stamp(now) -> str:
    if callable(now):
        return _stamp(now())
    if now is None:
        current = datetime.now(timezone.utc).replace(microsecond=0)
        return current.isoformat()
    if isinstance(now, datetime):
        current = now if now.tzinfo is not None else now.replace(tzinfo=timezone.utc)
        return current.astimezone(timezone.utc).replace(microsecond=0).isoformat()
    return str(now)


def _log(path: str, now, **fields) -> None:
    row = {"timestamp": _stamp(now), "mode": get_trade_mode()}
    row.update(fields)
    append_trade(path, row)
