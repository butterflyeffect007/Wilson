import type { ChatTurn } from "./agentLoop";

export const CHAT_KEY = "wilson_terminal_chat";
export const MAX_STORED_MESSAGES = 300;
export const MODEL_TURNS = 20;
const MAX_TURN_CHARS = 3500;

export type ChatMsg = { id: string; role: "user" | "wilson"; text: string };

function isMsg(v: unknown): v is ChatMsg {
  if (!v || typeof v !== "object") return false;
  const m = v as ChatMsg;
  return typeof m.id === "string" && (m.role === "user" || m.role === "wilson") && typeof m.text === "string";
}

export function loadChat(): ChatMsg[] {
  try {
    const raw = localStorage.getItem(CHAT_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isMsg).slice(-MAX_STORED_MESSAGES);
  } catch {
    return [];
  }
}

export function saveChat(list: ChatMsg[]): void {
  let batch = list.filter(isMsg).slice(-MAX_STORED_MESSAGES);
  while (true) {
    try {
      localStorage.setItem(CHAT_KEY, JSON.stringify(batch));
      return;
    } catch {
      if (batch.length <= 1) {
        try { localStorage.removeItem(CHAT_KEY); } catch { /* ignore */ }
        return;
      }
      batch = batch.slice(-Math.max(1, Math.floor(batch.length / 2)));
    }
  }
}

export function clearChatStore(): void {
  try { localStorage.removeItem(CHAT_KEY); } catch { /* ignore */ }
}

function trimTurn(text: string): string {
  if (text.length <= MAX_TURN_CHARS) return text;
  return text.slice(0, MAX_TURN_CHARS) + "\n…[trimmed]";
}

/** Last ~20 complete turns, trimmed, for the model. On-device chat can keep more. */
export function historyForModel(msgs: ChatMsg[]): ChatTurn[] {
  const cleaned = msgs.filter((m) => m.text && m.text.trim() && m.text !== "…");
  return cleaned.slice(-(MODEL_TURNS * 2)).map((m) => ({
    role: m.role === "wilson" ? "assistant" as const : "user" as const,
    content: trimTurn(m.text),
  }));
}
