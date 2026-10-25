from agentic_AI_portfolio_manager import engine_loop

if __name__ == "__main__":
    risk_specs = {
        "stop_loss": {"type": "percentage", "value": 0.02},
        "take_profit": {"type": "percentage", "value": 0.04}
    }
    
    engine_loop(
        tickers=["AAPL", "MSFT", "GOOG"],
        data_frequency="5min",
        num_observations=90,
        trader_timezone="America/Chicago",  # Austin, TX
        news_lookback_minutes=10,
        num_web_links=10,
        risk_management_specs=risk_specs
    )
