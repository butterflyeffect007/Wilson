/**
 * LocalMemory — browser-local persistence for Wilson:
 * threads, relationship seed, vibe/dream (parity with wilsonaibro
 * profiles.emotional_vibe / core_dream), and settings.
 */
export type WilsonVibe = "neutral" | "excited" | "calm" | "tired" | "dreaming";

export interface StoredMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: string; // ISO
}

export interface StoredThread {
  id: string;
  title: string;
  createdAt: string;
  messages: StoredMessage[];
}

export interface RelationshipSeed {
  displayName: string;
  role: string;
  notes: string[];
  updatedAt: string;
}

export interface Profile {
  vibe: WilsonVibe;
  dream: string;
}

export interface WilsonSettings {
  voiceEnabled: boolean;
  /** Free on-device Kokoro voice; kept local to this browser. */
  kokoroVoice?: "am_puck" | "am_michael" | "am_fenrir" | "af_heart";
  displayName: string;
  voiceRecognition: boolean;
  emotionDetection: boolean;
  longMemory: boolean;
  showHeard: boolean;
  dyslexiaFont: boolean;
  suggestions: boolean;
  wakeWord?: boolean;
}

const LEGACY_CONVO_KEY = "wilson_conversation_v1";
const THREADS_KEY = "wilson_threads_v1";
const ACTIVE_KEY = "wilson_active_thread_v1";
const RELATIONSHIP_KEY = "wilson_relationship_v1";
const PROFILE_KEY = "wilson_profile_v1";
const SETTINGS_KEY = "wilson_settings_v1";

const MAX_THREADS = 50;
const MAX_MESSAGES_PER_THREAD = 200;

const DEFAULT_RELATIONSHIP: RelationshipSeed = {
  displayName: "",
  role: "new friend",
  notes: [
    "This is a new person Wilson is meeting.",
    "Wilson does not know them yet.",
    "Start warm, curious, and open — learn who they are.",
  ],
  updatedAt: new Date().toISOString(),
};

export const DEFAULT_SETTINGS: WilsonSettings = {
  voiceEnabled: false,
  kokoroVoice: "am_puck",
  displayName: "",
  voiceRecognition: true,
  emotionDetection: true,
  longMemory: true,
  showHeard: false,
  dyslexiaFont: false,
  suggestions: true,
};

function safeGet<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function safeSet(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* quota / private mode */
  }
}

export function newId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

/** Same rule as wilsonaibro: first 40 chars of the first user message. */
export function makeTitle(content: string): string {
  const t = content.replace(/\s+/g, " ").trim();
  return t.slice(0, 40) + (t.length > 40 ? "..." : "");
}

/* ---------- threads ---------- */

export function loadThreads(): StoredThread[] {
  const threads = safeGet<StoredThread[]>(THREADS_KEY);
  if (threads) return threads;
  const legacy = safeGet<StoredMessage[]>(LEGACY_CONVO_KEY);
  if (legacy && legacy.length > 0) {
    const firstUser = legacy.find((m) => m.role === "user");
    const migrated: StoredThread[] = [
      {
        id: newId(),
        title: firstUser ? makeTitle(firstUser.content) : "Earlier conversation",
        createdAt: legacy[0].timestamp,
        messages: legacy,
      },
    ];
    safeSet(THREADS_KEY, migrated);
    return migrated;
  }
  return [];
}

export function saveThreads(threads: StoredThread[]): void {
  const trimmed = threads.slice(0, MAX_THREADS).map((t) => ({
    ...t,
    messages: t.messages.slice(-MAX_MESSAGES_PER_THREAD),
  }));
  safeSet(THREADS_KEY, trimmed);
}

export function loadActiveThreadId(): string | null {
  return safeGet<string>(ACTIVE_KEY);
}

export function saveActiveThreadId(id: string | null): void {
  safeSet(ACTIVE_KEY, id);
}

/* ---------- legacy single-conversation API (kept for compatibility) ---------- */

export function loadConversation(): StoredMessage[] {
  return safeGet<StoredMessage[]>(LEGACY_CONVO_KEY) ?? [];
}
export function saveConversation(messages: StoredMessage[]): void {
  safeSet(LEGACY_CONVO_KEY, messages.slice(-40));
}
export function clearConversation(): void {
  try {
    localStorage.removeItem(LEGACY_CONVO_KEY);
  } catch {
    /* ignore */
  }
}

/* ---------- relationship ---------- */

export function loadRelationship(): RelationshipSeed {
  return safeGet<RelationshipSeed>(RELATIONSHIP_KEY) ?? DEFAULT_RELATIONSHIP;
}
export function saveRelationship(seed: RelationshipSeed): void {
  safeSet(RELATIONSHIP_KEY, { ...seed, updatedAt: new Date().toISOString() });
}

/* ---------- vibe / dream ---------- */

export function loadProfile(): Profile {
  return { vibe: "neutral", dream: "", ...(safeGet<Partial<Profile>>(PROFILE_KEY) ?? {}) };
}
export function saveProfile(patch: Partial<Profile>): Profile {
  const next = { ...loadProfile(), ...patch };
  safeSet(PROFILE_KEY, next);
  return next;
}

/* ---------- settings ---------- */

export function loadSettings(): WilsonSettings {
  const saved = safeGet<Partial<WilsonSettings> & { autoSpeakV2?: boolean }>(SETTINGS_KEY) ?? {};
  if (!saved.autoSpeakV2) { saved.voiceEnabled = false; saved.autoSpeakV2 = true; safeSet(SETTINGS_KEY, { ...DEFAULT_SETTINGS, ...saved }); }
  return { ...DEFAULT_SETTINGS, ...saved };
}
export function saveSettings(s: WilsonSettings): void {
  safeSet(SETTINGS_KEY, s);
}

/* ---------- tag parsing (parity with wilsonaibro Index.tsx) ---------- */

const VIBE_RE = /\[VIBE:\s*(excited|calm|tired|dreaming|neutral)\s*\]/i;
const DREAM_RE = /\[DREAM_UPDATE:\s*(.+?)\]/i;

export function parseAndStripTags(text: string): {
  clean: string;
  vibe?: WilsonVibe;
  dream?: string;
} {
  const vibeMatch = text.match(VIBE_RE);
  const dreamMatch = text.match(DREAM_RE);
  const clean = text
    .replace(/\[VIBE:[^\]]*\]?/gi, "")
    .replace(/\[DREAM_UPDATE:[^\]]*\]?/gi, "")
    .trim();
  const dream = dreamMatch ? dreamMatch[1].trim() : undefined;
  return {
    clean,
    vibe: vibeMatch ? (vibeMatch[1].toLowerCase() as WilsonVibe) : undefined,
    dream: dream && !/^<.*>$/.test(dream) ? dream : undefined,
  };
}

/** Hide tags (including half-streamed ones) while a reply is streaming. */
export function stripTagsForDisplay(text: string): string {
  return text
    .replace(/\[(VIBE|DREAM_UPDATE):[^\]]*\]?/gi, "")
    .replace(/\[[A-Z_]{0,12}$/i, "")
    .trimEnd();
}

/* ---------- memory context (fed into the system prompt) ---------- */

export function buildMemoryContext(threads: StoredThread[] = loadThreads()): string {
  const rel = loadRelationship();
  const profile = loadProfile();
  const name = rel.displayName || "someone new";
  const lines = [
    "## RELATIONSHIP MEMORY (local)",
    `You are speaking with ${name} — ${rel.role}.`,
    rel.displayName ? "You already know them." : "This may be a first meeting. Be warm and curious.",
    ...rel.notes.map((n) => `- ${n}`),
  ];

  const titles = threads
    .map((t) => t.title)
    .filter((t) => t && t !== "New Thread")
    .slice(0, 15)
    .map((t) => `"${t}"`);
  if (titles.length) {
    lines.push(
      "",
      "## USER'S CONVERSATION HISTORY (long-term memory)",
      `The user has discussed these topics in previous threads: ${titles.join(", ")}`,
      "You remember these topics but do NOT continue them unless the user brings them up.",
    );
  }
  if (profile.dream) {
    lines.push(
      "",
      "## USER'S CORE DREAM",
      `The user's current dream/goal: "${profile.dream}"`,
      "Subtly tie your advice back to this dream when relevant.",
    );
  }
  if (profile.vibe !== "neutral") {
    lines.push("", `## USER'S CURRENT EMOTIONAL VIBE: ${profile.vibe.toUpperCase()}`, "Adapt your tone accordingly.");
  }
  return lines.join("\n");
}
