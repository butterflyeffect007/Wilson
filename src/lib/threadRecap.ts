/**
 * Extractive recap of turns that no longer fit in the live context window.
 * No extra model call. Keeps earlier same-thread substance without a reply length cap.
 */
export const CONTEXT_WINDOW = 10;
const DEFAULT_MAX = 1200;

function clip(s: string, n: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? t.slice(0, n).trim() + "…" : t;
}

/** Visible chat text, without vibe/dream tags. */
function plain(content: string): string {
  return content
    .replace(/\[(VIBE|DREAM_UPDATE):[^\]]*\]?/gi, "")
    .replace(/<thought\b[^>]*>[\s\S]*?(<\/thought>|$)/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

export type RecapMessage = { role: string; content: string };

/**
 * Summarize messages that fall before the last `windowSize` turns.
 * Prefers keeping the oldest setup and the most recent dropped turns when space is tight.
 */
export function buildThreadRecap(messages: RecapMessage[], windowSize = CONTEXT_WINDOW, maxChars = DEFAULT_MAX): string {
  const convo = (messages || []).filter((m) => (m.role === "user" || m.role === "assistant") && plain(m.content || ""));
  if (convo.length <= windowSize) return "";
  const older = convo.slice(0, -windowSize);
  const lines = older.map((m) => {
    const who = m.role === "user" ? "They" : "Wilson";
    const cap = m.role === "user" ? 180 : 140;
    return `${who}: ${clip(plain(m.content), cap)}`;
  });
  let body = lines.join("\n");
  if (body.length > maxChars && lines.length > 4) {
    const keepHead = 2;
    const room = maxChars - 40;
    let tail: string[] = [];
    let used = lines.slice(0, keepHead).join("\n").length + 20;
    for (let i = lines.length - 1; i >= keepHead; i--) {
      const next = lines[i].length + 1;
      if (used + next > room) break;
      tail.unshift(lines[i]);
      used += next;
    }
    body = [...lines.slice(0, keepHead), "— … —", ...tail].join("\n");
  } else if (body.length > maxChars) {
    body = body.slice(0, maxChars - 1).trim() + "…";
  }
  return `[Earlier in this conversation — not in the live window. Use it so you don't lose the thread; don't recite it back unless asked]\n${body}`;
}

/** True when a user message is about voice, mic, or playback — the only time to attach full diagnostics. */
export function needsVoiceDiagnostics(message: string): boolean {
  return /\b(voice|speak|speaking|spoken|mic|microphone|sound|audio|hear you|can't hear|cannot hear|not talking|puck|kokoro|tts|text to speech)\b/i.test(message || "");
}
