import { useEffect, useMemo, useState } from "react";
import { canOpenOmni, closeOmniHash } from "./access";
import { describeCaps, probeOmniCaps, type OmniCaps } from "./caps";
import { followUpChat, loadedPack, PERSONA_TEST_PROMPT, runTierTest, type OmniTestResult, type TestProgress } from "./engine";
import {
  autoPickTier,
  harvestInterruptedLoad,
  OMNI_TIERS,
  pickReason,
  readCrashMap,
  type CrashMap,
  type OmniTierId,
} from "./tiers";
import "./OmniLab.css";
import MatrixField from "./MatrixField";

type Props = { allowed: boolean; onClose: () => void };

export default function OmniLab({ allowed, onClose }: Props) {
  const [caps, setCaps] = useState<OmniCaps | null>(null);
  const [crashes, setCrashes] = useState<CrashMap>(() => readCrashMap());
  const [busyId, setBusyId] = useState<OmniTierId | null>(null);
  const [progress, setProgress] = useState<TestProgress | null>(null);
  const [results, setResults] = useState<Partial<Record<OmniTierId, OmniTestResult>>>({});
  const [chatDraft, setChatDraft] = useState("");
  const [chatBusy, setChatBusy] = useState(false);
  const [chatLog, setChatLog] = useState<{ q: string; a: string }[]>([]);

  useEffect(() => {
    harvestInterruptedLoad();
    setCrashes(readCrashMap());
    let gone = false;
    void probeOmniCaps().then((c) => { if (!gone) setCaps(c); });
    return () => { gone = true; };
  }, []);

  const picked = useMemo(() => (caps ? autoPickTier(caps, crashes) : null), [caps, crashes]);
  const reason = caps && picked ? pickReason(picked, caps, crashes) : "";

  const close = () => { closeOmniHash(); onClose(); };

  const run = async (id: OmniTierId) => {
    if (!caps || busyId) return;
    const tier = OMNI_TIERS.find((t) => t.id === id);
    if (!tier) return;
    setBusyId(id);
    setProgress({ text: "Starting…", progress: 0 });
    try {
      const res = await runTierTest(tier, caps, setProgress);
      setResults((s) => ({ ...s, [id]: res }));
      setCrashes(readCrashMap());
    } finally {
      setBusyId(null);
      setProgress(null);
    }
  };

  const onFollow = async () => {
    const q = chatDraft.trim();
    if (!q || chatBusy || !loadedPack()) return;
    setChatBusy(true);
    setChatDraft("");
    const out = await followUpChat(q);
    setChatLog((log) => [...log, { q, a: "error" in out ? out.error : out.reply }]);
    setChatBusy(false);
  };

  if (!allowed) {
    return (
      <div className="womni" role="dialog" aria-modal="true" aria-label="Omni Lab">
        <div className="bg"><div className="orb o1" /><div className="orb o2" /></div>
        <div className="phone">
          <div className="top">
            <button type="button" className="back" aria-label="Back" onClick={close}>‹</button>
            <div className="mark">W</div>
            <div className="titles"><h1>Omni Lab</h1><div className="sub">Architect only</div></div>
          </div>
          <section className="scroll"><p className="locked">This room is only for the Architect. It is a device proof for Wilson Omni — nothing is submitted or spent here.</p></section>
        </div>
      </div>
    );
  }

  const loaded = loadedPack();

  return (
    <div className="womni" role="dialog" aria-modal="true" aria-label="Omni Lab" data-testid="omni-lab">
      <div className="bg"><div className="orb o1" /><div className="orb o2" /><div className="orb o3" /></div>
      <div className="phone">
        <div className="top">
          <button type="button" className="back" aria-label="Back" onClick={close}>‹</button>
          <div className="mark">W</div>
          <div className="titles">
            <h1>Omni Lab</h1>
            <div className="sub">Device proof · Wilson hunts his own brain</div>
          </div>
          <div className="badge">Architect<br />only</div>
        </div>
        <div className="scroll">
          <section className="probe" data-testid="omni-probe">
            <h2>This device</h2>
            <p>{caps ? describeCaps(caps) : "Checking WebGPU, shader-f16, and memory…"}</p>
            {caps?.error && <p className="why">{caps.error}</p>}
            {picked && <p className="why"><strong>Auto-pick:</strong> {OMNI_TIERS.find((t) => t.id === picked)?.label}. {reason}</p>}
          </section>

          <section className="card" data-testid="omni-matrix-field">\n            <h3>Unified Matrix Field</h3>\n            <p className="meta">A calm spectrum of fading symbols · deterministic visual field</p>\n            <MatrixField />\n          </section>\n\n          <div className="lane-title">Tiers</div>
          {OMNI_TIERS.map((tier) => {
            const res = results[tier.id];
            const crashed = crashes[tier.id];
            const isPick = picked === tier.id;
            const busy = busyId === tier.id;
            const status = busy ? "running" : res ? (res.ok ? "ok" : "failed") : crashed ? "failed" : "idle";
            return (
              <article className={`card${isPick ? " is-pick" : ""}`} key={tier.id} data-testid={`omni-tier-${tier.id}`} data-pick={isPick ? "1" : "0"}>
                <div className="pills">
                  {isPick && <span className="pill gold">auto-pick</span>}
                  <span className={`pill ${status === "ok" ? "icy" : status === "failed" ? "amber" : ""}`}>
                    {status === "ok" ? "loaded" : status === "failed" ? "failed" : status === "running" ? "loading" : "not tested"}
                  </span>
                  <span className="pill">{tier.sizeLabel}</span>
                </div>
                <h3>{tier.label}</h3>
                <p className="meta">{tier.kind === "webllm" ? "WebLLM · WebGPU" : "Existing Wilson server path"}{res?.modelId ? ` · ${res.modelId}` : ""}</p>
                <p className="blurb">{tier.blurb}</p>
                {(busy || res || crashed) && (
                  <div className="metrics">
                    <div className="metric"><span className="k">Load</span><span className="v">{busy && !res ? "…" : res?.loadMs != null ? `${(res.loadMs / 1000).toFixed(1)}s` : "—"}</span></div>
                    <div className="metric"><span className="k">Tokens/sec</span><span className="v">{busy && !res ? "…" : res?.tokensPerSec != null ? String(res.tokensPerSec) : "—"}</span></div>
                    <div className="metric"><span className="k">Status</span><span className="v">{status === "ok" ? "ok" : status === "failed" ? "fail" : status === "running" ? "…" : "idle"}</span></div>
                  </div>
                )}
                {busy && progress && (
                  <div className="prog" aria-hidden="true"><span style={{ width: `${Math.max(4, Math.round(progress.progress * 100))}%` }} /></div>
                )}
                {busy && progress && <p className="meta">{progress.text}</p>}
                {res?.reply && <div className="reply" data-testid={`omni-reply-${tier.id}`}>{res.reply}</div>}
                {(res?.error || (!res && crashed)) && <p className="fail">{res?.error || crashed}</p>}
                <button
                  type="button"
                  className="btn go"
                  disabled={!!busyId}
                  onClick={() => void run(tier.id)}
                >
                  {busy ? "Testing…" : tier.kind === "rented" ? "Test rented brain" : "Download & test"}
                </button>
              </article>
            );
          })}

          {loaded && (
            <section className="card" data-testid="omni-chat">
              <h3>Persona chat</h3>
              <p className="meta">Uses Jenny’s existing Wilson identity, as written. First test question: “{PERSONA_TEST_PROMPT}”</p>
              {chatLog.map((row, i) => (
                <div key={i}>
                  <p className="meta">{row.q}</p>
                  <div className="reply">{row.a}</div>
                </div>
              ))}
              <div className="chatbar">
                <input
                  value={chatDraft}
                  onChange={(e) => setChatDraft(e.target.value)}
                  placeholder="Ask this pack something short…"
                  onKeyDown={(e) => { if (e.key === "Enter") void onFollow(); }}
                  disabled={chatBusy}
                />
                <button type="button" className="btn go" disabled={chatBusy || !chatDraft.trim()} onClick={() => void onFollow()}>Send</button>
              </div>
            </section>
          )}

          <p className="note">
            On any phone, including iPhone, Omni Lab auto-picks the small Qwen pack (or the floor if that failed before). The large Gemma pack is offered, but not auto-started, because a 2.5 GB+ WebGPU model often kills a phone tab. Downloads stay on this device. The first test is a short “who are you?” in Wilson’s own voice. Nothing is uploaded, spent, or submitted here.
          </p>
        </div>
      </div>
    </div>
  );
}
