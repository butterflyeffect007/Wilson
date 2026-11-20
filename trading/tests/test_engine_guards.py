from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]


def test_manager_source_is_paper_only_and_does_not_liquidate():
    text = (ROOT / "agentic_AI_portfolio_manager.py").read_text(encoding="utf-8")
    cycle = (ROOT / "cycle.py").read_text(encoding="utf-8")
    gate = (ROOT / "execution_gate.py").read_text(encoding="utf-8")
    assert "close_all_positions" not in text
    assert "close_all_positions" not in cycle
    assert "paper=True" in text
    assert "https://paper-api.alpaca.markets" in text
    assert "https://api.alpaca.markets" not in text
    assert "evaluate_execution" in cycle
    assert "should_execute" in gate
    for blob in (text, cycle, gate):
        assert "web3" not in blob.lower()
        assert "wallet" not in blob.lower() or "no wallet" in blob.lower()


def test_live_flag_is_rejected():
    from agentic_AI_portfolio_manager import engine_loop

    with pytest.raises(RuntimeError, match="paper"):
        engine_loop(paper=False, max_cycles=1)


def test_engine_sleeps_on_the_slower_cycle(broker, tmp_path, monkeypatch):
    from agentic_AI_portfolio_manager import engine_loop

    monkeypatch.setenv("TRADE_MODE", "auto")
    monkeypatch.setenv("TRADE_LOG_PATH", str(tmp_path / "trades.csv"))
    monkeypatch.setenv("TRADE_STATE_PATH", str(tmp_path / "state.json"))
    monkeypatch.setenv("CYCLE_SECONDS", "1800")
    monkeypatch.setenv("CLOSED_WAIT_SECONDS", "900")
    for key in ("MAX_TRADE_NOTIONAL", "DAILY_LOSS_LIMIT", "STOP_LOSS_PCT", "TARGET_WEIGHT", "REBALANCE_BAND"):
        monkeypatch.delenv(key, raising=False)

    sleeps = []
    engine_loop(
        broker=broker,
        signal_fn=lambda symbols: {symbol: "HOLD" for symbol in symbols},
        max_cycles=2,
        sleeper=lambda seconds: sleeps.append(seconds),
        load_env=False,
    )
    assert sleeps == [1800]
    assert broker.orders == []

    broker.open = False
    sleeps.clear()
    engine_loop(
        broker=broker,
        signal_fn=lambda _symbols: (_ for _ in ()).throw(AssertionError("signaled while closed")),
        max_cycles=2,
        sleeper=lambda seconds: sleeps.append(seconds),
        load_env=False,
    )
    assert sleeps == [900]
