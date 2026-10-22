import { useEffect, useRef, useState } from "react";
import { X, RefreshCw, ChevronLeft, ChevronRight, Send } from "lucide-react";
import { fetchTelemetry, forgetAdmin, type Telemetry } from "../lib/admin";
import type { StoredMessage } from "../memory/LocalMemory";

/** Architect view (server-verified admin only): collapsible sidebar, tach gauge, live chat center. */
export function AdminPanel({ onClose, onSignOut, messages = [], busy = false, onSend }: {
  onClose: () => void; onSignOut: () => void; messages?: StoredMessage[]; busy?: boolean; onSend?: (text: string) => void;
}) {
  const [t, setT] = useState<Telemetry | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "error">("loading");
  const [side, setSide] = useState(true);
  const [draft, setDraft] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  const load = () => { setState("loading"); void fetchTelemetry().then((d) => { setT(d); setState(d ? "ok" : "error"); }); };
  useEffect(load, []);
  // Exit paths: Escape key, and the phone's back gesture/button (history entry popped).
  const closeRef = useRef(onClose); closeRef.current = onClose;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") closeRef.current(); };
    let popped = false;
    const onPop = () => { popped = true; closeRef.current(); };
    try { history.pushState({ wilsonArchitect: 1 }, ""); } catch { /* ignore */ }
    window.addEventListener("keydown", onKey); window.addEventListener("popstate", onPop);
    return () => {
      window.removeEventListener("keydown", onKey); window.removeEventListener("popstate", onPop);
      if (!popped && history.state?.wilsonArchitect) { try { history.back(); } catch { /* ignore */ } }
    };
  }, []);
  useEffect(() => { endRef.current?.scrollIntoView({ block: "end" }); }, [messages]);
  const days = t ? Object.keys(t.usage).sort().reverse().slice(0, 7) : [];
  const lastModel = (() => { try { return localStorage.getItem("wilson_last_model") || "—"; } catch { return "—"; } })();
  const replies = (d: string) => Object.entries(t?.usage[d] ?? {}).filter(([k]) => k.startsWith("model:")).reduce((s, [, v]) => s + v, 0);
  const total7 = days.reduce((s, d) => s + replies(d), 0);
  const clips7 = days.reduce((s, d) => s + (t?.usage[d]?.["tts:gen"] ?? 0), 0);
  const today = new Date().toISOString().slice(0, 10);
  const peak = Math.max(1, ...days.map(replies));
  // Tach: today's replies relative to the busiest day of the week → 0–9k RPM.
  const rpm = t ? Math.round((replies(today) / peak) * 9000) : 0;
  const recent = messages.slice(-12);
  const send = () => { const s = draft.trim(); if (!s || busy || !onSend) return; onSend(s); setDraft(""); };

  return (
    <div className="fixed inset-0 z-[60] flex items-stretch justify-center bg-black/30 backdrop-blur-sm pt-[max(0.75rem,env(safe-area-inset-top))] pb-[max(0.75rem,env(safe-area-inset-bottom))] pl-[max(0.75rem,env(safe-area-inset-left))] pr-[max(0.75rem,env(safe-area-inset-right))] sm:p-6" role="dialog" aria-modal="true" aria-label="Architect view" onClick={onClose}>
      <div className="glass-strong rounded-3xl w-full max-w-3xl h-full sm:h-[90dvh] flex overflow-hidden text-violet-950/90" onClick={(e) => e.stopPropagation()}>
        {side && (
          <aside className="w-[40%] max-w-[15rem] shrink-0 bg-violet-100/50 border-r border-violet-300/30 overflow-y-auto p-3 text-[12px] space-y-4">
            <button type="button" onClick={() => setSide(false)} className="flex items-center text-[11px] font-semibold tracking-[0.12em] text-violet-800"><ChevronLeft className="w-3.5 h-3.5" />CORE</button>
            {state === "error" && <p className="text-rose-600">Couldn't load telemetry. Refresh.</p>}
            {t && <>
              <section>
                <h4 className="text-[10px] font-semibold tracking-[0.12em] text-violet-600 mb-1">TELEMETRY</h4>
                <div className="rounded-2xl bg-white/55 px-3 py-2 leading-[1.7]">
                  <div>OG 100 <b>{t.beta.count}/{t.beta.limit}</b></div>
                  <div>Reports <b>{t.reports.count}</b></div>
                  <div>Replies 7d <b>{total7}</b></div>
                  <div>Voice clips 7d <b>{clips7}</b></div>
                  <div className="break-all">Last model <b>{lastModel.replace(/^.*\//, "")}</b></div>
                </div>
              </section>
              <section>
                <h4 className="text-[10px] font-semibold tracking-[0.12em] text-violet-600 mb-1">ENGINE</h4>
                <div className="rounded-2xl bg-white/55 px-3 py-2"><div>Chat: {t.config.chat}</div><div>Voice: {t.config.voice}</div></div>
              </section>
              <section>
                <h4 className="text-[10px] font-semibold tracking-[0.12em] text-violet-600 mb-1">USAGE · 7 DAYS</h4>
                {days.length === 0 ? <p className="opacity-70">No usage yet.</p> : days.map((d) => {
                  const u = t.usage[d];
                  const models = Object.entries(u).filter(([k]) => k.startsWith("model:")).map(([k, v]) => `${k.slice(6).replace(/^.*\//, "")} ${v}`).join(" · ") || "—";
                  return <div key={d} className="rounded-xl bg-white/45 px-2.5 py-1.5 mb-1"><div className="font-semibold">{d.slice(5)} · {replies(d)} replies · {u["tts:gen"] ?? 0} voice{u["tts:limit"] ? ` (limit ${u["tts:limit"]}×)` : ""}</div><div className="text-[10.5px] opacity-75 break-words">{models}</div></div>;
                })}
              </section>
              <section>
                <h4 className="text-[10px] font-semibold tracking-[0.12em] text-violet-600 mb-1">REPORTS</h4>
                {t.reports.recent.length === 0 ? <p className="opacity-70">None yet.</p> : t.reports.recent.map((r) => (
                  <div key={r.id} className="rounded-xl bg-white/45 px-2.5 py-1.5 mb-1">
                    <div className="text-[10px] opacity-70">{r.type} · {new Date(r.ts).toLocaleString()} {r.beta ? `· β${r.beta}` : ""} {r.issue && <a className="md-link" href={r.issue} target="_blank" rel="noopener noreferrer">issue</a>}</div>
                    <div className="whitespace-pre-wrap break-words">{r.message}</div>
                  </div>
                ))}
              </section>
              {t.referrals && <section>
                <h4 className="text-[10px] font-semibold tracking-[0.12em] text-violet-600 mb-1">SHARING</h4>
                <p>{t.referrals.shares} shares · {t.referrals.opens} opened · {t.referrals.sharers} with stars{t.referrals.top.length ? ` · top: ${t.referrals.top.map((x) => `✦${x.stars}`).join(", ")}` : ""}</p>
              </section>}
              <section>
                <h4 className="text-[10px] font-semibold tracking-[0.12em] text-violet-600 mb-1">OG 100 ROSTER ({t.beta.count}/{t.beta.limit})</h4>
                {(t.beta.roster ?? t.beta.latest).length ? [...(t.beta.roster ?? t.beta.latest)].sort((a, b) => a.number - b.number).map((m) => (
                  <div key={m.number} className="flex gap-2 text-[10.5px]"><span className="w-5 text-right opacity-70">{m.number}</span><span>{new Date(m.ts).toLocaleString([], { month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit" })}</span></div>
                )) : <p>None yet.</p>}
              </section>
            </>}
            <button type="button" onClick={() => { forgetAdmin(); onSignOut(); }} className="text-[11px] text-violet-500 underline underline-offset-2">Sign out of Architect mode</button>
          </aside>
        )}
        <main className="flex-1 min-w-0 flex flex-col p-4 pr-3">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-1">
              {!side && <button type="button" onClick={() => setSide(true)} aria-label="Open sidebar" className="text-violet-500"><ChevronRight className="w-4 h-4" /></button>}
              <h3 className="text-sm font-semibold tracking-[0.12em]">ARCHITECT</h3>
            </div>
            <div className="flex items-center gap-3">
              <button type="button" onClick={load} aria-label="Refresh" className="p-2 -m-2 text-violet-400 hover:text-violet-600"><RefreshCw className={`w-4 h-4 ${state === "loading" ? "animate-spin" : ""}`} /></button>
              <button type="button" onClick={onClose} aria-label="Close Architect view" className="-mt-2 shrink-0 flex items-center justify-center w-11 h-11 rounded-full bg-violet-600 text-white shadow active:scale-95"><X className="w-5 h-5" /></button>
            </div>
          </div>
          <div className="flex justify-end -mt-1"><Tach rpm={rpm} /></div>
          <div className="flex-1 overflow-y-auto mt-3 space-y-3 text-[13.5px] leading-[1.55]">
            {recent.length === 0 && <p className="opacity-60 text-[13px]">Talk to Wilson here — same conversation as your main chat.</p>}
            {recent.map((m) => (
              <div key={m.id}>
                <div className={`text-[10px] font-semibold tracking-[0.12em] ${m.role === "user" ? "text-violet-400" : "text-violet-600"}`}>{m.role === "user" ? "YOU" : "WILSON"}</div>
                <div className="whitespace-pre-wrap break-words">{m.content}</div>
              </div>
            ))}
            {busy && <div className="text-violet-500 text-[12px]">Wilson is thinking…</div>}
            <div ref={endRef} />
          </div>
          <form className="mt-3 flex items-center gap-2 rounded-full bg-white/70 px-4 py-2.5" onSubmit={(e) => { e.preventDefault(); send(); }}>
            <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Talk to Wilson…" aria-label="Message Wilson" className="flex-1 min-w-0 bg-transparent outline-none text-[14px] placeholder:text-violet-400" />
            <button type="submit" disabled={busy || !draft.trim()} aria-label="Send" className="text-violet-500 disabled:opacity-40"><Send className="w-4 h-4" /></button>
          </form>
        </main>
      </div>
    </div>
  );
}

function Tach({ rpm }: { rpm: number }) {
  const f = Math.min(1, Math.max(0, rpm / 9000));
  const a = Math.PI * (1 - f); // 180° → 0°
  const cx = 46, cy = 48, r = 36;
  const x = cx + r * Math.cos(a), y = cy - r * Math.sin(a);
  const nx = cx + (r - 8) * Math.cos(a), ny = cy - (r - 8) * Math.sin(a);
  return (
    <svg width="92" height="58" viewBox="0 0 92 58" aria-label={`Activity ${(rpm / 1000).toFixed(1)}k RPM`}>
      <defs><linearGradient id="tachg"><stop offset="0" stopColor="#cbd5e1" /><stop offset="1" stopColor="#8b5cf6" /></linearGradient></defs>
      <path d={`M${cx - r} ${cy} A${r} ${r} 0 0 1 ${cx + r} ${cy}`} fill="none" stroke="#fff" strokeOpacity=".8" strokeWidth="5" strokeLinecap="round" />
      {f > 0.01 && <path d={`M${cx - r} ${cy} A${r} ${r} 0 0 1 ${x.toFixed(1)} ${y.toFixed(1)}`} fill="none" stroke="url(#tachg)" strokeWidth="5" strokeLinecap="round" />}
      <line x1={cx} y1={cy} x2={nx} y2={ny} stroke="#7c5cc4" strokeWidth="2" strokeLinecap="round" />
      <circle cx={cx} cy={cy} r="3.5" fill="#7c5cc4" />
      <text x="2" y="57" fill="#8a78b5" fontSize="7">0</text><text x="80" y="57" fill="#8a78b5" fontSize="7">9k</text>
      <text x={cx} y="57" textAnchor="middle" fill="#6d4fb3" fontSize="8">{(rpm / 1000).toFixed(1)}k</text>
    </svg>
  );
}
