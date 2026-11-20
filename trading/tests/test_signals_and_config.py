import pytest

from config import default_settings, load_settings
from signals import parse_signal


ENV_KEYS = [
    "MAX_TRADE_NOTIONAL",
    "DAILY_LOSS_LIMIT",
    "STOP_LOSS_PCT",
    "TARGET_WEIGHT",
    "REBALANCE_BAND",
    "CYCLE_SECONDS",
    "CLOSED_WAIT_SECONDS",
    "TRADE_LOG_PATH",
    "TRADE_STATE_PATH",
    "WATCHLIST",
    "TRADE_MODE",
]


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("buy", "BUY"),
        ("SELL now", "SELL"),
        ("HOLD\nextra", "HOLD"),
        ("BUY.", "BUY"),
        ("", "HOLD"),
        ("I think BUY", "HOLD"),
        ("HOLDING", "HOLD"),
        ("maybe", "HOLD"),
    ],
)
def test_parse_signal_is_strict(text, expected):
    assert parse_signal(text) == expected


def test_defaults_reduce_cycle_frequency(monkeypatch):
    for key in ENV_KEYS:
        monkeypatch.delenv(key, raising=False)
    settings = load_settings()
    assert settings.cycle_seconds == 1800
    assert settings.closed_wait_seconds == 900
    assert settings.max_trade_notional == 1000
    assert settings.daily_loss_limit == 500
    assert settings.stop_loss_pct == 0.05
    assert settings.watchlist == ("AAPL", "MSFT", "GOOG")


def test_invalid_stop_is_rejected(monkeypatch):
    monkeypatch.setenv("STOP_LOSS_PCT", "2")
    with pytest.raises(ValueError):
        load_settings()


def test_default_settings_ignore_environment(monkeypatch):
    monkeypatch.setenv("MAX_TRADE_NOTIONAL", "1")
    assert default_settings().max_trade_notional == 1000
