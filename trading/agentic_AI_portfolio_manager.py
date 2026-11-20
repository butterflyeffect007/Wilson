"""Paper portfolio loop.

News in, one-word BUY/SELL/HOLD out, then the execution gate. Alpaca is always
the paper endpoint. There is no live switch, no crypto, and no wallet code.

Sells happen only for a stop-loss, a SELL signal, or at most one daily
rebalance of the overweight slice. The loop does not liquidate the book.
"""

from __future__ import annotations

import os
import time
from pathlib import Path

from config import load_settings, with_watchlist
from confirm import get_trade_mode
from cycle import run_cycle
from risk import load_state, save_state
from signals import parse_signal

# Kept for callers that imported the old watchlist.
WATCHLIST = ["AAPL", "MSFT", "GOOG"]

# Hardcoded paper host. The live trading host is intentionally not referenced.
PAPER_TRADING_URL = "https://paper-api.alpaca.markets"


def _load_dotenv() -> None:
    try:
        from dotenv import load_dotenv
    except ImportError:
        return
    load_dotenv(override=False)
    local = Path(__file__).resolve().parent / ".env"
    if local.exists():
        load_dotenv(local, override=False)


class AlpacaPaperBroker:
    """Alpaca adapter. paper=True and the paper host are fixed."""

    def __init__(self) -> None:
        from alpaca.data.historical import StockHistoricalDataClient
        from alpaca.trading.client import TradingClient

        key = os.getenv("APCA_API_KEY_ID")
        secret = os.getenv("APCA_API_SECRET_KEY")
        if not key or not secret:
            raise RuntimeError("APCA_API_KEY_ID and APCA_API_SECRET_KEY are required for paper trading.")
        self.trading = TradingClient(
            key,
            secret,
            paper=True,
            url_override=PAPER_TRADING_URL,
        )
        self.data = StockHistoricalDataClient(key, secret)
        self._clock = None

    def market_open(self) -> bool:
        self._clock = self.trading.get_clock()
        return bool(self._clock.is_open)

    def session_day(self) -> str:
        if self._clock is None:
            self.market_open()
        stamp = self._clock.timestamp
        return stamp.date().isoformat()

    def snapshot(self):
        from models import PositionView, Snapshot

        account = self.trading.get_account()
        positions = []
        prices = {}
        for raw in self.trading.get_all_positions():
            qty = float(raw.qty)
            if qty <= 0:
                continue
            price = float(raw.current_price)
            symbol = str(raw.symbol)
            positions.append(
                PositionView(
                    symbol=symbol,
                    qty=qty,
                    avg_price=float(raw.avg_entry_price),
                    price=price,
                )
            )
            prices[symbol] = price
        return Snapshot(
            equity=float(account.equity),
            cash=float(account.cash),
            positions=tuple(positions),
            prices=prices,
        )

    def price(self, symbol: str) -> float:
        from alpaca.data.requests import StockLatestQuoteRequest

        quotes = self.data.get_stock_latest_quote(StockLatestQuoteRequest(symbol_or_symbols=symbol))
        quote = quotes[symbol]
        return float(quote.ask_price or quote.bid_price or 0)

    def pending_symbols(self) -> set[str]:
        from alpaca.trading.enums import QueryOrderStatus
        from alpaca.trading.requests import GetOrdersRequest

        request = GetOrdersRequest(status=QueryOrderStatus.OPEN)
        return {str(order.symbol) for order in self.trading.get_orders(filter=request)}

    def submit(self, intent) -> str:
        from alpaca.trading.enums import OrderSide, TimeInForce
        from alpaca.trading.requests import MarketOrderRequest

        side = OrderSide.BUY if intent.side == "buy" else OrderSide.SELL
        order = MarketOrderRequest(
            symbol=intent.symbol,
            qty=intent.qty,
            side=side,
            time_in_force=TimeInForce.DAY,
        )
        result = self.trading.submit_order(order)
        return str(getattr(result, "id", "") or "")


class NewsSignal:
    """Tavily headlines plus a one-word Gemini reply. Failures become HOLD."""

    def __init__(self) -> None:
        from google import genai
        from tavily import TavilyClient

        google_key = os.getenv("GOOGLE_API_KEY")
        tavily_key = os.getenv("TAVILY_API_KEY")
        if not google_key or not tavily_key:
            raise RuntimeError("GOOGLE_API_KEY and TAVILY_API_KEY are required for news signals.")
        self.llm = genai.Client(api_key=google_key)
        self.tavily = TavilyClient(api_key=tavily_key)

    def __call__(self, symbols: list[str]) -> dict[str, str]:
        signals = {}
        for symbol in symbols:
            try:
                news = self.tavily.search(f"{symbol} stock news today", max_results=5)
                prompt = (
                    f"Based on this news, should I BUY, SELL, or HOLD {symbol}? "
                    f"Reply with one word: BUY, SELL, or HOLD.\n{news}"
                )
                response = self.llm.models.generate_content(
                    model="gemini-2.0-flash",
                    contents=prompt,
                )
                signals[symbol] = parse_signal(getattr(response, "text", "") or "")
            except Exception as exc:
                print(f"[PORTFOLIO] Signal error on {symbol}: {exc}")
                signals[symbol] = "HOLD"
        return signals


def engine_loop(
    tickers=None,
    max_cycles=None,
    broker=None,
    signal_fn=None,
    sleeper=None,
    load_env=True,
    **kwargs,
):
    """Run the paper loop. paper=False is rejected. max_cycles stops after N passes (tests)."""
    if kwargs.get("paper", True) is not True:
        raise RuntimeError(
            "This bot only paper-trades. paper=True is fixed; live trading is not available."
        )
    if load_env:
        _load_dotenv()
    settings = with_watchlist(load_settings(), tickers)
    if sleeper is None:
        sleeper = time.sleep
    if broker is None:
        broker = AlpacaPaperBroker()
    if signal_fn is None:
        signal_fn = NewsSignal()

    state = load_state(settings.state_path)
    mode = get_trade_mode().upper()
    print(f"[PORTFOLIO] Starting in {mode} mode (paper only)")
    print(
        f"[PORTFOLIO] Cycle {settings.cycle_seconds}s | "
        f"cap ${settings.max_trade_notional:.2f} | "
        f"daily loss ${settings.daily_loss_limit:.2f} | "
        f"stop {settings.stop_loss_pct:.1%}"
    )
    completed = 0
    while True:
        is_open = False
        try:
            state, is_open = run_cycle(
                broker=broker,
                signal_fn=signal_fn,
                settings=settings,
                state=state,
                log_path=settings.trade_log_path,
            )
            save_state(settings.state_path, state)
        except Exception as exc:
            print(f"[PORTFOLIO] Cycle error: {exc}")
        completed += 1
        if max_cycles is not None and completed >= max_cycles:
            return
        wait = settings.cycle_seconds if is_open else settings.closed_wait_seconds
        print(f"[PORTFOLIO] Cycle complete. Sleeping {wait}s...")
        sleeper(wait)
