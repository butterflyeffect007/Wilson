import os
import time
from alpaca.trading.client import TradingClient
from alpaca.trading.requests import MarketOrderRequest
from alpaca.trading.enums import OrderSide, TimeInForce
from alpaca.data.historical import StockHistoricalDataClient
from alpaca.data.requests import StockLatestQuoteRequest
from google import genai
from tavily import TavilyClient

TRADE_MODE = os.getenv("TRADE_MODE", "confirm").lower()
WATCHLIST = ["AAPL", "MSFT", "GOOG"]

def engine_loop(tickers=None, **kwargs):
    if tickers is None:
        tickers = WATCHLIST
    mode = os.getenv("TRADE_MODE", "confirm").lower()
    print(f"[PORTFOLIO] Starting in {mode.upper()} mode")

    trading = TradingClient(
        os.getenv("APCA_API_KEY_ID"),
        os.getenv("APCA_API_SECRET_KEY"),
        paper=True
    )
    data = StockHistoricalDataClient(
        os.getenv("APCA_API_KEY_ID"),
        os.getenv("APCA_API_SECRET_KEY")
    )
    llm = genai.Client(api_key=os.getenv("GOOGLE_API_KEY"))
    tavily = TavilyClient(api_key=os.getenv("TAVILY_API_KEY"))

    while True:
        clock = trading.get_clock()
        if not clock.is_open:
            print("[PORTFOLIO] Market closed. Waiting 60s...")
            time.sleep(60)
            continue

        acct = trading.get_account()
        equity = float(acct.equity)
        print(f"[PORTFOLIO] Equity: ${equity:.2f}")

        # Liquidate existing
        try:
            trading.close_all_positions(cancel_orders=True)
        except Exception:
            pass

        for sym in tickers:
            try:
                news = tavily.search(f"{sym} stock news today", max_results=5)
                prompt = f"Based on this news, should I BUY or HOLD {sym}? Reply only BUY or HOLD.\n{news}"
                resp = llm.models.generate_content(model="gemini-2.0-flash", contents=prompt)
                signal = resp.text.strip().upper()
                print(f"[PORTFOLIO] {sym}: {signal}")

                if signal == "BUY":
                    if mode == "confirm":
                        ans = input(f"Buy {sym}? (y/n): ").strip().lower()
                        if ans != "y":
                            continue
                    q = data.get_stock_latest_quote(StockLatestQuoteRequest(symbol_or_symbols=sym))
                    price = float(q[sym].ask_price or q[sym].bid_price or 1)
                    qty = max(1, int((equity * 0.2) / price))
                    order = MarketOrderRequest(
                        symbol=sym,
                        qty=qty,
                        side=OrderSide.BUY,
                        time_in_force=TimeInForce.DAY
                    )
                    trading.submit_order(order)
                    print(f"[PORTFOLIO] Bought {qty} {sym} @ ~{price:.2f}")
            except Exception as e:
                print(f"[PORTFOLIO] Error on {sym}: {e}")

        print("[PORTFOLIO] Cycle complete. Sleeping 5 min...")
        time.sleep(300)
