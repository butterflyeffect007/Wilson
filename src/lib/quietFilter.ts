/** Build/dashboard/self-fix noise that used to leak into every reply. */
export const QUIET_NOISE = /\b(self-?fix|selffix|dashboard|gh-pages|preview\/pr-|github actions|wrangler|typecheck|deploy(?:ing|ment|ed)?|pr #?\d+|operator browser|pages build)\b/i;

export function isPersonalThread(t: { status: string; title: string; next: string; decision: string }): boolean {
  if (t.status === "done") return false;
  return !QUIET_NOISE.test(`${t.title} ${t.next} ${t.decision}`);
}

export function isPersonalRecap(text: string): boolean {
  return !QUIET_NOISE.test(text || "");
}
