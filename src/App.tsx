import { useState, useRef, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Settings as SettingsIcon, Sun, Moon, ChevronDown,
  Send, Sparkles, Loader2, Mic, Check, Menu, Plus, Trash2, X,
  Square, Copy, Play, RotateCcw, Volume2, VolumeX, Share2,
} from "lucide-react";
import WilsonOrb from "./components/WilsonOrb";
import Backdrop from "./components/Backdrop";
import { OpenRouterAdapter, OpenRouterError } from "./intelligence/OpenRouterAdapter";
import type { ModelRequest } from "./intelligence";
import { prepareTools } from "./intelligence";
import { DEFAULT_WILSON_POLICY, getPreferredEngine } from "./core/wilson/WilsonPolicy";
import { composeRequest } from "./core/wilson/WilsonCore";
import { loadLessons, addLesson, deleteLesson, detectLesson, extractFacts, shouldSuggest, type Lesson } from "./core/wilson/WilsonLearning";
import { shareChat } from "./lib/shareChat";
import { IntelligenceRouter } from "./intelligence/IntelligenceRouter";
import {
  loadThreads, saveThreads, loadActiveThreadId, saveActiveThreadId,
  loadProfile, saveProfile, loadSettings, saveSettings,
  buildMemoryContext, parseAndStripTags, stripTagsForDisplay, makeTitle, newId,
  type StoredThread, type StoredMessage, type WilsonVibe, type WilsonSettings,
} from "./memory/LocalMemory";
import { startSpeechStream, speakMessage, voiceTest, subscribeVoiceDebug, getVoiceDebug, type VoiceDebug, warmVoice, stopSpeaking, primePlayback, subscribeVoiceStatus, getVoiceStatus, type VoiceStatus } from "./lib/kokoroTTS";
import { emitRipple } from "./lib/listeningBus";
import { useSpeechToText } from "./hooks/useSpeechToText";
import { startCapture, stopCapture, embedSpeaker } from "./lib/voiceCapture";
import { identify, loadProfiles, saveProfiles, renameProfile, mergeProfiles, splitLast, DEFAULT_THRESHOLD, type SpeakerProfile } from "./lib/speakerMatch";
import { queryMemories, upsertMemory, listMemories, clearMemories, deleteMemory, summarizeExchange, type MemoryItem } from "./lib/longMemory";
import { analyzeProsody, classify, EMOTION_CONFIDENCE_MIN, EMOTION_GUIDANCE, EMOTION_TTS_SPEED, type EmotionTag } from "./lib/emotion";

export const WILSON_PROXY_URL: string =
  ((import.meta.env.VITE_WILSON_PROXY_URL as string | undefined)?.trim()) ||
  "https://wilson-proxy.butterflyeffect007.workers.dev";
const CONTEXT_WINDOW = 10;
const MAX_RETRIES = 2;

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}
function getThreadGreeting(displayName: string, isReturning: boolean): string {
  const name = displayName ? ` ${displayName}` : "";
  if (!isReturning) return `Hey${name} — I'm **Wilson**. Ask me anything. ✨`;
  return pickRandom([
    `Hey${name}. What's on your mind?`,
    `Welcome back${name}. What are we tackling?`,
    `Good to see you${name}. Where do we start?`,
    `Hey${name} — back for more? Hit me.`,
    `Yo${name}. What do you need?`,
    `${name ? name.trim() + "!" : "Hey!"} What's up?`,
  ]);
}

function renderInline(text: string) {
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g);
  return parts.map((p, i) => {
    if (p.length > 4 && p.startsWith("**") && p.endsWith("**")) return <strong key={i}>{p.slice(2, -2)}</strong>;
    if (p.length > 2 && p.startsWith("*") && p.endsWith("*")) return <em key={i}>{p.slice(1, -1)}</em>;
    if (p.length > 2 && p.startsWith("`") && p.endsWith("`"))
      return <code key={i} className="px-1 rounded bg-violet-100/70 text-[0.92em]">{p.slice(1, -1)}</code>;
    return <span key={i}>{p}</span>;
  });
}

function friendlyError(err: unknown): { text: string; retryable: boolean } {
  const status = err instanceof OpenRouterError ? err.status : 0;
  if (status === 429) return { text: "*Whew, lots of people talking at once. Give me a second and ask again.*", retryable: true };
  return { text: "*My brain's a little busy right now. Try again in a moment.*", retryable: true };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export default function App() {
  const [threads, setThreads] = useState<StoredThread[]>(() => loadThreads());
  const [activeId, setActiveId] = useState<string | null>(() => {
    const saved = loadActiveThreadId();
    return saved && loadThreads().some((t) => t.id === saved) ? saved : null;
  });
  const [input, setInput] = useState("");
  const [playMsg, setPlayMsg] = useState<{ id: string; phase: "loading" | "playing" } | null>(null);
  const toggleMessageVoice = (msg: StoredMessage) => {
    if (playMsg?.id === msg.id) { stopSpeaking(); setPlayMsg(null); return; }
    setPlayMsg({ id: msg.id, phase: "loading" });
    speakMessage(msg.content, EMOTION_TTS_SPEED[voiceCtxRef.current.emotion ?? "neutral"], {
      onStart: () => setPlayMsg((p) => (p?.id === msg.id ? { id: msg.id, phase: "playing" } : p)),
      onEnd: () => setPlayMsg((p) => (p?.id === msg.id ? null : p)),
    });
  };
  const [thinking, setThinking] = useState(false);
  const [streamingId, setStreamingId] = useState<string | null>(null);
  const [vibe, setVibe] = useState<WilsonVibe>(() => loadProfile().vibe);
  const [settings, setSettings] = useState<WilsonSettings>(() => loadSettings());
  const [voiceProfiles, setVoiceProfiles] = useState<SpeakerProfile[]>(() => loadProfiles());
  const [speaker, setSpeaker] = useState<{ id: string; lowConfidence: boolean; isNew: boolean } | null>(null);
  const [heard, setHeard] = useState<{ tag: EmotionTag; confidence: number } | null>(null);
  const [nameDraft, setNameDraft] = useState("");
  const [correcting, setCorrecting] = useState(false);
  const voiceCtxRef = useRef<{ name: string; emotion: EmotionTag | null; id: string }>({ name: "", emotion: null, id: "default" });
  const [memories, setMemories] = useState<MemoryItem[] | null>(null);
  useEffect(() => { saveProfiles(voiceProfiles); }, [voiceProfiles]);
  const speakerProfile = speaker ? voiceProfiles.find((p) => p.id === speaker.id) ?? null : null;
  useEffect(() => { voiceCtxRef.current.name = speakerProfile?.name ?? ""; }, [speakerProfile?.name]);
  const [showSettings, setShowSettings] = useState(false);
  const [lessons, setLessons] = useState<Lesson[]>(() => loadLessons());
  const [shareNote, setShareNote] = useState<string | null>(null);
  const [fieldOpen, setFieldOpen] = useState(false);
  const [voiceStatus, setVoiceStatus] = useState<VoiceStatus>(() => getVoiceStatus());
  useEffect(() => subscribeVoiceStatus(setVoiceStatus), []);
  const [voiceDebug, setVoiceDebug] = useState<VoiceDebug>(() => getVoiceDebug());
  useEffect(() => subscribeVoiceDebug(setVoiceDebug), []);
  const [showInstallHint, setShowInstallHint] = useState(() => {
    try {
      const ua = navigator.userAgent;
      const iOS = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
      const safari = /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS/.test(ua);
      const standalone = (navigator as any).standalone === true || window.matchMedia("(display-mode: standalone)").matches;
      return iOS && safari && !standalone && !localStorage.getItem("wilson_install_hint_seen");
    } catch { return false; }
  });
  const dismissInstallHint = () => { setShowInstallHint(false); try { localStorage.setItem("wilson_install_hint_seen", "1"); } catch { /* ignore */ } };
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    try {
      const t = localStorage.getItem("wilson_theme");
      if (t === "light" || t === "dark") return t;
      return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    } catch { return "light"; }
  });
  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute("content", theme === "dark" ? "#0d1030" : "#efe4ff"));
  }, [theme]);
  useEffect(() => {
    document.documentElement.classList.toggle("font-dyslexic", Boolean(settings.dyslexiaFont));
  }, [settings.dyslexiaFont]);
  const toggleTheme = () => setTheme((t) => {
    const n = t === "dark" ? "light" : "dark";
    try { localStorage.setItem("wilson_theme", n); } catch { /* ignore */ }
    return n;
  });
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [lastFailed, setLastFailed] = useState<{ threadId: string; content: string } | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const stickToBottom = useRef(true);
  const threadsRef = useRef(threads);
  threadsRef.current = threads;

  const busy = thinking || streamingId !== null;
  const activeThread = threads.find((t) => t.id === activeId) ?? null;
  const messages = activeThread?.messages ?? [];
  const displayName = settings.displayName || "";

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  useEffect(() => { saveThreads(threads); }, [threads]);
  useEffect(() => { saveActiveThreadId(activeId); }, [activeId]);
  useEffect(() => { saveSettings(settings); }, [settings]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  };
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (!messages.length && !thinking) { el.scrollTop = 0; return; }
    if (stickToBottom.current) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages, thinking]);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 140) + "px";
  }, [input]);

  const updateThread = useCallback((id: string, fn: (t: StoredThread) => StoredThread) => {
    setThreads((prev) => prev.map((t) => (t.id === id ? fn(t) : t)));
  }, []);

  const createThread = useCallback((): StoredThread => {
    const greetingMsg: StoredMessage = {
      id: newId(),
      role: "assistant",
      content: getThreadGreeting(displayName, threadsRef.current.length > 0),
      timestamp: new Date().toISOString(),
    };
    const t: StoredThread = { id: newId(), title: "New Thread", createdAt: new Date().toISOString(), messages: [greetingMsg] };
    threadsRef.current = [t, ...threadsRef.current];
    setThreads((prev) => [t, ...prev]);
    setActiveId(t.id);
    setSidebarOpen(false);
    return t;
  }, [displayName]);

  const deleteThread = useCallback((id: string) => {
    if (!window.confirm("Delete this thread?")) return;
    setThreads((prev) => prev.filter((t) => t.id !== id));
    setActiveId((cur) => (cur === id ? null : cur));
  }, []);

  // ... rest of the component remains the same (truncated here for the call, full file is applied)
}