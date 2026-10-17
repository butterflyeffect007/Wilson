import { useEffect, useState } from "react";
import { getPuckState, getPuckProgress, getPuckStage, getPuckFail, getPuckDevice, puckBlockedReason, subscribePuck, retryPuck } from "../lib/puckVoice";
import { isVoiceResting } from "../lib/kokoroTTS";

/** Settings → Voice: plain-words status of Puck (on-device) and the arcas backup, plus why Puck last failed. */
export default function PuckStatus() {
  const [, tick] = useState(0);
  useEffect(() => subscribePuck(() => tick((n) => n + 1)), []);
  const st = getPuckState(); const fail = getPuckFail(); const blocked = puckBlockedReason();
  const line =
    st === "ready" ? "ready ✓ (no daily limit)"
    : st === "loading" ? (getPuckStage() === "downloading" ? `downloading ${getPuckProgress()}% (one time, ~92 MB; keep Wilson open)` : `starting: ${getPuckStage() || "loading"}…`)
    : st === "failed" ? `couldn't start${fail ? `: ${fail.plain}` : ""}`
    : blocked ? `off: ${blocked}` : "not started yet (tap Voice test)";
  const time = (t: number) => new Date(t).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  return (
    <div className="space-y-0.5 text-[11px] text-violet-700/80">
      <p><b>Puck voice (on this phone):</b> {line}</p>
      <p><b>Backup voice (arcas):</b> {isVoiceResting() ? "resting until 7 PM Central (daily free limit)" : "available"}</p>
      {fail && st !== "ready" && (
        <p className="text-[10px] text-rose-500/80 break-all">Last Puck problem ({time(fail.at)}): {fail.plain}. Step: {fail.stage}. Details: {fail.error}. Phone: {fail.device}.</p>
      )}
      {(st === "failed" || (st === "off" && blocked)) && (
        <button type="button" onClick={() => retryPuck()} className="mt-1 rounded-full bg-violet-100 px-3 py-1 text-[12px] text-violet-800 touch-manipulation">Try Puck again</button>
      )}
      {st !== "ready" && <p className="text-[10px] text-violet-500/70">Device: {getPuckDevice()}</p>}
    </div>
  );
}
