/**
 * Operator room: Wilson does a task on the web while the user watches.
 * Visual style follows the Jobs/Terminal rooms (Neural Void glass, Lexend).
 * Model and tool logic live in loop.ts / tools.ts / brain.ts, not here.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Markdown } from "../components/Markdown";
import { copyText } from "../lib/clipboard";
import { speakMessage, stopSpeaking } from "../lib/kokoroTTS";
import { closeOperatorHash, operatorGoalFromHash } from "./access";
import { makeBrain } from "./brain";
import { runOperator, type ConfirmRequest, type OperatorResult, type Step } from "./loop";
import { loadOperatorSettings, saveOperatorSettings, type OperatorSettings } from "./settings";
import { createOperatorTools } from "./tools";
import "./OperatorRoom.css";

const EXAMPLES = [
  "Search for free AI grants for solo founders and list the top 3 with links",
  "Find three free note-taking apps that work on iPhone and compare them",
  "Find the opening hours and address of the nearest public library to Austin, TX",
];

const ICON: Record<Step["kind"], string> = { plan: "🗺️", search: "🔎", open: "📄", click: "👆", type: "⌨️", submit: "📨", snapshot: "📸", lookup: "🛰️", finish: "✨", think: "💭", error: "⚠️" };
const STATUS: Record<Step["status"], string> = { running: "working…", done: "done", failed: "didn't work", waiting: "needs your OK", declined: "skipped (you said no)", blocked: "not allowed", stopped: "stopped" };

const cleanAnswer = (t: string) => t.replace(/\[(VIBE|DREAM_UPDATE):[^\]]*\]?/gi, "").trim();

type Pending = ConfirmRequest & { resolve: (ok: boolean) => void };

export default function OperatorRoom({ allowed, onClose, personName = "Jenny" }: { allowed: boolean; onClose?: () => void; personName?: string }) {
  const [goal, setGoal] = useState(() => operatorGoalFromHash());
  const [steps, setSteps] = useState<Step[]>([]);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<OperatorResult | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [settings, setSettings] = useState<OperatorSettings>(() => loadOperatorSettings());
  const [showSettings, setShowSettings] = useState(false);
  const [zoom, setZoom] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const ctlRef = useRef<AbortController | null>(null);
  const pendingRef = useRef<Pending | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);

  const brainLabel = settings.groqKey ? "Private brain" : "Usual brain";
  const live = !!(settings.browserUrl && settings.browserToken);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [steps.length, result, pending]);
  useEffect(() => () => { ctlRef.current?.abort(); pendingRef.current?.resolve(false); }, []);

  const close = () => { stop(); onClose?.(); closeOperatorHash(); };

  const stop = useCallback(() => {
    ctlRef.current?.abort();
    pendingRef.current?.resolve(false);
    pendingRef.current = null;
    setPending(null);
    stopSpeaking();
  }, []);

  const start = useCallback(async (g?: string) => {
    const text = (g ?? goal).trim();
    if (!text || running) return;
    setGoal(text); setSteps([]); setResult(null); setNote("");
    const ctl = new AbortController();
    ctlRef.current = ctl;
    setRunning(true);
    const tools = createOperatorTools({ browser: live ? { url: settings.browserUrl, token: settings.browserToken } : null, snapshots: settings.snapshots });
    try {
      const res = await runOperator(text, {
        brain: makeBrain(settings),
        tools,
        personName,
        isArchitect: true,
        hooks: {
          signal: ctl.signal,
          onStep: (s) => setSteps((prev) => { const i = prev.findIndex((x) => x.id === s.id); if (i === -1) return [...prev, s]; const n = prev.slice(); n[i] = s; return n; }),
          confirm: (req) => new Promise<boolean>((resolve) => {
            if (ctl.signal.aborted) return resolve(false);
            const p: Pending = { ...req, resolve: (ok) => { pendingRef.current = null; setPending(null); resolve(ok); } };
            pendingRef.current = p;
            setPending(p);
          }),
        },
      });
      setResult(res);
    } finally {
      void tools.close();
      setRunning(false);
      ctlRef.current = null;
    }
  }, [goal, running, settings, live, personName]);

  const save = (s: OperatorSettings) => { setSettings(s); saveOperatorSettings(s); };

  if (!allowed) {
    return (
      <div className="wop" role="dialog" aria-label="Operator">
        <div className="phone"><div className="top"><button className="back" onClick={close} aria-label="Close">‹</button><div className="titles"><h1>Operator</h1></div></div>
          <div className="scroll"><div className="card"><p>Operator mode is open on The Architect's device only for now.</p></div></div></div>
      </div>
    );
  }

  return (
    <div className="wop" role="dialog" aria-label="Wilson Operator" data-operator-running={running ? "1" : "0"}>
      <div className="bg" aria-hidden><div className="orb o1" /><div className="orb o2" /><div className="orb o3" /></div>
      <div className="phone">
        <div className="top">
          <button className="back" onClick={close} aria-label="Close Operator">‹</button>
          <div className="mark">W+</div>
          <div className="titles">
            <h1>Operator</h1>
            <div className="sub">Wilson + The Only One · Imagination becomes intelligence™</div>
          </div>
          <button className="gear" onClick={() => setShowSettings((v) => !v)} aria-label="Operator settings">⚙︎</button>
        </div>
        <div className="chips" aria-label="Operator status">
          <span className={`chip ${settings.groqKey ? "ok" : ""}`}>{settings.groqKey ? "🔒" : "🧠"} {brainLabel}</span>
          <span className={`chip ${live ? "ok" : ""}`}>{live ? "🌐 Live browser" : "📖 Reading mode"}</span>
          <span className="chip">🛑 Asks before acting</span>
        </div>

        <div className="scroll">
          {showSettings && <SettingsCard s={settings} onSave={save} onDone={() => setShowSettings(false)} />}

          {!running && !result && !steps.length && (
            <div className="intro">
              <p>Tell me what to get done. I'll make a plan, search, open pages and follow links, and show you every step. I'll stop and ask before I submit, buy, send, sign in or delete anything.</p>
              <div className="examples">{EXAMPLES.map((e) => <button key={e} className="ex" onClick={() => start(e)}>{e}</button>)}</div>
            </div>
          )}

          {steps.length > 0 && (
            <div className="log" aria-live="polite">
              <div className="goal">🎯 {goal}</div>
              {steps.map((s) => s.kind === "finish" ? null : (
                <div key={s.id} className={`step ${s.status}`}>
                  <div className="row">
                    <span className="ic" aria-hidden>{ICON[s.kind]}</span>
                    <div className="body">
                      <div className="ttl">{s.title}</div>
                      {s.thought && <div className="thought">{s.thought}</div>}
                      {s.plan && <ol className="plan">{s.plan.map((p, i) => <li key={i}>{p}</li>)}</ol>}
                      {s.detail && s.kind !== "plan" && <div className="detail">{s.detail}</div>}
                      {s.shot && <button className="shot" onClick={() => setZoom(s.shot!)} aria-label="Enlarge page picture"><img src={s.shot} crossOrigin="anonymous" referrerPolicy="no-referrer" alt={`Picture of ${s.url || "the page"}`} loading="lazy" /></button>}
                      {s.url && <a className="link" href={s.url} target="_blank" rel="noopener noreferrer">{s.url.replace(/^https?:\/\/(www\.)?/, "").slice(0, 70)}</a>}
                      {s.kind === "search" && s.sources && s.sources.length > 0 && (
                        <ul className="srcs">{s.sources.slice(0, 5).map((x) => <li key={x.url}><a href={x.url} target="_blank" rel="noopener noreferrer">{x.title || x.url}</a></li>)}</ul>
                      )}
                    </div>
                    <span className="st">{STATUS[s.status]}</span>
                  </div>
                </div>
              ))}
              {running && !pending && <div className="thinking"><span className="dot" /><span className="dot" /><span className="dot" /> Wilson is working</div>}
            </div>
          )}

          {result && (
            <div className={`answer ${result.status}`}>
              <div className="ahead">{result.status === "done" ? "✨ Here's what I found" : result.status === "stopped" ? "🛑 Stopped" : "⚠️ Didn't finish"}</div>
              <div className="md"><Markdown text={cleanAnswer(result.answer)} /></div>
              {result.sources.length > 0 && result.status !== "done" && (
                <ul className="srcs">{result.sources.slice(0, 8).map((x) => <li key={x.url}><a href={x.url} target="_blank" rel="noopener noreferrer">{x.title || x.url}</a></li>)}</ul>
              )}
              <div className="aact">
                <button className="btn soft" onClick={() => speakMessage(cleanAnswer(result.answer))}>🔊 Hear it</button>
                <button className="btn soft" onClick={async () => setNote((await copyText(cleanAnswer(result.answer))) ? "Copied." : "Couldn't copy.")}>Copy</button>
                <button className="btn soft" onClick={() => { setResult(null); setSteps([]); }}>New task</button>
              </div>
              {note && <div className="note">{note}</div>}
            </div>
          )}
          <div ref={endRef} />
        </div>

        <div className="dock">
          {running ? (
            <button className="btn stop" onClick={stop} aria-label="Stop Wilson">■ Stop</button>
          ) : (
            <form className="ask" onSubmit={(e) => { e.preventDefault(); void start(); }}>
              <textarea value={goal} onChange={(e) => setGoal(e.target.value)} placeholder="What should I do? e.g. find three options and compare them" rows={2} enterKeyHint="go"
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void start(); } }} />
              <button className="btn go" type="submit" disabled={!goal.trim()}>Go</button>
            </form>
          )}
        </div>
      </div>

      {pending && (
        <div className="sheet-wrap" role="alertdialog" aria-modal="true" aria-label="Wilson needs your OK">
          <div className="sheet">
            <div className="sh-title">Wilson needs your OK</div>
            <div className="sh-what">{pending.preview}</div>
            <p className="sh-why">{pending.reason}</p>
            <div className="sh-btns">
              <button className="btn no" onClick={() => pending.resolve(false)}>No, don't</button>
              <button className="btn yes" onClick={() => pending.resolve(true)}>Yes, do it</button>
            </div>
            <button className="sh-stop" onClick={stop}>Stop the whole task</button>
          </div>
        </div>
      )}

      {zoom && (
        <div className="zoom" onClick={() => setZoom(null)} role="dialog" aria-label="Page picture">
          <img src={zoom} crossOrigin="anonymous" referrerPolicy="no-referrer" alt="Page picture, full size" />
        </div>
      )}
    </div>
  );
}

function SettingsCard({ s, onSave, onDone }: { s: OperatorSettings; onSave: (s: OperatorSettings) => void; onDone: () => void }) {
  const [d, setD] = useState(s);
  const set = (k: keyof OperatorSettings, v: string | boolean) => setD((x) => ({ ...x, [k]: v }));
  return (
    <div className="card settings">
      <h2>Operator settings</h2>
      <p className="hint">Saved on this device only. Nothing here goes into Wilson's code or GitHub.</p>

      <label>Private brain: Groq API key (optional)
        <input type="password" autoComplete="off" spellCheck={false} value={d.groqKey} onChange={(e) => set("groqKey", e.target.value)} placeholder="gsk_…" />
      </label>
      <p className="hint">Free at console.groq.com (no card). Groq doesn't train on what you send. Without a key, Operator uses Wilson's usual brain, the same one chat uses.</p>
      <label>Groq model
        <input value={d.groqModel} onChange={(e) => set("groqModel", e.target.value)} spellCheck={false} />
      </label>

      <label>Live browser address (optional)
        <input inputMode="url" value={d.browserUrl} onChange={(e) => set("browserUrl", e.target.value)} placeholder="https://wilson-operator-browser.<you>.workers.dev" spellCheck={false} />
      </label>
      <label>Live browser key
        <input type="password" autoComplete="off" value={d.browserToken} onChange={(e) => set("browserToken", e.target.value)} placeholder="the OPERATOR_TOKEN you chose" />
      </label>
      <p className="hint">With a live browser Wilson can click real buttons and type into forms (Cloudflare's free plan: about 10 browser minutes a day). Without it he reads pages and follows links.</p>

      <label className="check"><input type="checkbox" checked={d.snapshots} onChange={(e) => set("snapshots", e.target.checked)} /> Show page pictures</label>

      <div className="aact">
        <button className="btn go" onClick={() => { onSave(d); onDone(); }}>Save</button>
        <button className="btn soft" onClick={() => { const n = { ...d, groqKey: "", browserToken: "" }; setD(n); onSave(n); }}>Forget keys</button>
        <button className="btn soft" onClick={onDone}>Close</button>
      </div>
    </div>
  );
}
