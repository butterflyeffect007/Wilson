/**
 * Quiet memory — what Wilson carries between sessions: a short intent, pacing/preferences,
 * ongoing threads and short session recaps. Filled by the EXISTING "state of you" summary call
 * (no extra model calls). Stored on this device (localStorage); for the Architect it also
 * syncs to the worker (KV architect:memory) so it follows her across devices.
 * Never shown in chat; only a small list in Settings.
 */
import { WILSON_PROXY_URL } from "../App";
import { cachedIsAdmin, storedAdminKey } from "./admin";

const KEY = "wilson_quiet_memory_v1";
export interface MemThread { id: string; title: string; status: string; next: string; decision: string; date: string }
export interface MemRecap { id: string; date: string; text: string }
export interface QuietMemory { intent: string; pacing: string[]; threads: MemThread[]; recaps: MemRecap[]; updatedAt: number }
const empty = (): QuietMemory => ({ intent: "", pacing: [], threads: [], recaps: [], updatedAt: 0 });
const id = () => Math.random().toString(36).slice(2, 9);
const s = (v: unknown, n: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, n) : "");
const today = () => new Date().toISOString().slice(0, 10);

export function loadQuietMemory(): QuietMemory {
  try { return { ...empty(), ...JSON.parse(localStorage.getItem(KEY) || "{}") }; } catch { return empty(); }
}
function persist(m: QuietMemory, sync = true) {
  m.pacing = m.pacing.slice(0, 6); m.threads = m.threads.slice(0, 8); m.recaps = m.recaps.slice(0, 5);
  try { localStorage.setItem(KEY, JSON.stringify(m)); } catch { /* full */ }
  window.dispatchEvent(new Event("wilson-quiet-memory"));
  if (sync) void pushArchitectMemory(m);
}
export function clearQuietMemory() {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
  window.dispatchEvent(new Event("wilson-quiet-memory"));
  if (cachedIsAdmin()) void fetch(`${WILSON_PROXY_URL}/admin/memory`, { method: "DELETE", headers: { Authorization: `Bearer ${storedAdminKey()}` } }).catch(() => {});
}
export type MemItemKind = "intent" | "pacing" | "thread" | "recap";
export function deleteQuietItem(kind: MemItemKind, key: string) {
  const m = loadQuietMemory();
  if (kind === "intent") m.intent = "";
  if (kind === "pacing") m.pacing = m.pacing.filter((p) => p !== key);
  if (kind === "thread") m.threads = m.threads.filter((t) => t.id !== key);
  if (kind === "recap") m.recaps = m.recaps.filter((r) => r.id !== key);
  m.updatedAt = Date.now(); persist(m);
}
export function exportQuietMemory() {
  const blob = new Blob([JSON.stringify(loadQuietMemory(), null, 2)], { type: "application/json" });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `wilson-memory-${today()}.json`;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

/** Instructions appended to the existing summary call so the same reply also refreshes quiet memory. */
export const MEMORY_SUMMARY_ADDON = `

After the note, on its own line write exactly ---MEMORY--- and then ONE line of compact JSON (no code fences):
{"intent":"her current overarching aim, max 20 words","pacing":["how she likes to work/talk, max 4 short items"],"threads":[{"title":"ongoing project or topic","status":"active|paused|done","next":"next step, max 15 words","decision":"latest decision, max 15 words"}],"recap":"what this session covered and where it left off, max 30 words"}
Max 6 threads. Keep threads from PREVIOUS MEMORY unless finished or contradicted; never invent.`;

export function memoryForSummary(): string {
  const m = loadQuietMemory();
  if (!m.intent && !m.threads.length && !m.pacing.length) return "(none yet)";
  return JSON.stringify({ intent: m.intent, pacing: m.pacing, threads: m.threads.map(({ title, status, next, decision }) => ({ title, status, next, decision })) });
}

/** Splits the summary reply into note + memory JSON; merges memory. Returns the note text only. */
export function absorbSummaryReply(text: string): string {
  const i = text.indexOf("---MEMORY---");
  if (i < 0) return text.trim();
  const note = text.slice(0, i).trim();
  const raw = text.slice(i + 12).replace(/```(json)?/gi, "").trim();
  try {
    const j = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1));
    const m = loadQuietMemory();
    const old = new Map(m.threads.map((t) => [t.title.toLowerCase(), t]));
    if (s(j.intent, 200)) m.intent = s(j.intent, 200);
    if (Array.isArray(j.pacing) && j.pacing.length) m.pacing = j.pacing.map((p: unknown) => s(p, 120)).filter(Boolean).slice(0, 4);
    if (Array.isArray(j.threads)) {
      m.threads = j.threads.slice(0, 6).map((t: Record<string, unknown>) => {
        const title = s(t?.title, 80); const prev = old.get(title.toLowerCase());
        const next = s(t?.next, 140), decision = s(t?.decision, 140), status = s(t?.status, 12) || "active";
        const changed = !prev || prev.next !== next || prev.decision !== decision || prev.status !== status;
        return { id: prev?.id ?? id(), title, status, next, decision, date: changed ? today() : prev!.date };
      }).filter((t: MemThread) => t.title);
    }
    const recap = s(j.recap, 240);
    if (recap) {
      if (m.recaps[0]?.date === today()) m.recaps[0] = { ...m.recaps[0], text: recap };
      else m.recaps.unshift({ id: id(), date: today(), text: recap });
    }
    m.updatedAt = Date.now(); persist(m);
  } catch (e) { console.warn("[quiet-memory] parse", e); }
  return note;
}

/** Compact system-context block (~≤550 tokens). newChat adds a light "where we left off". */
export function buildQuietMemoryContext(newChat: boolean): string {
  const m = loadQuietMemory();
  if (!m.intent && !m.threads.length && !m.pacing.length && !m.recaps.length) return "";
  const lines: string[] = ["[What you carry between sessions — quiet background. Let it shape you; never recite, list, or announce it]"];
  if (m.intent) lines.push(`Intent: ${m.intent}`);
  if (m.pacing.length) lines.push(`How she likes it: ${m.pacing.join("; ")}`);
  const open = m.threads.filter((t) => t.status !== "done").slice(0, 5);
  if (open.length) lines.push("Threads:", ...open.map((t) => `- ${t.title} (${t.status}, ${t.date})${t.decision ? ` · decided: ${t.decision}` : ""}${t.next ? ` · next: ${t.next}` : ""}`));
  if (m.recaps.length) lines.push(`Recent sessions: ${m.recaps.slice(0, 2).map((r) => `${r.date}: ${r.text}`).join(" | ")}`);
  if (newChat) lines.push("This is a fresh chat. You know where you left off: if it fits her opener, you may pick it up in a light line (e.g. a nod to the last thread). Never summarize the past unprompted, and follow her lead if she starts something new.");
  return lines.join("\n").slice(0, 2200);
}

/* ---------- Architect sync (KV architect:memory via authenticated worker endpoints) ---------- */
let pushTimer: ReturnType<typeof setTimeout> | null = null;
async function pushArchitectMemory(m: QuietMemory) {
  if (!cachedIsAdmin()) return;
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    void fetch(`${WILSON_PROXY_URL}/admin/memory`, { method: "POST", headers: { Authorization: `Bearer ${storedAdminKey()}`, "Content-Type": "application/json" }, body: JSON.stringify({ memory: m }) }).catch(() => {});
  }, 1500);
}
/** On app open (Architect only): take the newer of device vs server copy. */
export async function pullArchitectMemory() {
  if (!cachedIsAdmin()) return;
  try {
    const r = await fetch(`${WILSON_PROXY_URL}/admin/memory`, { headers: { Authorization: `Bearer ${storedAdminKey()}` } });
    if (!r.ok) return;
    const srv = (await r.json())?.memory as QuietMemory | null;
    const local = loadQuietMemory();
    if (srv && (srv.updatedAt || 0) > (local.updatedAt || 0)) persist({ ...empty(), ...srv }, false);
    else if (local.updatedAt && (!srv || (srv.updatedAt || 0) < local.updatedAt)) void pushArchitectMemory(local);
  } catch { /* offline */ }
}
