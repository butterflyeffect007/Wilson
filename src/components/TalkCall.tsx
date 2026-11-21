import { PhoneOff } from "lucide-react";
import WilsonOrb, { type WilsonVibe } from "./WilsonOrb";
import { ErrorBoundary } from "./ErrorBoundary";
import { useOverlayHistory } from "@/hooks/useOverlayHistory";
import { useTalkCall, type CallSend } from "@/hooks/useTalkCall";
import { statusText } from "@/lib/callMode";

interface Props {
  micReady: Promise<boolean> | null;
  send: CallSend;
  getSpokenText: () => string;
  cancelReply?: () => void;
  onClose: () => void;
  vibe: WilsonVibe;
}

/** Full-screen "Talk with Wilson" call: his orb, a status line, what he heard, and a big End call button. */
export default function TalkCall({ micReady, send, getSpokenText, cancelReply, onClose, vibe }: Props) {
  const { state, tapOrb, end, voiceBargeIn } = useTalkCall({ micReady, send, getSpokenText, cancelReply, onClosed: onClose });
  useOverlayHistory(end, "talk-call");
  const p = state.phase;
  const hint =
    p === "thinking"
      ? "Still talking? Just keep going, he'll wait"
      : p === "speaking"
      ? voiceBargeIn ? "Start talking or tap the orb to cut in" : "Tap the orb to cut in"
      : p === "listening"
      ? state.heard ? "Take your time. Tap the orb when you're done, or just stop talking" : state.nudge ? "No rush. I'm right here" : "Talk whenever you're ready"
      : "";

  return (
    <div className="wl-call fixed inset-0 z-[90] flex flex-col items-center" role="dialog" aria-modal="true" aria-label="Talk with Wilson call">
      <div className="pt-[max(1.25rem,env(safe-area-inset-top))] px-6 text-center">
        <p className="wl-call-title">Talk with Wilson</p>
      </div>

      <div className="flex-1 w-full flex flex-col items-center justify-center px-6">
        <button type="button" onClick={tapOrb} className="wl-call-orb mb-[clamp(3.25rem,9dvh,5.5rem)] touch-manipulation" aria-label={p === "speaking" || p === "thinking" ? "Interrupt Wilson" : p === "paused" ? "Start listening" : "Send what I said"}>
          <ErrorBoundary label="the orb" compact>
            <WilsonOrb size="lg" vibe={vibe} isThinking={p === "thinking"} />
          </ErrorBoundary>
        </button>
        <div className="text-center min-h-[7.5rem] max-w-md">
          <p className="wl-call-status" role="status" aria-live="polite">{statusText(state)}</p>
          {state.heard && (p === "listening" || p === "thinking") && <p className="wl-call-heard">“{state.heard}”</p>}
          {hint && <p className="wl-call-hint">{hint}</p>}
        </div>
      </div>

      <div className="w-full px-6 pb-[max(1.5rem,calc(env(safe-area-inset-bottom)+0.75rem))] flex justify-center">
        <button type="button" onClick={end} className="wl-call-end touch-manipulation" aria-label="End call">
          <PhoneOff className="w-6 h-6" aria-hidden="true" />
          End call
        </button>
      </div>
    </div>
  );
}
