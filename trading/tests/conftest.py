"""Put the trading directory on sys.path and share a paper broker fake."""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from models import Snapshot  # noqa: E402


class FakeBroker:
    """In-memory broker. No network, no keys, no order unless a test submits one."""

    def __init__(self) -> None:
        self.open = True
        self.day = "2026-01-05"
        self.equity = 10_000.0
        self.cash = 10_000.0
        self.positions = ()
        self.prices: dict[str, float] = {}
        self.orders = []
        self.pending: set[str] = set()

    def market_open(self) -> bool:
        return self.open

    def session_day(self) -> str:
        return self.day

    def snapshot(self) -> Snapshot:
        return Snapshot(self.equity, self.cash, tuple(self.positions), dict(self.prices))

    def price(self, symbol: str) -> float:
        return float(self.prices[symbol])

    def pending_symbols(self) -> set[str]:
        return set(self.pending)

    def submit(self, intent):
        self.orders.append(intent)
        return "paper-1"


@pytest.fixture
def broker() -> FakeBroker:
    return FakeBroker()
