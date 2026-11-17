import { useState } from "react";
import type { PushLiveStatus, SelfFixProposal } from "./selfFix";
import { formatLiveWhen } from "./selfFix";
import { DiffView } from "./SelfFixViews";
import { simpleStatus, type CheckState, type PublishState, type PushStatus } from "./selfFixPipeline";

export type PreviewInfo = { state: "waiting" | "building" | "publishing" | "ready" | "failed" | "gone"; url?: string };

const STEPS = ["Proposed", "Waiting for you", "Live"];

function Steps({ step }: { step: number }) {
  return (
    <ol className="sf-steps" aria-label="Where this change is">
      {STEPS.map((label, i) => {
        const st = step > i ? "done" : step === i ? "now" : "todo";
        return (
          <li key={label} className={st} aria-current={st === "now" ? "step" : undefined}>
            <span className="dot" aria-hidden="true">{st === "done" ? "✓" : i + 1}</span>
            <span className="lbl">{label}</span>
          </li>
        );
      })}
    </ol>
  );
}

function Expander({ label, open, onToggle }: { label: string; open: boolean; onToggle: () => void }) {
  return (
    <button type="button" className="sf-expander" aria-expanded={open} onClick={onToggle}>
      <span>{label}</span><span className="chev">{open ? "Hide ▴" : "Show ▾"}</span>
    </button>
  );
}

export function ChangeCard({
  proposal, status, building, busy, error,
  onApprove, onDecline, onUndo, onPreview, onRetrySend, onDone, onStop,
}: {
  proposal: SelfFixProposal | null;
  status: PushLiveStatus | null;
  building: string[] | null;
  busy: boolean;
  error: string;
  onApprove: () => void;
  onDecline: () => void;
  onUndo: () => void;
  onPreview: (url: string) => void;
  onRetrySend: () => void;
  onDone: () => void;
  onStop: () => void;
}) {
  const [codeOpen, setCodeOpen] = useState(false);

  if (building) {
    return (
      <section className="sf-card working" data-testid="sf-card" data-state="working" aria-live="polite">
        <p className="sf-kicker">Wilson is working</p>
        <h2>Making your change…</h2>
        <ul className="sf-work">
          {building.map((b, i) => <li key={i} className={i === building.length - 1 ? "n" : "d"}>{i === building.length - 1 ? "◌" : "✓"} {b}</li>)}
        </ul>
        <Steps step={0} />
        <div className="sf-row"><button type="button" className="sf-btn soft" onClick={onStop}>Stop</button></div>
      </section>
    );
  }

  if (!proposal) {
    return (
      <section className="sf-card empty" data-testid="sf-card" data-state="empty">
        <p className="sf-kicker muted">No change yet</p>
        <h2>What should Wilson change about himself?</h2>
        <p className="sf-lead soft">Type it in the box at the bottom, in your own words. Wilson shows you the change first. Nothing goes live until you tap Approve.</p>
        <span className="sf-example">“Make the Back button in the Observatory bigger”</span>
        <span className="sf-example">“Change the welcome message to say good morning”</span>
        {error && <p className="sf-error" role="alert">{error}</p>}
      </section>
    );
  }

  const pushStatus = (status?.status || proposal.status || "draft") as PushStatus;
  const s = simpleStatus(pushStatus, status?.publish?.state as PublishState | undefined, status?.check?.state as CheckState | undefined);
  const preview = (status?.preview || null) as PreviewInfo | null;
  const prUrl = proposal.prUrl || status?.prUrl;
  const icon = s.tone === "ok" ? "✓" : s.tone === "live" ? "✦" : s.tone === "warn" ? "!" : s.tone === "done" ? "•" : "◌";

  return (
    <section className="sf-card" data-testid="sf-card" data-state={pushStatus}>
      <p className="sf-kicker">Wilson's change</p>
      <h2>{proposal.title}</h2>
      <p className="sf-lead">{proposal.summary}</p>
      <Steps step={s.step} />
      <div className={`sf-status ${s.tone}`} aria-live="polite" data-testid="sf-status">
        <span className="i" aria-hidden="true">{icon}</span>
        <span><b>{s.title}</b> {s.text}</span>
      </div>

      <Expander label="See the code changes" open={codeOpen} onToggle={() => setCodeOpen((o) => !o)} />
      {codeOpen && (
        <div className="sf-code">
          <DiffView lines={proposal.diff} full />
          <p className="sf-legend">Gold = old line taken out · Rainbow = new line Wilson wrote</p>
          {prUrl && <a className="sf-link" href={prUrl} target="_blank" rel="noopener">See it on GitHub ↗</a>}
        </div>
      )}

      {error && <p className="sf-error" role="alert">{error}</p>}

      {pushStatus === "review" && (
        <>
          <button type="button" className="sf-btn approve" data-testid="sf-approve" disabled={busy} onClick={onApprove}>
            {busy ? "Working…" : "✦ Approve & go live"}
          </button>
          <div className="sf-row">
            {preview && preview.state !== "gone" && (
              <button
                type="button"
                className="sf-btn soft"
                data-testid="sf-preview"
                data-preview={preview.state}
                disabled={busy || preview.state !== "ready" || !preview.url}
                onClick={() => preview.url && onPreview(preview.url)}
              >
                {preview.state === "ready" ? "Preview it" : preview.state === "failed" ? "No preview" : "Preparing preview…"}
              </button>
            )}
            <button type="button" className="sf-btn rose" data-testid="sf-decline" disabled={busy} onClick={onDecline}>Decline</button>
          </div>
        </>
      )}
      {pushStatus === "draft" && (
        <div className="sf-row">
          <button type="button" className="sf-btn approve slim" disabled={busy} onClick={onRetrySend}>{busy ? "Sending…" : "Try again"}</button>
          <button type="button" className="sf-btn rose" disabled={busy} onClick={onDecline}>Decline</button>
        </div>
      )}
      {(pushStatus === "live" || pushStatus === "undone" || pushStatus === "declined") && (
        <div className="sf-row">
          {pushStatus === "live" && <button type="button" className="sf-btn rose" data-testid="sf-undo" disabled={busy} onClick={onUndo}>{busy ? "Undoing…" : "↶ Undo it"}</button>}
          {s.settled && <button type="button" className="sf-btn soft" data-testid="sf-done" disabled={busy} onClick={onDone}>Done</button>}
        </div>
      )}
    </section>
  );
}

const PLAIN: Record<string, string> = { live: "live", review: "waiting for you", declined: "declined", undone: "undone", draft: "not sent" };

export function EarlierChanges({ items, busy, onUndo }: { items: SelfFixProposal[]; busy: boolean; onUndo: (p: SelfFixProposal) => void }) {
  const [open, setOpen] = useState(false);
  if (!items.length) return null;
  return (
    <div className="sf-history">
      <Expander label={`Earlier changes (${items.length})`} open={open} onToggle={() => setOpen((o) => !o)} />
      {open && items.map((h) => (
        <div className="sf-hrow" key={h.id}>
          <div className="nm">
            <b>{h.title}</b>
            <s>{formatLiveWhen(h.liveAt || h.createdAt)}</s>
          </div>
          <span className={`sf-chip ${h.status || ""}`}>{PLAIN[h.status || "draft"] || h.status}</span>
          {h.status === "live" && <button type="button" className="sf-mini" disabled={busy} onClick={() => onUndo(h)}>Undo it</button>}
        </div>
      ))}
    </div>
  );
}

/** Full-screen preview of the proposed Wilson, with an always-visible way back. */
export function PreviewOverlay({ url, onBack }: { url: string; onBack: () => void }) {
  const [loaded, setLoaded] = useState(false);
  return (
    <div className="sf-preview" role="dialog" aria-modal="true" aria-label="Preview of Wilson's change" data-testid="sf-preview-overlay">
      <div className="sf-preview-bar">
        <button type="button" className="sf-back" data-testid="sf-preview-back" onClick={onBack}>‹ Back to Terminal</button>
        <span className="sf-preview-tag">Preview — not live yet</span>
      </div>
      {!loaded && <p className="sf-preview-wait">Opening the preview…</p>}
      <iframe title="Preview of Wilson's change" src={url} onLoad={() => setLoaded(true)} allow="microphone; autoplay; clipboard-write" />
    </div>
  );
}
