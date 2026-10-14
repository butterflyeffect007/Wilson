import { useEffect, useState } from "react";
import { X, RefreshCw } from "lucide-react";
import { fetchTelemetry, forgetAdmin, type Telemetry } from "../lib/admin";

/** Architect telemetry view (server-verified admin only). */
export function AdminPanel({ onClose, onSignOut }: { onClose: () => void; onSignOut: () => void }) {
  const [t, setT] = useState<Telemetry | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "error">("loading");
  const load = () => { setState("loading"); void fetchTelemetry().then((d) => { setT(d); setState(d ? "ok" : "error"); }); };
  useEffect(load, []);
  const days = t ? Object.keys(t.usage).sort().reverse().slice(0, 7) : [];
  const lastModel = (() => { try { return localStorage.getItem("wilson_last_model") || "—"; } catch { return "—"; } })();
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-3 sm:p-6 bg-black/30 backdrop-blur-sm" onClick={onClose}>
      <div className="glass-strong rounded-3xl w-full max-w-lg max-h-[90dvh] overflow-y-auto p-5 text-violet-950/90" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold tracking-[0.12em]">ARCHITECT VIEW</h3>
          <div className="flex gap-3">
            <button type="button" onClick={load} aria-label="Refresh" className="text-violet-400 hover:text-violet-600"><RefreshCw className={`w-4 h-4 ${state === "loading" ? "animate-spin" : ""}`} /></button>
            <button type="button" onClick={onClose} aria-label="Close" className="text-violet-400 hover:text-violet-600"><X className="w-4 h-4" /></button>
          </div>
        </div>
        {state === "error" && <p className="text-[13px] text-rose-600">Couldn't load telemetry. Check your connection and refresh.</p>}
        {t && (
          <div className="space-y-4 text-[13px]">
            <div className="grid grid-cols-3 gap-2">
              <Stat label="Founders" value={`${t.beta.count}/${t.beta.limit}`} />
              <Stat label="Reports" value={String(t.reports.count)} />
              <Stat label="Last model (you)" value={lastModel.replace(/^.*\//, "")} small />
            </div>
            <div className="md-block p-3">
              <div className="md-block-label">engine</div>
              <div>Chat: {t.config.chat}</div><div>Voice: {t.config.voice}</div>
            </div>
            <section>
              <h4 className="md-h md-h4">Usage (last 7 days)</h4>
              {days.length === 0 ? <p className="opacity-70">No usage recorded yet — counters start now.</p> : (
                <div className="md-table-wrap"><table className="md-table">
                  <thead><tr><th>Day</th><th>Replies by model</th><th>Voice clips</th></tr></thead>
                  <tbody>{days.map((d) => {
                    const u = t.usage[d];
                    const models = Object.entries(u).filter(([k]) => k.startsWith("model:")).map(([k, v]) => `${k.slice(6).replace(/^.*\//, "")} ${v}`).join(" · ") || "—";
                    return <tr key={d}><td>{d.slice(5)}</td><td>{models}</td><td>{u["tts:gen"] ?? 0}{u["tts:limit"] ? ` (limit hit ${u["tts:limit"]}×)` : ""}</td></tr>;
                  })}</tbody>
                </table></div>
              )}
            </section>
            <section>
              <h4 className="md-h md-h4">Recent reports</h4>
              {t.reports.recent.length === 0 ? <p className="opacity-70">None yet.</p> : t.reports.recent.map((r) => (
                <div key={r.id} className="rounded-xl bg-violet-100/50 px-3 py-2 mb-1.5">
                  <div className="text-[11px] opacity-70">{r.type} · {new Date(r.ts).toLocaleString()} {r.beta ? `· β${r.beta}` : ""} {r.issue && <a className="md-link" href={r.issue} target="_blank" rel="noopener noreferrer">issue</a>}</div>
                  <div className="whitespace-pre-wrap break-words">{r.message}</div>
                </div>
              ))}
            </section>
            {t.referrals && <section>
              <h4 className="md-h md-h4">Sharing</h4>
              <p>{t.referrals.shares} shares · {t.referrals.opens} friends opened from a link · {t.referrals.sharers} people with stars{t.referrals.top.length ? ` · top: ${t.referrals.top.map((x) => `✦${x.stars}`).join(", ")}` : ""}</p>
            </section>}
            <section>
              <h4 className="md-h md-h4">Founders roster ({t.beta.count}/{t.beta.limit})</h4>
              {(t.beta.roster ?? t.beta.latest).length ? (
                <div className="md-table-wrap max-h-56 overflow-y-auto"><table className="md-table"><thead><tr><th>#</th><th>Joined</th></tr></thead>
                  <tbody>{[...(t.beta.roster ?? t.beta.latest)].sort((a, b) => a.number - b.number).map((m) => <tr key={m.number}><td>{m.number}</td><td>{new Date(m.ts).toLocaleString()}</td></tr>)}</tbody></table></div>
              ) : <p>None yet.</p>}
            </section>
          </div>
        )}
        <button type="button" onClick={() => { forgetAdmin(); onSignOut(); }} className="mt-5 text-[12px] text-violet-500 underline underline-offset-2">Sign out of Architect mode on this device</button>
      </div>
    </div>
  );
}
function Stat({ label, value, small }: { label: string; value: string; small?: boolean }) {
  return <div className="rounded-2xl bg-violet-100/60 px-3 py-2"><div className="text-[10px] opacity-70">{label}</div><div className={small ? "text-[12px] break-all" : "text-lg font-semibold"}>{value}</div></div>;
}
