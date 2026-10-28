# Wilson Trading Stack

Educational / paper-trading only. Combines three agentic systems:

## 1. Continuous Portfolio Manager (Alpaca)

Path: `trading/`

- LangGraph: Analyst → Portfolio Allocator → Executor → Email
- Hybrid signals (Gemini news + RandomForest on SMA/RSI)
- Runs during market hours at a configurable frequency
- **Toggle between auto-trade and confirmation** via `TRADE_MODE`

```powershell
cd trading
pip install -r requirements.txt
# fill .env from .env.example

# Confirmation mode (default) — asks Y/N before every order
$env:TRADE_MODE = "confirm"
python main.py

# Auto mode — executes immediately, no prompt
$env:TRADE_MODE = "auto"
python main.py
```

In confirm mode the console shows:

```
==================================================
PROPOSED TRADE
  BUY  $4,950.00  of AAPL  (weight 33.0%)
==================================================
Approve? (y/n):
```

Only `y` or `yes` proceeds. Anything else skips that order.

## 2. One-shot Sentiment + PDF Report

Path: `trading/sentiment/`

- News Gatherer → Sentiment → VIX → Strategy Agent
- Emits a PDF audit trail
- Does **not** place orders

```powershell
cd trading/sentiment
pip install -r requirements.txt
$env:GEMINI_API_KEY = "your_key"
python client_example.py
```

## 3. IBKR Integration Guide

Path: `trading/ibkr/`

- How to adapt the sentiment client into an Interactive Brokers `AI_strategy.py`
- See `how_to.md`

## Shared requirements

Gemini API key is required for all LLM steps.  
Alpaca paper keys for the portfolio manager.  
IB TWS/Gateway for the IBKR path.

## Disclaimer

Not financial advice. Use paper accounts. You are responsible for all trading decisions.
