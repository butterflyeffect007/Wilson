# Multi-Agent System for an IB Stock Setup

**Educational / Paper Trading Only**

Integrates the multi-agent sentiment pipeline into an Interactive Brokers stock framework.

- News Gatherer → Sentiment Analyzer → VIX → Strategy Agent
- Output is a `(signal, leverage)` tuple consumed by the IB setup
- See `how_to.md` for generating `AI_strategy.py` from `client_example.py`

Requires: IB account + TWS/Gateway, Gemini key, and the ibkr-stock package from QuantInsti.
