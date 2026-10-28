# Multi-Agent Sentiment Analysis System for Trading

**For Educational and Paper Trading Purposes Only**

This client runs a multi-agent pipeline:
1. News Gatherer
2. Sentiment Analyzer
3. Market Data Fetcher (VIX via yfinance)
4. Trading Strategy Agent
5. PDF Report Generation

## Setup
```bash
pip install -r requirements.txt
set GEMINI_API_KEY=your_key   # Windows
python client_example.py
```

Edit ASSET_NAME, EXCHANGE, etc. at the top of client_example.py.

Full source is in the uploaded attachment — copy it over the placeholder.
