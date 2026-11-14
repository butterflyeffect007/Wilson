import type { ReactNode } from "react";
import type { DiffLine, SelfFixProposal, SelfFixView } from "./selfFix";
import { FIXTURE, formatLiveWhen, proposeCardDiff } from "./selfFix";

function DiffView({ lines, full }: { lines: DiffLine[]; full?: boolean }) {
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

export function ProposalCard({ proposal, busy, error, onReview }: {
  proposal: SelfFixProposal;
  busy?: boolean;
  error?: string;
  onReview: () => void;
}) {
  const first = proposal.files[0]?.path || "src/";
  return (
    <div className="proposal" data-testid="selffix-propose">
      <p className="kicker">Proposed update to my own code</p>
      <p className="fname">{first}</p>
      <p className="sum">{proposal.summary}</p>
      <DiffView lines={proposeCardDiff(proposal)} />
      <button type="button" className="btn review" disabled={busy} onClick={onReview}>
        {busy ? "Sending…" : "Send for review"}
      </button>
      {error && <p className="note warn">{error}</p>}
    </div>
  );
}

export function ReviewScreen({ proposal, busy, error, onPreview, onApprove, onDecline }: {
  proposal: SelfFixProposal;
  busy?: boolean;
  error?: string;
  onPreview: () => void;
  onApprove: () => void;
  onDecline: () => void;
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
      <p className="note">Nothing changes until you approve.</p>
      {error && <p className="note warn">{error}</p>}
      <div className="cta-row">
        <button type="button" className="btn approve" disabled={busy} onClick={onApprove}>{busy ? "Shipping…" : "Approve & go live"}</button>
        <button type="button" className="btn decline" disabled={busy} onClick={onDecline}>Decline</button>
      </div>
    </div>
  );
}

export function LiveScreen({ proposal, busy, error, onUndo }: {
  proposal: SelfFixProposal;
  busy?: boolean;
  error?: string;
  onUndo: () => void;
}) {
  return (
    <>
      <div className="live-hero" data-testid="selffix-live">
        <div className="live-mark" aria-hidden="true">✦</div>
        <h2>Update is live ✦</h2>
        <p>{proposal.id === "e2e-observatory-back" ? "The Observatory now has a proper Back button. It is on the live site for everyone." : "This update is on the live site for everyone."}</p>
      </div>
      <div className="change">
        <p className="when">{formatLiveWhen(proposal.liveAt)}</p>
        <h3>{proposal.changelogTitle || proposal.title}</h3>
        <p>{proposal.changelogBody || proposal.summary}</p>
      </div>
      <button type="button" className="btn undo" disabled={busy} onClick={onUndo}>{busy ? "Undoing…" : "Undo this update"}</button>
      <p className="live-note">Undo puts the previous version back live. Nothing else changes.</p>
      {error && <p className="live-note warn">{error}</p>}
    </>
  );
}

export function selfFixBadge(view: SelfFixView | null): { badge: ReactNode; pill: string } | null {
  if (view === "review") return { badge: <>Architect<br />review only</>, pill: "waiting for you" };
  if (view === "live") return { badge: <>Update<br />is live</>, pill: "shipped" };
  return null;
}

void FIXTURE;
