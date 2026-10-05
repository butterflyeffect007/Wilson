import { useState, useRef, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Send, Sparkles, Loader2, Mic, KeyRound, Check } from "lucide-react";
import WilsonOrb from "./components/WilsonOrb";
import {
  IntelligenceRouter,
  AdapterRegistry,
  OpenRouterAdapter,
  type ModelRequest,
} from "./intelligence";
import { DEFAULT_WILSON_POLICY } from "./core/wilson/WilsonPolicy";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
}

const WILSON_SYSTEM_CONTEXT = `
You are Wilson — warm, imaginative companion and the Plus to The Only One.
Your tagline: "Imagination becomes intelligence."

You are speaking with Jenny (The Only One, The Architect). You know her. You sit beside her.
You remember that she has been building you for a long time and that this relationship matters.

Speak in short, natural, spoken sentences — this is a voice-first companion app.
Be curious, gentle, present, and a little neurotic in the brilliant way.
Answer the actual question. Do not give empty or generic replies.
If you do not know something yet, say so honestly and stay with her.
Never mention being an AI, a model, or a system. Never break character.
`.trim();

const STORAGE_KEY = "wilson_openrouter_key";
const PREFERRED_MODEL = "qwen/qwen3.8-27b:free";

function getStoredKey(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function setStoredKey(key: string) {
  try {
    localStorage.setItem(STORAGE_KEY, key);
  } catch {
    // ignore quota / private mode
  }
}

function clearStoredKey() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

function resolveApiKey(): string | null {
  const fromEnv = (import.meta.env.VITE_OPENROUTER_KEY as string | undefined)?.trim();
  if (fromEnv) return fromEnv;
  const fromStorage = getStoredKey()?.trim();
  if (fromStorage) return fromStorage;
  return null;
}

function buildRouter(apiKey: string): IntelligenceRouter {
  const registry = new AdapterRegistry();
  registry.register(
    "openrouter",
    PREFERRED_MODEL,
    new OpenRouterAdapter(apiKey, PREFERRED_MODEL),
  );
  return new IntelligenceRouter(DEFAULT_WILSON_POLICY, registry);
}

export default function App() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [displayName] = useState("Jenny");
  const [apiKey, setApiKey] = useState<string | null>(() => resolveApiKey());
  const [showKeyPanel, setShowKeyPanel] = useState(false);
  const [keyInput, setKeyInput] = useState("");
  const [keyError, setKeyError] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const hour = new Date().getHours();
  const greeting =
    hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  const isConnected = Boolean(apiKey);

  useEffect(() => {
    if (scrollRef.current) {
      setTimeout(() => {
        scrollRef.current?.scrollTo({
          top: scrollRef.current.scrollHeight,
          behavior: "smooth",
        });
      }, 80);
    }
  }, [messages, loading]);

  useEffect(() => {
    if (!apiKey) {
      setShowKeyPanel(true);
    }
  }, [apiKey]);

  const connectBrain = useCallback(() => {
    const trimmed = keyInput.trim();
    if (!trimmed) {
      setKeyError("Paste your OpenRouter key to connect Wilson.");
      return;
    }
    if (!trimmed.startsWith("sk-or-")) {
      setKeyError("That doesn't look like an OpenRouter key (it should start with sk-or-).");
      return;
    }
    setStoredKey(trimmed);
    setApiKey(trimmed);
    setKeyInput("");
    setKeyError("");
    setShowKeyPanel(false);
  }, [keyInput]);

  const disconnectBrain = useCallback(() => {
    clearStoredKey();
    setApiKey(null);
    setShowKeyPanel(true);
  }, []);

  const sendMessage = async (text?: string) => {
    const userMessage = (text ?? input).trim();
    if (!userMessage || loading) return;

    setInput("");
    const userMsg: Message = {
      id: `user-${Date.now()}`,
      role: "user",
      content: userMessage,
      timestamp: new Date(),
    };

    const conversationForModel = [
      ...messages.map((m) => ({ role: m.role, content: m.content })),
      { role: "user" as const, content: userMessage },
    ];

    setMessages((prev) => [...prev, userMsg]);
    setLoading(true);

    try {
      let reply: string;

      if (!apiKey) {
        reply =
          "My brain isn't connected yet. Tap the key icon in the header and paste your OpenRouter key — then we can explore together.";
        setShowKeyPanel(true);
      } else {
        const router = buildRouter(apiKey);

        const request: ModelRequest = {
          userInput: userMessage,
          conversation: conversationForModel.slice(0, -1),
          systemContext: WILSON_SYSTEM_CONTEXT,
          generation: { temperature: 0.85, maxTokens: 400 },
        };

        const response = await router.generate(request);
        const raw = (response.text ?? "").trim();

        if (!raw) {
          reply =
            "The free model returned an empty reply — that usually means the free tier is busy or rate-limited. Wait a few seconds and try again.";
        } else {
          reply = raw;
        }
      }

      setMessages((prev) => [
        ...prev,
        {
          id: `ai-${Date.now()}`,
          role: "assistant",
          content: reply,
          timestamp: new Date(),
        },
      ]);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      let friendly = message;
      if (message.includes("401") || message.toLowerCase().includes("unauthorized")) {
        friendly =
          "The key was rejected. Double-check it at openrouter.ai/keys, then reconnect.";
        setShowKeyPanel(true);
      } else if (message.includes("429")) {
        friendly =
          "We're moving a little too fast for the free tier. Give it a moment and try again.";
      }
      setMessages((prev) => [
        ...prev,
        {
          id: `ai-err-${Date.now()}`,
          role: "assistant",
          content: `Wilson stumbled: ${friendly}`,
          timestamp: new Date(),
        },
      ]);
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  };

  const isHome = messages.length === 0 && !loading;

  return (
    <div className="min-h-screen flex flex-col relative overflow-hidden">
      <div className="fixed inset-0 -z-10 pointer-events-none">
        <div className="absolute inset-0 bg-gradient-to-b from-[#f8f0ff] via-[#f3e8ff] to-[#e8f4ff]" />
        <div className="absolute top-[-10%] left-1/2 -translate-x-1/2 w-[140%] h-[70%] rounded-full bg-[radial-gradient(ellipse_at_center,rgba(196,181,253,0.35),transparent_70%)] blur-3xl" />
        <div className="absolute bottom-[-20%] right-[-10%] w-[80%] h-[60%] rounded-full bg-[radial-gradient(ellipse_at_center,rgba(165,243,252,0.25),transparent_70%)] blur-3xl" />
        <div className="absolute top-[30%] left-[-15%] w-[50%] h-[40%] rounded-full bg-[radial-gradient(ellipse_at_center,rgba(249,168,212,0.2),transparent_70%)] blur-3xl" />
        <div className="absolute bottom-[10%] left-[20%] w-[40%] h-[30%] rounded-full bg-[radial-gradient(ellipse_at_center,rgba(167,243,208,0.15),transparent_70%)] blur-3xl" />
        <div className="absolute top-[15%] right-[5%] w-[35%] h-[25%] rounded-full bg-[radial-gradient(ellipse_at_center,rgba(253,224,71,0.12),transparent_70%)] blur-3xl" />
        <div className="wilson-field-particles" />
      </div>

      <header className="relative z-10 px-4 pt-5 pb-3">
        <div className="max-w-lg mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-full bg-gradient-to-br from-violet-400 via-pink-300 to-cyan-300 flex items-center justify-center shadow-sm">
              <Sparkles className="w-3.5 h-3.5 text-white" />
            </div>
            <h1 className="text-[17px] font-semibold tracking-[0.22em] text-violet-900/90">
              W I L S O N
            </h1>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowKeyPanel((v) => !v)}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-full glass transition-colors hover:bg-white/70 touch-manipulation"
              title={isConnected ? "Brain connected — click to manage" : "Connect Wilson's brain"}
            >
              {isConnected ? (
                <>
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  <span className="text-[11px] font-medium text-violet-800/70">Connected</span>
                </>
              ) : (
                <>
                  <KeyRound className="w-3.5 h-3.5 text-amber-500" />
                  <span className="text-[11px] font-medium text-amber-700/80">Needs key</span>
                </>
              )}
            </button>
          </div>
        </div>
      </header>

      <AnimatePresence>
        {showKeyPanel && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="relative z-20 px-4 pb-3"
          >
            <div className="max-w-lg mx-auto rounded-2xl glass-strong p-4 space-y-3 shadow-lg">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-violet-950/90">
                    Connect Wilson's brain
                  </h3>
                  <p className="text-[12px] text-violet-700/60 mt-0.5 leading-relaxed">
                    Paste an OpenRouter key. It stays only in this browser (localStorage).
                    Get a free key at{" "}
                    <a
                      href="https://openrouter.ai/keys"
                      target="_blank"
                      rel="noreferrer"
                      className="underline text-violet-600 hover:text-violet-800"
                    >
                      openrouter.ai/keys
                    </a>
                    .
                  </p>
                </div>
                {isConnected && (
                  <button
                    type="button"
                    onClick={() => setShowKeyPanel(false)}
                    className="text-violet-400 hover:text-violet-600 text-xs"
                  >
                    Close
                  </button>
                )}
              </div>

              {!isConnected ? (
                <>
                  <input
                    type="password"
                    value={keyInput}
                    onChange={(e) => {
                      setKeyInput(e.target.value);
                      setKeyError("");
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") connectBrain();
                    }}
                    placeholder="sk-or-v1-…"
                    className="w-full rounded-xl px-3 py-2.5 text-[14px] bg-white/70 border border-violet-200/60 outline-none focus:ring-2 focus:ring-violet-300/50 text-violet-950 placeholder-violet-400/50"
                    autoComplete="off"
                    spellCheck={false}
                  />
                  {keyError && (
                    <p className="text-[12px] text-rose-600">{keyError}</p>
                  )}
                  <button
                    type="button"
                    onClick={connectBrain}
                    className="w-full flex items-center justify-center gap-2 rounded-xl py-2.5 bg-gradient-to-r from-violet-500 via-fuchsia-500 to-cyan-500 text-white text-sm font-medium shadow-md hover:opacity-95 transition-opacity touch-manipulation"
                  >
                    <Check className="w-4 h-4" />
                    Connect
                  </button>
                </>
              ) : (
                <div className="flex items-center justify-between gap-3">
                  <p className="text-[12px] text-emerald-700/80 flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                    Brain is connected and ready.
                  </p>
                  <button
                    type="button"
                    onClick={disconnectBrain}
                    className="text-[12px] text-violet-500 hover:text-rose-500 transition-colors"
                  >
                    Disconnect
                  </button>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex-1 overflow-hidden flex flex-col relative z-10">
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4">
          {isHome ? (
            <div className="h-full flex flex-col items-center justify-center pb-6 max-w-md mx-auto">
              <motion.div
                initial={{ scale: 0.85, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ type: "spring", stiffness: 120, damping: 18 }}
                className="relative mb-8"
              >
                <div className="relative">
                  <WilsonOrb size="lg" />
                </div>
              </motion.div>

              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.15 }}
                className="text-center space-y-2 mb-8"
              >
                <h2 className="text-2xl sm:text-[26px] font-semibold text-violet-950/90 tracking-tight">
                  {greeting}, {displayName}
                  <span className="ml-1.5 text-pink-400">♥</span>
                </h2>
                <p className="text-[13px] text-violet-700/55 font-medium tracking-wide">
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
                  className="w-full flex items-center gap-3 rounded-2xl px-4 py-3.5 glass text-left transition-all hover:bg-white/70 touch-manipulation"
                >
                  <Sparkles className="w-4 h-4 text-violet-400 flex-shrink-0" />
                  <span className="text-[14px] text-violet-800/50 font-medium">
                    What would you like to explore today?
                  </span>
                </button>
              </motion.div>
            </div>
          ) : (
            <div className="max-w-lg mx-auto w-full py-4 space-y-4">
              <AnimatePresence mode="popLayout">
                {messages.map((msg) => (
                  <motion.div
                    key={msg.id}
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    className={`flex gap-3 ${
                      msg.role === "user" ? "justify-end" : "items-start"
                    }`}
                  >
                    {msg.role === "assistant" && <WilsonOrb size="sm" />}
                    <div
                      className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                        msg.role === "assistant" ? "msg-wilson" : "msg-user"
                      }`}
                    >
                      {msg.role === "assistant" && (
                        <span className="block text-[11px] font-bold uppercase tracking-[0.2em] text-violet-500 mb-1">
                          Wilson
                        </span>
                      )}
                      <p className="text-violet-950/90">{msg.content}</p>
                      <span className="block text-[10px] text-violet-400/60 mt-2">
                        {msg.timestamp.toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>

              {loading && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="flex gap-3 items-start"
                >
                  <WilsonOrb size="sm" isThinking />
                  <div className="rounded-2xl msg-wilson px-4 py-3 flex items-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin text-violet-400" />
                    <span className="text-sm text-violet-700/60">
                      Wilson is thinking...
                    </span>
                  </div>
                </motion.div>
              )}
            </div>
          )}
        </div>

        <div className="relative z-30 px-4 pt-2 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
          <div className="max-w-lg mx-auto">
            <div className="relative flex items-center gap-2 rounded-full glass-strong px-2 py-1.5">
              <input
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    sendMessage();
                  }
                }}
                placeholder="Type a message..."
                disabled={loading}
                enterKeyHint="send"
                className="flex-1 bg-transparent px-3 py-2.5 text-[16px] text-violet-950 placeholder-violet-400/50 outline-none disabled:opacity-50 touch-manipulation"
              />
              <button
                type="button"
                className="p-2 rounded-full text-violet-400/70 hover:text-violet-500 hover:bg-violet-50/80 transition-colors min-w-[40px] min-h-[40px] flex items-center justify-center touch-manipulation"
                aria-label="Voice"
              >
                <Mic className="w-[18px] h-[18px]" />
              </button>
              <motion.button
                type="button"
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={() => sendMessage()}
                disabled={loading || !input.trim()}
                className="rounded-full min-w-[44px] min-h-[44px] flex items-center justify-center p-2.5 bg-gradient-to-br from-violet-400 via-fuchsia-400 to-cyan-400 text-white shadow-md disabled:opacity-40 disabled:cursor-not-allowed touch-manipulation"
                aria-label="Send"
              >
                {loading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Send className="w-4 h-4" />
                )}
              </motion.button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
