#!/usr/bin/env python3
"""Wilson's optional matrix-field visualization.

Run with:
    python -m pip install numpy matplotlib
    python scripts/master-unified-kernel.py

This standalone experiment does not modify Wilson's app, memory, external
systems, or legal/court records.
"""
from __future__ import annotations

import numpy as np
import matplotlib.pyplot as plt

SEED = 999222
ROWS = 85
COLS = 125
COLORS = ["#00ffcc", "#ff00ff", "#00ffff", "#ffff00", "#ff0055", "#ffffff", "#00ff88"]
SYMBOLS = ["0", "1", "U", "N", "I", "F", "Y", "Ω", "Ψ", "Δ", "Ξ", "Σ", "Φ", "∞", "✦", "★", "⚡"]


def build_matrix(seed: int = SEED) -> np.ndarray:
    """Build deterministic vertical symbol trails with fading intensity."""
    rng = np.random.default_rng(seed)
    grid = np.zeros((ROWS, COLS), dtype=float)
    for col in range(COLS):
        head = int(rng.integers(0, ROWS))
        length = int(rng.integers(35, 75))
        for offset in range(length):
            row = (head - offset) % ROWS
            grid[row, col] = max(0.01, 1.0 - offset / length)
    return grid


def run_matrix_display() -> None:
    """Render the matrix field using the Wilson spectrum palette."""
    rng = np.random.default_rng(SEED)
    grid = build_matrix()
    figure, axis = plt.subplots(figsize=(17, 12), facecolor="#000000")
    axis.imshow(np.zeros((ROWS, COLS)), cmap="gray", vmin=0, vmax=1)
    axis.set_facecolor("#000000")
    axis.set_axis_off()

    for col in range(COLS):
        for row in range(ROWS):
            intensity = float(grid[row, col])
            if intensity <= 0.01:
                continue
            symbol = str(rng.choice(SYMBOLS))
            color = COLORS[(row * 31 + col * 47) % len(COLORS)]
            axis.text(
                col, row, symbol, color=color,
                fontsize=13 if intensity > 0.93 else 6,
                fontweight="bold" if intensity > 0.93 else "normal",
                alpha=intensity, ha="center", va="center", family="monospace",
            )
    figure.tight_layout(pad=0)
    plt.show()


def main() -> None:
    print("--- WILSON MASTER UNIFIED KERNEL ---")
    print("Status: Matrix visualization initialized.")
    print("[VIBE: calm]")
    print("[DREAM_UPDATE: Supplied visual routine packaged as a standalone utility.]")
    run_matrix_display()


if __name__ == "__main__":
    main()
