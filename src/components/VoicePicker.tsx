import { useEffect, useState } from "react";
import { getLockedVoice, setLockedVoice, subscribeLockedVoice, VOICE_OPTIONS, puckPickBlockedReason, type VoiceId } from "../lib/kokoroTTS";

/** Settings → "Wilson's voice": the ONE voice Wilson always uses (no switching between voices). */
export default function VoicePicker() {
  const [voice, setVoice] = useState<VoiceId>(() => getLockedVoice());
  useEffect(() => subscribeLockedVoice(setVoice), []);
  const puckBlocked = puckPickBlockedReason();
  const current = VOICE_OPTIONS.find((o) => o.id === voice);
  return (
    <div className="text-[12px] text-violet-800/80" data-testid="voice-picker">
      <span className="text-[11px] text-violet-700/60">Wilson's voice</span>
      <div role="radiogroup" aria-label="Wilson's voice" className="mt-1 flex flex-wrap gap-1.5">
        {VOICE_OPTIONS.map((o) => {
          const on = o.id === voice;
          const disabled = o.id === "puck-device" && !!puckBlocked && !on;
          return (
            <button
              key={o.id}
              type="button"
              role="radio"
              aria-checked={on}
              disabled={disabled}
              title={disabled ? puckBlocked : o.note}
              onClick={() => setLockedVoice(o.id)}
              className={`px-3 py-1.5 rounded-full text-[12px] touch-manipulation transition-all ${on ? "bg-violet-500 text-white shadow-[0_0_14px_rgba(139,92,246,0.45)]" : "glass text-violet-800/80"} ${disabled ? "opacity-40" : ""}`}
            >
              {o.label}
            </button>
          );
        })}
      </div>
      <p className="mt-1 text-[11px] text-violet-700/70">{current?.note}. He always uses this one voice; if it's down he shows the text instead of switching to someone else.</p>
    </div>
  );
}
