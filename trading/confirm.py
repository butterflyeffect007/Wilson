"""
Trade confirmation helper with auto/confirm toggle.

Set the environment variable TRADE_MODE to control behavior:
  TRADE_MODE=auto     → execute immediately (no prompt)
  TRADE_MODE=confirm  → ask Y/N before every order (default)

Risk limits in the execution gate still apply in both modes.
A closed stdin (EOF) skips the order.
"""
import os


def get_trade_mode() -> str:
    """Returns 'auto' or 'confirm'. Defaults to 'confirm'."""
    mode = os.getenv("TRADE_MODE", "confirm").strip().lower()
    return mode if mode in ("auto", "confirm") else "confirm"


def confirm_trade(ticker: str, side: str, amount: float, weight: float, reason: str = "") -> bool:
    """
    Returns True if the trade should proceed.
    - In 'auto' mode: always True
    - In 'confirm' mode: True only if user types y/yes
    """
    mode = get_trade_mode()

    if mode == "auto":
        reason_note = f" [{reason}]" if reason else ""
        print(f"[AUTO] {side.upper()} ${amount:,.2f} of {ticker} (weight {weight:.1%}){reason_note}")
        return True

    print()
    print("=" * 50)
    print("PROPOSED TRADE")
    print(f"  {side.upper()}  ${amount:,.2f}  of {ticker}  (weight {weight:.1%})")
    if reason:
        print(f"  Reason: {reason}")
    print("=" * 50)
    try:
        answer = input("Approve? (y/n): ").strip().lower()
    except EOFError:
        print("SKIPPED")
        print()
        return False
    approved = answer in ("y", "yes")
    print("APPROVED" if approved else "SKIPPED")
    print()
    return approved
