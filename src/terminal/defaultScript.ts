export const DEFAULT_FILENAME = "matrix.py";

export const DEFAULT_SCRIPT = `import numpy as np
import matplotlib.pyplot as plt

# 5×5 resonance matrix — 3 · 6 · 9 overtones
n = 5
idx = np.arange(1, n + 1)
R = np.outer(
    np.sin(idx * np.pi / 3),
    np.cos(idx * np.pi / 6),
)
R += 0.369 * np.eye(n)

print("resonance matrix 5×5")
np.set_printoptions(precision=3, suppress=True)
print(R)

fig, ax = plt.subplots(figsize=(4, 3.4))
im = ax.imshow(R, cmap="magma")
ax.set_title("resonance")
plt.colorbar(im)
plt.show()
`;
