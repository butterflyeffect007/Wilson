import { useState } from "react";
import { X, Loader2 } from "lucide-react";
import { sendFeedback, type FeedbackType } from "../lib/beta";

export interface FeedbackTarget { type: FeedbackType; reply?: string; context?: string; pickType?: boolean }

export default function FeedbackSheet({ target, onClose }: { target: FeedbackTarget; onClose: () => void }) {
  const [type, setType] = useState<FeedbackType>(target.type);
  const [text, setText] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | string>("idle");
  const title = target.reply ? "Send to Jenny" : type === "suggestion" ? "Send a suggestion" : "Report a problem";
  const canSend = target.reply ? true : text.trim().length > 0;
  const submit = async () => {
    setState("sending");
    const r = await sendFeedback({ type, message: text.trim(), reply: target.reply, context: target.context });
    if (r.ok) { setState("sent"); setTimeout(onClose, 1200); } else setState(r.error || "Couldn't send");
  };
  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-violet-950/20" onClick={onClose}>
      <div className="w-full max-w-lg glass-strong rounded-t-3xl p-4 pb-[max(1rem,env(safe-area-inset-bottom))] space-y-3" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={title}>
        <div className="flex items-center justify-between">
          <h3 className="text-sm text-violet-950/90">{title}</h3>
          <button type="button" onClick={onClose} aria-label="Close" className="text-violet-400"><X className="w-4 h-4" /></button>
        </div>
        {target.reply && (
          <>
            <div className="text-[11px] text-violet-700/70 max-h-20 overflow-y-auto rounded-xl bg-violet-100/40 p-2 whitespace-pre-wrap">{target.reply.slice(0, 400)}{target.reply.length > 400 ? "…" : ""}</div>
            <select value={type} onChange={(e) => setType(e.target.value as FeedbackType)} aria-label="Type" className="w-full text-[13px] rounded-xl px-3 py-2 bg-white/60 text-violet-900 border border-violet-200/60">
              <option value="problem">Problem with this reply</option>
              <option value="suggestion">Suggestion</option>
              <option value="great">Great reply</option>
            </select>
          </>
        )}
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={4} placeholder={target.reply ? "Add a note (optional)" : type === "suggestion" ? "What would make Wilson better?" : "What went wrong?"} className="w-full text-[14px] rounded-xl px-3 py-2 bg-white/60 text-violet-950 border border-violet-200/60 resize-none" />
        <button type="button" disabled={!canSend || state === "sending" || state === "sent"} onClick={() => void submit()} className="w-full text-[14px] py-2.5 rounded-xl bg-violet-500/90 text-white disabled:opacity-50 flex items-center justify-center gap-2">
          {state === "sending" ? <><Loader2 className="w-4 h-4 animate-spin" />Sending</> : state === "sent" ? "Sent — thank you" : "Send"}
        </button>
        {!["idle", "sending", "sent"].includes(state) && <p className="text-[12px] text-rose-500">{state}</p>}
        <p className="text-[10px] text-violet-500/60">Sends your note, this app's version, device/browser type, theme and beta number. No account needed.</p>
      </div>
    </div>
  );
}
