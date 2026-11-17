import type { PushLiveStatus, SelfFixProposal } from "./selfFix";
import { formatLiveWhen } from "./selfFix";
import { stepperFor, type CheckState, type PublishState } from "./selfFixPipeline";

export type TermMode = "fix" | "python";

export function ModeToggle({ mode, onChange, disabled }: { mode: TermMode; onChange: (m: TermMode) => void; disabled?: boolean }) {
  return (
    <div className="mode-toggle" role="radiogroup" aria-label="What the Terminal does">
      <button type="button" role="radio" aria-checked={mode === "fix"} className={mode === "fix" ? "on" : ""} disabled={disabled} onClick={() => onChange("fix")} data-testid="mode-fix">
        <span className="ico" aria-hidden="true">✦</span> Fix Wilson's own code
      </button>
      <button type="button" role="radio" aria-checked={mode === "python"} className={mode === "python" ? "on" : ""} disabled={disabled} onClick={() => onChange("python")} data-testid="mode-python">
        <span className="ico" aria-hidden="true">▶</span> Python on this phone
      </button>
    </div>
  );
}

const STEPS = ["Proposed", "Waiting for you", "Live"];

function stepOf(p: SelfFixProposal | null, st: PushLiveStatus | null) {
  const status = (st?.status || p?.status || "draft") as SelfFixProposal["status"];
  const publish = st?.publish?.state as PublishState | undefined;
  const check = st?.check?.state as CheckState | undefined;
  return stepperFor(status, publish, check);
}

function statusChip(s?: string) {
  if (s === "live") return { cls: "live", label: "live" };
  if (s === "review") return { cls: "wait", label: "waiting for you" };
  if (s === "declined") return { cls: "muted", label: "declined" };
  if (s === "undone") return { cls: "muted", label: "undone" };
  return { cls: "wait", label: "proposed" };
}

export function Stepper({ step, tone }: { step: number; tone: string }) {
  return (
    <ol className={`stepper tone-${tone}`} aria-label="Push progress">
      {STEPS.map((label, i) => {
        const state = step > i ? "done" : step === i ? "now" : "todo";
        return (
          <li key={label} className={state} aria-current={state === "now" ? "step" : undefined}>
            <span className="dot" aria-hidden="true">{state === "done" ? "✓" : i + 1}</span>
            <span className="lbl">{label}</span>
          </li>
        );
      })}
    </ol>
  );
}

export function LivePushesPanel({
  current, status, history, busy, error, building, onOpenReview, onUndo, onDone, onStopBuild,
}: {
  current: SelfFixProposal | null;
  status: PushLiveStatus | null;
  history: SelfFixProposal[];
  busy?: boolean;
  error?: string;
  building?: string[] | null;
  onOpenReview: () => void;
  onSendForReview?: () => void;
  onDiscard?: () => void;
  onUndo: (p: SelfFixProposal) => void;
  onDone: () => void;
  onStopBuild: () => void;
}) {
  const s = current ? stepOf(current, status) : null;
  const cur = current ? { ...current, ...(status || {}) } : null;
  const prUrl = cur?.prUrl || status?.pr?.url;
  const others = history.filter((h) => h.id !== current?.id).slice(0, 6);
  const finished = cur && ((cur.status === "live" || cur.status === "undone") && status?.publish?.state === "live" || cur.status === "declined");
  return (
    <section className="stack" data-testid="live-pushes">
      <div className="win pushes">
        <div className="chrome">
          <span className="dots" aria-hidden="true"><i className="a" /><i className="b" /><i className="c" /></span>
          <span className="fn">Live pushes</span>
          <span className="sp" />
          <span className={`pill${s?.tone === "ok" ? " ok" : s?.tone === "warn" ? " bad" : ""}`}>{building ? "Wilson is working" : s ? s.headline.split(" — ")[0] : "none yet"}</span>
        </div>
        <div className="pushes-body">
          {building && (
            <div className="building" aria-live="polite">
              <p className="push-title">Wilson is writing a change to himself</p>
              <ul className="build-steps">
                {building.map((b, i) => <li key={i} className={i === building.length - 1 ? "now" : "done"}>{i === building.length - 1 ? "◌" : "✓"} {b}</li>)}
              </ul>
              <button type="button" className="btn push-secondary" onClick={onStopBuild}>Stop</button>
            </div>
          )}
          {!building && cur && s && (
            <div className="current">
              <p className="push-title">{cur.title}</p>
              <Stepper step={s.step} tone={s.tone} />
              <p className={`push-headline tone-${s.tone}`} aria-live="polite">{s.headline}</p>
              <p className="push-detail">{s.detail}</p>
              {prUrl && <a className="push-link" href={prUrl} target="_blank" rel="noopener">See it on GitHub (pull request #{cur.prNumber}) ↗</a>}
              <div className="push-actions">
                {cur.status === "review" && <button type="button" className="btn push-primary" disabled={busy} onClick={onOpenReview}>Open review</button>}
                {cur.status === "live" && <button type="button" className="btn push-secondary" disabled={busy} onClick={() => onUndo(cur)}>{busy ? "Undoing…" : "Undo this update"}</button>}
                {finished && <button type="button" className="btn push-secondary" disabled={busy} onClick={onDone}>Done</button>}
              </div>
            </div>
          )}
          {!building && !cur && (
            <p className="push-empty">No push in progress. Pick <b>Fix Wilson's own code</b> and tell Wilson what to change. His change shows up here.</p>
          )}
          {error && <p className="push-error" role="alert">{error}</p>}
          {others.length > 0 && (
            <div className="push-history">
              <div className="section-label">Recent pushes</div>
              {others.map((h) => {
                const c = statusChip(h.status);
                return (
                  <div className="push-row" key={h.id}>
                    <div className="nm">
                      <b>{h.title}</b>
                      <s>{formatLiveWhen(h.liveAt || h.createdAt)}{h.prUrl ? <> · <a href={h.prUrl} target="_blank" rel="noopener">PR #{h.prNumber} ↗</a></> : null}</s>
                    </div>
                    <span className={`push-chip ${c.cls}`}>{c.label}</span>
                    {h.status === "live" && <button type="button" className="btn push-mini" disabled={busy} onClick={() => onUndo(h)}>Undo</button>}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

/** One-line reminder shown in Python mode so a waiting push is never hidden. */
export function PushReminder({ current, status, onOpen }: { current: SelfFixProposal | null; status: PushLiveStatus | null; onOpen: () => void }) {
  if (!current) return null;
  const s = stepOf(current, status);
  return (
    <button type="button" className={`push-reminder tone-${s.tone}`} onClick={onOpen} data-testid="push-reminder">
      <span>Live push: {s.headline}</span><span className="go">Open ›</span>
    </button>
  );
}
