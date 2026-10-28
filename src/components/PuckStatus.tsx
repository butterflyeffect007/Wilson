import { useEffect, useState } from "react";
import { puckStats, getPuckState, getPuckProgress, getPuckStage, getPuckFail, getPuckDevice, puckBlockedReason, subscribePuck, retryPuck, puckOnDisk, puckOnDiskKnown } from "../lib/puckVoice";
import { isVoiceResting, getVoicePlaying, subscribeVoicePlaying, geminiRestingUntil, subscribeVoiceStatus } from "../lib/kokoroTTS";

const PROXY = (((import.meta as any).env?.VITE_WILSON_PROXY_URL as string | undefined)?.trim() || "https://wilson-proxy.butterflyeffect007.workers.dev");
type GStatus = { ok: boolean; used?: Record<string, number>; caps?: Record<string, number>; available?: boolean; resets?: number };

/** Settings → Voice: which voice is speaking, plus plain-words status of each voice in Wilson's order. */
export default function PuckStatus() {
  const [, tick] = useState(0);
  const [g, setG] = useState<GStatus | null>(null);
  useEffect(() => {
    const un1 = subscribePuck(() => tick((n) => n + 1));
    const un2 = subscribeVoicePlaying(() => tick((n) => n + 1));
    const un3 = subscribeVoiceStatus(() => tick((n) => n + 1));
    void puckOnDisk().then(() => tick((n) => n + 1));
    let alive = true;
    const load = () => fetch(PROXY + "/tts/gemini-puck/status").then((r) => r.json()).then((j) => { if (alive) setG(j); }).catch(() => { if (alive) setG({ ok: false }); });
    load();
    const iv = setInterval(load, 60000);
    return () => { alive = false; un1(); un2(); un3(); clearInterval(iv); };
  }, []);
  const v = getVoicePlaying();
  const st = getPuckState(); const fail = getPuckFail(); const blocked = puckBlockedReason();
  const saved = puckOnDiskKnown() === true;
  const hm = (t: number) => new Date(t).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const time = (t: number) => new Date(t).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  const gRest = geminiRestingUntil();
  const used = g?.used ? Object.values(g.used).reduce((a, b) => a + b, 0) : 0;
  const cap = g?.caps ? Object.values(g.caps).reduce((a, b) => a + b, 0) : 0;
  const gLine = gRest ? `resting until ${hm(gRest)} (free limit reached; resets at midnight Pacific)`
    : !g ? "checking…"
    : !g.ok ? "couldn't reach the voice server"
    : g.available === false ? `resting (free limit reached)${g.resets ? `; back at ${hm(g.resets)}` : ""}`
    : `available ✓ (${used} of ~${cap} pieces used today; resets midnight Pacific)`;
  const pLine =
    st === "ready" ? "ready ✓ (no daily limit)"
    : st === "loading" ? (getPuckStage() === "downloading" ? `downloading ${getPuckProgress()}% (one time, ~92 MB; keep Wilson open)` : `starting: ${getPuckStage() || "loading"}…`)
    : st === "failed" ? `couldn't start${fail ? `: ${fail.plain}` : ""}`
    : blocked ? `off: ${blocked}`
    : saved ? "saved on this phone; starts when needed" : "not downloaded (optional, only used if Gemini Puck is resting)";
  return (
    <div className="space-y-0.5 text-[11px] text-violet-700/80">
      <p data-testid="voice-now"><b>Now speaking:</b> {v.now ? v.now : "nothing"}{v.last ? ` · last voice: ${v.last}${v.lastAt ? ` (${time(v.lastAt)})` : ""}` : ""}</p>
      <p><b>1. Gemini Puck (main):</b> {gLine}</p>
      <p><b>2. Puck on this phone (optional backup):</b> {pLine}</p>
      {st === "ready" && puckStats.clips.length > 0 && (
        <p className="text-[10px] text-violet-500/80 break-all">Last sentences: {puckStats.clips.slice(-5).map((c) => `${(c.ms / 1000).toFixed(1)} s for ${c.secs} s of speech`).join(" · ")}.</p>
      )}
      <p><b>3. arcas (backup):</b> {isVoiceResting() ? "resting until 7 PM Central (daily free limit)" : "available"}</p>
      {fail && st !== "ready" && st !== "off" && (
        <p className="text-[10px] text-rose-500/80 break-all">Last on-device Puck problem ({time(fail.at)}): {fail.plain}. Step: {fail.stage}. Details: {fail.error}. Phone: {fail.device}.</p>
      )}
      {st !== "ready" && st !== "loading" && (
        <button type="button" onClick={() => retryPuck()} className="mt-1 rounded-full bg-violet-100 px-3 py-1 text-[12px] text-violet-800 touch-manipulation">
          {saved ? "Start on-device Puck" : st === "failed" ? "Try on-device Puck again" : "Download on-device Puck (92 MB, optional)"}
        </button>
      )}
      {st === "failed" && <p className="text-[10px] text-violet-500/70">Device: {getPuckDevice()}</p>}
    </div>
  );
}
