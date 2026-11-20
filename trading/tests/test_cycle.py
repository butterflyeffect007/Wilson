from config import default_settings
from cycle import run_cycle
from models import PositionView
from risk import RiskState, empty_state
from trade_log import read_trades


def _settings(tmp_path, **overrides):
    base = dict(
        trade_log_path=str(tmp_path / "trades.csv"),
        state_path=str(tmp_path / "state.json"),
        daily_loss_limit=500,
        max_trade_notional=1_000,
    )
    base.update(overrides)
    return default_settings(**base)


def _run(broker, tmp_path, signals, state=None, **overrides):
    seen = {}

    def _record(ticker, side, amount, weight, reason=""):
        seen.setdefault("calls", []).append((ticker, side, reason, amount))
        return True

    new_state, is_open = run_cycle(
        broker=broker,
        signal_fn=signals,
        settings=_settings(tmp_path, **overrides),
        state=state or empty_state(),
        log_path=str(tmp_path / "trades.csv"),
        now=lambda: "2026-01-05T15:00:00+00:00",
        confirmer=_record,
    )
    return new_state, is_open, seen


def test_market_closed_does_not_trade_or_signal(broker, tmp_path):
    broker.open = False

    def _boom(_symbols):
        raise AssertionError("signaled while closed")

    state, is_open, seen = _run(broker, tmp_path, _boom)
    assert is_open is False
    assert state.day == ""
    assert broker.orders == []
    assert seen == {}


def test_stop_and_buy_both_pass_through_the_gate(broker, tmp_path, monkeypatch):
    monkeypatch.setenv("TRADE_MODE", "confirm")
    broker.positions = (PositionView("AAPL", 10, 100, 90),)
    broker.prices = {"AAPL": 90, "MSFT": 50}
    broker.cash = 5_000
    broker.equity = 10_000

    def signals(_symbols):
        return {"AAPL": "HOLD", "MSFT": "BUY", "GOOG": "HOLD"}

    _state, is_open, seen = _run(broker, tmp_path, signals)
    assert is_open is True
    assert [(call[0], call[1], call[2]) for call in seen["calls"]] == [
        ("AAPL", "sell", "stop-loss"),
        ("MSFT", "buy", "buy-signal"),
    ]
    assert [(order.symbol, order.side, order.reason) for order in broker.orders] == [
        ("AAPL", "sell", "stop-loss"),
        ("MSFT", "buy", "buy-signal"),
    ]
    rows = read_trades(str(tmp_path / "trades.csv"))
    assert [row["status"] for row in rows] == ["submitted", "submitted"]
    assert rows[0]["pnl"] == "-100.00"
    assert _state.last_rebalance_day == "2026-01-05"


def test_confirm_decline_submits_nothing(broker, tmp_path, monkeypatch):
    monkeypatch.setenv("TRADE_MODE", "confirm")
    answers = iter(["n", "nope"])
    monkeypatch.setattr("builtins.input", lambda _prompt: next(answers))
    broker.positions = (PositionView("AAPL", 10, 100, 90),)
    broker.prices = {"MSFT": 50}
    broker.cash = 5_000

    def signals(_symbols):
        return {"MSFT": "BUY"}

    run_cycle(
        broker=broker,
        signal_fn=signals,
        settings=_settings(tmp_path),
        state=empty_state(),
        log_path=str(tmp_path / "trades.csv"),
        now="2026-01-05T15:00:00+00:00",
    )
    assert broker.orders == []
    rows = read_trades(str(tmp_path / "trades.csv"))
    assert [row["status"] for row in rows] == ["skipped", "skipped"]
    assert {row["side"] for row in rows} == {"sell", "buy"}


def test_news_failure_still_stops_and_does_not_buy(broker, tmp_path):
    broker.positions = (PositionView("AAPL", 8, 100, 90),)
    broker.prices = {"MSFT": 40}

    def signals(_symbols):
        raise RuntimeError("news down")

    _run(broker, tmp_path, signals)
    assert [(order.symbol, order.reason) for order in broker.orders] == [("AAPL", "stop-loss")]


def test_rebalance_at_most_once_per_day(broker, tmp_path):
    broker.positions = (PositionView("AAPL", 40, 100, 100),)
    broker.equity = 10_000
    broker.cash = 6_000
    settings_overrides = dict(max_trade_notional=1_000, target_weight=0.20, rebalance_band=0.25)

    def signals(_symbols):
        return {"AAPL": "HOLD"}

    state, _, _ = _run(broker, tmp_path, signals, **settings_overrides)
    assert [(order.qty, order.reason) for order in broker.orders] == [(10, "daily-rebalance")]

    broker.orders.clear()
    state, _, _ = _run(broker, tmp_path, signals, state=state, **settings_overrides)
    assert broker.orders == []

    broker.day = "2026-01-06"
    _run(broker, tmp_path, signals, state=state, **settings_overrides)
    assert [(order.qty, order.reason) for order in broker.orders] == [(10, "daily-rebalance")]


def test_daily_loss_halts_without_calling_signals_or_submitting(broker, tmp_path):
    broker.equity = 9_400
    broker.positions = (PositionView("AAPL", 10, 100, 90),)
    state = RiskState("2026-01-05", 10_000, False, "", "")

    def signals(_symbols):
        raise AssertionError("signaled while halted")

    new_state, _, seen = _run(broker, tmp_path, signals, state=state, daily_loss_limit=500)
    assert new_state.halted
    assert broker.orders == []
    assert seen == {}
    rows = read_trades(str(tmp_path / "trades.csv"))
    assert len(rows) == 1
    assert rows[0]["status"] == "halted"

    _run(broker, tmp_path, signals, state=new_state, daily_loss_limit=500)
    assert len(read_trades(str(tmp_path / "trades.csv"))) == 1


def test_pending_order_is_not_duplicated(broker, tmp_path):
    broker.positions = (PositionView("AAPL", 10, 100, 90),)
    broker.pending.add("AAPL")
    _run(broker, tmp_path, lambda _symbols: {"AAPL": "SELL"})
    assert broker.orders == []
    rows = read_trades(str(tmp_path / "trades.csv"))
    assert rows[0]["status"] == "blocked"
    assert "open order" in rows[0]["note"]


def test_submit_error_and_bad_quote_do_not_crash(broker, tmp_path):
    broker.positions = (PositionView("AAPL", 10, 100, 90),)

    def _fail(_intent):
        raise RuntimeError("rejected")

    broker.submit = _fail
    _run(broker, tmp_path, lambda _symbols: {})
    assert read_trades(str(tmp_path / "trades.csv"))[0]["status"] == "error"

    broker.positions = ()
    broker.submit = lambda intent: broker.orders.append(intent) or "paper-1"

    def _no_quote(_symbol):
        raise RuntimeError("no quote")

    broker.price = _no_quote
    _run(broker, tmp_path, lambda symbols: {symbol: "BUY" for symbol in symbols})
    assert broker.orders == []


def test_winner_with_hold_is_kept(broker, tmp_path):
    broker.positions = (
        PositionView("AAPL", 5, 100, 120),
        PositionView("MSFT", 5, 100, 130),
    )
    broker.equity = 10_000
    broker.cash = 8_750
    state = RiskState("2026-01-05", 10_000, False, "", "2026-01-05")
    _run(broker, tmp_path, lambda _symbols: {}, state=state)
    assert broker.orders == []
