"""
Drop-in execution gate for the portfolio manager.
Supports both auto and confirm modes via TRADE_MODE.

Usage inside execution_node, right before api.submit_order:

    from execution_gate import should_execute

    if not should_execute(ticker, "buy", investment_amount, weight):
        log.append(f"Skipped {ticker}")
        continue

    order = api.submit_order(**order_params)
"""

from confirm import confirm_trade, get_trade_mode

def should_execute(ticker: str, side: str, amount: float, weight: float) -> bool:
    """
    Returns True if the order should be submitted.
    - auto mode: always True
    - confirm mode: True only on explicit y/yes
    """
    mode = get_trade_mode()
    print(f"[MODE] {mode}")
    return confirm_trade(ticker, side, amount, weight)
