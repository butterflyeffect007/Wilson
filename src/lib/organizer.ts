/** On-device Notes & Reminders (localStorage) + chat intent parsing. Free, no backend. */
export interface Note { id: string; text: string; created: string; updated: string }
export interface Reminder { id: string; text: string; due: string | null; done: boolean; notified: boolean; created: string }
const NK = "wilson_notes_v1", RK = "wilson_reminders_v1", PK = "wilson_notif_asked_v1";
const nid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);
const read = <T,>(k: string): T[] => { try { return JSON.parse(localStorage.getItem(k) || "[]"); } catch { return []; } };
const write = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* full */ } window.dispatchEvent(new Event("wilson-organizer")); };

export const loadNotes = () => read<Note>(NK);
export const saveNotes = (n: Note[]) => write(NK, n);
export function addNote(text: string): Note { const now = new Date().toISOString(); const n = { id: nid(), text, created: now, updated: now }; saveNotes([n, ...loadNotes()]); return n; }
export function updateNote(id: string, text: string) { saveNotes(loadNotes().map((n) => (n.id === id ? { ...n, text, updated: new Date().toISOString() } : n))); }
export function deleteNote(id: string) { saveNotes(loadNotes().filter((n) => n.id !== id)); }

export const loadReminders = () => read<Reminder>(RK);
export const saveReminders = (r: Reminder[]) => write(RK, r);
export function addReminder(text: string, due: Date | null): Reminder {
  const r = { id: nid(), text, due: due ? due.toISOString() : null, done: false, notified: false, created: new Date().toISOString() };
  saveReminders([...loadReminders(), r]); return r;
}
export function setReminderDone(id: string, done = true) { saveReminders(loadReminders().map((r) => (r.id === id ? { ...r, done } : r))); }
export function deleteReminder(id: string) { saveReminders(loadReminders().filter((r) => r.id !== id)); }
export const upcoming = () => loadReminders().filter((r) => !r.done).sort((a, b) => (a.due ?? "9").localeCompare(b.due ?? "9"));
export const dueNow = () => loadReminders().filter((r) => !r.done && r.due && Date.parse(r.due) <= Date.now());

/** Ask for notification permission politely, only once ever. */
export async function askNotifyOnce() {
  if (!("Notification" in window) || Notification.permission !== "default" || localStorage.getItem(PK)) return;
  localStorage.setItem(PK, "1");
  try { await Notification.requestPermission(); } catch { /* ignore */ }
}
/** Fire notifications for newly-due reminders; returns the ones that became due. */
export function checkDue(): Reminder[] {
  const all = loadReminders(); const fired: Reminder[] = [];
  for (const r of all) if (!r.done && !r.notified && r.due && Date.parse(r.due) <= Date.now()) { r.notified = true; fired.push(r); }
  if (!fired.length) return [];
  saveReminders(all);
  if ("Notification" in window && Notification.permission === "granted")
    for (const r of fired) { try { new Notification("Wilson reminder", { body: r.text, tag: r.id, icon: "./favicon.svg" }); } catch { /* iOS non-PWA */ } }
  return fired;
}

export const fmtDue = (iso: string | null) => {
  if (!iso) return "No time";
  const d = new Date(iso), t = new Date(); const tm = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (d.toDateString() === t.toDateString()) return `Today ${tm}`;
  const tom = new Date(t); tom.setDate(t.getDate() + 1);
  if (d.toDateString() === tom.toDateString()) return `Tomorrow ${tm}`;
  return d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" }) + ` ${tm}`;
};

/** Parse a time phrase out of text. Returns the date and the text with the phrase removed. */
export function parseTime(text: string, now = new Date()): { due: Date | null; rest: string } {
  let s = text, due: Date | null = null; let m: RegExpMatchArray | null;
  if ((m = s.match(/\bin (\d+|an?|one|half an?) ?(minutes?|mins?|hours?|hrs?)\b/i))) {
    const n = /half/i.test(m[1]) ? 0.5 : /^(an?|one)$/i.test(m[1]) ? 1 : Number(m[1]);
    due = new Date(now.getTime() + n * (/^h/i.test(m[2]) ? 3600e3 : 60e3)); s = s.replace(m[0], " ");
  } else {
    let day = 0;
    if ((m = s.match(/\btomorrow\b/i))) { day = 1; s = s.replace(m[0], " "); }
    else if ((m = s.match(/\btonight\b/i))) { s = s.replace(m[0], " "); if (!/\bat \d/i.test(s)) s += " at 8pm"; }
    const t = s.match(/\b(?:at|by|@) ?(\d{1,2})(?::(\d{2}))? ?(am|pm|a\.m\.|p\.m\.)?\b|\b(noon|midnight)\b/i);
    if (t) {
      let h: number, mi = 0;
      if (t[4]) h = /noon/i.test(t[4]) ? 12 : 0;
      else {
        h = Number(t[1]); mi = Number(t[2] || 0); const ap = (t[3] || "").toLowerCase();
        if (ap.startsWith("p") && h < 12) h += 12; if (ap.startsWith("a") && h === 12) h = 0;
        if (!ap && h < 12) { const cand = new Date(now); cand.setDate(now.getDate() + day); cand.setHours(h, mi, 0, 0); if (day === 0 && cand <= now) h += 12; if (h >= 24) h -= 12; }
      }
      due = new Date(now); due.setDate(now.getDate() + day); due.setHours(h, mi, 0, 0);
      if (day === 0 && due <= now) due.setDate(due.getDate() + 1);
      s = s.replace(t[0], " ");
    } else if (day) { due = new Date(now); due.setDate(now.getDate() + 1); due.setHours(9, 0, 0, 0); }
  }
  return { due, rest: s.replace(/\s+/g, " ").trim() };
}

export type OrgAction =
  | { kind: "note"; text: string } | { kind: "notes" }
  | { kind: "remind"; text: string; due: Date | null } | { kind: "reminders" }
  | { kind: "complete"; query: string };

/** Detect a notes/reminders intent in a chat message. */
export function detectAction(msg: string): OrgAction | null {
  const m0 = msg.trim().replace(/[.!]+$/, "");
  let m: RegExpMatchArray | null;
  if (/\b(show|list|see|read|what are|open)\b.{0,15}\bnotes?\b/i.test(m0)) return { kind: "notes" };
  if (/\b(what'?s on my (list|plate|schedule)|(show|list|see|what are|any) .{0,12}reminders?|what do i (need|have) to do)\b/i.test(m0)) return { kind: "reminders" };
  if ((m = m0.match(/^(?:hey wilson,? )?(?:please )?(?:remind me|set a reminder|reminder)(?: to| that| about|:)?\s+(.+)/i))) {
    const { due, rest } = parseTime(m[1]);
    const text = rest.replace(/^(to|that|about)\s+/i, "").trim();
    if (text) return { kind: "remind", text: text.charAt(0).toUpperCase() + text.slice(1), due };
  }
  if ((m = m0.match(/\b(?:i )?(?:did|finished|done with|completed?|mark(?:ed)?|check(?:ed)? off)\s+(?:the )?(.{3,60}?)(?: as done| reminder| off)?$/i)) && /\b(done|finished|complete|check|mark)/i.test(m0)) return { kind: "complete", query: m[1] };
  if ((m = m0.match(/^(?:hey wilson,? )?(?:please )?(?:note that|make a note(?: that| of)?|save (?:a |this as a )?note(?: that|:)?|take a note(?: that|:)?|add (?:a )?note(?: that|:)?|note:|jot down)\s*(.+)/i)))
    return { kind: "note", text: m[1].trim() };
  return null;
}

/** Perform the action on-device and return context for Wilson's reply. */
export function runAction(a: OrgAction): string {
  if (a.kind === "note") { addNote(a.text); return `[Done on-device] Saved a new note: "${a.text}". Confirm briefly and naturally; mention she can find it in Notes from the menu.`; }
  if (a.kind === "remind") {
    addReminder(a.text, a.due); void askNotifyOnce();
    return `[Done on-device] Reminder set: "${a.text}" — ${a.due ? fmtDue(a.due.toISOString()) : "no specific time"}. Confirm in one short line with the time. Don't claim anything else was scheduled.`;
  }
  if (a.kind === "notes") { const n = loadNotes(); return `[Her saved notes, newest first]\n${n.length ? n.slice(0, 20).map((x) => `- ${x.text}`).join("\n") : "(none yet)"}\nShow them to her clearly as a short list.`; }
  if (a.kind === "reminders") { const r = upcoming(); return `[Her open reminders]\n${r.length ? r.map((x) => `- ${x.text} (${fmtDue(x.due)})`).join("\n") : "(nothing open)"}\nShow them as a simple checklist.`; }
  const q = a.query.toLowerCase(); const hit = upcoming().find((r) => r.text.toLowerCase().includes(q) || q.includes(r.text.toLowerCase().slice(0, 12)));
  if (hit) { setReminderDone(hit.id); return `[Done on-device] Marked reminder complete: "${hit.text}". Acknowledge warmly in one line.`; }
  return "";
}
