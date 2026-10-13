/**
 * "State of you" — a rolling, on-device shared-history profile that shapes Wilson's tone & pacing.
 * localStorage only (this device). Gated by the "Remember things" setting. Refreshed by ONE
 * lightweight summary call every REFRESH_EVERY user messages, or at session end (tab hidden) if ≥ MIN_PENDING.
 */
import type { OpenRouterAdapter } from "../intelligence/OpenRouterAdapter";
import type { StoredMessage, WilsonVibe } from "../memory/LocalMemory";

const KEY = "wilson_state_of_you_v1";
export const REFRESH_EVERY = 12;
const MIN_PENDING = 4;
const DAY = 86_400_000;

export interface StateOfYou {
  summary: string;              // model-written + user-editable (~150-250 words)
  vibes: { v: WilsonVibe; ts: number }[];   // last 7 days
  turns: { ts: number; len: number }[];     // her messages, last 7 days (timestamps + length only)
  pending: number;              // user messages since last refresh
  updatedAt: number | null;
  editedByUser?: boolean;
}
const empty = (): StateOfYou => ({ summary: "", vibes: [], turns: [], pending: 0, updatedAt: null });

export function loadStateOfYou(): StateOfYou {
  try { return { ...empty(), ...JSON.parse(localStorage.getItem(KEY) || "{}") }; } catch { return empty(); }
}
function save(s: StateOfYou) {
  const cut = Date.now() - 7 * DAY;
  s.vibes = s.vibes.filter((x) => x.ts > cut).slice(-200);
  s.turns = s.turns.filter((x) => x.ts > cut).slice(-400);
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* full */ }
  window.dispatchEvent(new Event("wilson-state-of-you"));
}
export function clearStateOfYou() { try { localStorage.removeItem(KEY); } catch { /* ignore */ } window.dispatchEvent(new Event("wilson-state-of-you")); }
export function editStateSummary(text: string) { const s = loadStateOfYou(); s.summary = text.trim().slice(0, 2000); s.editedByUser = true; save(s); }

export function recordUserTurn(text: string) { const s = loadStateOfYou(); s.turns.push({ ts: Date.now(), len: text.length }); s.pending++; save(s); }
export function recordVibe(v: WilsonVibe) { const s = loadStateOfYou(); s.vibes.push({ v, ts: Date.now() }); save(s); }

/** Cheap local signals (no model call): mood trend, late nights, streaks, short/tired messages. */
export function localSignals(s = loadStateOfYou()): string[] {
  const out: string[] = [];
  const now = Date.now();
  const recent = s.vibes.filter((x) => x.ts > now - 3 * DAY && x.v !== "neutral");
  if (recent.length >= 2) {
    const c: Record<string, number> = {};
    recent.forEach((x) => (c[x.v] = (c[x.v] || 0) + 1));
    const top = Object.entries(c).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([k]) => k);
    const last = recent.slice(-3).map((x) => x.v).join(" → ");
    out.push(`Mood trend (last few days): mostly ${top.join(" & ")}; most recent: ${last}.`);
  }
  const late = s.turns.filter((t) => { const h = new Date(t.ts).getHours(); return h >= 23 || h < 5; });
  const lateDays = new Set(late.map((t) => new Date(t.ts).toDateString())).size;
  if (lateDays >= 2) out.push(`Late-night sessions on ${lateDays} of the last 7 days.`);
  const nowH = new Date().getHours(); if (nowH >= 23 || nowH < 5) out.push("It's late for her right now.");
  const today = s.turns.filter((t) => t.ts > now - 3 * 3_600_000);
  if (today.length >= 25) out.push(`Long streak: ${today.length} messages in the last 3 hours.`);
  const last5 = s.turns.slice(-5);
  if (last5.length === 5 && last5.every((t) => t.len < 25)) out.push("Her last few messages are very short — possible fatigue or low bandwidth.");
  const days = new Set(s.turns.map((t) => new Date(t.ts).toDateString())).size;
  if (days >= 4) out.push(`She's shown up ${days} of the last 7 days.`);
  return out;
}

/** Compact block for the system prompt. */
export function buildStateOfYouContext(): string {
  const s = loadStateOfYou();
  const sig = localSignals(s);
  if (!s.summary && !sig.length) return "";
  return [
    "[State of her — your shared recent history. Let this quietly shape your tone, pacing and energy (e.g. gentler and briefer if she's worn down, match momentum if she's on a roll, follow up on open loops when natural). Never recite it, list it, or say you're tracking her.]",
    s.summary,
    sig.length ? `Signals: ${sig.join(" ")}` : "",
  ].filter(Boolean).join("\n");
}

let running = false;
/** Refresh the summary with ONE small call. Returns true if updated. */
export async function maybeRefreshStateOfYou(adapter: OpenRouterAdapter, recent: StoredMessage[], opts: { force?: boolean } = {}): Promise<boolean> {
  const s = loadStateOfYou();
  if (running || s.pending < (opts.force ? MIN_PENDING : REFRESH_EVERY)) return false;
  const convo = recent.filter((m) => m.role === "user" || m.role === "assistant").slice(-24)
    .map((m) => `${m.role === "user" ? "HER" : "WILSON"}: ${m.content.replace(/\s+/g, " ").slice(0, 500)}`).join("\n");
  if (!convo) return false;
  running = true;
  try {
    const r = await adapter.generate({
      systemContext: "You maintain a private, compact 'state of her' note for Wilson, a companion app. Update the previous note using the new conversation. Output ONLY the note, 150-220 words, plain short lines, no preamble, under these headings exactly:\nMood & energy:\nGrinding on:\nOpen loops:\nLife context:\nHow to meet her now:\nKeep durable facts from the previous note unless contradicted; drop stale items; be specific; no diagnoses; never invent facts.",
      userInput: `PREVIOUS NOTE:\n${s.summary || "(none yet)"}\n\nLOCAL SIGNALS:\n${localSignals(s).join(" ") || "(none)"}\n\nNEW CONVERSATION (most recent last):\n${convo}`,
      generation: { temperature: 0.3, maxTokens: 600 },
    });
    const text = (r.text || "").replace(/\[(VIBE|DREAM_UPDATE):[^\]]*\]/gi, "").trim();
    if (text.length < 40) return false;
    const fresh = loadStateOfYou();
    fresh.summary = text.slice(0, 2000); fresh.pending = 0; fresh.updatedAt = Date.now(); fresh.editedByUser = false;
    save(fresh);
    window.dispatchEvent(new CustomEvent("wilson-state-refreshed", { detail: fresh.summary }));
    return true;
  } catch (e) { console.warn("[state-of-you]", e); return false; } finally { running = false; }
}
