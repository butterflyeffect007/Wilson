/* Wilson's Terminal — Pyodide runner (classic worker, loaded only when the room opens). */
/* global loadPyodide, importScripts */
const CDN = "https://cdn.jsdelivr.net/pyodide/v0.27.6/full/";

let pyodide = null;
let busy = false;
let live = false;

function send(msg) {
  self.postMessage(msg);
}

async function grabFigures() {
  if (!pyodide) return [];
  const raw = await pyodide.runPythonAsync(`
import io, base64
import matplotlib.pyplot as plt
_out = []
for _n in list(plt.get_fignums()):
    _buf = io.BytesIO()
    plt.figure(_n).savefig(_buf, format="png", dpi=140, bbox_inches="tight", facecolor="#07040D", edgecolor="none")
    _out.append(base64.b64encode(_buf.getvalue()).decode("ascii"))
plt.close("all")
_out
`);
  try {
    const js = raw && raw.toJs ? raw.toJs() : raw;
    const arr = Array.from(js || []);
    if (raw && typeof raw.destroy === "function") raw.destroy();
    return arr;
  } catch {
    return [];
  }
}

async function boot() {
  send({ type: "progress", detail: "Downloading Python…" });
  importScripts(CDN + "pyodide.js");
  send({ type: "progress", detail: "Starting the interpreter…" });
  const emit = (type, s) => {
    if (!live) return;
    const t = typeof s === "string" ? s : String(s);
    send({ type, text: t.endsWith("\n") ? t : t + "\n" });
  };
  pyodide = await loadPyodide({
    indexURL: CDN,
    stdout: (s) => emit("stdout", s),
    stderr: (s) => emit("stderr", s),
  });
  send({ type: "progress", detail: "Loading numpy, matplotlib, micropip…" });
  await pyodide.loadPackage(["numpy", "matplotlib", "micropip"]);
  await pyodide.runPythonAsync(`
import warnings
warnings.filterwarnings("ignore", message=r".*FigureCanvasAgg is non-interactive.*")
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
# Warm the font cache during load so the first visible run stays clean.
plt.figure(); plt.close("all")
`);
  live = true;
  send({ type: "ready" });
}

self.onmessage = async (e) => {
  const msg = e.data || {};
  if (msg.type === "init") {
    try {
      await boot();
    } catch (err) {
      send({ type: "init-error", error: String((err && err.message) || err) });
    }
    return;
  }
  if (msg.type !== "run") return;
  const id = msg.id;
  if (!pyodide) {
    send({ type: "done", id, ok: false, figures: [], error: "Python is not ready yet." });
    return;
  }
  if (busy) {
    send({ type: "done", id, ok: false, figures: [], error: "A run is already in progress." });
    return;
  }
  busy = true;
  try {
    await pyodide.runPythonAsync(String(msg.code ?? ""));
    const figures = await grabFigures();
    send({ type: "done", id, ok: true, figures });
  } catch (err) {
    const error = String((err && err.message) || err);
    send({ type: "stderr", text: error.endsWith("\n") ? error : error + "\n" });
    let figures = [];
    try { figures = await grabFigures(); } catch { /* ignore */ }
    send({ type: "done", id, ok: false, figures, error });
  } finally {
    busy = false;
  }
};
