"""Shared paper-trading records. No broker or network types."""

from __future__ import annotations

import math
from dataclasses import dataclass


def whole_shares(qty: float) -> int:
    """Long whole shares. Fractional remainders are not sold or bought."""
    if qty < 1:
        return 0
    return int(math.floor(qty + 1e-9))


def shares_for_budget(budget: float, price: float, share_limit: int) -> int:
    """Largest whole-share quantity whose rounded notional fits the budget."""
    if budget <= 0 or price <= 0 or share_limit <= 0:
        return 0
    qty = min(share_limit, int(math.floor((budget + 1e-9) / price)))
    while qty > 0 and round(qty * price, 2) > budget + 1e-6:
        qty -= 1
    return qty


@dataclass(frozen=True)
class PositionView:
    symbol: str
    qty: float
    avg_price: float
    price: float

    @property
    def market_value(self) -> float:
        return self.qty * self.price

    def stopped_out(self, stop_loss_pct: float) -> bool:
        if self.avg_price <= 0 or self.price <= 0:
            return False
        stop_price = self.avg_price * (1 - stop_loss_pct)
        return self.price <= stop_price + 1e-9


@dataclass(frozen=True)
class OrderIntent:
    symbol: str
    side: str
    qty: int
    price: float
    reason: str

    @property
    def notional(self) -> float:
        return round(self.qty * self.price, 2)


@dataclass(frozen=True)
class Snapshot:
    equity: float
    cash: float
    positions: tuple[PositionView, ...]
    prices: dict[str, float]
