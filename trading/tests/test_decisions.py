from config import default_settings
from decisions import decide_orders
from models import PositionView

REASONS = {"stop-loss", "sell-signal", "daily-rebalance", "buy-signal"}


def _settings(**overrides):
    return default_settings(**overrides)


def _decide(**kwargs):
    base = dict(
        equity=10_000.0,
        cash=10_000.0,
        positions=[],
        prices={},
        signals={},
        settings=_settings(),
        rebalance_due=False,
        universe=("AAPL", "MSFT", "GOOG"),
    )
    base.update(kwargs)
    return decide_orders(**base)


def test_winners_are_not_liquidated():
    positions = [
        PositionView("AAPL", 10, 100, 110),
        PositionView("MSFT", 10, 100, 130),
        PositionView("GOOG", 10, 100, 120),
    ]
    orders = _decide(
        positions=positions,
        signals={name: "HOLD" for name in ("AAPL", "MSFT", "GOOG")},
        rebalance_due=True,
        equity=10_000,
        cash=6_700,
    )
    assert orders == []


def test_overweight_rebalance_sells_the_slice_not_the_position():
    # 1100 / 3300 is above the 25% ceiling, but only the excess is sold.
    orders = _decide(
        equity=3_300,
        cash=0,
        positions=[
            PositionView("AAPL", 10, 100, 110),
            PositionView("MSFT", 10, 100, 110),
            PositionView("GOOG", 10, 100, 110),
        ],
        signals={"AAPL": "HOLD", "MSFT": "HOLD", "GOOG": "HOLD"},
        rebalance_due=True,
        settings=_settings(max_trade_notional=10_000),
    )
    assert len(orders) == 3
    assert {order.symbol for order in orders} == {"AAPL", "MSFT", "GOOG"}
    assert {order.qty for order in orders} == {4}
    assert {order.reason for order in orders} == {"daily-rebalance"}


def test_rebalance_flag_off_keeps_overweight_positions():
    orders = _decide(
        equity=3_300,
        cash=0,
        positions=[PositionView("AAPL", 10, 100, 110)],
        signals={"AAPL": "HOLD"},
        rebalance_due=False,
    )
    assert orders == []


def test_stop_loss_beats_a_sell_signal_and_is_capped():
    orders = _decide(
        positions=[PositionView("AAPL", 100, 100, 90)],
        signals={"AAPL": "SELL"},
        settings=_settings(max_trade_notional=1_000, stop_loss_pct=0.05),
    )
    assert len(orders) == 1
    assert orders[0].reason == "stop-loss"
    assert orders[0].side == "sell"
    assert orders[0].qty == 11  # floor(1000/90), not the whole 100 shares
    assert orders[0].notional <= 1_000


def test_one_share_above_the_cap_is_not_forced():
    orders = _decide(
        positions=[PositionView("AAPL", 2, 5_000, 4_000)],
        signals={"AAPL": "SELL"},
        settings=_settings(max_trade_notional=1_000, stop_loss_pct=0.05),
    )
    assert orders == []


def test_small_dip_is_not_a_stop():
    orders = _decide(
        positions=[PositionView("AAPL", 10, 100, 96)],
        signals={"AAPL": "HOLD"},
    )
    assert orders == []


def test_sell_signal_sells_a_winner():
    orders = _decide(
        positions=[PositionView("AAPL", 5, 100, 140)],
        signals={"AAPL": "SELL"},
        settings=_settings(max_trade_notional=10_000),
    )
    assert len(orders) == 1
    assert orders[0].reason == "sell-signal"
    assert orders[0].qty == 5


def test_buy_respects_cap_cash_and_target_and_skips_a_name_being_sold():
    orders = _decide(
        equity=10_000,
        cash=150,
        positions=[PositionView("AAPL", 10, 100, 90)],
        prices={"AAPL": 90, "MSFT": 50, "GOOG": 50},
        signals={"AAPL": "BUY", "MSFT": "BUY", "GOOG": "BUY"},
        settings=_settings(max_trade_notional=1_000, target_weight=0.20),
        universe=("AAPL", "MSFT", "GOOG"),
    )
    # AAPL is a stop-loss sell, so the BUY on AAPL is ignored.
    # Cash is 150, so only MSFT is bought (3 shares) and GOOG is unaffordable.
    assert [(order.symbol, order.side, order.qty, order.reason) for order in orders] == [
        ("AAPL", "sell", 10, "stop-loss"),
        ("MSFT", "buy", 3, "buy-signal"),
    ]


def test_no_buy_when_already_at_target():
    orders = _decide(
        equity=10_000,
        cash=5_000,
        positions=[PositionView("AAPL", 20, 100, 100)],
        prices={"AAPL": 100},
        signals={"AAPL": "BUY"},
        settings=_settings(target_weight=0.20),
    )
    assert orders == []


def test_every_order_has_a_reason():
    orders = _decide(
        equity=10_000,
        cash=10_000,
        positions=[PositionView("AAPL", 10, 100, 80)],
        prices={"MSFT": 100},
        signals={"AAPL": "HOLD", "MSFT": "BUY"},
        rebalance_due=True,
    )
    assert orders
    assert {order.reason for order in orders} <= REASONS
    assert all(order.qty >= 1 for order in orders)
