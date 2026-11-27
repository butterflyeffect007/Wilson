/**
 * Detect when Jenny is asking Wilson to change his own app / look / code,
 * even if she said it in Python mode or in the main chat.
 */
const PENDING_KEY = "wilson_selffix_pending";

const PYTHON_WORK = /\b(python|matplotlib|numpy|pyplot|pyodide|micropip|pandas|jupyter|fibonacci|hello world|plot a|graph a|script that|write a (script|program|function)|run this code)\b/i;

const APP_SUBJECT = /\b(your(self| own)?|wilson'?s?|the app|this app|the (site|page|ui|look|theme|design|interface)|chat title|the title|the orb|the (header|footer|button|font|color|colour|sidebar|dashboard|terminal|welcome))\b/i;

const APP_NOUN = /\b(app|application|ui|interface|look|design|theme|style|css|layout|screen|page|button|title|header|footer|font|color|colour|orb|glow|shimmer|sparkle|animation|dashboard|sidebar|settings|welcome)\b/i;

const CHANGE_VERB = /\b(add|change|fix|update|edit|tweak|adjust|make|put|give|improve|redesign|restyle|rewrite|modify|remove|replace|do)\b/i;

const STRONG_SELF = /\b(your (own )?(code|app|look|ui|orb)|change yourself|fix yourself|edit yourself|the wilson app)\b/i;

const VISUAL_ASK = /\b(shimmer|sparkle|iridescent|glow)\b/i;

export function isSelfFixIntent(text: string, opts?: { mode?: "fix" | "python" | "chat" }): boolean {
  const t = String(text || "").trim();
  if (!t) return false;
  if (opts?.mode === "fix") return true;

  if (STRONG_SELF.test(t)) return true;

  const python = PYTHON_WORK.test(t);
  const aboutApp = APP_SUBJECT.test(t) || (CHANGE_VERB.test(t) && APP_NOUN.test(t));
  if (python && !STRONG_SELF.test(t) && !/\b(your app|your code|the (wilson )?app|chat title|the orb|your look|your ui)\b/i.test(t)) {
    return false;
  }
  if (aboutApp && CHANGE_VERB.test(t)) return true;
  // Bare visual asks like "do shimmer" were Jenny's test — treat them as app changes
  // unless she clearly wanted a Python sketch.
  if (VISUAL_ASK.test(t) && !python) return true;
  return false;
}

/** Title in her words, not a model invention. */
export function titleFromRequest(request: string, fallback = "Wilson self-update"): string {
  const cleaned = String(request || "").replace(/\s+/g, " ").trim().replace(/[.?!]+$/g, "");
  if (!cleaned) return fallback.slice(0, 80);
  const cut = cleaned.length <= 72 ? cleaned : `${cleaned.slice(0, 69).replace(/\s+\S*$/, "")}…`;
  return (cut.charAt(0).toUpperCase() + cut.slice(1)).slice(0, 80);
}

export function stashSelfFixRequest(text: string): void {
  const t = String(text || "").trim();
  if (!t) return;
  try { sessionStorage.setItem(PENDING_KEY, t); } catch { /* ignore */ }
}

export function takeSelfFixRequest(): string | null {
  try {
    const t = sessionStorage.getItem(PENDING_KEY);
    if (t) sessionStorage.removeItem(PENDING_KEY);
    return t && t.trim() ? t.trim() : null;
  } catch {
    return null;
  }
}

export const SELF_FIX_HANDOFF = "That's a change to my own app, so I'm opening the Terminal to make a real preview. You'll see what I change, and nothing goes live until you Approve.";
export const SELF_FIX_ROUTED = "That's a change to my app, so I'm doing it as a real self-fix, not as Python on this phone. You'll get a preview — nothing goes live until you Approve.";
