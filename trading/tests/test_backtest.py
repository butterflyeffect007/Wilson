from pathlib import Path

import pytest

from backtest import cross_signal, load_prices, main, run_backtest
from config import default_settings


ROOT = Path(__file__).resolve().parents[1]


def _bars(closes, symbol="AAA", start=2):
    rows = []
    for offset, close in enumerate(closes):
        rows.append({"date": f"2024-01-{start + offset:02d}", "symbol": symbol, "close": float(close)})
    return rows


def test_cross_signal():
    assert cross_signal(10, 10, 11, 10.5) == "BUY"
    assert cross_signal(11, 10, 9, 10) == "SELL"
    assert cross_signal(None, None, 10, 10) == "HOLD"
    assert cross_signal(10, 10, 10, 10) == "HOLD"


def test_sma_round_trip_stop_and_pnl():
    settings = default_settings(daily_loss_limit=0, max_trade_notional=1_000, stop_loss_pct=0.05, target_weight=0.20)
    result = run_backtest(_bars([10, 10, 10, 10, 12, 13, 11]), settings, fast=2, slow=3, starting_cash=10_000)
    submitted = [row for row in result.trades if row["status"] == "submitted"]
    assert [(row["timestamp"], row["side"], int(row["qty"]), row["reason"], row["pnl"]) for row in submitted] == [
        ("2024-01-06", "buy", 83, "buy-signal", ""),
        ("2024-01-08", "sell", 83, "stop-loss", "-83.00"),
    ]
    assert result.ending_cash == 9917
    assert result.ending_equity == 9917
    assert result.realized_pnl == -83
    assert result.open_positions == {}


def test_gap_through_the_daily_loss_limit_halts_without_selling(monkeypatch):
    monkeypatch.setattr("builtins.input", lambda *_a, **_k: (_ for _ in ()).throw(AssertionError("prompted")))
    settings = default_settings(
        daily_loss_limit=100,
        max_trade_notional=1_000,
        stop_loss_pct=0.05,
        target_weight=0.50,
        rebalance_band=1.0,
    )
    result = run_backtest(_bars([10, 10, 10, 10, 20, 1]), settings, fast=2, slow=3, starting_cash=10_000)
    assert [row["side"] for row in result.trades if row["status"] == "submitted"] == ["buy"]
    assert any(row["status"] == "halted" and row["reason"] == "daily-loss-halt" for row in result.trades)
    assert result.open_positions["AAA"]["qty"] == 50
    assert not any(row["side"] == "sell" for row in result.trades)


def test_sample_csv_and_cli(tmp_path, monkeypatch):
    for key in (
        "MAX_TRADE_NOTIONAL",
        "DAILY_LOSS_LIMIT",
        "STOP_LOSS_PCT",
        "TARGET_WEIGHT",
        "REBALANCE_BAND",
        "WATCHLIST",
        "TRADE_MODE",
    ):
        monkeypatch.delenv(key, raising=False)
    monkeypatch.setattr("builtins.input", lambda *_a, **_k: (_ for _ in ()).throw(AssertionError("prompted")))
    output = tmp_path / "backtest_trades.csv"
    code = main(
        [
            "--prices",
            str(ROOT / "sample_prices.csv"),
            "--output",
            str(output),
            "--fast",
            "2",
            "--slow",
            "3",
            "--cash",
            "10000",
            "--max-trade",
            "1000",
            "--daily-loss-limit",
            "0",
            "--stop-loss",
            "0.05",
            "--target-weight",
            "0.2",
            "--rebalance-band",
            "0.25",
        ]
    )
    assert code == 0
    text = output.read_text(encoding="utf-8")
    assert "stop-loss" in text
    assert "FLAT" not in text
    bars = load_prices(str(ROOT / "sample_prices.csv"))
    assert {row["symbol"] for row in bars} == {"AAA", "FLAT"}


def test_backtest_modules_do_not_reference_network_clients():
    source = (ROOT / "backtest.py").read_text(encoding="utf-8")
    for banned in ("alpaca", "urllib", "requests", "tavily", "genai", "socket"):
        assert banned not in source


def test_duplicate_bar_is_rejected(tmp_path):
    path = tmp_path / "prices.csv"
    path.write_text("date,symbol,close\n2024-01-02,AAA,10\n2024-01-02,AAA,11\n", encoding="utf-8")
    with pytest.raises(ValueError, match="duplicate"):
        load_prices(str(path))
