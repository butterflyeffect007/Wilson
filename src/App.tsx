import { useState, useRef, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Settings as SettingsIcon, Sun, Moon, ChevronDown,
  Send, Sparkles, Loader2, Mic, MicOff, Check, Menu, Plus, Trash2, X,
  Square, Copy, RotateCcw, Volume2, VolumeX,
} from "lucide-react";
import WilsonOrb from "./components/WilsonOrb";
import Backdrop from "./components/Backdrop";
import { OpenRouterAdapter, OpenRouterError } from "./intelligence/OpenRouterAdapter";
import type { ModelRequest } from "./intelligence";
import { DEFAULT_WILSON_POLICY, getPreferredEngine } from "./core/wilson/WilsonPolicy";
import { WILSON_SYSTEM_CONTEXT } from "./core/wilson/WilsonIdentity";
import {
  loadThreads, saveThreads, loadActiveThreadId, saveActiveThreadId,
  loadProfile, saveProfile, loadSettings, saveSettings,
  buildMemoryContext, parseAndStripTags, stripTagsForDisplay, makeTitle, newId,
  type StoredThread, type StoredMessage, type WilsonVibe, type WilsonSettings,
} from "./memory/LocalMemory";
import { speak, stopSpeaking, primePlayback, subscribeVoiceStatus, getVoiceStatus, type VoiceStatus } from "./lib/kokoroTTS";
import { emitRipple } from "./lib/listeningBus";
import { useSpeechToText } from "./hooks/useSpeechToText";
import { startCapture, stopCapture, embedSpeaker } from "./lib/voiceCapture";
import { identify, loadProfiles, saveProfiles, renameProfile, mergeProfiles, splitLast, DEFAULT_THRESHOLD, type SpeakerProfile } from "./lib/speakerMatch";
import { queryMemories, upsertMemory, listMemories, clearMemories, deleteMemory, summarizeExchange, type MemoryItem } from "./lib/longMemory";
import { analyzeProsody, classify, EMOTION_CONFIDENCE_MIN, EMOTION_GUIDANCE, EMOTION_TTS_SPEED, type EmotionTag } from "./lib/emotion";

export const WILSON_PROXY_URL: string =
  ((import.meta.env.VITE_WILSON_PROXY_URL as string | undefined)?.trim()) ||
  "https://wilson-proxy.butterflyeffect007.workers.dev";
const CONTEXT_WINDOW = 10; // parity: wilsonaibro sent only the last 10 messages
const MAX_RETRIES = 2;

/* ---------- greetings (logic from wilsonaibro Index.tsx @ 1816d92) ---------- */
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

/* ---------- tiny safe inline markdown (bold, italic, code) ---------- */
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
  const [fieldOpen, setFieldOpen] = useState(false);
  const [voiceStatus, setVoiceStatus] = useState<VoiceStatus>(() => getVoiceStatus());
  useEffect(() => subscribeVoiceStatus(setVoiceStatus), []);
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
  const displayName = settings.displayName || "Jenny";

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  /* persistence */
  useEffect(() => { saveThreads(threads); }, [threads]);
  useEffect(() => { saveActiveThreadId(activeId); }, [activeId]);
  useEffect(() => { saveSettings(settings); }, [settings]);

  /* smart auto-scroll: follow the stream unless the user scrolled up */
  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  };
  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickToBottom.current) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages, thinking]);

  /* textarea auto-grow */
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 140) + "px";
  }, [input]);

  /* ---------- thread helpers ---------- */
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

  /* ---------- core completion (streaming) ---------- */
  const runCompletion = useCallback(
    async (threadId: string, history: StoredMessage[], content: string) => {
      const pushAssistant = (text: string) =>
        updateThread(threadId, (t) => ({
          ...t,
          messages: [...t.messages, { id: newId(), role: "assistant", content: text, timestamp: new Date().toISOString() }],
        }));

      const engine = getPreferredEngine(DEFAULT_WILSON_POLICY);
      const adapter = new OpenRouterAdapter("", engine.model, WILSON_PROXY_URL);

      const convo = history
        .filter((m) => m.role === "user" || m.role === "assistant")
        .map((m) => ({ role: m.role, content: m.content }));
      // last 10 messages INCLUDING the new user message (parity)
      const windowed = [...convo, { role: "user" as const, content }].slice(-CONTEXT_WINDOW);
      let recalled = "";
      if (settings.longMemory) {
        try {
          const hits = await Promise.race([
            queryMemories(content, voiceCtxRef.current.id),
            new Promise<MemoryItem[]>((r) => setTimeout(() => r([]), 3000)),
          ]);
          if (hits.length) recalled = `\n\n[Long-term memories relevant to this turn]\n${hits.map((h) => `- (${h.ts.slice(0, 10)}) ${h.text}`).join("\n")}`;
        } catch (e) { console.warn("[memory]", e); }
      }
      const request: ModelRequest = {
        userInput: content,
        conversation: windowed.slice(0, -1),
        systemContext: `${WILSON_SYSTEM_CONTEXT}\n\n${buildMemoryContext(threadsRef.current)}${recalled}${
          voiceCtxRef.current.name ? `\n\n[Voice recognition] The person speaking right now is ${voiceCtxRef.current.name}. Address them by name naturally.` : ""
        }${
          voiceCtxRef.current.emotion && EMOTION_GUIDANCE[voiceCtxRef.current.emotion]
            ? `\n\n[Tone heard in their voice: ${voiceCtxRef.current.emotion}] ${EMOTION_GUIDANCE[voiceCtxRef.current.emotion]}` : ""
        }`,
        generation: { temperature: 0.8, maxTokens: 2048 },
      };

      const msgId = "stream-" + newId();
      let raw = "";
      setThinking(true);
      setLastFailed(null);
      const abort = new AbortController();
      abortRef.current = abort;

      const writeAssistant = (text: string) => {
        updateThread(threadId, (t) => {
          const exists = t.messages.some((m) => m.id === msgId);
          return {
            ...t,
            messages: exists
              ? t.messages.map((m) => (m.id === msgId ? { ...m, content: text } : m))
              : [...t.messages, { id: msgId, role: "assistant", content: text, timestamp: new Date().toISOString() }],
          };
        });
      };

      let attempt = 0;
      for (;;) {
        try {
          const result = await adapter.generateStream(
            request,
            (chunk) => {
              if (!raw) {
                setThinking(false);
                setStreamingId(msgId);
              }
              raw += chunk;
              writeAssistant(stripTagsForDisplay(raw));
            },
            abort.signal,
          );

          const { clean, vibe: newVibe, dream } = parseAndStripTags(raw);
          let finalText = clean;
          if (result.finishReason === "aborted") {
            finalText = clean ? `${clean}\n\n*...stopped.*` : "*Stopped.*";
          } else if (!clean) {
            finalText = "Eh, the void handed me silence. Give it a few seconds and try again — I don't want to give you something half-baked.";
          } else if (result.finishReason === "length") {
            finalText += "\n\n*...whew, hit my length ceiling. Ask me to continue and I'll pick up where I left off.*";
          } else if (result.finishReason === "content_filter" || result.finishReason === "SAFETY") {
            finalText += "\n\n*...okay okay, the safety net just yanked me back. Try rephrasing, or ask me something adjacent and I'll get you what you need.*";
          }
          writeAssistant(finalText);

          if (newVibe) {
            setVibe(newVibe);
            saveProfile({ vibe: newVibe });
          }
          if (dream) saveProfile({ dream });

          if (result.finishReason !== "aborted" && clean && settings.longMemory) {
            void upsertMemory(summarizeExchange(content, clean, voiceCtxRef.current.name), voiceCtxRef.current.id, voiceCtxRef.current.emotion).catch((e) => console.warn("[memory]", e));
          }
          if (result.finishReason !== "aborted" && clean && settings.voiceEnabled) {
            void speak(clean, EMOTION_TTS_SPEED[voiceCtxRef.current.emotion ?? "neutral"]);
          }
          break;
        } catch (err) {
          const fe = friendlyError(err);
          // retry only if nothing has streamed yet (avoids duplicated text)
          if (fe.retryable && !raw && attempt < MAX_RETRIES && !abort.signal.aborted) {
            attempt++;
            await sleep(800 * attempt);
            continue;
          }
          writeAssistant(
            raw
              ? `${stripTagsForDisplay(raw)}\n\n*...connection dropped mid-thought. Ask me to continue and I'll pick it back up.*`
              : fe.text,
          );
          if (fe.retryable && !raw) setLastFailed({ threadId, content });
          break;
        }
      }

      abortRef.current = null;
      setThinking(false);
      setStreamingId(null);
      inputRef.current?.focus();
    },
    [settings, updateThread],
  );

  const sendMessage = useCallback(
    async (text?: string) => {
      const content = (text ?? input).trim();
      if (!content || busy) return;
      stopSpeaking(); // interrupt any voice on send (parity)
      primePlayback();
      emitRipple();
      setInput("");
      stickToBottom.current = true;

      const thread = activeThread ?? createThread();
      const history = thread.messages;
      const userMsg: StoredMessage = { id: newId(), role: "user", content, timestamp: new Date().toISOString() };

      updateThread(thread.id, (t) => ({
        ...t,
        title: t.title === "New Thread" ? makeTitle(content) : t.title,
        messages: [...t.messages, userMsg],
      }));

      await runCompletion(thread.id, history, content);
    },
    [input, busy, activeThread, createThread, updateThread, runCompletion],
  );

  const retryLast = useCallback(() => {
    if (!lastFailed || busy) return;
    const t = threadsRef.current.find((x) => x.id === lastFailed.threadId);
    if (!t) return;
    const msgs = [...t.messages];
    if (msgs.length && msgs[msgs.length - 1].role === "assistant") msgs.pop(); // drop error bubble
    const historyBeforeUser = msgs.slice(0, -1);
    updateThread(t.id, (x) => ({ ...x, messages: msgs }));
    void runCompletion(t.id, historyBeforeUser, lastFailed.content);
  }, [lastFailed, busy, updateThread, runCompletion]);

  const stopGenerating = useCallback(() => abortRef.current?.abort(), []);

  const copyMessage = useCallback(async (m: StoredMessage) => {
    try {
      await navigator.clipboard.writeText(m.content);
      setCopiedId(m.id);
      setTimeout(() => setCopiedId((c) => (c === m.id ? null : c)), 1500);
    } catch { /* clipboard blocked */ }
  }, []);

  /* ---------- voice input ---------- */
  const analyzeUtterance = useCallback(async (text: string) => {
    const samples = await stopCapture();
    if (!samples || samples.length < 16000 * 0.6) return;
    if (settings.emotionDetection) {
      const words = text.split(/\s+/).filter(Boolean).length;
      const c = classify(analyzeProsody(samples, 16000, words));
      const ok = c.confidence >= EMOTION_CONFIDENCE_MIN;
      voiceCtxRef.current.emotion = ok ? c.tag : null;
      setHeard(ok ? c : null);
      if (ok && (c.tag === "excited" || c.tag === "calm" || c.tag === "sad" || c.tag === "tired")) {
        const vibeMap: Record<string, string> = { excited: "excited", calm: "calm", sad: "tired", tired: "tired" };
        const v = vibeMap[c.tag] as WilsonVibe;
        try { setVibe(v); } catch { /* ignore */ }
      }
    }
    if (settings.voiceRecognition) {
      const emb = await embedSpeaker(samples);
      setVoiceProfiles((prev) => {
        const r = identify(prev, emb, DEFAULT_THRESHOLD);
        setSpeaker({ id: r.profile.id, lowConfidence: r.lowConfidence, isNew: r.isNew || !r.profile.name });
        voiceCtxRef.current.name = r.profile.name;
        voiceCtxRef.current.id = r.profile.id;
        return r.profiles;
      });
    }
  }, [settings.emotionDetection, settings.voiceRecognition]);

  const onFinalSpeech = useCallback(async (t: string) => {
    if (settings.voiceRecognition || settings.emotionDetection) {
      // wait briefly for on-device analysis (first run downloads the model; don't block on that)
      await Promise.race([analyzeUtterance(t).catch((e) => console.warn("[voice]", e)), new Promise((r) => setTimeout(r, 2500))]);
    }
    void sendMessage(t);
  }, [sendMessage, analyzeUtterance, settings.voiceRecognition, settings.emotionDetection]);

  const nameSpeaker = useCallback((name: string) => {
    const n = name.trim();
    if (!speaker || !n) return;
    setVoiceProfiles((prev) => {
      const existing = prev.find((p) => p.id !== speaker.id && p.name.toLowerCase() === n.toLowerCase());
      if (existing) { setSpeaker({ id: existing.id, lowConfidence: false, isNew: false }); return mergeProfiles(prev, speaker.id, existing.id); }
      return renameProfile(prev, speaker.id, n);
    });
    voiceCtxRef.current.name = n;
    setSpeaker((s) => (s ? { ...s, isNew: false, lowConfidence: false } : s));
    setNameDraft(""); setCorrecting(false);
  }, [speaker]);

  const correctSpeaker = useCallback((name: string) => {
    const n = name.trim();
    if (!speaker || !n) return;
    setVoiceProfiles((prev) => {
      const target = prev.find((p) => p.id !== speaker.id && p.name.toLowerCase() === n.toLowerCase());
      const { profiles, created } = splitLast(prev, speaker.id, n);
      if (target && created) { setSpeaker({ id: target.id, lowConfidence: false, isNew: false }); return mergeProfiles(profiles, created.id, target.id); }
      if (created) setSpeaker({ id: created.id, lowConfidence: false, isNew: false });
      return profiles;
    });
    voiceCtxRef.current.name = n;
    setNameDraft(""); setCorrecting(false);
  }, [speaker]);
  const onInterimSpeech = useCallback((t: string) => setInput(t), []);
  const stt = useSpeechToText(onFinalSpeech, onInterimSpeech);

  /* ---------- global shortcuts ---------- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (abortRef.current) abortRef.current.abort();
        stopSpeaking();
        setSidebarOpen(false);
      }
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "o") {
        e.preventDefault();
        createThread();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [createThread]);

  const isHome = !activeThread;

  return (
    <div className="h-[100dvh] flex flex-col relative overflow-hidden">
      <Backdrop />

      {/* Threads drawer (existing glass styling) */}
      <AnimatePresence>
        {sidebarOpen && (
          <>
            <motion.div
              className="fixed inset-0 z-40 bg-violet-950/10"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setSidebarOpen(false)}
            />
            <motion.aside
              initial={{ x: "-100%" }} animate={{ x: 0 }} exit={{ x: "-100%" }}
              transition={{ type: "tween", duration: 0.25 }}
              className="fixed z-50 inset-y-0 left-0 w-72 max-w-[85%] glass-strong flex flex-col"
              aria-label="Threads"
            >
              <div className="flex items-center justify-between px-4 pt-5 pb-3">
                <span className="text-[13px] tracking-[0.04em] text-violet-500">Threads</span>
                <button type="button" onClick={() => setSidebarOpen(false)} className="p-1.5 rounded-full text-violet-400 hover:bg-violet-50/80" aria-label="Close threads">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="px-3 pb-2">
                <button
                  type="button"
                  onClick={createThread}
                  className="w-full flex items-center justify-center gap-2 rounded-xl py-2.5 bg-gradient-to-r from-violet-500 via-fuchsia-500 to-cyan-500 text-white text-sm font-medium shadow-md hover:opacity-95"
                >
                  <Plus className="w-4 h-4" /> New thread
                </button>
              </div>
              <div className="flex-1 overflow-y-auto px-2 pb-4 space-y-1">
                {threads.length === 0 && <p className="text-[12px] text-violet-700/50 px-3 py-4">No threads yet.</p>}
                {threads.map((t) => (
                  <div
                    key={t.id}
                    onClick={() => { setActiveId(t.id); setSidebarOpen(false); }}
                    className={`group flex items-center gap-2 rounded-xl px-3 py-2.5 cursor-pointer text-[13px] text-violet-950/85 ${
                      t.id === activeId ? "bg-white/70" : "hover:bg-white/50"
                    }`}
                  >
                    <span className="flex-1 truncate">{t.title}</span>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); deleteThread(t.id); }}
                      className="opacity-60 sm:opacity-0 group-hover:opacity-100 p-1 rounded text-violet-400 hover:text-rose-500"
                      aria-label="Delete thread"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      <header className="relative z-10 px-4 pt-5 pb-2">
        <div className="max-w-lg mx-auto grid grid-cols-[1fr_auto_1fr] items-center">
          <div className="flex items-center">
            <button
              type="button"
              onClick={() => setSidebarOpen(true)}
              className="p-1.5 -ml-1.5 rounded-full text-violet-500/70 hover:bg-violet-50/80 touch-manipulation"
              aria-label="Open threads"
            >
              <Menu className="w-[18px] h-[18px]" />
            </button>
          </div>
          <div className="flex items-center gap-2">
            <Sparkles className="w-[18px] h-[18px] text-violet-400 wl-title" />
            <h1 className="wl-title text-[19px] tracking-[0.28em] text-violet-900/80">WILSON</h1>
          </div>
          <div className="flex items-center justify-end gap-1 -mr-1.5">
            <button
              type="button"
              onClick={() => { primePlayback(); if (settings.voiceEnabled) stopSpeaking(); setSettings((s) => ({ ...s, voiceEnabled: !s.voiceEnabled })); }}
              className="p-1 rounded-full text-violet-500/80 hover:bg-violet-50/80 touch-manipulation"
              aria-label={settings.voiceEnabled ? "Mute Wilson's voice" : "Turn on Wilson's voice"}
              title={settings.voiceEnabled ? "Voice on" : "Voice off"}
            >
              {settings.voiceEnabled ? <Volume2 className="w-[15px] h-[15px]" /> : <VolumeX className="w-[15px] h-[15px]" />}
            </button>
            <span className="flex items-center gap-1 px-2 py-0.5 rounded-full glass text-[9px] whitespace-nowrap text-violet-700/70">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />Always with you
            </span>
            <button
              type="button"
              onClick={() => setShowSettings((v) => !v)}
              className="p-1 rounded-full text-violet-400/70 hover:bg-violet-50/80 touch-manipulation"
              aria-label="Settings"
              title="Settings"
            >
              <SettingsIcon className="w-[15px] h-[15px]" />
            </button>
          </div>
        </div>
      </header>

      <AnimatePresence>
        {showSettings && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="relative z-20 px-4 pb-3"
          >
            <div className="max-w-lg mx-auto rounded-2xl glass-strong p-4 space-y-3 shadow-lg max-h-[70dvh] overflow-y-auto">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-violet-950/90">Settings</h3>
                <button type="button" onClick={() => setShowSettings(false)} className="text-violet-400 hover:text-violet-600" aria-label="Close settings"><X className="w-4 h-4" /></button>
              </div>
              {/* Voice + name settings (persisted locally) */}
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <button type="button" onClick={toggleTheme} className="flex items-center gap-1.5 px-3 py-1.5 rounded-full glass text-[12px] text-violet-800/80">
                    {theme === "dark" ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}{theme === "dark" ? "Light" : "Dark"}
                  </button>
                  <button type="button" onClick={() => setSettings((s) => ({ ...s, voiceEnabled: !s.voiceEnabled }))} className="flex items-center gap-1.5 px-3 py-1.5 rounded-full glass text-[12px] text-violet-800/80">
                    {settings.voiceEnabled ? <Volume2 className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5" />}{settings.voiceEnabled ? "Voice on" : "Voice off"}
                  </button>
                </div>
                <label className="block">
                  <span className="text-[11px] text-violet-700/60">Your name</span>
                  <input
                    value={settings.displayName}
                    onChange={(e) => setSettings((s) => ({ ...s, displayName: e.target.value }))}
                    className="mt-1 w-full rounded-xl px-3 py-2 text-[14px] bg-white/70 border border-violet-200/60 outline-none focus:ring-2 focus:ring-violet-300/50 text-violet-950"
                  />
                </label>
                <label className="flex items-center gap-2 text-[12px] text-violet-800/80">
                  <input type="checkbox" checked={settings.voiceRecognition} onChange={(e) => setSettings((s) => ({ ...s, voiceRecognition: e.target.checked }))} />
                  Know who's talking
                </label>
                <label className="flex items-center gap-2 text-[12px] text-violet-800/80">
                  <input type="checkbox" checked={settings.emotionDetection} onChange={(e) => setSettings((s) => ({ ...s, emotionDetection: e.target.checked }))} />
                  Notice my mood
                </label>
                <label className="flex items-center gap-2 text-[12px] text-violet-800/80">
                  <input type="checkbox" checked={settings.longMemory} onChange={(e) => setSettings((s) => ({ ...s, longMemory: e.target.checked }))} />
                  Remember things
                </label>
                <div className="text-[12px] text-violet-800/80">
                  <button type="button" className="underline" onClick={() => void listMemories().then(setMemories).catch(() => setMemories([]))}>{memories ? "Refresh memories" : "View memories"}</button>
                  {" · "}
                  <button type="button" className="underline text-rose-500" onClick={() => { if (confirm("Clear all of Wilson's long-term memories?")) void clearMemories().then(() => setMemories([])); }}>Clear all</button>
                  {memories && (
                    <div className="mt-1 max-h-40 overflow-y-auto space-y-1">
                      {memories.length === 0 && <div className="text-violet-500/60">No memories yet.</div>}
                      {[...memories].sort((a, b) => b.ts.localeCompare(a.ts)).map((m) => (
                        <div key={m.id} className="flex gap-2 justify-between">
                          <span className="text-[11px]">{m.ts.slice(0, 10)} · {m.text}</span>
                          <button type="button" className="text-rose-500" onClick={() => void deleteMemory(m.id).then(() => setMemories((v) => v?.filter((x) => x.id !== m.id) ?? null))}>✕</button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <label className="flex items-center gap-2 text-[12px] text-violet-800/80">
                  <input type="checkbox" checked={settings.showHeard} onChange={(e) => setSettings((s) => ({ ...s, showHeard: e.target.checked }))} />
                  Show mood label
                </label>
                <label className="flex items-center gap-2 text-[12px] text-violet-800/80">
                  <input type="checkbox" checked={Boolean(settings.dyslexiaFont)} onChange={(e) => setSettings((s) => ({ ...s, dyslexiaFont: e.target.checked }))} />
                  Dyslexia font
                </label>
                {voiceProfiles.length > 0 && (
                  <div className="text-[12px] text-violet-800/80">
                    <span className="text-[11px] text-violet-700/60">Voices</span>
                    {voiceProfiles.map((p) => (
                      <div key={p.id} className="flex items-center justify-between">
                        <span>{p.name || "Unnamed"}</span>
                        <button type="button" className="text-rose-500 underline" onClick={() => { setVoiceProfiles((v) => v.filter((x) => x.id !== p.id)); if (speaker?.id === p.id) setSpeaker(null); }}>Delete</button>
                      </div>
                    ))}
                  </div>
                )}
                <label className="flex items-center gap-2 text-[12px] text-violet-800/80">
                  <input
                    type="checkbox"
                    checked={settings.voiceEnabled}
                    onChange={(e) => setSettings((s) => ({ ...s, voiceEnabled: e.target.checked }))}
                  />
                  Read Wilson's replies aloud
                </label>
                <p className="text-[11px] text-violet-500/70">
                  Enter send · Shift+Enter new line · Esc stop · Ctrl/Cmd+Shift+O new thread
                </p>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex-1 overflow-hidden flex flex-col relative z-10">
        <div ref={scrollRef} onScroll={onScroll} className="flex-1 overflow-y-auto px-4">
          {isHome ? (
            <div className="h-full flex flex-col items-center justify-center pt-4 pb-16 max-w-md mx-auto">
              <motion.div
                initial={{ scale: 0.85, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ type: "spring", stiffness: 120, damping: 18 }}
                className="relative mb-20"
              >
                <div className="relative">
                  <WilsonOrb size="lg" vibe={vibe} isThinking={thinking} interactive onTap={primePlayback} onLongPress={() => { if (!stt.listening && stt.supported) { primePlayback(); stopSpeaking(); if (settings.voiceRecognition || settings.emotionDetection) void startCapture().catch(() => {}); stt.toggle(); } }} />
                </div>
              </motion.div>

              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.15 }}
                className="text-center space-y-2 mb-8"
              >
                <h2 className="wl-thin text-[27px] text-violet-950/85 tracking-tight">
                  {greeting}, {displayName}
                  <span className="ml-1.5 text-pink-400">♡</span>
                </h2>
                <p className="text-[13px] text-violet-700/55 wl-thin tracking-wide">
                  Imagination becomes intelligence.
                </p>
              </motion.div>

              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.25 }}
                className="w-full"
              >
                <button
                  type="button"
                  onClick={() => inputRef.current?.focus()}
                  className="w-full flex items-center gap-4 rounded-[1.4rem] px-4 py-5 glass text-left transition-all touch-manipulation"
                >
                  <span className="w-9 h-9 rounded-full glass flex items-center justify-center flex-shrink-0"><Sparkles className="w-4 h-4 text-violet-400" /></span>
                  <span className="text-[16px] leading-snug text-violet-900/80 wl-thin max-w-[13rem]">
                    What would you like to explore today?
                  </span>
                </button>
              </motion.div>
            </div>
          ) : (
            <div className="max-w-lg mx-auto w-full py-4 space-y-4">
              <div className="flex justify-center pt-1 pb-3"><WilsonOrb size="mdx" vibe={vibe} isThinking={thinking} interactive /></div>
              <div className="rounded-2xl glass px-4 py-2.5">
                <button type="button" onClick={() => setFieldOpen((v) => !v)} className="w-full flex items-center gap-3 text-left" aria-expanded={fieldOpen}>
                  <Sparkles className="w-4 h-4 text-violet-400" />
                  <span className="flex-1">
                    <span className="block text-[13px] text-violet-900/90">Wilson Field</span>
                    <span className="block text-[10px] text-violet-600/60">Your memory · Your mood · Your dreams</span>
                  </span>
                  <ChevronDown className={`w-4 h-4 text-violet-400 transition-transform ${fieldOpen ? "rotate-180" : ""}`} />
                </button>
                {fieldOpen && (
                  <div className="mt-2 pt-2 border-t border-violet-200/30 space-y-1 text-[12px] text-violet-800/80 wl-thin">
                    <div>Mood: {vibe}{heard ? ` · I heard you sounding ${heard.tag}` : ""}</div>
                    <div>Dream: {loadProfile().dream || "Still dreaming…"}</div>
                    <div>Talking with: {speakerProfile?.name || displayName}</div>
                  </div>
                )}
              </div>
              {messages.map((msg) => (
                <motion.div
                  key={msg.id}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={`group flex gap-3 ${msg.role === "user" ? "justify-end" : "items-start"}`}
                >
                  {msg.role === "assistant" && <WilsonOrb size="sm" vibe={vibe} isThinking={streamingId === msg.id} />}
                  <div
                    className={`max-w-[85%] rounded-2xl px-4 py-3 text-[17px] leading-[1.6] ${
                      msg.role === "assistant" ? "msg-wilson" : "msg-user"
                    }`}
                  >
                    {msg.role === "assistant" && (
                      <span className="block text-[12px] tracking-[0.08em] text-violet-500 mb-1">
                        Wilson
                      </span>
                    )}
                    <div className="text-violet-950/90 whitespace-pre-wrap break-words">
                      {msg.content.split("\n").map((line, i) => (
                        <div key={i}>{line ? renderInline(line) : "\u00A0"}</div>
                      ))}
                      {streamingId === msg.id && (
                        <span className="inline-block w-1.5 h-4 align-middle bg-violet-400/70 animate-pulse ml-0.5" />
                      )}
                    </div>
                    <div className="flex items-center gap-3 mt-2 text-[10px] text-violet-400/60">
                      <span>
                        {new Date(msg.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </span>
                      {streamingId !== msg.id && (
                        <button
                          type="button"
                          onClick={() => copyMessage(msg)}
                          className="flex items-center gap-1 opacity-70 sm:opacity-0 group-hover:opacity-100 focus:opacity-100 hover:text-violet-600"
                          aria-label="Copy message"
                        >
                          {copiedId === msg.id ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                          {copiedId === msg.id ? "Copied" : "Copy"}
                        </button>
                      )}
                    </div>
                  </div>
                </motion.div>
              ))}

              {thinking && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="flex gap-3 items-start"
                >
                  <WilsonOrb size="sm" vibe={vibe} isThinking />
                  <div className="rounded-2xl msg-wilson px-4 py-3 flex items-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin text-violet-400" />
                    <span className="text-sm text-violet-700/60">Wilson is thinking...</span>
                  </div>
                </motion.div>
              )}

              {lastFailed && !busy && lastFailed.threadId === activeId && (
                <div className="flex justify-center">
                  <button
                    type="button"
                    onClick={retryLast}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-full glass text-[12px] text-violet-700/80 hover:bg-white/70"
                  >
                    <RotateCcw className="w-3.5 h-3.5" /> Retry
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="relative z-30 px-4 pt-2 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
          <div className="max-w-lg mx-auto">
            {settings.voiceRecognition && speaker && (speaker.isNew || correcting) && (
              <form onSubmit={(e) => { e.preventDefault(); correcting ? correctSpeaker(nameDraft) : nameSpeaker(nameDraft); }} className="flex items-center gap-2 mb-1.5 px-2 text-[12px] text-violet-700/80">
                <span>{correcting ? "Who is this, then?" : "Who am I talking to?"}</span>
                <input value={nameDraft} onChange={(e) => setNameDraft(e.target.value)} placeholder="Name" className="flex-1 min-w-0 rounded-full px-2 py-0.5 bg-white/70 border border-violet-200/60 outline-none" />
                <button type="submit" className="text-violet-600 underline">Save</button>
                <button type="button" onClick={() => { setSpeaker(null); setCorrecting(false); }} className="text-violet-400">✕</button>
              </form>
            )}
            {settings.voiceRecognition && speaker && speakerProfile?.name && speaker.lowConfidence && !speaker.isNew && !correcting && (
              <p className="mb-1.5 px-2 text-[12px] text-violet-600/70">
                I think this is {speakerProfile.name}?{" "}
                <button type="button" className="underline" onClick={() => setSpeaker({ ...speaker, lowConfidence: false })}>Yes</button>{" · "}
                <button type="button" className="underline" onClick={() => setCorrecting(true)}>No</button>
              </p>
            )}
            {settings.showHeard && settings.emotionDetection && heard && (
              <p className="mb-1 px-2 text-[11px] text-violet-500/60">Heard: {heard.tag} ({Math.round(heard.confidence * 100)}%)</p>
            )}
            {settings.voiceEnabled && voiceStatus.state === "loading" && (
              <p className="mb-1.5 px-2 text-[12px] text-violet-600/70">Wilson's voice is loading… {voiceStatus.progress}%</p>
            )}
            {showInstallHint && (
              <div className="mb-2 mx-1 flex items-center gap-2 rounded-2xl glass px-3 py-2 text-[13px] text-violet-800/80">
                <span className="flex-1">Add Wilson to your Home Screen: tap Share, then “Add to Home Screen”.</span>
                <button type="button" onClick={dismissInstallHint} aria-label="Dismiss" className="text-violet-400"><X className="w-4 h-4" /></button>
              </div>
            )}
            {stt.error && <p className="text-[12px] text-rose-600 mb-1.5 px-2">{stt.error}</p>}
            <div className="relative flex items-end gap-2 rounded-[1.6rem] glass-strong px-2 py-1.5">
              <textarea
                ref={inputRef}
                rows={1}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    void sendMessage();
                  }
                }}
                placeholder={stt.listening ? "Listening..." : "Type a message..."}
                enterKeyHint="send"
                className="flex-1 resize-none bg-transparent px-3 py-2.5 text-[16px] leading-6 text-violet-950 placeholder-violet-400/50 outline-none touch-manipulation"
              />
              <button
                type="button"
                onClick={() => {
                  primePlayback(); stopSpeaking();
                  if (!stt.listening && (settings.voiceRecognition || settings.emotionDetection)) void startCapture().catch((e) => console.warn("[capture]", e));
                  if (stt.listening) setTimeout(() => void stopCapture(), 3000);
                  stt.toggle();
                }}
                disabled={busy || !stt.supported}
                className={`p-2 rounded-full transition-colors min-w-[40px] min-h-[40px] flex items-center justify-center touch-manipulation disabled:opacity-40 ${
                  stt.listening ? "text-rose-500 bg-rose-50/80" : "glass text-violet-500/80"
                }`}
                aria-label={stt.listening ? "Stop listening" : "Voice"}
                title={stt.supported ? "Speak to Wilson" : "Voice input isn't supported in this browser"}
              >
                {stt.listening ? <MicOff className="w-[18px] h-[18px]" /> : <Mic className="w-[18px] h-[18px]" />}
              </button>
              {busy ? (
                <button
                  type="button"
                  onClick={stopGenerating}
                  className="rounded-full min-w-[44px] min-h-[44px] flex items-center justify-center p-2.5 bg-gradient-to-br from-violet-400 via-fuchsia-400 to-cyan-400 text-white shadow-md touch-manipulation"
                  aria-label="Stop generating"
                  title="Stop (Esc)"
                >
                  <Square className="w-3.5 h-3.5 fill-current" />
                </button>
              ) : (
                <motion.button
                  type="button"
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  onClick={() => void sendMessage()}
                  disabled={!input.trim()}
                  className="rounded-full min-w-[44px] min-h-[44px] flex items-center justify-center p-2.5 bg-gradient-to-br from-fuchsia-400 via-violet-500 to-sky-400 text-white shadow-[0_0_16px_rgba(168,85,247,.55)] disabled:opacity-60 disabled:cursor-not-allowed touch-manipulation"
                  aria-label="Send"
                >
                  <Send className="w-4 h-4" />
                </motion.button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
