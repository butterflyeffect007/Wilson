"""Local CSV of each paper order and its outcome. Nothing here is uploaded."""

from __future__ import annotations

import csv
from pathlib import Path


COLUMNS = [
    "timestamp",
    "symbol",
    "side",
    "qty",
    "price",
    "notional",
    "reason",
    "status",
    "mode",
    "pnl",
    "note",
]


def _prepare(row: dict) -> dict[str, str]:
    prepared = {column: "" for column in COLUMNS}
    for column in COLUMNS:
        value = row.get(column, "")
        if value is None:
            prepared[column] = ""
        else:
            prepared[column] = str(value)
    return prepared


def append_trade(path: str, row: dict) -> None:
    file = Path(path)
    if file.parent and str(file.parent) not in ("", "."):
        file.parent.mkdir(parents=True, exist_ok=True)
    new_file = not file.exists() or file.stat().st_size == 0
    with file.open("a", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=COLUMNS)
        if new_file:
            writer.writeheader()
        writer.writerow(_prepare(row))


def write_trades(path: str, rows: list[dict]) -> None:
    """Replace the file. Used by the backtest so a rerun does not append."""
    file = Path(path)
    if file.parent and str(file.parent) not in ("", "."):
        file.parent.mkdir(parents=True, exist_ok=True)
    with file.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=COLUMNS)
        writer.writeheader()
        for row in rows:
            writer.writerow(_prepare(row))


def read_trades(path: str) -> list[dict[str, str]]:
    file = Path(path)
    if not file.exists():
        return []
    with file.open(newline="", encoding="utf-8") as handle:
        return list(csv.DictReader(handle))
