import { useEffect, useState } from "react";
import { isVoiceResting, getVoicePlaying, subscribeVoicePlaying, geminiRestingUntil, subscribeVoiceStatus } from "../lib/kokoroTTS";

const PROXY = (((import.meta as any).env?.VITE_WILSON_PROXY_URL as string | undefined)?.trim() || "https://wilson-proxy.butterflyeffect007.workers.dev");
type GStatus = { ok: boolean; used?: Record<string, number>; caps?: Record<string, number>; available?: boolean; resets?: number };

/** Settings → Voice: cloud voice routing. Kokoro is disabled; only male voice profiles are requested. */
export default function PuckStatus() {
  const [, tick] = useState(0);
  const [g, setG] = useState<GStatus | null>(null);
  useEffect(() => {
    const un1 = subscribeVoicePlaying(() => tick((n) => n + 1));
    const un2 = subscribeVoiceStatus(() => tick((n) => n + 1));
    let alive = true;
    const load = () => fetch(PROXY + "/tts/gemini-puck/status").then((r) => r.json()).then((j) => { if (alive) setG(j); }).catch(() => { if (alive) setG({ ok: false }); });
    load();
    const iv = setInterval(load, 60000);
    return () => { alive = false; un1(); un2(); clearInterval(iv); };
  }, []);
  const v = getVoicePlaying();
  const hm = (t: number) => new Date(t).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const time = (t: number) => new Date(t).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  const gRest = geminiRestingUntil();
  const used = g?.used ? Object.values(g.used).reduce((a, b) => a + b, 0) : 0;
  const cap = g?.caps ? Object.values(g.caps).reduce((a, b) => a + b, 0) : 0;
  const gLine = gRest ? `resting until ${hm(gRest)}`
    : !g ? "checking…"
    : !g.ok ? "couldn't reach the voice server"
    : g.available === false ? `resting (free limit reached)${g.resets ? `; back at ${hm(g.resets)}` : ""}`
    : `available ✓ (${used} of ~${cap} pieces used today)`;
  return (
    <div className="space-y-0.5 text-[11px] text-violet-700/80">
      <p data-testid="voice-now"><b>Now speaking:</b> {v.now ? v.now : "nothing"}{v.last ? ` · last voice: ${v.last}${v.lastAt ? ` (${time(v.lastAt)})` : ""}` : ""}</p>
      <p><b>Cloud voice 1. Gemini Fenrir:</b> male voice · fallback · {gLine}</p>
      <p><b>2. Edge Andrew:</b> male voice · free, no daily limit · always-on fallback</p>
      <p><b>3. Deepgram Aura-2 Orion:</b> male backup voice · {isVoiceResting() ? "daily free limit reached" : "fallback available"}</p>
      <p className="text-[10px] text-violet-500/80">Speech routing prefers the on-device Puck model when it is already downloaded; otherwise it tries Gemini Fenrir, then the uncapped Edge Andrew voice, then Aura-2 Orion. Only male cloud voice profiles are requested.</p>
    </div>
  );
}
