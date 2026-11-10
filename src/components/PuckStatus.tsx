import { useEffect, useState } from "react";
import { isVoiceResting, getVoicePlaying, subscribeVoicePlaying, geminiRestingUntil, subscribeVoiceStatus, getLockedVoice, subscribeLockedVoice, voiceLabel } from "../lib/kokoroTTS";
import { getPuckState, getPuckProgress, subscribePuck } from "../lib/puckVoice";

/** Settings → Voice: what's speaking now and how the locked voice is doing. Never probes the on-device model. */
export default function PuckStatus() {
  const [, tick] = useState(0);
  useEffect(() => {
    const bump = () => tick((n) => n + 1);
    const un = [subscribeVoicePlaying(bump), subscribeVoiceStatus(bump), subscribeLockedVoice(bump), subscribePuck(bump)];
    return () => un.forEach((u) => u());
  }, []);
  const v = getVoicePlaying();
  const locked = getLockedVoice();
  const hm = (t: number) => new Date(t).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const time = (t: number) => new Date(t).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  const gRest = geminiRestingUntil();
  const p = getPuckState();
  const health = locked === "edge-andrew" ? "free, no daily limit"
    : locked === "gemini" ? (gRest ? `resting until ${hm(gRest)} (daily free limit)` : "free daily limit")
    : locked === "aura-orion" ? (isVoiceResting() ? "daily free limit reached" : "free daily limit")
    : p === "ready" ? "ready on this phone" : p === "loading" ? `getting ready… ${getPuckProgress()}%` : p === "failed" ? "couldn't start on this phone" : "starts on the next reply";
  return (
    <div className="space-y-0.5 text-[11px] text-violet-700/80">
      <p data-testid="voice-now"><b>Now speaking:</b> {v.now ? v.now : "nothing"}{v.last ? ` · last voice: ${v.last}${v.lastAt ? ` (${time(v.lastAt)})` : ""}` : ""}</p>
      <p data-testid="voice-locked"><b>Locked voice:</b> {voiceLabel(locked)} · {health}</p>
    </div>
  );
}
