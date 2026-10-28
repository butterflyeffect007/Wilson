/**
 * "Export my chats" — one JSON download with every conversation stored on this device.
 * Nothing is uploaded; the file is built in the browser and saved by the user.
 *
 * Format (version 1) — also readable by src/lib/phi-engine/wilson-signal.ts --logs
 * (it reads the top-level "threads" array; extra fields are ignored):
 * {
 *   "app": "wilson", "version": 1, "exportedAt": ISO,
 *   "threads": [{ id, title, createdAt, messages: [{ role: "user"|"assistant", content, timestamp: ISO }] }],
 *   "memory": { lessons, quietMemory, stateOfYou, longTermMemories }   // other on-device stores with conversation content
 * }
 */
import { loadThreads, type StoredThread } from "../memory/LocalMemory";
import { loadLessons } from "../core/wilson/WilsonLearning";
import { loadQuietMemory } from "./quietMemory";
import { loadStateOfYou } from "./stateOfYou";
import { listMemories } from "./longMemory";

export const CHAT_EXPORT_VERSION = 1;

export interface ExportMessage { role: "user" | "assistant"; content: string; timestamp: string }
export interface ExportThread { id: string; title: string; createdAt: string; messages: ExportMessage[] }
export interface ChatExport {
  app: "wilson";
  version: number;
  exportedAt: string;
  threads: ExportThread[];
  memory: {
    lessons: { text: string; timestamp: string }[];
    quietMemory: ReturnType<typeof loadQuietMemory> | null;
    stateOfYou: { summary: string; updatedAt: string | null } | null;
    longTermMemories: { text: string; emotion: string | null; timestamp: string }[];
  };
}

const iso = (v: unknown): string => {
  if (typeof v === "number") return new Date(v).toISOString();
  if (typeof v === "string" && !Number.isNaN(Date.parse(v))) return new Date(v).toISOString();
  return "";
};

export async function buildChatExport(threads: StoredThread[] = loadThreads()): Promise<ChatExport> {
  const out: ExportThread[] = threads.map((t) => ({
    id: t.id,
    title: t.title,
    createdAt: iso(t.createdAt) || iso(t.messages[0]?.timestamp),
    messages: t.messages
      .filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
      .map((m) => ({ role: m.role, content: m.content, timestamp: iso(m.timestamp) })),
  }));
  const qm = loadQuietMemory();
  const soy = loadStateOfYou();
  // Long-term memories live in IndexedDB; drop the embedding vectors (not conversation content).
  const ltm = await listMemories().catch(() => []);
  return {
    app: "wilson",
    version: CHAT_EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    threads: out,
    memory: {
      lessons: loadLessons().map((l) => ({ text: l.text, timestamp: iso(l.ts) })),
      quietMemory: qm.intent || qm.pacing.length || qm.threads.length || qm.recaps.length ? qm : null,
      stateOfYou: soy.summary ? { summary: soy.summary, updatedAt: soy.updatedAt ? iso(soy.updatedAt) : null } : null,
      longTermMemories: ltm.map((m) => ({ text: m.text, emotion: m.emotion, timestamp: iso(m.ts) })),
    },
  };
}

/** Local calendar date, so the filename matches the day the user sees. */
const localDate = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/** Builds the export and triggers the download. Returns the number of threads exported. */
export async function downloadChatExport(threads?: StoredThread[]): Promise<number> {
  const data = await buildChatExport(threads);
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `wilson-chats-${localDate()}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  return data.threads.length;
}
