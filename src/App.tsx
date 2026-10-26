import { useState, useRef, useEffect, useCallback } from "react";
import { Markdown } from "./components/Markdown";
import { ErrorBoundary } from "./components/ErrorBoundary";
import InstallCard, { isInstalled } from "./components/InstallCard";
import { AdminPanel } from "./components/AdminPanel";
import { cachedIsAdmin, verifyAdmin, nightlyOptIn, setNightlyOptIn, syncLoops, fetchUnseenNote, markNoteSeen } from "./lib/admin";
import { emitRipple } from "./lib/listeningBus";
import { useDebouncedSave } from "./lib/useDebouncedSave";
import { wakeSupport, startWake, stopWake, pauseWake } from "./lib/wakeWord";
import { useWilsonAudio } from "./hooks/useWilsonAudio";
import { enablePush, disablePush, pushEnabled, pushSupported, isIOS, isStandalone, startReminderSync } from "./lib/push";
import { loadStateOfYou, recordUserTurn, recordVibe, buildStateOfYouContext, maybeRefreshStateOfYou, editStateSummary, clearStateOfYou, localSignals, type StateOfYou } from "./lib/stateOfYou";
import { subscribeSaving } from "./lib/saveBus";
import { loadQuietMemory, buildQuietMemoryContext, deleteQuietItem, clearQuietMemory, exportQuietMemory, pullArchitectMemory, type QuietMemory } from "./lib/quietMemory";
import { motion, AnimatePresence } from "framer-motion";
import {
  Settings as SettingsIcon, Sun, Moon, ChevronDown,
  Send, Sparkles, Loader2, Mic, Check, Menu, Plus, Trash2, X,
  Square, Copy, Play, RotateCcw, Volume2, VolumeX, Share2, Send as SendIcon, StickyNote, Bell,
  Search as SearchIcon, Gift, ChevronUp, MessageSquareWarning,
} from "lucide-react";
import WilsonOrb from "./components/WilsonOrb";
import Backdrop from "./components/Backdrop";
import { OpenRouterAdapter, OpenRouterError } from "./intelligence/OpenRouterAdapter";
import type { ModelRequest } from "./intelligence";
import { prepareTools } from "./intelligence";
import { linksIn } from "./intelligence/tools";
import { DEFAULT_WILSON_POLICY, getPreferredEngine } from "./core/wilson/WilsonPolicy";
import { composeRequest } from "./core/wilson/WilsonCore";
import { loadLessons, addLesson, deleteLesson, detectLesson, extractFacts, shouldSuggest, type Lesson } from "./core/wilson/WilsonLearning";
import { shareChat } from "./lib/shareChat";
import { joinBeta, betaNumber, APP_VERSION } from "./lib/beta";
import { shareApp, syncStars, starsSeen, markStarsSeen, creditReferral } from "./lib/ref";
import Organizer, { type OrgTab } from "./components/Organizer";
import { detectAction, runAction, checkDue, dueNow } from "./lib/organizer";
import FeedbackSheet, { type FeedbackTarget } from "./components/FeedbackSheet";
import { IntelligenceRouter } from "./intelligence/IntelligenceRouter";
import {
  loadThreads, saveThreads, loadActiveThreadId, saveActiveThreadId,
  loadProfile, saveProfile, loadSettings, saveSettings,
  buildMemoryContext, parseAndStripTags, stripTagsForDisplay, makeTitle, newId,
  type StoredThread, type StoredMessage, type WilsonVibe, type WilsonSettings,
} from "./memory/LocalMemory";
import PuckStatus from "./components/PuckStatus";
import { startSpeechStream, speakMessage, voiceTest, subscribeVoiceDebug, getVoiceDebug, type VoiceDebug, warmVoice, stopSpeaking, primePlayback, subscribeVoiceStatus, getVoiceStatus, type VoiceStatus, isVoiceActive, subscribeVoiceActive } from "./lib/kokoroTTS";
import { useSpeechToText } from "./hooks/useSpeechToText";
import { startCapture, stopCapture, embedSpeaker } from "./lib/voiceCapture";
import { identify, loadProfiles, saveProfiles, renameProfile, mergeProfiles, splitLast, DEFAULT_THRESHOLD, type SpeakerProfile } from "./lib/speakerMatch";
import { queryMemories, upsertMemory, listMemories, clearMemories, deleteMemory, summarizeExchange, type MemoryItem } from "./lib/longMemory";
import { analyzeProsody, classify, EMOTION_CONFIDENCE_MIN, EMOTION_GUIDANCE, EMOTION_TTS_SPEED, type EmotionTag } from "./lib/emotion";

export const WILSON_PROXY_URL: string =
  ((import.meta.env.VITE_WILSON_PROXY_URL as string | undefined)?.trim()) ||
  "https://wilson-proxy.butterflyeffect007.workers.dev";
const CONTEXT_WINDOW = 10; // last 10 messages (20 kept old spec talk in view)
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


function friendlyError(err: unknown): { text: string; retryable: boolean } {
  const status = err instanceof OpenRouterError ? err.status : 0;
  if (status === 429) return { text: "*Whew, lots of people talking at once. Give me a second and ask again.*", retryable: true };
  return { text: "*My brain's a little busy right now. Try again in a moment.*", retryable: true };
}

const TACHO_VISION = "the tacho climbs past 9,000 RPMs as the browser version stabilizes into unshakeable, native-grade code at the waterfront";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export default function App() {
  const [threads, setThreads] = useState<StoredThread[]>(() => loadThreads());
  const [activeId, setActiveId] = useState<string | null>(() => {
    const saved = loadActiveThreadId();
    return saved && loadThreads().some((t) => t.id === saved) ? saved : null;
  });
  const [input, setInput] = useState(() => { try { return localStorage.getItem("wilson_draft") || ""; } catch { return ""; } });
  useDebouncedSave(input, (v) => { try { if (v) localStorage.setItem("wilson_draft", v); else localStorage.removeItem("wilson_draft"); } catch { /* full */ } });
  const [saving, setSaving] = useState(false);
  useEffect(() => subscribeSaving(setSaving), []);
  const [globalWarn, setGlobalWarn] = useState<string | null>(null);
  useEffect(() => {
    const onRej = (e: PromiseRejectionEvent) => {
      if ((e.reason as { name?: string })?.name === "AbortError") return;
      console.warn("[unhandled]", e.reason);
      setGlobalWarn("Something didn't go through — Wilson's still here. Try that again.");
      setTimeout(() => setGlobalWarn(null), 6000);
    };
    const onErr = (e: ErrorEvent) => { if (!e.message || /ResizeObserver/.test(e.message)) return; console.warn("[error]", e.message); };
    const onOff = () => setGlobalWarn("You're offline — your chat and draft are saved on this device.");
    const onOn = () => setGlobalWarn(null);
    window.addEventListener("unhandledrejection", onRej);
    window.addEventListener("error", onErr);
    window.addEventListener("offline", onOff);
    window.addEventListener("online", onOn);
    return () => { window.removeEventListener("unhandledrejection", onRej); window.removeEventListener("error", onErr); window.removeEventListener("offline", onOff); window.removeEventListener("online", onOn); };
  }, []);
  const [isAdmin, setIsAdmin] = useState<boolean>(() => cachedIsAdmin());
  const [showAdmin, setShowAdmin] = useState(false);
  const [adminKeyDraft, setAdminKeyDraft] = useState("");
  const [adminMsg, setAdminMsg] = useState<string | null>(null);
  useEffect(() => { if (cachedIsAdmin()) void verifyAdmin().then((ok) => { if (ok !== null) setIsAdmin(ok); }); }, []);
  const anchorTurnRef = useRef(0);
  const wakeSpeakRef = useRef(false);
  const [soy, setSoy] = useState<StateOfYou>(() => loadStateOfYou());
  const [soyOpen, setSoyOpen] = useState(false);
  const [nightly, setNightly] = useState(() => nightlyOptIn());
  const [awayNote, setAwayNote] = useState<{ text: string; ts: string } | null>(null);
  const [pushOn, setPushOn] = useState(() => { try { return pushEnabled(); } catch { return false; } });
  const [pushMsg, setPushMsg] = useState<string | null>(null);
  useEffect(() => startReminderSync(), []);
  useEffect(() => { if (!navigator.onLine) setGlobalWarn("You're offline — your chats and notes are right here. Wilson will answer once you're back online."); }, []);
  /* Notification taps: ?open=note | ?open=reminders (cold start) or a message from the service worker (warm). */
  useEffect(() => {
    const handle = (href: string) => {
      const open = new URL(href, location.href).searchParams.get("open");
      if (open === "reminders") { setOrgTab("reminders"); setDueBanner([]); }
      if (open === "admin" && cachedIsAdmin()) setShowAdmin(true);
      if (open === "note") void fetchUnseenNote().then((n) => n && setAwayNote(n));
    };
    if (/[?&]open=/.test(location.search)) { handle(location.href); const u = new URL(location.href); u.searchParams.delete("open"); history.replaceState(null, "", u.pathname + u.search + u.hash); }
    const onMsg = (e: MessageEvent) => { if (e.data?.type === "wilson-open") handle(e.data.url); };
    navigator.serviceWorker?.addEventListener("message", onMsg);
    return () => navigator.serviceWorker?.removeEventListener("message", onMsg);
  }, []);
  useEffect(() => {
    const f = (e: Event) => void syncLoops((e as CustomEvent<string>).detail);
    window.addEventListener("wilson-state-refreshed", f);
    return () => window.removeEventListener("wilson-state-refreshed", f);
  }, []);
  useEffect(() => { if (isAdmin && nightly) { const t = setTimeout(() => void fetchUnseenNote().then(setAwayNote), 2500); return () => clearTimeout(t); } }, [isAdmin, nightly]);
  const [soyDraft, setSoyDraft] = useState<string | null>(null);
  const [qmem, setQmem] = useState<QuietMemory>(() => loadQuietMemory());
  const [qmemOpen, setQmemOpen] = useState(false);
  useEffect(() => { const f = () => setQmem(loadQuietMemory()); window.addEventListener("wilson-quiet-memory", f); return () => window.removeEventListener("wilson-quiet-memory", f); }, []);
  useEffect(() => { if (isAdmin) void pullArchitectMemory(); }, [isAdmin]);
  useEffect(() => { const f = () => setSoy(loadStateOfYou()); window.addEventListener("wilson-state-of-you", f); return () => window.removeEventListener("wilson-state-of-you", f); }, []);
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
  useEffect(() => {
    const V: Record<WilsonVibe, [number, string, string]> = {
      neutral: [1, "9s", "6.5s"], excited: [1.22, "6s", "4.8s"], calm: [0.9, "12s", "8s"], tired: [0.78, "13s", "9s"], dreaming: [1.1, "10.5s", "7.5s"],
    };
    const [sat, breathe, float] = V[vibe] ?? V.neutral;
    const r = document.documentElement.style;
    r.setProperty("--vibe-sat", String(sat)); r.setProperty("--vibe-breathe", breathe); r.setProperty("--vibe-float", float);
  }, [vibe]);
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
  /* Voice-recognition consent (voiceprints are computed + stored on this device only). */
  const [voiceConsent, setVoiceConsent] = useState<string | null>(() => { try { return localStorage.getItem("wilson_voiceprint_consent"); } catch { return null; } });
  const [askVoiceConsent, setAskVoiceConsent] = useState(false);
  const recordConsent = (v: "yes" | "no") => { try { localStorage.setItem("wilson_voiceprint_consent", v); localStorage.setItem("wilson_voiceprint_consent_at", new Date().toISOString()); } catch { /* ignore */ } setVoiceConsent(v); };
  const voiceId = settings.voiceRecognition && voiceConsent === "yes";
  const eraseVoiceData = () => { setVoiceProfiles([]); saveProfiles([]); setSpeaker(null); voiceCtxRef.current.name = ""; voiceCtxRef.current.id = "default"; };
  /* Founders: the first 100 unique devices to open Wilson are added automatically (no signup, no link). */
  useEffect(() => {
    try { if (new URLSearchParams(location.search).has("beta")) { const u = new URL(location.href); u.searchParams.delete("beta"); history.replaceState({}, "", u.toString()); } } catch { /* ignore */ }
    if (betaNumber() || localStorage.getItem("wilson_founders_full")) return;
    void joinBeta().then((n) => { if (typeof n === "number") setBetaNum(n); else if (n === "full") { setBetaFull(true); try { localStorage.setItem("wilson_founders_full", "1"); } catch { /* ignore */ } } });
  }, []);

  const [betaNum, setBetaNum] = useState<number | null>(() => betaNumber());
  /* ---------- Share Wilson + referral stars ---------- */
  const [stars, setStars] = useState(() => starsSeen());
  const [starMoment, setStarMoment] = useState<string | null>(null);
  const [shareMsg, setShareMsg] = useState<string | null>(null);
  useEffect(() => {
    try { const ref = new URLSearchParams(location.search).get("ref"); if (ref) { void creditReferral(ref); const u = new URL(location.href); u.searchParams.delete("ref"); history.replaceState({}, "", u.toString()); } } catch { /* ignore */ }
    const check = () => void syncStars().then((n) => {
      if (n === null) return;
      const seen = starsSeen();
      if (n > seen) { setStarMoment(n - seen === 1 ? "A friend opened Wilson from your link — you earned a star ✦" : `${n - seen} friends opened Wilson from your link — you earned ${n - seen} stars ✦`); setTimeout(() => setStarMoment(null), 7000); }
      markStarsSeen(n); setStars(n);
    });
    if (localStorage.getItem("wilson_ref_code")) check();
    const vis = () => { if (document.visibilityState === "visible" && localStorage.getItem("wilson_ref_code")) check(); };
    document.addEventListener("visibilitychange", vis);
    return () => document.removeEventListener("visibilitychange", vis);
  }, []);
  const doShare = () => void shareApp().then((r) => {
    const m = r === "shared" ? "Thank you for sharing Wilson ✦ You'll earn a star when your friend opens it." : r === "copied" ? "Link copied — paste it to a friend. You'll earn a star when they open it ✦" : r === "failed" ? "Couldn't share right now — try again." : null;
    setShareMsg(m); if (m) setTimeout(() => setShareMsg(null), 5000);
  });
  const [, setBetaFull] = useState(false);
  const [feedback, setFeedback] = useState<FeedbackTarget | null>(null);
  const [orgTab, setOrgTab] = useState<OrgTab | null>(null);
  const [dueBanner, setDueBanner] = useState<string[]>([]);
  useEffect(() => {
    const surface = () => { const fired = checkDue(); if (fired.length) setDueBanner((b) => [...new Set([...b, ...fired.map((r) => r.text)])]); };
    setDueBanner(dueNow().map((r) => r.text)); checkDue();
    const t = setInterval(surface, 20000);
    const vis = () => { if (document.visibilityState === "visible") { surface(); setDueBanner(dueNow().map((r) => r.text)); } };
    document.addEventListener("visibilitychange", vis);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", vis); };
  }, []);
  const [lessons, setLessons] = useState<Lesson[]>(() => loadLessons());
  const [shareNote, setShareNote] = useState<string | null>(null);
  const [fieldOpen, setFieldOpen] = useState(false);
  const [voiceStatus, setVoiceStatus] = useState<VoiceStatus>(() => getVoiceStatus());
  useEffect(() => subscribeVoiceStatus(setVoiceStatus), []);
  const [voiceActive, setVoiceActive] = useState<boolean>(() => isVoiceActive());
  useEffect(() => subscribeVoiceActive(setVoiceActive), []);
  const [voiceDebug, setVoiceDebug] = useState<VoiceDebug>(() => getVoiceDebug());
  useEffect(() => subscribeVoiceDebug(setVoiceDebug), []);
  /* Add-to-Home-Screen card: once, after Wilson's first reply (never before), hidden when installed. */
  const [installOpen, setInstallOpen] = useState(false);
  const [installSeen, setInstallSeen] = useState(() => { try { return !!localStorage.getItem("wilson_install_card_seen"); } catch { return true; } });
  const dismissInstallHint = () => { setInstallOpen(false); setInstallSeen(true); try { localStorage.setItem("wilson_install_card_seen", "1"); } catch { /* ignore */ } };
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
  /* State-of-you: one summary at session end (tab hidden) if enough new messages */
  const activeIdRef = useRef(activeId); activeIdRef.current = activeId;
  const longMemRef = useRef(settings.longMemory); longMemRef.current = settings.longMemory;
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState !== "hidden" || !longMemRef.current) return;
      const t = threadsRef.current.find((x) => x.id === activeIdRef.current);
      if (!t) return;
      const ad = new OpenRouterAdapter("", getPreferredEngine(DEFAULT_WILSON_POLICY).model, WILSON_PROXY_URL);
      void maybeRefreshStateOfYou(ad, t.messages, { force: true });
    };
    document.addEventListener("visibilitychange", onHide);
    return () => document.removeEventListener("visibilitychange", onHide);
  }, []);
  threadsRef.current = threads;

  const busy = thinking || streamingId !== null;
  const activeThread = threads.find((t) => t.id === activeId) ?? null;
  const messages = activeThread?.messages ?? [];
  const hadFirstReply = messages.some((m, i) => m.role === "assistant" && messages.slice(0, i).some((u) => u.role === "user"));
  const showInstallHint = installOpen || (!installSeen && hadFirstReply && !thinking && !streamingId && !isInstalled());
  /* ---------- search: in-thread find + thread-list filter ---------- */
  const [findOpen, setFindOpen] = useState(false);
  const [findQ, setFindQ] = useState("");
  const [findIdx, setFindIdx] = useState(0);
  const [findCount, setFindCount] = useState(0);
  const findTerm = findOpen && findQ.trim().length >= 2 ? findQ.trim() : "";
  useEffect(() => {
    const el = scrollRef.current; if (!el) return;
    const hits = Array.from(el.querySelectorAll<HTMLElement>("mark.wl-hit"));
    setFindCount(hits.length);
    hits.forEach((h) => h.classList.remove("wl-hit-cur"));
    if (!hits.length) return;
    const i = ((findIdx % hits.length) + hits.length) % hits.length;
    hits[i].classList.add("wl-hit-cur");
    hits[i].scrollIntoView({ block: "center", behavior: "smooth" });
  }, [findTerm, findIdx, activeId, messages.length]);
  useEffect(() => { setFindIdx(0); }, [findTerm, activeId]);
  const [threadQ, setThreadQ] = useState("");
  const tq = threadQ.trim().toLowerCase();
  const shownThreads = tq ? threads.filter((t) => t.title.toLowerCase().includes(tq) || t.messages.some((m) => m.content.toLowerCase().includes(tq))) : threads;
  const displayName = settings.displayName || "";

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  /* persistence */
  useDebouncedSave(threads, saveThreads);
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
    if (!el) return;
    // Home screen (no messages): keep the top in view so the orb's butterflies aren't scrolled off on short phones
    if (!messages.length && !thinking) { el.scrollTop = 0; return; }
    if (stickToBottom.current) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
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
      // Interface -> Wilson Core -> Intelligence Router -> Model Adapter -> Model
      const router = new IntelligenceRouter(DEFAULT_WILSON_POLICY, {
        get: (p, m) => (p === engine.provider && m === engine.model ? new OpenRouterAdapter("", engine.model, WILSON_PROXY_URL) : undefined),
      });
      const adapter = router.getAdapter() as OpenRouterAdapter;

      const convo = history
        .filter((m) => m.role === "user" || m.role === "assistant")
        .map((m) => ({ role: m.role, content: m.content }));
      // last CONTEXT_WINDOW messages INCLUDING the new user message
      const windowed = [...convo, { role: "user" as const, content }].slice(-CONTEXT_WINDOW);
      let recalled: string[] = [];
      if (settings.longMemory) {
        try {
          const hits = await Promise.race([
            queryMemories(content, voiceCtxRef.current.id),
            new Promise<MemoryItem[]>((r) => setTimeout(() => r([]), 3000)),
          ]);
          recalled = hits.map((h) => `(${h.ts.slice(0, 10)}) ${h.text}`);
        } catch (e) { console.warn("[memory]", e); }
      }
      if (settings.longMemory) recordUserTurn(content);
      const learned = detectLesson(content);
      if (learned) setLessons(addLesson(learned) && loadLessons());
      if (settings.longMemory) {
        for (const f of extractFacts(content, voiceCtxRef.current.name || displayName))
          void upsertMemory(f, voiceCtxRef.current.id, voiceCtxRef.current.emotion).catch(() => {});
      }
      const orgAction = detectAction(content);
      const orgCtx = orgAction ? runAction(orgAction) : "";
      let toolCtx = "";
      if (!orgAction) try {
        const step = await Promise.race([
          prepareTools(content, { toolsUrl: WILSON_PROXY_URL, adapter }),
          new Promise<{ context: string }>((r) => setTimeout(() => r({ context: "" }), 15000)),
        ]);
        toolCtx = step.context;
      } catch (e) { console.warn("[tools]", e); }
      if (!orgAction && !toolCtx && linksIn(content).length)
        toolCtx = `\n\n[Link reader] The link the user shared could not be opened in time (timeout). Tell them plainly you couldn't open it just now; do NOT guess what it says.`;
      const emo = voiceCtxRef.current.emotion;
      const request: ModelRequest = composeRequest(content, windowed.slice(0, -1), {
        memory: buildMemoryContext(threadsRef.current),
        recalled,
        speakerName: voiceCtxRef.current.name,
        emotion: emo && EMOTION_GUIDANCE[emo] ? { tag: emo, guidance: EMOTION_GUIDANCE[emo] } : null,
        tools: (orgCtx ? `\n\n${orgCtx}` : "") + toolCtx,
        lessons: loadLessons().map((l) => l.text),
        newLesson: learned,
        suggest: settings.suggestions && !learned && shouldSuggest(),
        stateOfYou: settings.longMemory ? buildStateOfYouContext() : "",
        quietMemory: settings.longMemory ? buildQuietMemoryContext(!history.some((m) => m.role === "user")) : "",
        anchor: isAdmin ? { vision: TACHO_VISION, weave: ++anchorTurnRef.current % 5 === 0 } : null,
      });

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

      const speakIt = settings.voiceEnabled || wakeSpeakRef.current; wakeSpeakRef.current = false;
      const speech = speakIt ? startSpeechStream(EMOTION_TTS_SPEED[voiceCtxRef.current.emotion ?? "neutral"]) : null;
      let attempt = 0;
      for (;;) {
        try {
          let result = await adapter.generateStream(
            request,
            (chunk) => {
              if (!raw) {
                setThinking(false);
                setStreamingId(msgId);
              }
              raw += chunk;
              const shown = stripTagsForDisplay(raw);
              writeAssistant(shown);
              speech?.push(shown);
            },
            abort.signal,
          );
          // Auto-continue once if the model hit its length cap mid-thought
          if (result.finishReason === "length" && raw && !abort.signal.aborted) {
            const contReq: ModelRequest = {
              ...request,
              conversation: [...(request.conversation ?? []), { role: "user", content: request.userInput }, { role: "assistant", content: raw }],
              userInput: "Continue exactly where you left off. Do not repeat anything or add a preamble.",
            };
            const needsSpace = !/\s$/.test(raw);
            let first = true;
            result = await adapter.generateStream(
              contReq,
              (chunk) => {
                if (first && needsSpace && !/^\s/.test(chunk)) chunk = " " + chunk;
                first = false;
                raw += chunk;
                const shown = stripTagsForDisplay(raw);
                writeAssistant(shown);
                speech?.push(shown);
              },
              abort.signal,
            );
          }

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
            if (settings.longMemory) recordVibe(newVibe);
          }
          if (dream) saveProfile({ dream });

          if (result.finishReason !== "aborted" && clean && settings.longMemory) {
            void upsertMemory(summarizeExchange(content, clean, voiceCtxRef.current.name), voiceCtxRef.current.id, voiceCtxRef.current.emotion).catch((e) => console.warn("[memory]", e));
          }
          if (result.finishReason !== "aborted" && clean && speech) speech.finish(clean);
          if (result.finishReason !== "aborted" && clean && settings.longMemory) {
            const recentMsgs: StoredMessage[] = [...history, { id: "u", role: "user", content, timestamp: "" }, { id: "a", role: "assistant", content: clean, timestamp: "" }];
            setTimeout(() => void maybeRefreshStateOfYou(adapter, recentMsgs), 1500);
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

      if (speech && abort.signal.aborted) stopSpeaking();
      else if (speech) speech.finish(stripTagsForDisplay(raw)); // no-op if already finished
      abortRef.current = null;
      setThinking(false);
      setStreamingId(null);
      inputRef.current?.focus();
    },
    [settings, updateThread, isAdmin],
  );

  const sendMessage = useCallback(
    async (text?: string) => {
      const content = (text ?? input).trim();
      if (!content || busy) return;
      stopSpeaking(); // interrupt any voice on send (parity)
      primePlayback();
      emitRipple();
      setInput(""); try { localStorage.removeItem("wilson_draft"); } catch { /* ignore */ }
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
    if (voiceId) {
      const emb = await embedSpeaker(samples);
      setVoiceProfiles((prev) => {
        const r = identify(prev, emb, DEFAULT_THRESHOLD);
        setSpeaker({ id: r.profile.id, lowConfidence: r.lowConfidence, isNew: r.isNew || !r.profile.name });
        voiceCtxRef.current.name = r.profile.name;
        voiceCtxRef.current.id = r.profile.id;
        return r.profiles;
      });
    }
  }, [settings.emotionDetection, voiceId]);

  const onFinalSpeech = useCallback(async (t: string) => {
    if (voiceId || settings.emotionDetection) {
      // wait briefly for on-device analysis (first run downloads the model; don't block on that)
      await Promise.race([analyzeUtterance(t).catch((e) => console.warn("[voice]", e)), new Promise((r) => setTimeout(r, 2500))]);
    }
    void sendMessage(t);
  }, [sendMessage, analyzeUtterance, voiceId, settings.emotionDetection]);
  // Mic dictation never auto-sends: the words land in the message box for her to review/edit, and she taps Send.
  const dictBaseRef = useRef("");
  const joinDict = (base: string, spoken: string) => (base && spoken ? base.replace(/\s+$/, "") + " " + spoken : base + spoken);
  const onDictated = useCallback((t: string) => {
    setInput(joinDict(dictBaseRef.current, t));
    if (voiceId || settings.emotionDetection) void analyzeUtterance(t).catch((e) => console.warn("[voice]", e)); // tone/speaker ready by the time she sends
  }, [analyzeUtterance, voiceId, settings.emotionDetection]);

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
  const onInterimSpeech = useCallback((t: string) => setInput(joinDict(dictBaseRef.current, t)), []);
  const stt = useSpeechToText(onDictated, onInterimSpeech);

  /* ---------- "Hey Wilson" wake word (foreground, opt-in) ---------- */
  const { speaking: wilsonSpeaking } = useWilsonAudio();
  const wakeOk = wakeSupport();
  const wakeOn = !!settings.wakeWord && wakeOk.ok;
  const wakeCtx = useRef({ onFinalSpeech, stt });
  wakeCtx.current = { onFinalSpeech, stt };
  useEffect(() => {
    if (!wakeOn) { stopWake(); return; }
    startWake((rest) => {
      emitRipple();
      wakeSpeakRef.current = true;
      if (rest) void wakeCtx.current.onFinalSpeech(rest);
      else { dictBaseRef.current = ""; wakeCtx.current.stt.start(); }
    });
    return () => stopWake();
  }, [wakeOn]);
  useEffect(() => { if (wakeOn) pauseWake(stt.listening || wilsonSpeaking || voiceActive || thinking); }, [wakeOn, stt.listening, wilsonSpeaking, voiceActive, thinking]);

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
      <Backdrop chat={!isHome} />
      {orgTab && <ErrorBoundary label="organizer" compact><Organizer tab={orgTab} onTab={setOrgTab} onClose={() => setOrgTab(null)} /></ErrorBoundary>}
      {dueBanner.length > 0 && !orgTab && (
        <div className="fixed z-[45] left-3 right-3 top-[max(4.25rem,calc(env(safe-area-inset-top)+3.5rem))] max-w-lg mx-auto glass-strong rounded-2xl px-4 py-3 flex items-start gap-3 shadow-lg">
          <Bell className="w-4 h-4 mt-0.5 text-violet-500 flex-shrink-0" />
          <button type="button" className="flex-1 text-left text-[14px] text-violet-950/90" onClick={() => { setOrgTab("reminders"); setDueBanner([]); }}>
            <span className="block text-[11px] text-violet-500 tracking-wide">Reminder{dueBanner.length > 1 ? "s" : ""} due</span>{dueBanner.slice(0, 3).join(" · ")}
          </button>
          <button type="button" aria-label="Dismiss" onClick={() => setDueBanner([])} className="text-violet-400"><X className="w-4 h-4" /></button>
        </div>
      )}
      {feedback && <ErrorBoundary label="feedback" compact><FeedbackSheet target={feedback} onClose={() => setFeedback(null)} /></ErrorBoundary>}
      {showAdmin && isAdmin && <ErrorBoundary label="Architect view"><AdminPanel messages={activeThread?.messages ?? []} busy={busy} onSend={(x) => void sendMessage(x)} onClose={() => setShowAdmin(false)} onSignOut={() => { setIsAdmin(false); setShowAdmin(false); }} /></ErrorBoundary>}
      {awayNote && (
        <div className="fixed bottom-28 left-1/2 -translate-x-1/2 z-[55] w-[min(92vw,30rem)] glass-strong rounded-2xl px-4 py-3 shadow-lg text-[15px] leading-[1.65] text-violet-950/90">
          <div className="text-[11px] tracking-[0.12em] text-violet-500 mb-1">WHILE YOU WERE AWAY</div>
          <div className="whitespace-pre-wrap">{awayNote.text}</div>
          <div className="flex gap-4 mt-2 text-[13px]">
            <button type="button" className="underline text-violet-700" onClick={() => { markNoteSeen(awayNote.ts); setInput(`About your note: `); setAwayNote(null); }}>Talk about it</button>
            <button type="button" className="underline text-violet-500" onClick={() => { markNoteSeen(awayNote.ts); setAwayNote(null); }}>Got it</button>
          </div>
        </div>
      )}
      {(starMoment || shareMsg) && <div role="status" className="fixed top-14 left-1/2 -translate-x-1/2 z-[61] glass-strong rounded-2xl px-4 py-2.5 text-[14px] text-violet-900 shadow-lg max-w-[92vw] text-center">{starMoment ?? shareMsg}</div>}
      {askVoiceConsent && (
        <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center bg-violet-950/20 p-3" role="dialog" aria-label="Voice recognition">
          <div className="w-full max-w-md glass-strong rounded-3xl p-5 text-violet-950/90 text-[16px] leading-[1.7]">
            <p className="mb-2 font-medium">Can Wilson learn your voice?</p>
            <p>He learns how your voice sounds so he knows it's you. That voice data is made and kept only on this device — it's never uploaded. You can turn it off or erase it anytime in Settings.</p>
            <div className="flex gap-3 mt-4">
              <button type="button" className="flex-1 py-2.5 rounded-xl bg-violet-500 text-white" onClick={() => { recordConsent("yes"); setAskVoiceConsent(false); setTimeout(() => (document.querySelector('[aria-label="Talk to type"]') as HTMLButtonElement | null)?.click(), 50); }}>OK</button>
              <button type="button" className="flex-1 py-2.5 rounded-xl bg-violet-100/80 text-violet-800" onClick={() => { recordConsent("no"); setSettings((s) => ({ ...s, voiceRecognition: false })); setAskVoiceConsent(false); setTimeout(() => (document.querySelector('[aria-label="Talk to type"]') as HTMLButtonElement | null)?.click(), 50); }}>Not now</button>
            </div>
          </div>
        </div>
      )}
      {globalWarn && <div role="status" className="wl-warn fixed top-3 left-1/2 -translate-x-1/2 z-[60] rounded-full px-4 py-2 text-[13px] shadow-lg">{globalWarn}</div>}

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
              <div className="px-3 pb-2 flex gap-2">
                <button type="button" onClick={() => { setSidebarOpen(false); setOrgTab("notes"); }} className="flex-1 flex items-center justify-center gap-2 rounded-xl py-2 bg-white/50 text-violet-800 text-[13px]"><StickyNote className="w-4 h-4" />Notes</button>
                <button type="button" onClick={() => { setSidebarOpen(false); setOrgTab("reminders"); }} className="flex-1 flex items-center justify-center gap-2 rounded-xl py-2 bg-white/50 text-violet-800 text-[13px]"><Bell className="w-4 h-4" />Reminders</button>
                <a href="https://butterflyeffect007.github.io/Wilson/subscribe.html" target="_blank" rel="noopener" className="flex-1 flex items-center justify-center gap-2 rounded-xl py-2 bg-white/50 text-violet-800 text-[13px]">Alerts</a>
              </div>
              <div className="px-3 pb-2">
                <button type="button" onClick={() => { setSidebarOpen(false); setFeedback({ type: "problem" }); }} className="w-full flex items-center justify-center gap-2 rounded-xl py-2 bg-white/50 text-violet-800 text-[13px]"><MessageSquareWarning className="w-4 h-4" />Send feedback to Jenny</button>
                <div className="mt-2 flex gap-2">
                  <button type="button" onClick={() => { setSidebarOpen(false); setShowSettings(true); }} className="flex-1 flex items-center justify-center gap-2 rounded-xl py-2.5 bg-white/50 text-violet-800 text-[14px]"><SettingsIcon className="w-4 h-4" />Settings</button>
                  <button type="button" onClick={() => { setSidebarOpen(false); if (isAdmin) setShowAdmin(true); else { setShowSettings(true); setTimeout(() => (document.querySelector('[aria-label="Architect key"]') as HTMLInputElement | null)?.focus(), 300); } }} className="flex-1 flex items-center justify-center gap-2 rounded-xl py-2.5 bg-white/50 text-violet-800 text-[14px]">✦ Architect access</button>
                </div>
                <button type="button" onClick={() => { setSidebarOpen(false); doShare(); }} className="mt-2 w-full flex items-center justify-center gap-2 rounded-xl py-2.5 bg-gradient-to-r from-fuchsia-500/15 via-violet-500/15 to-amber-400/20 text-violet-800 text-[14px]"><Gift className="w-4 h-4" />Share Wilson with a friend{stars > 0 ? ` · ✦${stars}` : ""}</button>
                {!isInstalled() && <button type="button" onClick={() => { setSidebarOpen(false); setInstallOpen(true); }} className="mt-2 w-full flex items-center justify-center gap-2 rounded-xl py-2 bg-white/50 text-violet-800 text-[13px]">Add to Home Screen</button>}
              </div>
              <div className="flex-1 overflow-y-auto px-2 pb-4 space-y-1">
                <div className="px-1 pb-2">
                  <div className="flex items-center gap-2 rounded-xl px-3 py-2 bg-white/60 border border-violet-200/60">
                    <SearchIcon className="w-4 h-4 text-violet-400 shrink-0" />
                    <input value={threadQ} onChange={(e) => setThreadQ(e.target.value)} placeholder="Search chats" aria-label="Search chats" className="flex-1 min-w-0 bg-transparent outline-none text-[15px] text-violet-950" />
                    {threadQ && <button type="button" onClick={() => setThreadQ("")} aria-label="Clear search" className="text-violet-400"><X className="w-4 h-4" /></button>}
                  </div>
                </div>
                {threads.length === 0 && <p className="text-[12px] text-violet-700/50 px-3 py-4">No threads yet.</p>}
                {tq && shownThreads.length === 0 && <p className="text-[13px] text-violet-700/60 px-3 py-3">No chats mention "{threadQ.trim()}".</p>}
                {shownThreads.map((t) => (
                  <div
                    key={t.id}
                    onClick={() => { setActiveId(t.id); setSidebarOpen(false); if (tq) { setFindQ(threadQ.trim()); setFindOpen(true); } }}
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

      <header className="relative z-10 pt-[max(0.75rem,env(safe-area-inset-top))] pb-1 pl-[max(0.75rem,env(safe-area-inset-left))] pr-[max(0.75rem,env(safe-area-inset-right))]">
        <div className="max-w-lg mx-auto flex items-center gap-2">
          <button type="button" onClick={() => setSidebarOpen(true)} className="shrink-0 w-11 h-11 flex items-center justify-center rounded-full text-violet-500/80 hover:bg-violet-50/80 touch-manipulation" aria-label="Open menu">
            <Menu className="w-[22px] h-[22px]" />
          </button>
          <div className="flex-1 min-w-0 flex items-center justify-center gap-2">
            <Sparkles className="shrink-0 w-[18px] h-[18px] text-violet-400 wl-title" />
            <h1 className="wl-title leading-none text-violet-900/80 min-w-0" aria-label="Wilson + The Only One"><span className="block text-[19px] tracking-[0.28em]">WILSON</span><span className="block text-[8px] tracking-[0.32em] mt-0.5 opacity-75 whitespace-nowrap">+ THE ONLY ONE</span></h1>
          </div>
          <button type="button" onClick={() => setShowSettings((v) => !v)} className="shrink-0 min-w-11 h-11 px-1 flex flex-col items-center justify-center rounded-2xl text-violet-600/90 hover:bg-violet-50/80 touch-manipulation" aria-label="Settings" title="Settings">
            <SettingsIcon className="w-[20px] h-[20px]" />
            <span className="text-[9px] leading-none mt-0.5 tracking-wide">Settings</span>
          </button>
        </div>
        <div className="max-w-lg mx-auto mt-1 flex items-center justify-between gap-1 flex-wrap">
          <div className="flex items-center gap-1.5 min-w-0">
            {betaNum && (
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-violet-500/15 text-violet-700/90 tracking-wide whitespace-nowrap" title={`OG 100 #${betaNum}`}>
                {`OG·${betaNum}`}
              </span>
            )}
            {stars > 0 && <span className="text-[12px] text-amber-500 tracking-wide" title={`${stars} friend${stars === 1 ? "" : "s"} joined from your link`} aria-label={`${stars} stars`}>✦{stars > 1 ? stars : ""}</span>}
            {isAdmin && (
              <button type="button" onClick={() => setShowAdmin(true)} className="text-[10px] px-2 py-0.5 rounded-full bg-gradient-to-r from-fuchsia-500/20 via-violet-500/20 to-amber-400/25 text-violet-700/90 tracking-wide" title="Architect view">
                ARCHITECT
              </button>
            )}
          </div>
          <div className="flex items-center gap-0.5 ml-auto">
            {activeThread && activeThread.messages.length > 1 && (
              <button type="button" onClick={() => { setFindOpen((o) => !o); }} className="p-2 rounded-full text-violet-500/80 hover:bg-violet-50/80 touch-manipulation" aria-label="Search this chat" title="Search this chat">
                <SearchIcon className="w-[18px] h-[18px]" />
              </button>
            )}
            {activeThread && activeThread.messages.some((m) => m.role === "user") && (
              <button
                type="button"
                onClick={() => void shareChat(activeThread.title, activeThread.messages, displayName, document.documentElement.classList.contains("dark")).then((r) => { if (r === "downloaded") { setShareNote("Saved as a web page"); setTimeout(() => setShareNote(null), 2500); } })}
                className="p-2 rounded-full text-violet-500/80 hover:bg-violet-50/80 touch-manipulation"
                aria-label="Share this conversation"
                title={shareNote ?? "Share"}
              >
                {shareNote ? <Check className="w-[18px] h-[18px]" /> : <Share2 className="w-[18px] h-[18px]" />}
              </button>
            )}
            <button type="button" onClick={doShare} className="p-2 rounded-full text-violet-500/80 hover:bg-violet-50/80 touch-manipulation" aria-label="Share Wilson with a friend" title="Share Wilson with a friend">
              <Gift className="w-[18px] h-[18px]" />
            </button>
            <button
              type="button"
              onClick={() => { primePlayback(); if (settings.voiceEnabled) stopSpeaking(); setSettings((s) => ({ ...s, voiceEnabled: !s.voiceEnabled })); }}
              className="p-2 rounded-full text-violet-500/80 hover:bg-violet-50/80 touch-manipulation"
              aria-label={settings.voiceEnabled ? "Mute Wilson's voice" : "Turn on Wilson's voice"}
              title={settings.voiceEnabled ? "Voice on" : "Voice off"}
            >
              {settings.voiceEnabled ? <Volume2 className="w-[18px] h-[18px]" /> : <VolumeX className="w-[18px] h-[18px]" />}
            </button>
            <button
              type="button"
              onClick={toggleTheme}
              className="wl-theme-toggle relative w-9 h-9 rounded-full text-violet-500/80 hover:bg-violet-50/80 touch-manipulation"
              aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
              title={theme === "dark" ? "Light theme" : "Dark theme"}
              data-theme={theme}
            >
              <Sun className="wl-tt-sun absolute inset-0 m-auto w-[18px] h-[18px]" />
              <Moon className="wl-tt-moon absolute inset-0 m-auto w-[18px] h-[18px]" />
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
              <div>
                {isAdmin ? (
                  <>
                  <button type="button" onClick={() => { setShowSettings(false); setShowAdmin(true); }} className="w-full text-left text-[13px] px-3 py-2 rounded-xl bg-violet-100/60 hover:bg-violet-100 text-violet-800">Open Architect view</button>
                  <label className="flex items-start gap-2 text-[12px] text-violet-800/80 mt-2">
                    <input type="checkbox" className="mt-0.5" checked={nightly} onChange={(e) => { const on = e.target.checked; setNightly(on); setNightlyOptIn(on); if (on) void syncLoops(loadStateOfYou().summary); }} />
                    <span>Nightly notes — Wilson thinks about your open loops overnight and leaves you a short note. (Shares only your open loops with Wilson's server.)</span>
                  </label>
                  </>
                ) : (
                  <div className="rounded-xl border border-violet-200/60 p-3">
                    <p className="text-[13px] text-violet-900/90 mb-2">✦ Architect access (Jenny)</p>
                    <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); const k = adminKeyDraft.trim(); if (!k) return; setAdminMsg("Checking…"); void verifyAdmin(k).then((ok) => { setAdminKeyDraft(""); if (ok) { setIsAdmin(true); setAdminMsg(null); setShowSettings(false); setShowAdmin(true); } else setAdminMsg(ok === null ? "Couldn't reach Wilson — try again." : "That key didn't work."); }); }}>
                      <input type="password" autoComplete="off" aria-label="Architect key" value={adminKeyDraft} onChange={(e) => setAdminKeyDraft(e.target.value)} placeholder="Architect key" className="flex-1 min-w-0 rounded-xl px-3 py-2 text-[14px] bg-white/70 border border-violet-200/60 outline-none text-violet-950" />
                      <button type="submit" className="px-3 py-2 rounded-xl bg-violet-500 text-white text-[13px]">Unlock</button>
                    </form>
                    {adminMsg && <p className="mt-1 text-[12px] text-violet-700/80">{adminMsg}</p>}
                  </div>
                )}
              </div>


              <div className="space-y-1.5">
                <p className="text-[12px] text-violet-700/70">Tell Jenny what's working and what isn't — she reads every one.</p>
                <div className="flex gap-2">
                  <button type="button" onClick={() => { setShowSettings(false); setFeedback({ type: "problem" }); }} className="flex-1 text-[14px] px-3 py-2.5 rounded-xl bg-violet-500 text-white">Report a problem</button>
                  <button type="button" onClick={() => { setShowSettings(false); setFeedback({ type: "suggestion" }); }} className="flex-1 text-[14px] px-3 py-2.5 rounded-xl bg-violet-100/80 text-violet-800">Suggest an idea</button>
                </div>
                <button type="button" onClick={doShare} className="w-full flex items-center justify-center gap-2 text-[14px] px-3 py-2.5 rounded-xl bg-gradient-to-r from-fuchsia-500/15 via-violet-500/15 to-amber-400/20 text-violet-800"><Gift className="w-4 h-4" />Share Wilson with a friend{stars > 0 ? ` · ✦${stars}` : ""}</button>
                {!isInstalled() && <button type="button" onClick={() => { setShowSettings(false); setInstallOpen(true); }} className="w-full text-[14px] px-3 py-2.5 rounded-xl bg-violet-100/80 text-violet-800">Add Wilson to your Home Screen</button>}
                <p className="text-[12px] text-violet-700/80">Wilson + The Only One · <span className="italic">Imagination becomes intelligence™</span></p>
                <p className="text-[12px]"><a href="https://butterflyeffect007.github.io/Wilson/subscribe.html" className="text-violet-600 hover:underline" target="_blank" rel="noopener">Silver Harbor Alerts</a></p>
                <p className="text-[11px] text-violet-500/70">Version {APP_VERSION} · build {__BUILD_ID__} · {new Date(__BUILD_AT__).toLocaleDateString([], { month: "short", day: "numeric" })} {new Date(__BUILD_AT__).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</p>
              </div>
              <div className="pt-2 border-t border-violet-200/40 text-[13px] text-violet-800/90">
                <label className="flex items-start gap-2">
                  <input type="checkbox" className="mt-1" checked={pushOn} onChange={(e) => {
                    const on = e.target.checked; setPushMsg(on ? "Turning on…" : null);
                    if (on) void enablePush().then((err) => { setPushOn(!err); setPushMsg(err); });
                    else void disablePush().then(() => setPushOn(false));
                  }} />
                  <span>Notifications from Wilson — reminders{isAdmin ? " and nightly notes" : ""}, even when the app is closed.</span>
                </label>
                {isIOS() && !isStandalone() && <p className="text-[12px] text-violet-700/70 mt-1 leading-[1.6]">On iPhone (iOS 16.4 or newer): tap Share → Add to Home Screen, open Wilson from the Home Screen, then turn this on.</p>}
                {!pushSupported() && !isIOS() && <p className="text-[12px] text-violet-700/70 mt-1">This browser can't show notifications.</p>}
                {pushMsg && <p className="text-[12px] text-violet-700/80 mt-1 leading-[1.6]">{pushMsg}</p>}
              </div>


              {betaNum && <p><span className="inline-block text-[12px] px-2 py-0.5 rounded-full bg-gradient-to-r from-pink-200/70 via-violet-200/70 to-sky-200/70 text-violet-800">✦ OG 100 #{betaNum}, one of Wilson's first 100</span></p>}

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
                  <input type="checkbox" checked={voiceId} onChange={(e) => { const on = e.target.checked; if (on) recordConsent("yes"); setSettings((s) => ({ ...s, voiceRecognition: on })); }} />
                  Know who's talking
                </label>
                {(voiceProfiles.length > 0 || voiceConsent) && (
                  <button type="button" className="text-[12px] underline text-rose-500 text-left" onClick={() => { if (confirm("Erase the voice data Wilson saved on this device?")) eraseVoiceData(); }}>Erase my voice data</button>
                )}
                <label className={`flex items-start gap-2 text-[12px] ${wakeOk.ok ? "text-violet-800/80" : "text-violet-800/40"}`}>
                  <input type="checkbox" className="mt-0.5" disabled={!wakeOk.ok} checked={wakeOn} onChange={(e) => { const on = e.target.checked; if (on && voiceConsent === null) setAskVoiceConsent(true); setSettings((s) => ({ ...s, wakeWord: on })); }} />
                  <span>Listen for “Hey Wilson” (while Wilson is open on screen){wakeOk.ok ? " — uses your browser's speech recognition; in Chrome, Google processes the audio." : ""}</span>
                </label>
                {!wakeOk.ok && <p className="text-[12px] text-violet-700/70 leading-[1.6]">{wakeOk.reason}</p>}
                <details className="text-[12px] text-violet-800/80 leading-[1.7]">
                  <summary className="cursor-pointer select-none">Use Siri to open Wilson (iPhone)</summary>
                  <ol className="list-decimal pl-5 mt-1 space-y-0.5">
                    <li>Open the <b>Shortcuts</b> app.</li>
                    <li>Tap <b>+</b> to make a new shortcut.</li>
                    <li>Tap <b>Add Action</b>, search <b>Open URLs</b>, and add it.</li>
                    <li>Set the URL to <b>https://butterflyeffect007.github.io/Wilson/</b></li>
                    <li>Name the shortcut <b>Wilson</b> and tap Done.</li>
                    <li>Now say <b>“Hey Siri, Wilson”</b> to open him.</li>
                  </ol>
                </details>
                <label className="flex items-center gap-2 text-[12px] text-violet-800/80">
                  <input type="checkbox" checked={settings.emotionDetection} onChange={(e) => setSettings((s) => ({ ...s, emotionDetection: e.target.checked }))} />
                  Notice my mood
                </label>
                <label className="flex items-center gap-2 text-[12px] text-violet-800/80">
                  <input type="checkbox" checked={settings.longMemory} onChange={(e) => setSettings((s) => ({ ...s, longMemory: e.target.checked }))} />
                  Remember things
                </label>
                <div className="pt-2">
                  <button type="button" className="underline text-[12px] text-violet-700/80" onClick={() => setSoyOpen((o) => !o)}>{soyOpen ? "Hide" : "What Wilson knows about how you're doing"}</button>
                  {soyOpen && (
                    <div className="mt-2 rounded-xl bg-violet-100/50 p-3 text-[14px] leading-[1.7] text-violet-950/90 space-y-2">
                      <p className="text-[12px] text-violet-700/70">Kept only on this device. Wilson uses it to match your energy, not to repeat it back. Updates about every 12 messages and when you leave.</p>
                      {soyDraft === null ? (
                        <div className="whitespace-pre-wrap">{soy.summary || "Nothing yet — it fills in as you talk."}</div>
                      ) : (
                        <textarea value={soyDraft} onChange={(e) => setSoyDraft(e.target.value)} rows={9} className="w-full rounded-lg p-2 text-[14px] leading-[1.7] bg-white/80 border border-violet-200/60 text-violet-950" />
                      )}
                      {localSignals(soy).length > 0 && <div className="text-[12px] text-violet-700/70">Right now: {localSignals(soy).join(" ")}</div>}
                      {soy.updatedAt && <div className="text-[11px] text-violet-500/70">Updated {new Date(soy.updatedAt).toLocaleString()}{soy.editedByUser ? " · edited by you" : ""}</div>}
                      <div className="flex gap-3 text-[13px]">
                        {soyDraft === null
                          ? <button type="button" className="underline" onClick={() => setSoyDraft(soy.summary)}>Edit</button>
                          : <><button type="button" className="underline" onClick={() => { editStateSummary(soyDraft); setSoyDraft(null); }}>Save</button><button type="button" className="underline" onClick={() => setSoyDraft(null)}>Cancel</button></>}
                        <button type="button" className="underline text-rose-500" onClick={() => { if (confirm("Clear everything Wilson knows about how you're doing?")) { clearStateOfYou(); setSoyDraft(null); } }}>Clear</button>
                      </div>
                    </div>
                  )}
                </div>
                <div>
                  <button type="button" className="underline text-[12px] text-violet-700/80" onClick={() => setQmemOpen((o) => !o)}>{qmemOpen ? "Hide" : "What Wilson remembers about you"}</button>
                  {qmemOpen && (() => {
                    const rows: { k: string; kind: "intent" | "pacing" | "thread" | "recap"; key: string; text: string }[] = [
                      ...(qmem.intent ? [{ k: "i", kind: "intent" as const, key: "", text: `What you're aiming for: ${qmem.intent}` }] : []),
                      ...qmem.pacing.map((p, i) => ({ k: `p${i}`, kind: "pacing" as const, key: p, text: `How you like it: ${p}` })),
                      ...qmem.threads.map((t) => ({ k: t.id, kind: "thread" as const, key: t.id, text: `${t.title} (${t.status}, ${t.date})${t.decision ? ` · decided: ${t.decision}` : ""}${t.next ? ` · next: ${t.next}` : ""}` })),
                      ...qmem.recaps.map((r) => ({ k: r.id, kind: "recap" as const, key: r.id, text: `${r.date} · ${r.text}` })),
                    ];
                    return (
                      <div className="mt-1 rounded-xl bg-violet-100/50 p-3 text-[12px] text-violet-900/90 space-y-1.5">
                        <p className="text-[11px] text-violet-700/70">{isAdmin ? "Kept on this device and synced privately to your Wilson server." : "Kept only on this device."} Wilson uses it to pick up where you left off; he won't read it back to you.</p>
                        {rows.length === 0 && <div className="text-violet-500/70">Nothing yet. It fills in quietly as you talk.</div>}
                        <div className="max-h-40 overflow-y-auto space-y-1">
                          {rows.map((r) => (
                            <div key={r.k} className="flex gap-2 justify-between">
                              <span className="text-[11px]">{r.text}</span>
                              <button type="button" className="text-rose-500" aria-label="Forget this" onClick={() => deleteQuietItem(r.kind, r.key)}>✕</button>
                            </div>
                          ))}
                        </div>
                        <div className="flex gap-3 text-[12px]">
                          <button type="button" className="underline" onClick={exportQuietMemory}>Export</button>
                          <button type="button" className="underline text-rose-500" onClick={() => { if (confirm("Clear what Wilson remembers about you?")) clearQuietMemory(); }}>Clear</button>
                        </div>
                      </div>
                    );
                  })()}
                </div>
                <label className="flex items-center gap-2 text-[12px] text-violet-800/80">
                  <input type="checkbox" checked={settings.suggestions} onChange={(e) => setSettings((s) => ({ ...s, suggestions: e.target.checked }))} />
                  Gentle suggestions (now and then)
                </label>
                <div className="text-[12px] text-violet-800/80">
                  <span className="text-[11px] text-violet-700/60">What Wilson's learned</span>
                  <div className="mt-1 max-h-32 overflow-y-auto space-y-1">
                    {lessons.length === 0 && <div className="text-[11px] text-violet-500/60">Nothing yet. Correct him anytime ("call me Jenny", "be shorter about…").</div>}
                    {lessons.map((l) => (
                      <div key={l.id} className="flex gap-2 justify-between">
                        <span className="text-[11px]">{l.text}</span>
                        <button type="button" className="text-rose-500" aria-label="Delete lesson" onClick={() => setLessons(deleteLesson(l.id))}>✕</button>
                      </div>
                    ))}
                  </div>
                </div>
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
                  Auto-speak replies (otherwise tap Play on a reply; saves the daily voice allowance)
                </label>
                <div className="flex items-center gap-2">
                  <button type="button" onClick={() => voiceTest()} className="rounded-full bg-violet-100 px-3 py-1 text-[12px] text-violet-800 touch-manipulation">Voice test</button>
                  <span className="text-[10px] text-violet-500/80 break-all">{voiceDebug.lastEvent || "not tested yet"}</span>
                </div>
                {voiceDebug.lastError && <p className="text-[10px] text-rose-500/80 break-all">Last voice error: {voiceDebug.lastError}</p>}
                <PuckStatus />
                <p className="text-[11px] text-violet-500/70">
                  Enter send · Shift+Enter new line · Esc stop · Ctrl/Cmd+Shift+O new thread
                </p>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex-1 overflow-hidden flex flex-col relative z-10">
        {findOpen && activeThread && (
          <div className="relative z-20 px-4 pb-2">
            <div className="max-w-2xl mx-auto flex items-center gap-2 rounded-2xl glass-strong px-3 py-2">
              <SearchIcon className="w-4 h-4 text-violet-400 shrink-0" />
              <input autoFocus value={findQ} onChange={(e) => setFindQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); setFindIdx((i) => i + (e.shiftKey ? -1 : 1)); } if (e.key === "Escape") setFindOpen(false); }} placeholder="Find in this chat" aria-label="Find in this chat" className="flex-1 min-w-0 bg-transparent outline-none text-[16px] text-violet-950" />
              <span className="text-[13px] text-violet-700/70 tabular-nums whitespace-nowrap" aria-live="polite">{findTerm ? (findCount ? `${(((findIdx % findCount) + findCount) % findCount) + 1} of ${findCount}` : "No matches") : ""}</span>
              <button type="button" disabled={!findCount} onClick={() => setFindIdx((i) => i - 1)} aria-label="Previous match" className="p-1.5 rounded-full text-violet-500 disabled:opacity-30"><ChevronUp className="w-5 h-5" /></button>
              <button type="button" disabled={!findCount} onClick={() => setFindIdx((i) => i + 1)} aria-label="Next match" className="p-1.5 rounded-full text-violet-500 disabled:opacity-30"><ChevronDown className="w-5 h-5" /></button>
              <button type="button" onClick={() => { setFindOpen(false); setFindQ(""); }} aria-label="Close search" className="p-1.5 rounded-full text-violet-400"><X className="w-4 h-4" /></button>
            </div>
          </div>
        )}
        <div
          ref={scrollRef}
          onScroll={onScroll}
          className="flex-1 overflow-y-auto px-4"
        >
          {isHome ? (
            <div className="min-h-full flex flex-col items-center justify-center pt-[clamp(2rem,8dvh,5rem)] pb-10 max-w-md mx-auto">
              <motion.div
                initial={{ scale: 0.85, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ type: "spring", stiffness: 120, damping: 18 }}
                className="relative mb-[clamp(2.5rem,8dvh,5rem)]"
              >
                <div className="relative">
                  <ErrorBoundary label="the orb" compact><WilsonOrb size="lg" vibe={vibe} isThinking={thinking} interactive onTap={() => { if (wilsonSpeaking || voiceActive) { stopSpeaking(); setPlayMsg(null); } primePlayback(); }} onLongPress={() => { if (!stt.listening && stt.supported && settings.voiceRecognition && voiceConsent === null) { setAskVoiceConsent(true); return; } if (!stt.listening && stt.supported) { primePlayback(); stopSpeaking(); if (voiceId || settings.emotionDetection) void startCapture().catch(() => {}); stt.toggle(); } }} /></ErrorBoundary>
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
                  className={`group flex gap-3 items-start ${msg.role === "user" ? "justify-end" : ""}`}
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
                      <ErrorBoundary label="this message" compact><Markdown text={msg.content} highlight={findTerm} /></ErrorBoundary>
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
                      {streamingId !== msg.id && msg.role === "assistant" && (
                        <button
                          type="button"
                          onClick={() => toggleMessageVoice(msg)}
                          className="flex items-center gap-1 opacity-70 sm:opacity-0 group-hover:opacity-100 focus:opacity-100 hover:text-violet-600 touch-manipulation"
                          aria-label={playMsg?.id === msg.id ? "Stop Wilson speaking" : "Play this message"}
                        >
                          {playMsg?.id === msg.id
                            ? playMsg.phase === "loading"
                              ? <><Loader2 className="w-3 h-3 animate-spin" />Loading</>
                              : <><Square className="w-3 h-3" />Stop</>
                            : <><Play className="w-3 h-3" />Play</>}
                        </button>
                      )}
                      {streamingId !== msg.id && msg.role === "assistant" && (
                        <button
                          type="button"
                          onClick={() => { const i = messages.findIndex((m) => m.id === msg.id); const prev = [...messages.slice(0, i)].reverse().find((m) => m.role === "user"); setFeedback({ type: "problem", reply: msg.content, context: prev?.content }); }}
                          className="flex items-center gap-1 opacity-70 sm:opacity-0 group-hover:opacity-100 focus:opacity-100 hover:text-violet-600 touch-manipulation"
                          aria-label="Send this reply to Jenny"
                          title="Send to Jenny"
                        >
                          <SendIcon className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  </div>
                  {msg.role === "user" && (
                    <div className="user-avatar w-9 h-9 flex-shrink-0 rounded-full flex items-center justify-center text-[14px] font-light select-none" aria-hidden="true">
                      {(displayName || "J").trim().charAt(0).toUpperCase()}
                    </div>
                  )}
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
            {voiceId && speaker && (speaker.isNew || correcting) && (
              <form onSubmit={(e) => { e.preventDefault(); correcting ? correctSpeaker(nameDraft) : nameSpeaker(nameDraft); }} className="flex items-center gap-2 mb-1.5 px-2 text-[12px] text-violet-700/80">
                <span>{correcting ? "Who is this, then?" : "Who am I talking to?"}</span>
                <input value={nameDraft} onChange={(e) => setNameDraft(e.target.value)} placeholder="Name" className="flex-1 min-w-0 rounded-full px-2 py-0.5 bg-white/70 border border-violet-200/60 outline-none" />
                <button type="submit" className="text-violet-600 underline">Save</button>
                <button type="button" onClick={() => { setSpeaker(null); setCorrecting(false); }} className="text-violet-400">✕</button>
              </form>
            )}
            {voiceId && speaker && speakerProfile?.name && speaker.lowConfidence && !speaker.isNew && !correcting && (
              <p className="mb-1.5 px-2 text-[12px] text-violet-600/70">
                I think this is {speakerProfile.name}?{" "}
                <button type="button" className="underline" onClick={() => setSpeaker({ ...speaker, lowConfidence: false })}>Yes</button>{" · "}
                <button type="button" className="underline" onClick={() => setCorrecting(true)}>No</button>
              </p>
            )}
            {settings.showHeard && settings.emotionDetection && heard && (
              <p className="mb-1 px-2 text-[11px] text-violet-500/60">Heard: {heard.tag} ({Math.round(heard.confidence * 100)}%)</p>
            )}
            {showInstallHint && <InstallCard onClose={dismissInstallHint} />}
            {voiceStatus.state === "resting" && (
              <p className="mb-1.5 px-2 text-[12px] text-violet-600/70">Wilson's voice is resting until 7 PM Central (daily free limit).</p>
            )}
            {voiceStatus.state === "preparing" && (
              <p className="mb-1.5 px-2 text-[12px] text-violet-600/70">Getting Wilson's voice ready…{voiceStatus.progress > 0 && voiceStatus.progress < 100 ? ` ${voiceStatus.progress}%` : ""} (one-time download, Wi-Fi is best)</p>
            )}
            {voiceStatus.state === "unavailable" && (
              <p className="mb-1.5 px-2 text-[12px] text-violet-600/70">Wilson's voice couldn't play just now{voiceStatus.reason ? ` (${voiceStatus.reason})` : ""}, so this reply is text only.</p>
            )}
            {voiceActive && (
              <div className="flex justify-center mb-1.5">
                <button type="button" onClick={() => { stopSpeaking(); setPlayMsg(null); }} className="flex items-center gap-1.5 px-3 py-1 rounded-full glass text-[12px] text-violet-700/80 touch-manipulation" aria-label="Stop Wilson's voice">
                  <Square className="w-3 h-3 fill-current" /> Stop voice
                </button>
              </div>
            )}
            {stt.error && <p className="text-[12px] text-rose-600 mb-1.5 px-2">{stt.error}</p>}
            <div className={`relative flex items-end gap-2 rounded-[1.6rem] glass-strong px-2 py-1.5 ${saving || stt.listening ? "wl-telemetry" : ""}`} title={stt.listening ? "Listening…" : saving ? "Saving…" : undefined}>
              {(saving || stt.listening) && <span className="sr-only" role="status">{stt.listening ? "Processing voice" : "Saving"}</span>}
              <textarea
                ref={inputRef}
                rows={1}
                value={input}
                onChange={(e) => { setInput(e.target.value); if (settings.voiceEnabled) warmVoice(); }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    stt.cancel();
                    void sendMessage();
                  }
                }}
                placeholder={stt.listening ? "Listening…" : "Type a message..."}
                enterKeyHint="send"
                className="flex-1 resize-none bg-transparent px-3 py-2.5 text-[16px] leading-6 text-violet-950 placeholder-violet-400/50 outline-none touch-manipulation"
              />
              <button
                type="button"
                onClick={() => {
                  if (!stt.listening && settings.voiceRecognition && voiceConsent === null) { setAskVoiceConsent(true); return; }
                  primePlayback(); stopSpeaking();
                  const iOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
                  // iOS can't share the mic between getUserMedia and speech recognition reliably: skip voice ID capture there
                  if (!iOS && !stt.listening && (voiceId || settings.emotionDetection)) void startCapture().catch((e) => console.warn("[capture]", e));
                  if (!iOS && stt.listening) setTimeout(() => void stopCapture(), 3000);
                  if (!stt.listening) dictBaseRef.current = input; // keep anything already typed; dictation adds to it
                  stt.toggle();
                }}
                disabled={!stt.supported}
                className={`relative p-2 rounded-full transition-colors min-w-[40px] min-h-[40px] flex items-center justify-center touch-manipulation disabled:opacity-40 ${
                  stt.listening ? "text-white bg-rose-500 wl-mic-live" : "glass text-violet-500/80"
                }`}
                aria-label={stt.listening ? "Stop listening" : "Talk to type"}
                aria-pressed={stt.listening}
                title={stt.supported ? (stt.listening ? "Listening… tap to stop" : "Tap to talk") : "Voice input isn't supported in this browser"}
              >
                <Mic className="w-[18px] h-[18px]" />
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
                  onClick={() => { stt.cancel(); void sendMessage(); }}
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

