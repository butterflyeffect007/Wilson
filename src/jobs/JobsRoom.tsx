import { useCallback, useEffect, useMemo, useState } from "react";
import { copyText } from "../lib/clipboard";
import { canOpenJobs, closeJobsHash, isE2EJobs } from "./access";
import { runMoneyHunt, draftForCard } from "./api";
import { EXAMPLE_BANNER, EXAMPLE_CARDS, EXAMPLE_DRAFT } from "./exampleData";
import { dismissCard, huntedToday, loadJobsState, pullJobsState, saveJobsState, upsertSaved } from "./store";
import type { JobCard, JobLane, JobsState } from "./types";
import "./JobsRoom.css";

const LANE_META: Record<JobLane, { title: string; blurb: string }> = {
  assistance: { title: "Help for Jenny & Caitlin", blurb: "Housing help, emergency rent, ID replacement, Texas and federal benefits — Austin, Texas." },
  gigs: { title: "Paid AI gigs", blurb: "Remote freelance and part-time work for an AI orchestrator or prompt engineer." },
  mesh: { title: "Sunflower Protocol grants", blurb: "Open-source networking grants and bounties — FUTO, NLnet, Mozilla, and Filecoin types." },
};

function formatWhen(iso?: string): string {
  if (!iso) return "No hunt yet today.";
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Chicago",
      month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true,
    }).format(new Date(iso)) + " Central";
  } catch {
    return iso;
  }
}

function statusLabel(s: JobCard["status"]) {
  if (s === "drafting") return "drafting";
  if (s === "applied") return "applied";
  if (s === "won") return "won";
  return "found";
}

export default function JobsRoom({ allowed, onClose }: { allowed: boolean; onClose?: () => void }) {
  const e2e = isE2EJobs();
  const [tab, setTab] = useState<"hunt" | "saved">(e2e === "draft" ? "saved" : "hunt");
  const [state, setState] = useState<JobsState>(() => loadJobsState());
  const [huntCards, setHuntCards] = useState<JobCard[]>(() => (e2e ? EXAMPLE_CARDS : []));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [needsKey, setNeedsKey] = useState(false);
  const [drafting, setDrafting] = useState<JobCard | null>(() => {
    if (e2e === "draft") return { ...EXAMPLE_CARDS[1], status: "drafting", draft: EXAMPLE_DRAFT, example: true };
    return null;
  });
  const [copyMsg, setCopyMsg] = useState("");

  const close = () => { onClose?.(); closeJobsHash(); };

  useEffect(() => {
    if (e2e || !allowed) return;
    let stop = false;
    void (async () => {
      const remote = await pullJobsState();
      if (stop || !remote) return;
      const local = loadJobsState();
      const merged: JobsState = {
        saved: [...(remote.saved || []), ...local.saved].filter((c, i, a) => a.findIndex((x) => x.id === c.id) === i),
        dismissed: Array.from(new Set([...(remote.dismissed || []), ...local.dismissed])),
        lastHuntAt: local.lastHuntAt || remote.lastHuntAt,
      };
      saveJobsState(merged);
      setState(merged);
    })();
    return () => { stop = true; };
  }, [allowed, e2e]);

  const hunt = useCallback(async () => {
    if (e2e) {
      setHuntCards(EXAMPLE_CARDS);
      setNeedsKey(false);
      setMsg(EXAMPLE_BANNER);
      return;
    }
    setBusy(true); setMsg("");
    try {
      const res = await runMoneyHunt();
      if (res.needsKey) {
        setNeedsKey(true);
        setHuntCards([]);
        setMsg(res.message || "The Money Hunt needs the worker's search key before Wilson can look things up.");
      } else {
        setNeedsKey(false);
        const dismissed = new Set(state.dismissed);
        const cards = (res.cards || []).filter((c) => c.url && !dismissed.has(c.id));
        setHuntCards(cards);
        const next = { ...state, lastHuntAt: res.huntedAt || new Date().toISOString() };
        saveJobsState(next);
        setState(next);
        setMsg(cards.length ? `Found ${cards.length} live result${cards.length === 1 ? "" : "s"}. Wilson did not invent any of these.` : (res.error || "The hunt finished, but Wilson didn't find cards he could stand behind. Nothing was invented."));
      }
    } catch {
      setMsg("The hunt couldn't reach Wilson's worker just now. Nothing was invented.");
    } finally { setBusy(false); }
  }, [e2e, state]);

  useEffect(() => {
    if (!allowed || e2e) return;
    if (!huntedToday(state.lastHuntAt)) void hunt();
    // one auto-hunt per Central day, or first open
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allowed]);

  const visibleHunt = useMemo(() => huntCards.filter((c) => !state.dismissed.includes(c.id)), [huntCards, state.dismissed]);

  const onSave = (c: JobCard) => setState((s) => upsertSaved(s, { ...c, status: c.status === "found" ? "found" : c.status }));
  const onDismiss = (c: JobCard) => {
    setState((s) => dismissCard(s, c));
    setHuntCards((list) => list.filter((x) => x.id !== c.id));
    if (drafting?.id === c.id) setDrafting(null);
  };
  const onDraft = async (c: JobCard) => {
    if (e2e) {
      const next = { ...c, status: "drafting" as const, draft: EXAMPLE_DRAFT, example: true };
      setDrafting(next);
      setState((s) => upsertSaved(s, next));
      return;
    }
    setBusy(true); setMsg("");
    try {
      const res = await draftForCard(c);
      if (res.needsModel || !res.draft) {
        setMsg(res.error || "Wilson couldn't draft this yet.");
        return;
      }
      const next = { ...c, status: "drafting" as const, draft: res.draft, draftedAt: res.draftedAt };
      setDrafting(next);
      setState((s) => upsertSaved(s, next));
    } catch {
      setMsg("Wilson couldn't reach the drafting path just now.");
    } finally { setBusy(false); }
  };
  const markStatus = (c: JobCard, status: JobCard["status"]) => {
    const next = { ...c, status };
    setDrafting((d) => (d && d.id === c.id ? next : d));
    setState((s) => upsertSaved(s, next));
  };

  if (!allowed) {
    return (
      <div className="wjobs" role="dialog" aria-modal="true" aria-label="Jobs">
        <div className="bg"><div className="orb o1" /><div className="orb o2" /></div>
        <div className="phone">
          <div className="top">
            <button type="button" className="back" aria-label="Back" onClick={close}>‹</button>
            <div className="mark">W</div>
            <div className="titles"><h1>Jobs</h1><div className="sub">Architect only</div></div>
          </div>
          <section className="locked">
            <p>This room is only for the Architect. Sign in on Jenny's account to let Wilson hunt and draft — she approves and submits.</p>
          </section>
        </div>
      </div>
    );
  }

  const list = tab === "saved" ? state.saved : visibleHunt;

  return (
    <div className="wjobs" role="dialog" aria-modal="true" aria-label="Jobs" data-testid="jobs-room">
      <div className="bg"><div className="orb o1" /><div className="orb o2" /></div>
      <div className="phone">
        <div className="top">
          <button type="button" className="back" aria-label="Back" onClick={() => drafting ? setDrafting(null) : close()}>‹</button>
          <div className="mark">W</div>
          <div className="titles">
            <h1>{drafting ? "Wilson's draft" : "Jobs"}</h1>
            <div className="sub">{drafting ? "You review and send it" : "Wilson hunts. You approve."}</div>
          </div>
          <div className="badge">Architect<br />only</div>
        </div>

        {drafting ? (
          <div className="scroll draft-view" data-testid="jobs-draft">
            {drafting.example && <div className="banner" role="status">{EXAMPLE_BANNER}</div>}
            <h2>{drafting.title}</h2>
            <p className="meta">{drafting.who}{drafting.amount ? ` · ${drafting.amount}` : ""}{drafting.deadline ? ` · ${drafting.deadline}` : ""}</p>
            <a className="src" href={drafting.url} target="_blank" rel="noopener">{drafting.sourceName} →</a>
            <div className="draft-box">{drafting.draft}</div>
            <div className="actions">
              <button type="button" className="btn draft" onClick={async () => {
                const ok = await copyText(drafting.draft || "");
                setCopyMsg(ok ? "Copied" : "Couldn't copy");
                setTimeout(() => setCopyMsg(""), 2000);
              }}>{copyMsg || "Copy draft"}</button>
              <button type="button" className="btn ghost" onClick={() => markStatus(drafting, "applied")}>I applied</button>
              <button type="button" className="btn ghost" onClick={() => markStatus(drafting, "won")}>We won</button>
            </div>
            <p className="note">Wilson never submits, emails, or contacts anyone. You approve and send it — about 20 minutes a day of your yes.</p>
          </div>
        ) : (
          <>
            <div className="tabs" role="tablist" aria-label="Jobs views">
              <button type="button" role="tab" className={tab === "hunt" ? "on" : ""} aria-selected={tab === "hunt"} onClick={() => setTab("hunt")}>Money Hunt</button>
              <button type="button" role="tab" className={tab === "saved" ? "on" : ""} aria-selected={tab === "saved"} onClick={() => setTab("saved")}>Saved</button>
            </div>
            <div className="scroll">
              {e2e && <div className="banner" role="status">{EXAMPLE_BANNER}</div>}
              {needsKey && !e2e && (
                <div className="key-state">
                  <h2>Needs a search key</h2>
                  <p>Wilson's Money Hunt uses the worker's existing Brave search. That key isn't available to this app yet, so he did not run a hunt and he did not invent any opportunities. After the worker is deployed with the search key in place, Hunt now will look up real results.</p>
                </div>
              )}
              <div className="huntbar">
                <div className="when">{e2e ? "Example preview" : busy ? "Wilson is hunting…" : (msg || `Last hunt: ${formatWhen(state.lastHuntAt)}`)}</div>
                <button type="button" className="btn hunt" disabled={busy && !e2e} onClick={() => void hunt()}>{busy && !e2e ? "Hunting…" : "Hunt now"}</button>
              </div>

              {tab === "saved" && state.saved.length === 0 && <p className="empty">Nothing saved yet. When a card looks right, tap Save — it stays on this device, and syncs when the worker can.</p>}
              {tab === "hunt" && !needsKey && !busy && visibleHunt.length === 0 && !e2e && <p className="empty">No live cards right now. Tap Hunt now and Wilson will search for real sources only.</p>}

              {(Object.keys(LANE_META) as JobLane[]).map((lane) => {
                const items = list.filter((c) => c.lane === lane);
                if (!items.length) return null;
                const meta = LANE_META[lane];
                return (
                  <section className="lane" key={lane}>
                    <h2>{meta.title}</h2>
                    {items.map((c) => (
                      <article className="card" key={c.id}>
                        {c.example && <span className="pill">example data</span>}
                        <span className={`pill ${c.status === "found" ? "icy" : c.status === "won" ? "violet" : ""}`}>{statusLabel(c.status)}</span>
                        <h3>{c.title}</h3>
                        <p className="meta">
                          {c.who}
                          {c.amount ? ` · ${c.amount}` : " · amount not stated"}
                          {c.deadline ? ` · ${c.deadline}` : " · no deadline stated"}
                        </p>
                        <p className="why">{c.why}</p>
                        <a className="src" href={c.url} target="_blank" rel="noopener">{c.sourceName} →</a>
                        <p className="meta">{c.nextStep}</p>
                        <div className="actions">
                          <button type="button" className="btn ghost" onClick={() => onSave(c)}>Save</button>
                          <button type="button" className="btn ghost" onClick={() => onDismiss(c)}>Dismiss</button>
                          <button type="button" className="btn draft" disabled={busy && !e2e} onClick={() => void onDraft(c)}>Wilson, draft it</button>
                        </div>
                      </article>
                    ))}
                  </section>
                );
              })}
              <div className="footnote">Imagination becomes intelligence · Wilson hunts. You approve and submit.</div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
