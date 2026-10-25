"""
Y/N confirmation gate for the agentic portfolio manager.
Import and call before any order is submitted.
"""

def confirm_trade(ticker: str, side: str, amount: float, weight: float) -> bool:
    """
    Prompt the user in the console before submitting an order.
    Returns True only if the user types 'y' or 'yes'.
    """
    print()
    print("=" * 50)
    print(f"PROPOSED TRADE")
    print(f"  {side.upper()}  ${amount:,.2f}  of {ticker}  (weight {weight:.1%})")
    print("=" * 50)
    answer = input("Approve? (y/n): ").strip().lower()
    approved = answer in ("y", "yes")
    print("APPROVED" if approved else "SKIPPED")
    print()
    return approved
