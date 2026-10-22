/**
 * WilsonLearning — on-device "Teach Wilson" lessons, key-fact extraction,
 * and low-frequency proactive-suggestion pacing. localStorage only.
 */
export interface Lesson { id: string; text: string; ts: string }
const LESSONS_KEY = "wilson_lessons_v1";
const SUGGEST_KEY = "wilson_suggest_turns_v1";

export function loadLessons(): Lesson[] {
  try { return JSON.parse(localStorage.getItem(LESSONS_KEY) || "[]"); } catch { return []; }
}
export function saveLessons(l: Lesson[]): void {
  try { localStorage.setItem(LESSONS_KEY, JSON.stringify(l.slice(-60))); } catch { /* ignore */ }
}
export function addLesson(text: string): Lesson {
  const l: Lesson = { id: Math.random().toString(36).slice(2) + Date.now().toString(36), text, ts: new Date().toISOString() };
  const cur = loadLessons().filter((x) => x.text.toLowerCase() !== text.toLowerCase());
  saveLessons([...cur, l]);
  return l;
}
export function deleteLesson(id: string): Lesson[] {
  const next = loadLessons().filter((l) => l.id !== id);
  saveLessons(next);
  return next;
}

const clean = (s: string) => s.trim().replace(/[.!]+$/, "").replace(/\s+(?:anymore|again|please|ever)$/i, "").replace(/^["'“”‘’]+|["'“”‘’]+$/g, "").trim();

/** Detects a correction/instruction aimed at Wilson's behavior. Returns a lesson sentence or null. */
export function detectLesson(msg: string): string | null {
  const m = msg.trim();
  let r: RegExpMatchArray | null;
  if ((r = m.match(/\b(?:please\s+)?(?:don'?t|do not|never|stop)\s+(?:say(?:ing)?|call(?:ing)? me|use|using)\s+(.{2,80})/i)))
    return /call/i.test(r[0]) ? `Never call her ${clean(r[1])}.` : `Don't say or use: ${clean(r[1])}.`;
  if ((r = m.match(/\b(?:please\s+)?call me\s+([A-Z][\w' -]{1,30})/i))) return `Call her ${clean(r[1])}.`;
  if ((r = m.match(/\bmy name is\s+([A-Z][\w'-]{1,20})/))) return `Her name is ${clean(r[1])}.`;
  if ((r = m.match(/\bbe (shorter|briefer|more concise|longer|more detailed|calmer|more direct|less \w+|more \w+)(?:\s+(?:about|when|with)\s+(.{2,80}))?/i)))
    return `Be ${r[1].toLowerCase()}${r[2] ? ` about ${clean(r[2])}` : ""}.`;
  if ((r = m.match(/\b(?:i (?:don'?t|do not) (?:like|want) (?:it )?when you|(?:from now on|going forward|in the future),?\s*(?:please\s+)?)(.{3,100})/i)))
    return /when you/i.test(r[0]) ? `She doesn't like it when Wilson ${clean(r[1])}.` : `From now on: ${clean(r[1])}.`;
  if ((r = m.match(/\b(?:remember (?:that|to)|always)\s+(.{3,100})/i)) && /\byou\b|\bme\b/i.test(r[1]))
    return `Always: ${clean(r[1])}.`;
  return null;
}

/** Lightweight on-device key-fact extraction (people, projects, dreams, preferences). */
export function extractFacts(msg: string, who = "Jenny"): string[] {
  const out = new Set<string>();
  const s = msg.replace(/\s+/g, " ");
  const add = (t: string) => out.add(t.replace(/\s+([.,])/g, "$1"));
  let r: RegExpExecArray | null;
  const rel = /\b[Mm]y (friend|best friend|brother|sister|mom|mother|dad|father|son|daughter|husband|wife|partner|boyfriend|girlfriend|boss|coworker|cousin|aunt|uncle|grandma|grandpa|kid|dog|cat)(?:'s name is|,| is named| named| is called)?\s+([A-Z][a-z]+(?: [A-Z][a-z]+)?)/g;
  while ((r = rel.exec(s))) add(`Person: ${r[2]} is ${who}'s ${r[1]}.`);
  const named = /\b([A-Z][a-z]+ [A-Z][a-z]+|[A-Z][a-z]{2,}) (?:is|was) (?:my|a|an|the) ([\w -]{3,40}?)(?:[.,!?]|$)/g;
  while ((r = named.exec(s))) if (!/^(I|It|This|That|There|Wilson|He|She|They)$/.test(r[1])) add(`Person: ${r[1]} — ${r[2].trim()}.`);
  const proj = /\bi(?:'m| am) (?:working on|building|making|writing|starting|launching) (.{3,80}?)(?:[.!?]|$)/gi;
  while ((r = proj.exec(s))) add(`Project: ${who} is working on ${r[1].trim()}.`);
  const dream = /\b(?:my (?:dream|goal) is(?: to)?|i (?:want|hope|plan) to) (.{3,80}?)(?:[.!?]|$)/gi;
  while ((r = dream.exec(s))) add(`Goal: ${who} wants to ${r[1].trim()}.`);
  const pref = /\bi (love|like|hate|prefer|can'?t stand|don'?t like) (.{2,60}?)(?:[.!?,]|$)/gi;
  while ((r = pref.exec(s))) add(`Preference: ${who} ${r[1].toLowerCase()}s ${r[2].trim()}.`.replace(/(love|like|hate|prefer)ss/, "$1s").replace(/n'?t (stand|like)s/, "n't $1"));
  return [...out].slice(0, 5);
}

/** Low-frequency pacing: at most one gentle suggestion every ~5 turns. */
export function shouldSuggest(): boolean {
  const n = (Number(localStorage.getItem(SUGGEST_KEY)) || 0) + 1;
  const go = n >= 5;
  try { localStorage.setItem(SUGGEST_KEY, String(go ? 0 : n)); } catch { /* ignore */ }
  return go;
}
