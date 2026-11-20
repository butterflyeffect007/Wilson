"""Turn a model reply into BUY, SELL, or HOLD.

The live loop asks Gemini for one of those three words. Anything else is HOLD,
so a chatty or empty reply cannot place an order.
"""

from __future__ import annotations


_SIGNALS = {"BUY", "SELL", "HOLD"}


def parse_signal(text: str) -> str:
    raw = (text or "").strip().upper()
    if not raw:
        return "HOLD"
    first = raw.replace("\n", " ").split()[0]
    token = "".join(ch for ch in first if ch.isalpha())
    if token in _SIGNALS:
        return token
    return "HOLD"


def normalize_signal(value: str) -> str:
    token = (value or "").strip().upper()
    if token in _SIGNALS:
        return token
    return "HOLD"
