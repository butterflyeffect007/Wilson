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
    _fig = plt.figure(_n)
    _wilson_latinize_figure(_fig)
    _fig.patch.set_facecolor("#07040D")
    for _ax in _fig.axes:
        _ax.tick_params(colors="#F6EEFF", labelcolor="#F6EEFF")
        _ax.xaxis.label.set_color("#F6EEFF")
        _ax.yaxis.label.set_color("#F6EEFF")
        if _ax.get_title():
            _ax.title.set_color("#F6EEFF")
        for _sp in _ax.spines.values():
            _sp.set_color("#CDB4FF")
        _cb = getattr(_ax, "colorbar", None) or getattr(_ax, "_colorbar", None)
        if _cb is not None:
            _cb.ax.yaxis.label.set_color("#F6EEFF")
            _cb.ax.tick_params(colors="#F6EEFF", labelcolor="#F6EEFF")
    _buf = io.BytesIO()
    _fig.savefig(_buf, format="png", dpi=140, bbox_inches="tight", facecolor="#07040D", edgecolor="none")
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
# DejaVu (the font Pyodide matplotlib ships) is Latin-only. Ignore tofu warnings
# so a Matrix-rain script does not flood the terminal on a phone.
warnings.filterwarnings("ignore", message=r"Glyph .* missing from current font")
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.text import Text as _WilsonText
_LIGHT = "#F6EEFF"
matplotlib.rcParams.update({
    "figure.facecolor": "#07040D",
    "axes.facecolor": "#0C0718",
    "axes.edgecolor": "#CDB4FF",
    "axes.labelcolor": _LIGHT,
    "axes.titlecolor": _LIGHT,
    "xtick.color": _LIGHT,
    "ytick.color": _LIGHT,
    "text.color": _LIGHT,
    "savefig.facecolor": "#07040D",
    "savefig.edgecolor": "none",
    "legend.edgecolor": "#CDB4FF",
    "legend.labelcolor": _LIGHT,
    "legend.facecolor": "#0C0718",
})
# Map CJK / kana / fullwidth glyphs to ASCII so figures stay readable
# without downloading a CJK font on a phone. One character in, one out,
# so a Matrix-rain grid keeps its columns.
_WILSON_RAIN = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz#$%&*+=<>/|"
def _wilson_plot_text(s):
    if not isinstance(s, str) or not s:
        return s
    out = []
    for ch in s:
        o = ord(ch)
        if 0xFF01 <= o <= 0xFF5E:
            out.append(chr(o - 0xFEE0))
        elif o == 0x3000:
            out.append(" ")
        elif (0x3040 <= o <= 0x30FF) or (0x31F0 <= o <= 0x31FF) or (0xFF65 <= o <= 0xFF9F) or (0x3400 <= o <= 0x4DBF) or (0x4E00 <= o <= 0x9FFF) or (0xF900 <= o <= 0xFAFF):
            out.append(_WILSON_RAIN[o % len(_WILSON_RAIN)])
        else:
            out.append(ch)
    return "".join(out)
def _wilson_latinize_figure(fig):
    def walk(artist):
        if isinstance(artist, _WilsonText):
            t = artist.get_text()
            if t:
                n = _wilson_plot_text(t)
                if n != t:
                    artist.set_text(n)
        for child in artist.get_children():
            walk(child)
    walk(fig)
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
