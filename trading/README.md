# Wilson Trading Stack

Educational / paper-trading only. The portfolio loop talks to Alpaca's paper endpoint and never places a live order.

## 1. Paper portfolio loop

Path: `trading/`

What one cycle actually does:

1. If the market is closed, it waits. It does not trade.
2. It reads equity, cash, and long stock positions from the Alpaca paper account.
3. For each watchlist name (and any name already held) it asks Tavily for headlines and Gemini for one word: `BUY`, `SELL`, or `HOLD`. Any other reply is `HOLD`.
4. It may sell only for one of these reasons:
   - **stop-loss** — last mark is at least `STOP_LOSS_PCT` below the average entry. A position bigger than the size cap is sold in slices, one cap per cycle.
   - **sell signal** — Gemini said `SELL`.
   - **daily rebalance** — at most once per session day, and only the shares above `TARGET_WEIGHT`. Names inside the band are left alone.
5. It may buy on `BUY` when the name is under its target weight. Size is the smallest of the room to target, cash, and `MAX_TRADE_NOTIONAL`.
6. Every buy and every sell goes through `execution_gate` / `confirm`. In confirm mode the process asks `y/n` before that order. `n`, anything else, or a closed stdin skips it. Auto mode does not prompt. The size cap and the daily loss halt apply in both modes, and a blocked order is not prompted.
7. The decision is appended to a local CSV.

There is no `close_all_positions` call. A winning hold is not sold just because a new cycle started.

The live loop does **not** use LangGraph, email, RandomForest, SMA, or RSI. Those were described here before and are not in the code. The moving-average cross exists only in the offline backtest below, so a price history can be replayed without news or API keys.

### Run the paper loop

```bash
cd trading
pip install -r requirements.txt
cp .env.example .env
# fill paper keys only: APCA_API_KEY_ID, APCA_API_SECRET_KEY, GOOGLE_API_KEY, TAVILY_API_KEY

# confirm mode (default) — y/n before every buy and every sell
TRADE_MODE=confirm python main.py

# auto mode — no prompt; the size cap and daily loss halt still apply
TRADE_MODE=auto python main.py
```

PowerShell:

```powershell
$env:TRADE_MODE = "confirm"
python main.py
```

Confirm mode prints:

```
==================================================
PROPOSED TRADE
  SELL  $900.00  of AAPL  (weight 9.0%)
  Reason: stop-loss
==================================================
Approve? (y/n):
```

Only `y` or `yes` submits. Alpaca is constructed with `paper=True` and `https://paper-api.alpaca.markets`. Passing `paper=False` raises. There is no live host in this code.

### Risk limits and schedule

| Variable | Default | Effect |
| --- | --- | --- |
| `TRADE_MODE` | `confirm` | `confirm` prompts; `auto` does not. Anything else is treated as `confirm`. |
| `MAX_TRADE_NOTIONAL` | `1000` | Maximum dollars per buy or sell. Larger exits are split across later cycles. A single share that costs more than the cap is skipped. |
| `DAILY_LOSS_LIMIT` | `500` | If equity is this far below the session day's starting equity, trading stops until the next session day. `0` disables it. The halt does not liquidate; it refuses every order, including stops, until the next day. |
| `STOP_LOSS_PCT` | `0.05` | Sell when price is 5% under the average entry. |
| `TARGET_WEIGHT` | `0.20` | Target fraction of equity for one name. |
| `REBALANCE_BAND` | `0.25` | Rebalance only when weight is above `target * (1 + band)` (default ceiling 25%). |
| `CYCLE_SECONDS` | `1800` | Wait between cycles while the market is open (was 5 minutes). |
| `CLOSED_WAIT_SECONDS` | `900` | Wait while the market is closed (was 60 seconds). |
| `WATCHLIST` | `AAPL,MSFT,GOOG` | Comma-separated stock symbols. |
| `TRADE_LOG_PATH` | `trades.csv` | Append-only trade log. |
| `TRADE_STATE_PATH` | `trading_state.json` | Session-day equity, halt latch, and last rebalance date. |

Long stock only. A working order in a symbol blocks a second order in that symbol until it is gone. News or quote failures become `HOLD` for buys; a stop-loss still uses the position mark.

### Trade log

`trades.csv` columns:

`timestamp, symbol, side, qty, price, notional, reason, status, mode, pnl, note`

`status` is `submitted`, `skipped` (confirm declined), `blocked` (cap, halt, or an order already working), `halted`, or `error`. `pnl` on a sell is the estimated result versus average entry at the decision price, not a broker fill. The file stays on this machine.

### Backtest

`backtest.py` replays daily closes. A fast SMA crossing above a slow SMA is treated as `BUY`; a cross the other way is `SELL`. Stops, the once-a-day rebalance slice, the notional cap, and the daily loss halt are the same rules as the paper loop. Fills are assumed at that bar's close after the risk checks. The script does not prompt and does not use the network.

```bash
cd trading
python backtest.py --prices sample_prices.csv --fast 2 --slow 3 --output backtest_trades.csv
```

Defaults are `--fast 5 --slow 20` and `--cash 10000`. Flags `--max-trade`, `--daily-loss-limit`, `--stop-loss`, `--target-weight`, and `--rebalance-band` override the environment for that run. The sample file is a short made-up series (a flat name plus one name that is bought and then stopped out). It is not market data and not a performance claim.

With the built-in risk defaults, that sample command prints:

```
trades submitted: 2
ending cash: $9,917.00
ending equity: $9,917.00
realized pnl: -$83.00
unrealized pnl: $0.00
open positions: 0
```

The CSV is a buy of 83 AAA at 12, then a stop-loss sell at 11 (realized pnl -83). FLAT never trades. Approvals are assumed after the risk checks; the script does not read `TRADE_MODE` and does not prompt.

CSV columns: `date, symbol, close`.

### Tests

No network and no API keys:

```bash
cd trading
pip install -r requirements-dev.txt
python -m pytest
```

## 2. Sentiment example

Path: `trading/sentiment/`

`client_example.py` is a placeholder. It prints one line and does not place orders, fetch news, or write a PDF. There is no `requirements.txt` in that folder. See `sentiment/README.md`.

## 3. IBKR notes

Path: `trading/ibkr/`

Notes on how a sentiment client could be adapted for an Interactive Brokers setup. This repository does not include that strategy or a live IB connection. See `how_to.md`.

## Keys

The paper loop needs a Gemini key, a Tavily key, and Alpaca **paper** keys. The backtest and `pytest` need none of them. Nothing in this folder sends mail.

## Disclaimer

Not financial advice. The loop is paper-only. You are responsible for your own brokerage accounts and for any trading you do outside this program.
