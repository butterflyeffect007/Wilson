"""Offline backtest on a CSV of daily closes.

This is not the live news strategy. Live orders come from a Gemini BUY/SELL/HOLD
reply. Here a fast/slow simple-moving-average cross supplies that same reply so
the shared sizing, stop-loss, daily-rebalance, size-cap, and daily-loss rules
can be replayed without API keys or a network connection.

Approvals are assumed after the execution gate's risk checks. A historical
replay cannot prompt. The live loop still prompts in confirm mode.

CSV columns: date, symbol, close. Dates sort as YYYY-MM-DD text.

Example:
  python backtest.py --prices sample_prices.csv --fast 2 --slow 3 --output backtest_trades.csv
"""

from __future__ import annotations

import argparse
import sys
from collections import defaultdict
from dataclasses import dataclass, replace

from config import Settings, load_settings
from decisions import decide_orders
from execution_gate import evaluate_execution
from models import PositionView
from risk import RiskState, mark_halt_if_needed
from trade_log import COLUMNS, write_trades


@dataclass
class BacktestResult:
    trades: list[dict]
    ending_cash: float
    ending_equity: float
    realized_pnl: float
    unrealized_pnl: float
    open_positions: dict[str, dict]


def sma(values: list[float], window: int) -> float | None:
    if window < 1 or len(values) < window:
        return None
    return sum(values[-window:]) / window


def cross_signal(
    prev_fast: float | None,
    prev_slow: float | None,
    fast: float | None,
    slow: float | None,
) -> str:
    if None in (prev_fast, prev_slow, fast, slow):
        return "HOLD"
    crossed_up = prev_fast <= prev_slow and fast > slow
    crossed_down = prev_fast >= prev_slow and fast < slow
    if crossed_up and not crossed_down:
        return "BUY"
    if crossed_down and not crossed_up:
        return "SELL"
    return "HOLD"


def load_prices(path: str) -> list[dict]:
    import csv

    rows: list[dict] = []
    seen: set[tuple[str, str]] = set()
    with open(path, newline="", encoding="utf-8") as handle:
        reader = csv.DictReader(handle)
        if reader.fieldnames is None or not {"date", "symbol", "close"} <= set(reader.fieldnames):
            raise ValueError("price CSV needs columns date, symbol, close")
        for raw in reader:
            date = (raw.get("date") or "").strip()
            symbol = (raw.get("symbol") or "").strip().upper()
            if not date or not symbol:
                raise ValueError("price CSV has a row with a blank date or symbol")
            try:
                close = float(raw["close"])
            except (TypeError, ValueError) as exc:
                raise ValueError(f"bad close for {symbol} on {date}") from exc
            if close <= 0:
                raise ValueError(f"close must be positive for {symbol} on {date}")
            key = (date, symbol)
            if key in seen:
                raise ValueError(f"duplicate bar for {symbol} on {date}")
            seen.add(key)
            rows.append({"date": date, "symbol": symbol, "close": close})
    if not rows:
        raise ValueError("price CSV has no rows")
    rows.sort(key=lambda row: (row["date"], row["symbol"]))
    return rows


def run_backtest(
    bars: list[dict],
    settings: Settings,
    *,
    fast: int = 5,
    slow: int = 20,
    starting_cash: float = 10_000.0,
    confirmer=None,
) -> BacktestResult:
    if fast < 1 or slow <= fast:
        raise ValueError("fast window must be >= 1 and slow must be greater than fast")
    if starting_cash <= 0:
        raise ValueError("starting cash must be positive")

    grouped: dict[str, list[dict]] = defaultdict(list)
    for bar in bars:
        grouped[bar["date"]].append(bar)

    cash = float(starting_cash)
    positions: dict[str, dict] = {}
    history: dict[str, list[float]] = defaultdict(list)
    prev_sma: dict[str, tuple[float | None, float | None]] = {}
    last_close: dict[str, float] = {}
    state = RiskState("", 0.0, False, "", "")
    trades: list[dict] = []
    realized = 0.0
    approve = confirmer if confirmer is not None else (lambda *args, **kwargs: True)

    for day in sorted(grouped):
        start_equity = cash + sum(
            pos["qty"] * last_close[symbol] for symbol, pos in positions.items()
        )
        state = RiskState(day, start_equity, False, "", state.last_rebalance_day)
        for bar in sorted(grouped[day], key=lambda item: item["symbol"]):
            history[bar["symbol"]].append(bar["close"])
            last_close[bar["symbol"]] = bar["close"]

        equity = _marked(cash, positions, last_close)
        was_halted = state.halted
        state = mark_halt_if_needed(state, equity, settings.daily_loss_limit)
        if state.halted:
            if not was_halted:
                trades.append(
                    _row(
                        day,
                        reason="daily-loss-halt",
                        status="halted",
                        pnl=f"{equity - state.start_equity:.2f}",
                        note=state.halt_reason,
                    )
                )
        else:
            signals: dict[str, str] = {}
            for symbol, closes in history.items():
                fast_now = sma(closes, fast)
                slow_now = sma(closes, slow)
                previous = prev_sma.get(symbol, (None, None))
                signals[symbol] = cross_signal(previous[0], previous[1], fast_now, slow_now)
            views = [
                PositionView(symbol, pos["qty"], pos["avg"], last_close[symbol])
                for symbol, pos in sorted(positions.items())
            ]
            rebalance_due = state.last_rebalance_day != day
            orders = decide_orders(
                equity=equity,
                cash=cash,
                positions=views,
                prices=dict(last_close),
                signals=signals,
                settings=settings,
                rebalance_due=rebalance_due,
                universe=sorted(history),
            )
            if rebalance_due:
                state = replace(state, last_rebalance_day=day)
            for intent in orders:
                weight = (intent.notional / equity) if equity > 0 else 0.0
                gate = evaluate_execution(
                    intent.symbol,
                    intent.side,
                    intent.notional,
                    weight,
                    reason=intent.reason,
                    risk_state=state,
                    settings=settings,
                    confirmer=approve,
                    announce=False,
                )
                if not gate.proceed:
                    trades.append(
                        _row(
                            day,
                            symbol=intent.symbol,
                            side=intent.side,
                            qty=intent.qty,
                            price=f"{intent.price:.4f}",
                            notional=f"{intent.notional:.2f}",
                            reason=intent.reason,
                            status=gate.status,
                            note=gate.message,
                        )
                    )
                    continue
                filled = _fill(intent, cash, positions, last_close)
                if filled is None:
                    trades.append(
                        _row(
                            day,
                            symbol=intent.symbol,
                            side=intent.side,
                            qty=intent.qty,
                            price=f"{intent.price:.4f}",
                            notional=f"{intent.notional:.2f}",
                            reason=intent.reason,
                            status="blocked",
                            note="insufficient cash or shares",
                        )
                    )
                    continue
                cash, pnl = filled
                if pnl is not None:
                    realized = round(realized + pnl, 2)
                trades.append(
                    _row(
                        day,
                        symbol=intent.symbol,
                        side=intent.side,
                        qty=intent.qty,
                        price=f"{intent.price:.4f}",
                        notional=f"{intent.notional:.2f}",
                        reason=intent.reason,
                        status="submitted",
                        pnl="" if pnl is None else f"{pnl:.2f}",
                        note="filled at close",
                    )
                )
                equity = _marked(cash, positions, last_close)
                state = mark_halt_if_needed(state, equity, settings.daily_loss_limit)

        for symbol, closes in history.items():
            prev_sma[symbol] = (sma(closes, fast), sma(closes, slow))

    ending_equity = _marked(cash, positions, last_close)
    unrealized = round(
        sum((last_close[symbol] - pos["avg"]) * pos["qty"] for symbol, pos in positions.items()),
        2,
    )
    return BacktestResult(
        trades=trades,
        ending_cash=round(cash, 2),
        ending_equity=round(ending_equity, 2),
        realized_pnl=round(realized, 2),
        unrealized_pnl=unrealized,
        open_positions=positions,
    )


def _marked(cash: float, positions: dict[str, dict], last_close: dict[str, float]) -> float:
    return cash + sum(pos["qty"] * last_close[symbol] for symbol, pos in positions.items())


def _fill(intent, cash: float, positions: dict[str, dict], last_close: dict[str, float]):
    """Apply one fill at the bar close. Returns (cash, pnl or None) or None if it cannot."""
    price = float(last_close[intent.symbol])
    if intent.side == "buy":
        cost = round(intent.qty * price, 2)
        if cost > cash + 1e-6:
            return None
        current = positions.get(intent.symbol)
        if current is None:
            positions[intent.symbol] = {"qty": intent.qty, "avg": price}
        else:
            total = current["qty"] + intent.qty
            average = (current["avg"] * current["qty"] + price * intent.qty) / total
            positions[intent.symbol] = {"qty": total, "avg": average}
        return round(cash - cost, 2), None

    current = positions.get(intent.symbol)
    if current is None or current["qty"] < intent.qty:
        return None
    pnl = round((price - current["avg"]) * intent.qty, 2)
    remaining = current["qty"] - intent.qty
    if remaining <= 0:
        del positions[intent.symbol]
    else:
        positions[intent.symbol] = {"qty": remaining, "avg": current["avg"]}
    return round(cash + round(intent.qty * price, 2), 2), pnl


def _row(day: str, **fields) -> dict:
    row = {column: "" for column in COLUMNS}
    row["timestamp"] = day
    row["mode"] = "backtest"
    row.update(fields)
    return row


def _money(amount: float) -> str:
    if amount < 0:
        return f"-${abs(amount):,.2f}"
    return f"${amount:,.2f}"


def format_summary(result: BacktestResult) -> str:
    submitted = [row for row in result.trades if row["status"] == "submitted"]
    halted = sum(1 for row in result.trades if row["status"] == "halted")
    blocked = sum(1 for row in result.trades if row["status"] == "blocked")
    lines = [
        f"trades submitted: {len(submitted)}",
        f"ending cash: {_money(result.ending_cash)}",
        f"ending equity: {_money(result.ending_equity)}",
        f"realized pnl: {_money(result.realized_pnl)}",
        f"unrealized pnl: {_money(result.unrealized_pnl)}",
        f"open positions: {len(result.open_positions)}",
    ]
    if halted:
        lines.append(f"halted sessions: {halted}")
    if blocked:
        lines.append(f"blocked orders: {blocked}")
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Backtest SMA crosses on a CSV of closes. No network.")
    parser.add_argument("--prices", required=True, help="CSV with date, symbol, close")
    parser.add_argument("--output", default="backtest_trades.csv", help="Trade log to write")
    parser.add_argument("--cash", type=float, default=10_000.0)
    parser.add_argument("--fast", type=int, default=5)
    parser.add_argument("--slow", type=int, default=20)
    parser.add_argument("--max-trade", type=float, default=None)
    parser.add_argument("--daily-loss-limit", type=float, default=None)
    parser.add_argument("--stop-loss", type=float, default=None)
    parser.add_argument("--target-weight", type=float, default=None)
    parser.add_argument("--rebalance-band", type=float, default=None)
    args = parser.parse_args(argv)

    settings = load_settings()
    overrides = {}
    if args.max_trade is not None:
        overrides["max_trade_notional"] = args.max_trade
    if args.daily_loss_limit is not None:
        overrides["daily_loss_limit"] = args.daily_loss_limit
    if args.stop_loss is not None:
        overrides["stop_loss_pct"] = args.stop_loss
    if args.target_weight is not None:
        overrides["target_weight"] = args.target_weight
    if args.rebalance_band is not None:
        overrides["rebalance_band"] = args.rebalance_band
    if overrides:
        settings = replace(settings, **overrides)

    bars = load_prices(args.prices)
    result = run_backtest(
        bars,
        settings,
        fast=args.fast,
        slow=args.slow,
        starting_cash=args.cash,
    )
    write_trades(args.output, result.trades)
    print(format_summary(result))
    print(f"wrote {args.output}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
