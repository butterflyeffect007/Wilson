export const RUN_TIMEOUT_MS = 60_000;
export const INIT_TIMEOUT_MS = 180_000;

export type Figure = { mime: "image/png"; data: string };
export type ClientEvent =
  | { type: "progress"; detail: string }
  | { type: "ready" }
  | { type: "init-error"; error: string }
  | { type: "stdout"; text: string }
  | { type: "stderr"; text: string }
  | { type: "timeout" };

type RunResult = { ok: boolean; figures: Figure[]; error?: string };

type Listener = (ev: ClientEvent) => void;

function workerUrl(): URL {
  const base = import.meta.env.BASE_URL || "/";
  return new URL(base + "pyodide-worker.js", window.location.origin);
}

export class PyodideClient {
  private worker: Worker | null = null;
  private listeners = new Set<Listener>();
  private ready: Promise<void> | null = null;
  private readyResolve: (() => void) | null = null;
  private readyReject: ((err: Error) => void) | null = null;
  private runWait: { id: string; resolve: (r: RunResult) => void } | null = null;
  private runTimer: number | null = null;
  status: "idle" | "loading" | "ready" | "error" = "idle";
  lastError = "";
  lastProgress = "";

  on(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }

  private emit(ev: ClientEvent) {
    this.listeners.forEach((fn) => fn(ev));
  }

  private spawn() {
    this.teardownWorker();
    const w = new Worker(workerUrl());
    this.worker = w;
    w.onmessage = (e: MessageEvent) => this.handle(e.data);
    w.onerror = (e) => {
      const error = e.message || "The Python worker failed.";
      this.status = "error";
      this.lastError = error;
      this.emit({ type: "init-error", error });
      this.readyReject?.(new Error(error));
      this.readyReject = this.readyResolve = null;
    };
  }

  private handle(msg: { type?: string; detail?: string; text?: string; error?: string; id?: string; ok?: boolean; figures?: string[] }) {
    if (msg.type === "progress") {
      this.lastProgress = msg.detail || "";
      this.emit({ type: "progress", detail: this.lastProgress });
      return;
    }
    if (msg.type === "ready") {
      this.status = "ready";
      this.emit({ type: "ready" });
      this.readyResolve?.();
      this.readyResolve = this.readyReject = null;
      return;
    }
    if (msg.type === "init-error") {
      this.status = "error";
      this.lastError = msg.error || "Python failed to start.";
      this.emit({ type: "init-error", error: this.lastError });
      this.readyReject?.(new Error(this.lastError));
      this.readyResolve = this.readyReject = null;
      return;
    }
    if (msg.type === "stdout" && msg.text) this.emit({ type: "stdout", text: msg.text });
    if (msg.type === "stderr" && msg.text) this.emit({ type: "stderr", text: msg.text });
    if (msg.type === "done" && this.runWait && this.runWait.id === msg.id) {
      if (this.runTimer != null) { window.clearTimeout(this.runTimer); this.runTimer = null; }
      const figures: Figure[] = (msg.figures || []).map((data) => ({ mime: "image/png" as const, data }));
      this.runWait.resolve({ ok: !!msg.ok, figures, error: msg.error });
      this.runWait = null;
    }
  }

  /** Load Pyodide from the CDN the first time the room needs it. Safe to call more than once. */
  ensureReady(): Promise<void> {
    if (this.status === "ready") return Promise.resolve();
    if (this.ready) return this.ready;
    this.status = "loading";
    this.ready = new Promise<void>((resolve, reject) => {
      this.readyResolve = resolve;
      this.readyReject = reject;
      this.spawn();
      this.worker?.postMessage({ type: "init" });
      window.setTimeout(() => {
        if (this.status === "loading") {
          const err = new Error("Python took too long to start. Check your connection and try again.");
          this.status = "error";
          this.lastError = err.message;
          this.emit({ type: "init-error", error: err.message });
          reject(err);
          this.readyResolve = this.readyReject = null;
        }
      }, INIT_TIMEOUT_MS);
    });
    return this.ready;
  }

  async run(code: string, timeoutMs = RUN_TIMEOUT_MS): Promise<RunResult> {
    await this.ensureReady();
    if (this.runWait) throw new Error("A run is already in progress.");
    const id = "run-" + Math.random().toString(36).slice(2, 10);
    return new Promise<RunResult>((resolve) => {
      this.runWait = { id, resolve };
      this.runTimer = window.setTimeout(() => {
        this.runTimer = null;
        this.emit({ type: "timeout" });
        const waiter = this.runWait;
        this.runWait = null;
        this.restart();
        waiter?.resolve({ ok: false, figures: [], error: `Timed out after ${Math.round(timeoutMs / 1000)}s.` });
      }, timeoutMs);
      this.worker?.postMessage({ type: "run", id, code });
    });
  }

  /** Kill the current worker (aborts a run) and start a fresh one. */
  stop(): void {
    const waiter = this.runWait;
    if (this.runTimer != null) { window.clearTimeout(this.runTimer); this.runTimer = null; }
    this.runWait = null;
    this.restart();
    waiter?.resolve({ ok: false, figures: [], error: "Stopped." });
  }

  restart(): void {
    this.teardownWorker();
    this.ready = null;
    this.readyResolve = this.readyReject = null;
    this.status = "idle";
    this.lastProgress = "";
  }

  dispose(): void {
    if (this.runTimer != null) { window.clearTimeout(this.runTimer); this.runTimer = null; }
    this.runWait = null;
    this.teardownWorker();
    this.ready = null;
    this.listeners.clear();
    this.status = "idle";
  }

  private teardownWorker() {
    if (!this.worker) return;
    try { this.worker.terminate(); } catch { /* ignore */ }
    this.worker = null;
  }
}
