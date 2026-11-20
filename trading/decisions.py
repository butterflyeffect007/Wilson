"""Choose paper orders from positions and signals.

Sells are emitted only for a stop-loss, a SELL signal, or the overweight slice
of a daily rebalance. There is no close-everything action. The caller decides
whether today is the one rebalance pass.
"""

from __future__ import annotations

from config import Settings
from models import OrderIntent, PositionView, shares_for_budget, whole_shares
from signals import normalize_signal


def decide_orders(
    *,
    equity: float,
    cash: float,
    positions: list[PositionView] | tuple[PositionView, ...],
    prices: dict[str, float],
    signals: dict[str, str],
    settings: Settings,
    rebalance_due: bool,
    universe: list[str] | tuple[str, ...],
) -> list[OrderIntent]:
    orders: list[OrderIntent] = []
    selling: set[str] = set()
    held = {position.symbol: position for position in positions}

    for position in sorted(positions, key=lambda item: item.symbol):
        qty = _sell_qty(position, equity, settings, signals, rebalance_due)
        if qty is None:
            continue
        shares, reason = qty
        if shares < 1:
            continue
        orders.append(
            OrderIntent(
                symbol=position.symbol,
                side="sell",
                qty=shares,
                price=position.price,
                reason=reason,
            )
        )
        selling.add(position.symbol)

    remaining_cash = max(0.0, cash)
    seen: set[str] = set()
    for symbol in list(universe):
        if symbol in seen:
            continue
        seen.add(symbol)
        if symbol in selling:
            continue
        if normalize_signal(signals.get(symbol, "HOLD")) != "BUY":
            continue
        price = float(prices.get(symbol) or 0)
        if price <= 0 or equity <= 0:
            continue
        position = held.get(symbol)
        held_value = position.market_value if position else 0.0
        room = settings.target_weight * equity - held_value
        budget = min(room, settings.max_trade_notional, remaining_cash)
        shares = shares_for_budget(budget, price, share_limit=10**9)
        if shares < 1:
            continue
        orders.append(
            OrderIntent(
                symbol=symbol,
                side="buy",
                qty=shares,
                price=price,
                reason="buy-signal",
            )
        )
        remaining_cash = round(remaining_cash - shares * price, 2)
        if remaining_cash < 0:
            remaining_cash = 0.0
    return orders


def _sell_qty(
    position: PositionView,
    equity: float,
    settings: Settings,
    signals: dict[str, str],
    rebalance_due: bool,
) -> tuple[int, str] | None:
    share_limit = whole_shares(position.qty)
    if share_limit < 1 or position.price <= 0:
        return None

    if position.stopped_out(settings.stop_loss_pct):
        budget = min(position.market_value, settings.max_trade_notional)
        return shares_for_budget(budget, position.price, share_limit), "stop-loss"

    if normalize_signal(signals.get(position.symbol, "HOLD")) == "SELL":
        budget = min(position.market_value, settings.max_trade_notional)
        return shares_for_budget(budget, position.price, share_limit), "sell-signal"

    if rebalance_due and equity > 0:
        ceiling_value = settings.target_weight * (1 + settings.rebalance_band) * equity
        target_value = settings.target_weight * equity
        if position.market_value > ceiling_value + 1e-6:
            excess = position.market_value - target_value
            budget = min(excess, settings.max_trade_notional)
            return shares_for_budget(budget, position.price, share_limit), "daily-rebalance"
    return None
