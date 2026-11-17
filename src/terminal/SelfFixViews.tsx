import type { ReactNode } from "react";
import type { DiffLine, SelfFixProposal, SelfFixView } from "./selfFix";
import { FIXTURE, formatLiveWhen, proposeCardDiff } from "./selfFix";

export function DiffView({ lines, full }: { lines: DiffLine[]; full?: boolean }) {
  return (
    <div className={`diff${full ? " full" : ""}`}>
      {lines.map((ln, i) => (
        <div className={`ln ${ln.kind}`} key={i}>
          <span className="mark">{ln.kind === "del" ? "−" : ln.kind === "add" ? "+" : " "}</span>
          <span className="code">{ln.text}</span>
        </div>
      ))}
    </div>
  );
}

function fileName(path: string) {
  const parts = path.split("/");
  return { name: parts[parts.length - 1], dir: parts.slice(0, -1).join("/") };
}

export function ProposalCard({ proposal, busy, error, onReview, onDiscard, lifted }: {
  proposal: SelfFixProposal;
  busy?: boolean;
  error?: string;
  onReview: () => void;
  onDiscard?: () => void;
  lifted?: boolean;
}) {
  const first = proposal.files[0]?.path || "src/";
  const more = proposal.files.length > 1 ? ` + ${proposal.files.length - 1} more` : "";
  return (
    <div className={`proposal${lifted ? " lifted" : ""}`} data-testid="selffix-propose">
      <p className="kicker">Proposed update to my own code</p>
      <p className="fname">{first}{more}</p>
      <p className="sum">{proposal.summary}</p>
      <DiffView lines={lifted ? proposal.diff : proposeCardDiff(proposal)} />
      <button type="button" className="btn review" disabled={busy} onClick={onReview}>
        {busy ? "Sending…" : "Send for review"}
      </button>
      {onDiscard && <button type="button" className="btn later" disabled={busy} onClick={onDiscard}>Throw it away</button>}
      {error && <p className="note warn">{error}</p>}
    </div>
  );
}

export function ReviewScreen({ proposal, busy, error, onPreview, onApprove, onDecline, checkLine, onLater }: {
  proposal: SelfFixProposal;
  busy?: boolean;
  error?: string;
  onPreview: () => void;
  onApprove: () => void;
  onDecline: () => void;
  checkLine?: string;
  onLater?: () => void;
}) {
  return (
    <div className="review-card" data-testid="selffix-review">
      <h2>Wilson wants to update himself</h2>
      <p className="lead">{proposal.summary}</p>

      <div className="section-label">Files changed</div>
      <div className="filelist">
        {proposal.files.map((f) => {
          const n = fileName(f.path);
          return (
            <div className="file-row" key={f.path}>
              <div className="nm"><b>{n.name}</b><s>{n.dir}</s></div>
              <span className={`chip ${f.status === "edited" ? "edit" : f.status === "deleted" ? "del" : "add"}`}>{f.status}</span>
            </div>
          );
        })}
      </div>

      <div className="section-label">Full diff</div>
      <DiffView lines={proposal.diff} full />

      <a className="preview-link" href={proposal.previewUrl || "#"} target={proposal.previewUrl ? "_blank" : undefined} rel="noopener" onClick={(e) => { if (!proposal.previewUrl) { e.preventDefault(); onPreview(); } }}>
        Preview it first <span className="arrow">→</span>
      </a>
      {(proposal.prUrl || checkLine) && (
        <p className="review-extra">
          {proposal.prUrl && <a href={proposal.prUrl} target="_blank" rel="noopener">Pull request #{proposal.prNumber} on GitHub ↗</a>}
          {proposal.prUrl && checkLine ? " · " : ""}{checkLine}
        </p>
      )}
      <p className="note">Nothing changes until you approve.</p>
      {error && <p className="note warn">{error}</p>}
      <div className="cta-row">
        <button type="button" className="btn approve" disabled={busy} onClick={onApprove}>{busy ? "Shipping…" : "Approve & go live"}</button>
        <button type="button" className="btn decline" disabled={busy} onClick={onDecline}>Decline</button>
      </div>
      {onLater && <button type="button" className="btn later" disabled={busy} onClick={onLater}>Not now — keep it waiting</button>}
    </div>
  );
}

export function LiveScreen({ proposal, busy, error, onUndo, publish, onBack }: {
  proposal: SelfFixProposal;
  busy?: boolean;
  error?: string;
  onUndo: () => void;
  /** Real publish progress; when omitted (e2e fixture) the screen shows the finished state. */
  publish?: { headline: string; detail: string; done: boolean; failed?: boolean };
  onBack?: () => void;
}) {
  const done = publish ? publish.done : true;
  return (
    <>
      <div className="live-hero" data-testid="selffix-live">
        <div className="live-mark" aria-hidden="true">✦</div>
        <h2>{done ? "Update is live ✦" : publish?.failed ? "Approved — publish failed" : "Approved — publishing…"}</h2>
        <p aria-live="polite">{publish ? (done ? `${publish.headline} ${publish.detail}` : publish.detail) : proposal.id === "e2e-observatory-back" ? "The Observatory now has a proper Back button. It is on the live site for everyone." : "This update is on the live site for everyone."}</p>
        {proposal.prUrl && <p className="review-extra"><a href={proposal.prUrl} target="_blank" rel="noopener">Pull request #{proposal.prNumber} on GitHub ↗</a></p>}
      </div>
      <div className="change">
        <p className="when">{formatLiveWhen(proposal.liveAt)}</p>
        <h3>{proposal.changelogTitle || proposal.title}</h3>
        <p>{proposal.changelogBody || proposal.summary}</p>
      </div>
      <button type="button" className="btn undo" disabled={busy} onClick={onUndo}>{busy ? "Undoing…" : "Undo this update"}</button>
      <p className="live-note">Undo puts the previous version back live. Nothing else changes.</p>
      {error && <p className="live-note warn">{error}</p>}
      {onBack && <button type="button" className="btn later" onClick={onBack}>Back to the Terminal</button>}
    </>
  );
}

export function selfFixBadge(view: SelfFixView | null): { badge: ReactNode; pill: string } | null {
  if (view === "review") return { badge: <>Architect<br />review only</>, pill: "waiting for you" };
  if (view === "live") return { badge: <>Update<br />is live</>, pill: "shipped" };
  return null;
}

void FIXTURE;
