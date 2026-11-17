import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { copyText } from "../lib/clipboard";
import { highlightPython } from "./syntax";
import { DEFAULT_FILENAME, DEFAULT_SCRIPT } from "./defaultScript";
import { deleteSnippet, loadDraft, loadSnippets, saveDraft, upsertSnippet, type TerminalSnippet } from "./snippets";
import { PyodideClient, type Figure } from "./pyodideClient";
import { makeTerminalAdapter, runAgentLoop, MAX_PASSES } from "./agentLoop";
import { loadChat, saveChat, clearChatStore, historyForModel, type ChatMsg } from "./chatStore";
import { typeCode } from "./pythonFence";
import { closeTerminalHash, isE2EArchitect, isE2ESelfFix } from "./access";
import { cachedIsAdmin } from "../lib/admin";
import { ProposalCard, ReviewScreen, LiveScreen, selfFixBadge } from "./SelfFixViews";
import {
  FIXTURE, canUseSelfFix, loadSelfFix, saveSelfFix,
  submitForReview, approveSelfFix, declineSelfFix, undoSelfFix, fetchPushes, fetchPushStatus,
  type PushLiveStatus, type SelfFixProposal, type SelfFixView,
} from "./selfFix";
import { buildSelfFixProposal } from "./selfFixAgent";
import { stepperFor, type CheckState, type PublishState } from "./selfFixPipeline";
import { LivePushesPanel, ModeToggle, PushReminder, type TermMode } from "./LivePushes";
import "./WilsonTerminal.css";

type Tab = "terminal" | "files";

const MODE_KEY = "wilson_term_mode";
function loadMode(): TermMode {
  try { return localStorage.getItem(MODE_KEY) === "python" ? "python" : "fix"; } catch { return "fix"; }
}

/** Which screen to restore when the Terminal reopens, from the saved push status. */
function viewForSaved(p: SelfFixProposal | null): SelfFixView | null {
  if (!p) return null;
  if (p.status === "review") return "review";
  return null;
}
type Line = { kind: "prompt" | "out" | "err" | "figure" | "caret"; text?: string; src?: string };

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


/** Insert clipboard text at the caret of a controlled field. iOS PWAs sometimes
 *  swallow native paste into inputs nested in an `aside`; handling it here keeps
 *  the value in sync without changing the look. */
function pasteInto(
  value: string,
  el: HTMLInputElement | HTMLTextAreaElement,
  inserted: string,
  setValue: (next: string) => void,
) {
  const start = el.selectionStart ?? value.length;
  const end = el.selectionEnd ?? value.length;
  const next = value.slice(0, start) + inserted + value.slice(end);
  setValue(next);
  requestAnimationFrame(() => {
    const pos = start + inserted.length;
    try { el.setSelectionRange(pos, pos); } catch { /* ignore */ }
  });
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
  const [chat, setChat] = useState<ChatMsg[]>(() => {
    if (isE2ESelfFix() === "propose") {
      return [
        { id: "e2e-selffix-j", role: "user", text: "fix the back button on the observatory" },
        { id: "e2e-selffix-w", role: "wilson", text: "The close control is a tiny faint × — easy to miss and hard to tap. I wrote a proper Back button." },
      ];
    }
    return loadChat();
  });
  const [clearAsk, setClearAsk] = useState(false);
  const [draftMsg, setDraftMsg] = useState("");
  const [looping, setLooping] = useState(false);
  const [copyMsg, setCopyMsg] = useState("");
  const [saveMsg, setSaveMsg] = useState("");
  const e2eFix = isE2ESelfFix();
  const [proposal, setProposal] = useState<SelfFixProposal | null>(() => {
    if (e2eFix) return { ...FIXTURE, status: e2eFix === "live" ? "live" : e2eFix === "review" ? "review" : "draft" };
    return loadSelfFix();
  });
  const [fixView, setFixView] = useState<SelfFixView | null>(() => e2eFix ?? (canUseSelfFix() ? viewForSaved(loadSelfFix()) : null));
  const [fixBusy, setFixBusy] = useState(false);
  const [fixErr, setFixErr] = useState("");
  const [mode, setModeState] = useState<TermMode>(() => (e2eFix || !cachedIsAdmin() ? "python" : loadMode()));
  const [liveStatus, setLiveStatus] = useState<PushLiveStatus | null>(null);
  const [history, setHistory] = useState<SelfFixProposal[]>([]);
  const [building, setBuilding] = useState<string[] | null>(null);
  const buildAbort = useRef<AbortController | null>(null);
  const realFix = canUseSelfFix() && cachedIsAdmin() && !e2eFix;
  const setMode = (m: TermMode) => { setModeState(m); try { localStorage.setItem(MODE_KEY, m); } catch { /* ignore */ } };
  const clientRef = useRef<PyodideClient | null>(null);
  const loopAbort = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<HTMLDivElement | null>(null);
  const hlRef = useRef<HTMLPreElement | null>(null);
  const taRef = useRef<HTMLTextAreaElement | null>(null);

  const close = () => { closeTerminalHash(); onClose?.(); };

  useEffect(() => { saveDraft(code, filename); }, [code, filename]);
  useEffect(() => { saveChat(chat); }, [chat]);
  useEffect(() => {
    const box = document.getElementById("wterm-msgs");
    if (box) box.scrollTop = box.scrollHeight;
  }, [chat]);

  const refreshHistory = useCallback(async () => {
    if (!realFix) return;
    try { setHistory(await fetchPushes()); } catch { /* offline: keep what we have */ }
  }, [realFix]);
  useEffect(() => { void refreshHistory(); }, [refreshHistory]);

  // Follow the current push for real: PR state, build check, then the GitHub Pages publish.
  const pushId = proposal?.id && proposal.status !== "draft" && !proposal.id.startsWith("draft-") ? proposal.id : "";
  const pushStatus = proposal?.status;
  useEffect(() => {
    if (!realFix || !pushId || pushStatus === "declined") return;
    let stop = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      try {
        const st = await fetchPushStatus(pushId);
        if (stop) return;
        setLiveStatus(st);
        setProposal((prev) => {
          if (!prev || prev.id !== st.id) return prev;
          if (prev.status === st.status && prev.prUrl === st.prUrl && prev.mergeSha === st.mergeSha) return prev;
          const next = { ...prev, status: st.status, prUrl: st.prUrl, liveAt: st.liveAt || prev.liveAt, mergeSha: st.mergeSha, undoneAt: st.undoneAt };
          saveSelfFix(next);
          return next;
        });
        const settled = st.status === "declined" || ((st.status === "live" || st.status === "undone") && (st.publish?.state === "live" || st.publish?.state === "failed"));
        if (settled) { void refreshHistory(); return; }
      } catch { /* try again next tick */ }
      if (!stop) timer = setTimeout(tick, 9000);
    };
    void tick();
    return () => { stop = true; if (timer) clearTimeout(timer); };
  }, [realFix, pushId, pushStatus, refreshHistory]);

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
    return () => { off(); c.dispose(); clientRef.current = null; loopAbort.current?.abort(); buildAbort.current?.abort(); };
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

  const onClearChat = () => {
    if (!clearAsk) {
      setClearAsk(true);
      setTimeout(() => setClearAsk(false), 4000);
      return;
    }
    setClearAsk(false);
    setChat([]);
    clearChatStore();
  };

  const pushChat = (role: "user" | "wilson", msg: string, replaceLast = false) => {
    setChat((prev) => {
      let next: typeof prev;
      if (replaceLast && prev.length && prev[prev.length - 1].role === "wilson") {
        next = [...prev.slice(0, -1), { ...prev[prev.length - 1], text: msg }];
      } else {
        next = [...prev, { id: "m-" + Math.random().toString(36).slice(2, 8), role, text: msg }];
      }
      return next.length > 300 ? next.slice(-300) : next;
    });
  };

  const runSelfFix = async (text: string) => {
    if (proposal && proposal.status === "review") {
      pushChat("user", text);
      pushChat("wilson", "I already have a change waiting for you. Approve it or Decline it first (tap Open review in Live pushes), then I'll start the next one.");
      return;
    }
    if (!realFix) {
      pushChat("user", text);
      pushChat("wilson", "Fixing my own code needs the Architect key on this phone. Sign in as the Architect, then ask me again.");
      return;
    }
    const abort = new AbortController();
    buildAbort.current = abort;
    setLooping(true);
    setFixErr("");
    setBuilding(["Starting…"]);
    pushChat("user", text);
    pushChat("wilson", "On it. I'm reading my own code now.");
    try {
      const next = await buildSelfFixProposal(text, {
        signal: abort.signal,
        onStep: (step) => setBuilding((prev) => (prev && prev[prev.length - 1] === "Starting…" ? [step] : [...(prev || []), step])),
      });
      if (abort.signal.aborted) return;
      setProposal(next); saveSelfFix(next); setLiveStatus(null); setFixView(null);
      pushChat("wilson", `Done. My proposed change: "${next.title}". ${next.summary} Look it over in Live pushes, then tap Send for review.`, true);
    } catch (err) {
      if (abort.signal.aborted || (err as Error).name === "AbortError") {
        pushChat("wilson", "Stopped. Nothing was changed.", true);
      } else {
        const msg = err instanceof Error ? err.message : "Something went wrong.";
        pushChat("wilson", `${msg}\nNothing was sent anywhere.`, true);
      }
    } finally {
      setBuilding(null);
      setLooping(false);
      buildAbort.current = null;
    }
  };

  const sendChat = async () => {
    const text = draftMsg.trim();
    if (!text || looping) return;
    setDraftMsg("");
    if (mode === "fix" && !e2eFix) { await runSelfFix(text); return; }
    const abort = new AbortController();
    loopAbort.current = abort;
    setLooping(true);
    const prior = historyForModel(chat);
    const adapter = makeTerminalAdapter();
    try {
      await runAgentLoop(adapter, text, {
        signal: abort.signal,
        onChat: (role, msg, replaceLast) => {
          setChat((prev) => {
            let next: typeof prev;
            if (replaceLast && prev.length && prev[prev.length - 1].role === "wilson") {
              next = [...prev.slice(0, -1), { ...prev[prev.length - 1], text: msg }];
            } else {
              next = [...prev, { id: "m-" + Math.random().toString(36).slice(2, 8), role, text: msg }];
            }
            return next.length > 300 ? next.slice(-300) : next;
          });
        },
        onCode: (src) => setCode(src),
        typeCode: (src, signal) => typeCode(src, setCode, signal),
        run: (src) => runCode(src, undefined),
      }, prior);
    } finally {
      setLooping(false);
      loopAbort.current = null;
    }
  };

  const showFix = canUseSelfFix() && !!proposal;
  const onSendForReview = async () => {
    if (!proposal || !canUseSelfFix()) return;
    setFixBusy(true); setFixErr("");
    try {
      if (isE2EArchitect() && !cachedIsAdmin()) {
        const next = { ...proposal, status: "review" as const };
        setProposal(next); saveSelfFix(next); setFixView("review");
      } else {
        const next = await submitForReview(proposal);
        setProposal(next); saveSelfFix(next); setLiveStatus(null); setFixView("review");
        void refreshHistory();
      }
    } catch (err) {
      setFixErr(err instanceof Error ? err.message : "Couldn't send for review.");
    } finally { setFixBusy(false); }
  };
  const onApproveFix = async () => {
    if (!proposal) return;
    setFixBusy(true); setFixErr("");
    try {
      if (isE2EArchitect() && !cachedIsAdmin()) {
        const next = { ...proposal, status: "live" as const, liveAt: proposal.liveAt || new Date().toISOString() };
        setProposal(next); saveSelfFix(next); setFixView("live");
      } else {
        const next = await approveSelfFix(proposal);
        setProposal(next); saveSelfFix(next); setLiveStatus(null); setFixView("live");
        void refreshHistory();
      }
    } catch (err) {
      setFixErr(err instanceof Error ? err.message : "Couldn't approve this update.");
    } finally { setFixBusy(false); }
  };
  const onDeclineFix = async () => {
    if (!proposal) return;
    setFixBusy(true); setFixErr("");
    try {
      if (!(isE2EArchitect() && !cachedIsAdmin())) await declineSelfFix(proposal);
      setProposal(null); saveSelfFix(null); setLiveStatus(null); setFixView(null);
      void refreshHistory();
    } catch (err) {
      setFixErr(err instanceof Error ? err.message : "Couldn't decline this update.");
    } finally { setFixBusy(false); }
  };
  const onUndoFix = async (target?: SelfFixProposal) => {
    const which = target || proposal;
    if (!which) return;
    setFixBusy(true); setFixErr("");
    try {
      if (isE2EArchitect() && !cachedIsAdmin()) {
        setProposal(null); saveSelfFix(null); setFixView(null);
      } else {
        const next = await undoSelfFix(which);
        // Follow the undo's publish in the Live pushes panel.
        setProposal(next); saveSelfFix(next); setLiveStatus(null); setFixView(null); setMode("fix");
        void refreshHistory();
      }
    } catch (err) {
      setFixErr(err instanceof Error ? err.message : "Couldn't undo this update.");
    } finally { setFixBusy(false); }
  };
  const onDiscardDraft = () => { setProposal(null); saveSelfFix(null); setLiveStatus(null); setFixErr(""); };
  const onPushDone = () => { setProposal(null); saveSelfFix(null); setLiveStatus(null); setFixView(null); setFixErr(""); void refreshHistory(); };
  const onStopBuild = () => { buildAbort.current?.abort(); };
  const stepNow = proposal ? stepperFor(
    (liveStatus?.status || proposal.status || "draft") as NonNullable<SelfFixProposal["status"]>,
    liveStatus?.publish?.state as PublishState | undefined,
    liveStatus?.check?.state as CheckState | undefined,
  ) : null;
  const checkLine = realFix && proposal?.status === "review" ? stepNow?.detail.split(". ")[0] : undefined;
  const livePublish = realFix && proposal && (proposal.status === "live" || proposal.status === "undone") && stepNow
    ? { headline: stepNow.headline, detail: stepNow.detail, done: stepNow.step === 3, failed: stepNow.tone === "warn" }
    : undefined;

  const highlighted = useMemo(() => highlightPython(code.endsWith("\n") ? code : code + "\n"), [code]);
  const gutter = useMemo(() => Array.from({ length: linesOf(code) }, (_, i) => i + 1), [code]);
  const pyAttr = py === "ready" ? "ready" : py === "error" ? "error" : py === "loading" ? "loading" : "idle";
  const publishingNow = fixView === "live" && !!livePublish && !livePublish.done;
  const chrome = publishingNow
    ? { badge: <>Publishing<br />to live site</>, pill: livePublish?.failed ? "publish failed" : "publishing…" }
    : selfFixBadge(fixView);
  const pill = chrome?.pill
    || (py === "loading" ? progress || "loading Python…"
    : py === "error" ? (progress || "Python failed")
    : runMeta || (py === "ready" ? "ready" : "starting…"));

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
    <div className={`wterm${fixView === "review" ? " is-review" : fixView === "live" ? " is-live" : fixView === "propose" ? " is-propose" : ""}`} role="dialog" aria-modal="true" aria-label="Wilson's Terminal" data-pyodide={pyAttr} data-run={runState} data-selffix={fixView || ""}>
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
          <div className="badge">{chrome?.badge || (mode === "fix" && canUseSelfFix() ? <>Fixes his<br />own code</> : <>Python · runs<br />on this phone</>)}</div>
        </div>

        {fixView !== "review" && fixView !== "live" && canUseSelfFix() && (
          <ModeToggle mode={mode} onChange={(m) => { setMode(m); if (m === "python") setTab("terminal"); }} disabled={looping} />
        )}

        {(mode === "python" || !canUseSelfFix()) && <div className="tabs" role="tablist" aria-label="Terminal views">
          <button type="button" role="tab" aria-selected={tab === "terminal"} className={tab === "terminal" ? "on" : ""} onClick={() => setTab("terminal")}>Terminal</button>
          <button type="button" role="tab" aria-selected={tab === "files"} className={tab === "files" ? "on" : ""} onClick={() => setTab("files")}>Files / snippets</button>
        </div>}

        <div className="scroll" id="wterm-scroll" ref={scrollRef}>
          {fixView === "review" && proposal && (
            <section className="stack">
              <div className="win">
                <div className="chrome">
                  <span className="dots" aria-hidden="true"><i className="a" /><i className="b" /><i className="c" /></span>
                  <span className="fn">wilson@neural-void</span>
                  <span className="sp" />
                  <span className="pill">{pill}</span>
                </div>
                <ReviewScreen proposal={{ ...proposal, prUrl: proposal.prUrl || liveStatus?.prUrl }} busy={fixBusy} error={fixErr} checkLine={checkLine} onLater={realFix ? () => { setFixErr(""); setFixView(null); setMode("fix"); } : undefined} onPreview={() => {}} onApprove={() => void onApproveFix()} onDecline={() => void onDeclineFix()} />
              </div>
            </section>
          )}
          {fixView === "live" && proposal && (
            <section className="stack">
              <div className="win">
                <div className="chrome">
                  <span className="dots" aria-hidden="true"><i className="a" /><i className="b" /><i className="c" /></span>
                  <span className="fn">wilson@neural-void</span>
                  <span className="sp" />
                  <span className={`pill${publishingNow ? (livePublish?.failed ? " bad" : "") : " ok"}`}>{pill}</span>
                </div>
                <LiveScreen proposal={proposal} busy={fixBusy} error={fixErr} publish={livePublish} onBack={realFix ? () => { setFixErr(""); setFixView(null); setMode("fix"); } : undefined} onUndo={() => void onUndoFix()} />
              </div>
            </section>
          )}
          {fixView === "live" && <div className="footnote">Imagination becomes intelligence</div>}
          {fixView !== "review" && fixView !== "live" && mode === "fix" && canUseSelfFix() && (
            <>
              <LivePushesPanel
                current={proposal && (e2eFix || proposal.status !== "draft" || realFix) ? proposal : null}
                status={liveStatus}
                history={history}
                busy={fixBusy}
                error={fixErr}
                building={building}
                onOpenReview={() => { setFixErr(""); setFixView("review"); }}
                onUndo={(p) => void onUndoFix(p)}
                onDone={onPushDone}
                onStopBuild={onStopBuild}
              />
              {showFix && proposal && proposal.status === "draft" && !building && (
                <ProposalCard lifted proposal={proposal} busy={fixBusy} error={fixErr} onReview={() => void onSendForReview()} onDiscard={onDiscardDraft} />
              )}
              <p className="footnote">Tell Wilson what to change about himself in the box below. He reads his real code, shows you the change, and nothing goes live until you approve.</p>
            </>
          )}
          {fixView !== "review" && fixView !== "live" && mode === "python" && canUseSelfFix() && (
            <PushReminder current={proposal && proposal.status !== "declined" ? proposal : null} status={liveStatus} onOpen={() => setMode("fix")} />
          )}
          {fixView !== "review" && fixView !== "live" && (mode === "python" || !canUseSelfFix()) && tab === "terminal" && (
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
                        onPaste={(e) => {
                          const text = e.clipboardData?.getData("text/plain") ?? e.clipboardData?.getData("text");
                          if (text == null) return;
                          e.preventDefault();
                          pasteInto(code, e.currentTarget, text, setCode);
                        }}
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
                    <span className={`pill${runState === "ok" ? " ok" : (runState === "error" || py === "error") ? " bad" : ""}`}>{pill}</span>
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

          {fixView !== "review" && fixView !== "live" && (mode === "python" || !canUseSelfFix()) && tab === "files" && (
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

          {fixView !== "live" && fixView !== "review" && <div className="footnote">Wilson + The Only One · Imagination becomes intelligence™</div>}
        </div>

        {fixView !== "review" && fixView !== "live" && <aside className="dock" id="chat">
          {chat.length > 0 && (
            <div className="chat-bar">
              <button type="button" className={`chat-clear${clearAsk ? " ask" : ""}`} data-testid="clear-chat" disabled={looping} onClick={onClearChat}>
                {clearAsk ? "Tap again to clear" : "Clear chat"}
              </button>
            </div>
          )}
          <div className="msgs" id="wterm-msgs" data-testid="terminal-msgs">
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
            {showFix && e2eFix === "propose" && fixView === "propose" && proposal && mode === "python" && (
              <ProposalCard proposal={proposal} busy={fixBusy} error={fixErr} onReview={() => void onSendForReview()} />
            )}
          </div>
          <form className="composer" onSubmit={(e) => { e.preventDefault(); void sendChat(); }}>
            <input
              className="field"
              value={draftMsg}
              onChange={(e) => setDraftMsg(e.target.value)}
              onPaste={(e) => {
                const text = e.clipboardData?.getData("text/plain") ?? e.clipboardData?.getData("text");
                if (text == null || looping) return;
                e.preventDefault();
                pasteInto(draftMsg, e.currentTarget, text, setDraftMsg);
              }}
              placeholder={looping ? "Wilson is working…" : mode === "fix" && canUseSelfFix() ? "Tell Wilson what to change about himself" : "Ask Wilson to write Python"}
              aria-label="Message Wilson"
              disabled={looping}
            />
            <button type="submit" className="sendb" disabled={looping || !draftMsg.trim()} aria-label="Send">➤</button>
          </form>
        </aside>}
      </div>
    </div>
  );
}
