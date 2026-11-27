/** Worker cap is 8,000 chars per message (MAX_MSG_CHARS). Split long system prompts on paragraph breaks. */
export const SYSTEM_MSG_MAX = 7800;

export function splitSystemContext(text: string | undefined): string[] {
  const raw = (text || "").trim();
  if (!raw) return [];
  if (raw.length <= SYSTEM_MSG_MAX) return [raw];
  const parts: string[] = [];
  let cur = "";
  for (const para of raw.split("\n\n")) {
    if (cur && cur.length + para.length + 2 > SYSTEM_MSG_MAX) {
      parts.push(cur);
      cur = para;
    } else cur = cur ? cur + "\n\n" + para : para;
  }
  if (cur) parts.push(cur);
  const out: string[] = [];
  for (const p of parts) {
    if (p.length <= SYSTEM_MSG_MAX) out.push(p);
    else {
      for (let i = 0; i < p.length; i += SYSTEM_MSG_MAX) out.push(p.slice(i, i + SYSTEM_MSG_MAX));
    }
  }
  return out;
}
