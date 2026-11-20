import pytest

from config import default_settings
from confirm import confirm_trade, get_trade_mode
from execution_gate import evaluate_execution, should_execute
from risk import RiskState, load_state, mark_halt_if_needed, refresh_day, save_state
from trade_log import read_trades, append_trade


def _state(**overrides) -> RiskState:
    base = dict(day="2026-01-05", start_equity=10_000.0, halted=False, halt_reason="", last_rebalance_day="")
    base.update(overrides)
    return RiskState(**base)


def test_confirm_requires_yes(monkeypatch):
    monkeypatch.setenv("TRADE_MODE", "confirm")
    monkeypatch.setattr("builtins.input", lambda _prompt: "no")
    assert confirm_trade("AAPL", "buy", 100, 0.1, "buy-signal") is False
    monkeypatch.setattr("builtins.input", lambda _prompt: "y")
    assert confirm_trade("AAPL", "sell", 100, 0.1, "stop-loss") is True


def test_confirm_eof_skips(monkeypatch):
    monkeypatch.setenv("TRADE_MODE", "confirm")

    def _eof(_prompt):
        raise EOFError

    monkeypatch.setattr("builtins.input", _eof)
    assert confirm_trade("AAPL", "buy", 50, 0.01) is False


def test_auto_does_not_prompt(monkeypatch):
    monkeypatch.setenv("TRADE_MODE", "auto")

    def _explode(_prompt):
        raise AssertionError("auto mode prompted")

    monkeypatch.setattr("builtins.input", _explode)
    assert confirm_trade("MSFT", "sell", 200, 0.2, "sell-signal") is True


def test_unknown_mode_is_confirm(monkeypatch):
    monkeypatch.setenv("TRADE_MODE", "yolo")
    assert get_trade_mode() == "confirm"


def test_size_cap_blocks_before_prompt(monkeypatch):
    monkeypatch.setenv("TRADE_MODE", "auto")

    def _explode(_prompt):
        raise AssertionError("blocked order prompted")

    monkeypatch.setattr("builtins.input", _explode)
    settings = default_settings(max_trade_notional=100)
    result = evaluate_execution(
        "AAPL",
        "buy",
        150,
        0.2,
        reason="buy-signal",
        risk_state=_state(),
        settings=settings,
    )
    assert result.proceed is False
    assert result.status == "blocked"
    assert "cap" in result.message
    assert should_execute("AAPL", "sell", 500, 0.5, reason="stop-loss", risk_state=_state(), settings=settings) is False


def test_daily_loss_halt_blocks_buys_and_sells(monkeypatch):
    monkeypatch.setenv("TRADE_MODE", "confirm")

    def _explode(_prompt):
        raise AssertionError("halted order prompted")

    monkeypatch.setattr("builtins.input", _explode)
    state = mark_halt_if_needed(_state(), equity=9_400, daily_loss_limit=500)
    assert state.halted
    settings = default_settings()
    for side, reason in (("buy", "buy-signal"), ("sell", "stop-loss"), ("sell", "daily-rebalance")):
        result = evaluate_execution(
            "AAPL",
            side,
            100,
            0.1,
            reason=reason,
            risk_state=state,
            settings=settings,
        )
        assert result.proceed is False
        assert result.status == "blocked"


def test_halt_latches_for_the_day_and_clears_next_day():
    state = mark_halt_if_needed(_state(), equity=9_000, daily_loss_limit=500)
    # A bounce the same day does not re-open trading.
    bounced = mark_halt_if_needed(state, equity=10_500, daily_loss_limit=500)
    assert bounced.halted
    nxt = refresh_day(bounced, "2026-01-06", 10_500)
    assert nxt.halted is False
    assert nxt.start_equity == 10_500
    assert nxt.last_rebalance_day == ""


def test_trade_log_and_state_roundtrip(tmp_path):
    log_path = tmp_path / "trades.csv"
    append_trade(
        str(log_path),
        {
            "timestamp": "2026-01-05T15:00:00+00:00",
            "symbol": "AAPL",
            "side": "sell",
            "qty": 4,
            "price": "90",
            "notional": "360",
            "reason": "stop-loss",
            "status": "submitted",
            "mode": "auto",
            "pnl": "-40.00",
            "note": "estimated",
        },
    )
    append_trade(str(log_path), {"timestamp": "2026-01-05T15:01:00+00:00", "symbol": "MSFT", "side": "buy", "status": "skipped"})
    rows = read_trades(str(log_path))
    assert rows[0]["pnl"] == "-40.00"
    assert rows[1]["status"] == "skipped"
    text = log_path.read_text(encoding="utf-8")
    assert text.count("timestamp") == 1

    state_path = tmp_path / "state.json"
    save_state(str(state_path), _state(halted=True, halt_reason="daily loss", last_rebalance_day="2026-01-05"))
    loaded = load_state(str(state_path))
    assert loaded.halted is True
    assert loaded.last_rebalance_day == "2026-01-05"

    (tmp_path / "bad.json").write_text("{", encoding="utf-8")
    assert load_state(str(tmp_path / "bad.json")).day == ""
