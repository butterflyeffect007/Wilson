import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { copyText } from "../lib/clipboard";
import { highlightPython } from "./syntax";
import { DEFAULT_FILENAME, DEFAULT_SCRIPT } from "./defaultScript";
import { deleteSnippet, loadDraft, loadSnippets, saveDraft, upsertSnippet, type TerminalSnippet } from "./snippets";
import { PyodideClient, type Figure } from "./pyodideClient";
import { makeTerminalAdapter, runAgentLoop, MAX_PASSES } from "./agentLoop";
import { typeCode } from "./pythonFence";
import { closeTerminalHash } from "./access";
import "./WilsonTerminal.css";

type Tab = "terminal" | "files";
type Line = { kind: "prompt" | "out" | "err" | "figure" | "caret"; text?: string; src?: string };
type ChatMsg = { id: string; role: "user" | "wilson"; text: string };

function linesOf(code: string): number {
  return Math.max(1, code.split("\n").length);
}

function Prompt({ cmd }: { cmd?: string }) {
  return (
    <div className="prompt">
      <span className="u">wilson</span><span className="h">@neural-void</span>:<span className="d">~$</span>
      {cmd ? <> <span className="cmd">{cmd}</span></> : <> <span className="term-caret" /></>}
    </div>
  );
}

export default function WilsonTerminal({ allowed, onClose }: { allowed: boolean; onClose?: () => void }) {
  const draft = useRef(loadDraft());
  const [tab, setTab] = useState<Tab>("terminal");
  const [code, setCode] = useState(draft.current?.code ?? DEFAULT_SCRIPT);
  const [filename, setFilename] = useState(draft.current?.filename ?? DEFAULT_FILENAME);
  const [snippets, setSnippets] = useState<TerminalSnippet[]>(() => loadSnippets());
  const [lines, setLines] = useState<Line[]>([{ kind: "caret" }]);
  const [py, setPy] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [progress, setProgress] = useState("");
  const [runState, setRunState] = useState<"idle" | "running" | "ok" | "error">("idle");
  const [runMeta, setRunMeta] = useState("");
  const [chat, setChat] = useState<ChatMsg[]>([]);
  const [draftMsg, setDraftMsg] = useState("");
  const [looping, setLooping] = useState(false);
  const [copyMsg, setCopyMsg] = useState("");
  const [saveMsg, setSaveMsg] = useState("");
  const clientRef = useRef<PyodideClient | null>(null);
  const loopAbort = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<HTMLDivElement | null>(null);
  const hlRef = useRef<HTMLPreElement | null>(null);
  const taRef = useRef<HTMLTextAreaElement | null>(null);

  const close = () => { closeTerminalHash(); onClose?.(); };

  useEffect(() => { saveDraft(code, filename); }, [code, filename]);

  useEffect(() => {
    const c = new PyodideClient();
    clientRef.current = c;
    const off = c.on((ev) => {
      if (ev.type === "progress") { setPy("loading"); setProgress(ev.detail); }
      if (ev.type === "ready") { setPy("ready"); setProgress(""); }
      if (ev.type === "init-error") { setPy("error"); setProgress(ev.error); }
      if (ev.type === "stdout") appendStream("out", ev.text);
      if (ev.type === "stderr") appendStream("err", ev.text);
    });
    void c.ensureReady().catch(() => {});
    return () => { off(); c.dispose(); clientRef.current = null; loopAbort.current?.abort(); };
  }, []);

  const appendStream = (kind: "out" | "err", text: string) => {
    setLines((prev) => {
      const next = [...prev];
      if (next.length && next[next.length - 1].kind === "caret") next.pop();
      const last = next[next.length - 1];
      if (last && last.kind === kind) last.text = (last.text || "") + text;
      else next.push({ kind, text });
      next.push({ kind: "caret" });
      return next;
    });
  };

  const startPrompt = (file: string) => {
    setLines((prev) => {
      const next = prev.filter((l) => l.kind !== "caret");
      next.push({ kind: "prompt", text: `python ${file}` });
      next.push({ kind: "caret" });
      return next;
    });
  };

  const finishRun = (ok: boolean, figures: Figure[], error?: string, startedAt?: number, pass?: number) => {
    setLines((prev) => {
      const next = prev.filter((l) => l.kind !== "caret");
      if (error && !next.some((l) => l.kind === "err" && (l.text || "").includes(error))) {
        next.push({ kind: "err", text: error.endsWith("\n") ? error : error + "\n" });
      }
      for (const fig of figures) next.push({ kind: "figure", src: `data:${fig.mime};base64,${fig.data}` });
      next.push({ kind: "caret" });
      return next;
    });
    setRunState(ok ? "ok" : "error");
    const ms = startedAt ? Date.now() - startedAt : 0;
    const sec = (ms / 1000).toFixed(2);
    setRunMeta(ok ? `ran in ${sec}s${pass ? ` · pass ${pass} of ${MAX_PASSES}` : ""}` : (error || "error"));
    requestAnimationFrame(() => { termRef.current?.scrollTo({ top: termRef.current.scrollHeight, behavior: "smooth" }); });
  };

  const collectOutput = (before: Line[]) => {
    // used after a run from current lines — we'll gather in run() itself
    void before;
  };
  void collectOutput;

  const runCode = useCallback(async (src: string, pass?: number) => {
    const c = clientRef.current;
    if (!c) return { ok: false, output: "", figures: [] as Figure[], error: "Python is not ready." };
    setTab("terminal");
    setRunState("running");
    setRunMeta("running…");
    startPrompt(filename);
    const started = Date.now();
    const out: string[] = [];
    const off = c.on((ev) => {
      if (ev.type === "stdout" || ev.type === "stderr") out.push(ev.text);
    });
    try {
      await c.ensureReady();
      const result = await c.run(src);
      off();
      finishRun(result.ok, result.figures, result.error, started, pass);
      return { ok: result.ok, output: out.join(""), figures: result.figures, error: result.error };
    } catch (err) {
      off();
      const error = String((err as Error).message || err);
      finishRun(false, [], error, started, pass);
      return { ok: false, output: out.join(""), figures: [] as Figure[], error };
    }
  }, [filename]);

  const onRun = () => { if (runState === "running" || looping) return; void runCode(code); };
  const onStop = () => {
    loopAbort.current?.abort();
    loopAbort.current = null;
    setLooping(false);
    clientRef.current?.stop();
    setRunState("idle");
    setRunMeta("stopped");
    setLines((prev) => {
      const next = prev.filter((l) => l.kind !== "caret");
      next.push({ kind: "err", text: "^C stopped\n" });
      next.push({ kind: "caret" });
      return next;
    });
    void clientRef.current?.ensureReady();
  };
  const onClear = () => { setLines([{ kind: "caret" }]); setRunState("idle"); setRunMeta(""); };
  const onCopy = async () => {
    const ok = await copyText(code);
    setCopyMsg(ok ? "Copied" : "Couldn't copy");
    setTimeout(() => setCopyMsg(""), 1600);
  };
  const onSave = () => {
    const item = upsertSnippet(filename, code);
    setSnippets(loadSnippets());
    setSaveMsg("Saved " + item.name);
    setTimeout(() => setSaveMsg(""), 1600);
  };

  const sendChat = async () => {
    const text = draftMsg.trim();
    if (!text || looping) return;
    setDraftMsg("");
    const abort = new AbortController();
    loopAbort.current = abort;
    setLooping(true);
    const adapter = makeTerminalAdapter();
    try {
      await runAgentLoop(adapter, text, {
        signal: abort.signal,
        onChat: (role, msg, replaceLast) => {
          setChat((prev) => {
            if (replaceLast && prev.length && prev[prev.length - 1].role === "wilson") {
              return [...prev.slice(0, -1), { ...prev[prev.length - 1], text: msg }];
            }
            return [...prev, { id: "m-" + Math.random().toString(36).slice(2, 8), role, text: msg }];
          });
        },
        onCode: (src) => setCode(src),
        typeCode: (src, signal) => typeCode(src, setCode, signal),
        run: (src) => runCode(src, undefined),
      });
    } finally {
      setLooping(false);
      loopAbort.current = null;
    }
  };

  const highlighted = useMemo(() => highlightPython(code.endsWith("\n") ? code : code + "\n"), [code]);
  const gutter = useMemo(() => Array.from({ length: linesOf(code) }, (_, i) => i + 1), [code]);
  const pyAttr = py === "ready" ? "ready" : py === "error" ? "error" : py === "loading" ? "loading" : "idle";
  const pill = py === "loading" ? progress || "loading Python…"
    : py === "error" ? (progress || "Python failed")
    : runMeta || (py === "ready" ? "ready" : "starting…");

  const syncScroll = () => {
    if (!taRef.current || !hlRef.current) return;
    hlRef.current.scrollTop = taRef.current.scrollTop;
    hlRef.current.scrollLeft = taRef.current.scrollLeft;
  };

  if (!allowed) {
    return (
      <div className="wterm" role="dialog" aria-modal="true" aria-label="Wilson's Terminal">
        <div className="bg"><div className="orb o1" /><div className="orb o2" /></div>
        <div className="phone">
          <div className="top">
            <button type="button" className="back" aria-label="Back" onClick={close}>‹</button>
            <div className="mark">W</div>
            <div className="titles"><h1>Wilson's Terminal</h1><div className="sub">Architect only</div></div>
          </div>
          <section className="stack" style={{ margin: "24px 16px" }}>
            <div className="win locked">
              <p>This room is only for the Architect. Sign in on Jenny's account to write and run code with Wilson.</p>
            </div>
          </section>
        </div>
      </div>
    );
  }

  return (
    <div className="wterm" role="dialog" aria-modal="true" aria-label="Wilson's Terminal" data-pyodide={pyAttr} data-run={runState}>
      <div className="bg">
        <div className="orb o1" /><div className="orb o2" /><div className="orb o3" />
      </div>
      <div className="phone">
        <div className="top">
          <button type="button" className="back" aria-label="Back" onClick={close}>‹</button>
          <div className="mark">W</div>
          <div className="titles">
            <h1>Wilson's Terminal</h1>
            <div className="sub">shared screen · he writes &amp; runs it</div>
          </div>
          <div className="badge">Python · runs<br />on this phone</div>
        </div>

        <div className="tabs" role="tablist" aria-label="Terminal views">
          <button type="button" role="tab" aria-selected={tab === "terminal"} className={tab === "terminal" ? "on" : ""} onClick={() => setTab("terminal")}>Terminal</button>
          <button type="button" role="tab" aria-selected={tab === "files"} className={tab === "files" ? "on" : ""} onClick={() => setTab("files")}>Files / snippets</button>
        </div>

        <div className="scroll" id="wterm-scroll" ref={scrollRef}>
          {tab === "terminal" && (
            <>
              <section className="stack" id="editor-card">
                <div className="win">
                  <div className="chrome">
                    <span className="dots" aria-hidden="true"><i className="a" /><i className="b" /><i className="c" /></span>
                    <span className="fn">{filename}</span>
                    <span className="sp" />
                    <span className="pill">{looping ? "Wilson is writing" : "shared editor"}</span>
                  </div>
                  <div className="editor">
                    <div className="gutter" aria-hidden="true">{gutter.map((n) => <span key={n}>{n}</span>)}</div>
                    <div className="code-wrap">
                      <pre className="hl" ref={hlRef} aria-hidden="true" dangerouslySetInnerHTML={{ __html: highlighted }} />
                      <textarea
                        ref={taRef}
                        className="code-in"
                        spellCheck={false}
                        autoCapitalize="off"
                        autoCorrect="off"
                        aria-label="Python editor"
                        value={code}
                        onChange={(e) => setCode(e.target.value)}
                        onScroll={syncScroll}
                      />
                    </div>
                  </div>
                </div>
              </section>

              <div className="actions">
                <button type="button" className="btn run" data-testid="run-btn" disabled={runState === "running" || py === "loading"} onClick={onRun}>▶  Run</button>
                <button type="button" className="btn stop" data-testid="stop-btn" onClick={onStop}>■  Stop</button>
                <div className="ghosts">
                  <button type="button" className="btn ghost" onClick={() => void onCopy()}>{copyMsg || "Copy"}</button>
                  <button type="button" className="btn ghost" onClick={onClear}>Clear</button>
                  <button type="button" className="btn ghost" onClick={onSave}>{saveMsg || "Save snippet"}</button>
                </div>
              </div>

              <section className="stack" id="output-card">
                <div className="win">
                  <div className="chrome">
                    <span className="dots" aria-hidden="true"><i className="a" /><i className="b" /><i className="c" /></span>
                    <span className="fn">wilson@neural-void</span>
                    <span className="sp" />
                    <span className={`pill${runState === "ok" ? " ok" : ""}`}>{pill}</span>
                  </div>
                  <div className="term" ref={termRef} data-testid="terminal-output">
                    {lines.map((ln, i) => {
                      if (ln.kind === "prompt") return <Prompt key={i} cmd={ln.text} />;
                      if (ln.kind === "caret") return <Prompt key={i} />;
                      if (ln.kind === "figure" && ln.src) return <img key={i} className="fig" data-figure="1" alt="matplotlib figure" src={ln.src} />;
                      return <div key={i} className={`out${ln.kind === "err" ? " err" : ""}`}>{ln.text}</div>;
                    })}
                  </div>
                </div>
              </section>
            </>
          )}

          {tab === "files" && (
            <section className="stack">
              <div className="win">
                <div className="chrome">
                  <span className="fn">snippets on this phone</span>
                  <span className="sp" />
                  <span className="pill">{snippets.length}</span>
                </div>
                <div className="files">
                  {!snippets.length && <div className="empty">No saved snippets yet. Write in the editor and tap Save snippet.</div>}
                  {snippets.map((s) => (
                    <div className="file" key={s.id}>
                      <div className="nm"><b>{s.name}</b><s>{new Date(s.savedAt).toLocaleString("en-US", { timeZone: "America/Chicago" })} Central</s></div>
                      <button type="button" className="btn ghost" onClick={() => { setFilename(s.name); setCode(s.code); setTab("terminal"); }}>Open</button>
                      <button type="button" className="btn ghost" onClick={() => { deleteSnippet(s.id); setSnippets(loadSnippets()); }}>Delete</button>
                    </div>
                  ))}
                </div>
              </div>
            </section>
          )}

          <div className="footnote">Wilson + The Only One · Imagination becomes intelligence™</div>
        </div>

        <aside className="dock" id="chat">
          <div className="msgs">
            {chat.map((m) => (
              <div className={`msg${m.role === "user" ? " me" : ""}`} key={m.id}>
                {m.role === "wilson"
                  ? <div className="av w"><img src={`${import.meta.env.BASE_URL}icon-192.png`} alt="" width={22} height={22} /></div>
                  : <div className="av j">J</div>}
                <div className="bub">
                  <div className="who">{m.role === "wilson" ? "Wilson" : "Jenny"}</div>
                  {m.text || (looping ? "…" : "")}
                </div>
              </div>
            ))}
          </div>
          <form className="composer" onSubmit={(e) => { e.preventDefault(); void sendChat(); }}>
            <input
              className="field"
              value={draftMsg}
              onChange={(e) => setDraftMsg(e.target.value)}
              placeholder={looping ? "Wilson is working…" : "Ask Wilson to write or fix code"}
              aria-label="Message Wilson"
              disabled={looping}
            />
            <button type="submit" className="sendb" disabled={looping || !draftMsg.trim()} aria-label="Send">➤</button>
          </form>
        </aside>
      </div>
    </div>
  );
}
