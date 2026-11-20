"""Environment-backed settings for the paper-trading loop.

Nothing here selects a live brokerage. The trading client hardcodes Alpaca's
paper endpoint; these values only size, schedule, and record paper orders.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, replace


def _raw(name: str) -> str | None:
    value = os.getenv(name)
    if value is None:
        return None
    value = value.strip()
    return value if value else None


def _float(name: str, default: float) -> float:
    raw = _raw(name)
    if raw is None:
        return default
    return float(raw)


def _int(name: str, default: int) -> int:
    raw = _raw(name)
    if raw is None:
        return default
    return int(raw)


@dataclass(frozen=True)
class Settings:
    max_trade_notional: float
    daily_loss_limit: float
    stop_loss_pct: float
    target_weight: float
    rebalance_band: float
    cycle_seconds: int
    closed_wait_seconds: int
    trade_log_path: str
    state_path: str
    watchlist: tuple[str, ...]

    def __post_init__(self) -> None:
        if self.max_trade_notional <= 0:
            raise ValueError("MAX_TRADE_NOTIONAL must be positive")
        if self.daily_loss_limit < 0:
            raise ValueError("DAILY_LOSS_LIMIT cannot be negative (0 disables it)")
        if not 0 < self.stop_loss_pct < 1:
            raise ValueError("STOP_LOSS_PCT must be between 0 and 1")
        if not 0 < self.target_weight <= 1:
            raise ValueError("TARGET_WEIGHT must be in (0, 1]")
        if self.rebalance_band < 0:
            raise ValueError("REBALANCE_BAND cannot be negative")
        if self.cycle_seconds < 1 or self.closed_wait_seconds < 1:
            raise ValueError("cycle waits must be at least 1 second")
        if not self.watchlist:
            raise ValueError("WATCHLIST must contain at least one symbol")
        if not self.trade_log_path or not self.state_path:
            raise ValueError("trade log and state paths are required")


def default_settings(**overrides: object) -> Settings:
    """Built-in defaults. Ignores the process environment."""
    base = dict(
        max_trade_notional=1000.0,
        daily_loss_limit=500.0,
        stop_loss_pct=0.05,
        target_weight=0.20,
        rebalance_band=0.25,
        cycle_seconds=1800,
        closed_wait_seconds=900,
        trade_log_path="trades.csv",
        state_path="trading_state.json",
        watchlist=("AAPL", "MSFT", "GOOG"),
    )
    base.update(overrides)
    return Settings(**base)


def load_settings() -> Settings:
    """Read settings from the environment, falling back to the defaults."""
    watch = _raw("WATCHLIST") or "AAPL,MSFT,GOOG"
    symbols = tuple(part.strip().upper() for part in watch.split(",") if part.strip())
    return default_settings(
        max_trade_notional=_float("MAX_TRADE_NOTIONAL", 1000.0),
        daily_loss_limit=_float("DAILY_LOSS_LIMIT", 500.0),
        stop_loss_pct=_float("STOP_LOSS_PCT", 0.05),
        target_weight=_float("TARGET_WEIGHT", 0.20),
        rebalance_band=_float("REBALANCE_BAND", 0.25),
        cycle_seconds=_int("CYCLE_SECONDS", 1800),
        closed_wait_seconds=_int("CLOSED_WAIT_SECONDS", 900),
        trade_log_path=_raw("TRADE_LOG_PATH") or "trades.csv",
        state_path=_raw("TRADE_STATE_PATH") or "trading_state.json",
        watchlist=symbols,
    )


def with_watchlist(settings: Settings, tickers: list[str] | tuple[str, ...] | None) -> Settings:
    if not tickers:
        return settings
    symbols = tuple(str(ticker).strip().upper() for ticker in tickers if str(ticker).strip())
    if not symbols:
        return settings
    return replace(settings, watchlist=symbols)
