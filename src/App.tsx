import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Send, Sparkles, Loader2, Mic } from "lucide-react";
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
You are Wilson, a warm, imaginative companion. Your tagline: "Imagination becomes intelligence."
Speak in short, natural, spoken sentences — this is a voice-first companion app.
Be curious, gentle, and present. Ask one thoughtful follow-up question when it fits.
Never mention being an AI, a model, or a system. Never break character.
`.trim();

function buildRouter(): IntelligenceRouter | null {
  const apiKey = import.meta.env.VITE_OPENROUTER_KEY as string | undefined;
  if (!apiKey) return null;

  const registry = new AdapterRegistry();
  registry.register("openrouter", "openai/gpt-4o", new OpenRouterAdapter(apiKey));
  return new IntelligenceRouter(DEFAULT_WILSON_POLICY, registry);
}

export default function App() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [displayName] = useState("Jenny");
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  useEffect(() => {
    if (scrollRef.current) {
      setTimeout(() => {
        scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
      }, 80);
    }
  }, [messages, loading]);

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
    setMessages((prev) => [...prev, userMsg]);
    setLoading(true);

    try {
      const router = buildRouter();

      let reply: string;

      if (!router) {
        reply = "Wilson's brain isn't connected yet — add your OpenRouter key to .env.local as VITE_OPENROUTER_KEY and restart.";
      } else {
        const conversation = messages.map((m) => ({
          role: m.role,
          content: m.content,
        }));

        const request: ModelRequest = {
          userInput: userMessage,
          conversation,
          systemContext: WILSON_SYSTEM_CONTEXT,
          generation: { temperature: 0.8, maxTokens: 300 },
        };

        const response = await router.generate(request);
        reply = response.text?.trim() || "I'm here with you.";
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
      setMessages((prev) => [
        ...prev,
        {
          id: `ai-err-${Date.now()}`,
          role: "assistant",
          content: `Wilson stumbled: ${message}`,
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
      {/* Atmospheric field */}
      <div className="fixed inset-0 -z-10 pointer-events-none">
        <div className="absolute inset-0 bg-gradient-to-b from-[#f8f0ff] via-[#f3e8ff] to-[#e8f4ff]" />
        <div className="absolute top-[-10%] left-1/2 -translate-x-1/2 w-[140%] h-[70%] rounded-full bg-[radial-gradient(ellipse_at_center,rgba(196,181,253,0.35),transparent_70%)] blur-3xl" />
        <div className="absolute bottom-[-20%] right-[-10%] w-[80%] h-[60%] rounded-full bg-[radial-gradient(ellipse_at_center,rgba(165,243,252,0.25),transparent_70%)] blur-3xl" />
        <div className="absolute top-[30%] left-[-15%] w-[50%] h-[40%] rounded-full bg-[radial-gradient(ellipse_at_center,rgba(249,168,212,0.2),transparent_70%)] blur-3xl" />
        <div className="absolute bottom-[10%] left-[20%] w-[40%] h-[30%] rounded-full bg-[radial-gradient(ellipse_at_center,rgba(167,243,208,0.15),transparent_70%)] blur-3xl" />
        <div className="absolute top-[15%] right-[5%] w-[35%] h-[25%] rounded-full bg-[radial-gradient(ellipse_at_center,rgba(253,224,71,0.12),transparent_70%)] blur-3xl" />
        <div className="wilson-field-particles" />
      </div>

      {/* Header */}
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
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full glass">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-[11px] font-medium text-violet-800/70">Always with you</span>
          </div>
        </div>
      </header>

      {/* Content */}
      <div className="flex-1 overflow-hidden flex flex-col relative z-10">
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4">
          {isHome ? (
            <div className="h-full flex flex-col items-center justify-center pb-6 max-w-md mx-auto">
              {/* Authentic living Orb */}
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

              {/* Greeting */}
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

              {/* Invitation */}
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.25 }}
                className="w-full"
              >
                <button
                  onClick={() => inputRef.current?.focus()}
                  className="w-full flex items-center gap-3 rounded-2xl px-4 py-3.5 glass text-left transition-all hover:bg-white/70"
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
                    className={`flex gap-3 ${msg.role === "user" ? "justify-end" : "items-start"}`}
                  >
                    {msg.role === "assistant" && <WilsonOrb size="sm" />}
                    <div
                      className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${msg.role === "assistant" ? "msg-wilson" : "msg-user"}`}
                    >
                      {msg.role === "assistant" && (
                        <span className="block text-[11px] font-bold uppercase tracking-[0.2em] text-violet-500 mb-1">
                          Wilson
                        </span>
                      )}
                      <p className="text-violet-950/90">{msg.content}</p>
                      <span className="block text-[10px] text-violet-400/60 mt-2">
                        {msg.timestamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
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
                    <span className="text-sm text-violet-700/60">Wilson is thinking...</span>
                  </div>
                </motion.div>
              )}
            </div>
          )}
        </div>

        {/* Input */}
        <div className="relative z-20 px-4 pb-5 pt-2">
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
                className="flex-1 bg-transparent px-3 py-2.5 text-[14px] text-violet-950 placeholder-violet-400/50 outline-none disabled:opacity-50"
              />
              <button
                type="button"
                className="p-2 rounded-full text-violet-400/70 hover:text-violet-500 hover:bg-violet-50/80 transition-colors"
                aria-label="Voice"
              >
                <Mic className="w-[18px] h-[18px]" />
              </button>
              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={() => sendMessage()}
                disabled={loading || !input.trim()}
                className="rounded-full p-2.5 bg-gradient-to-br from-violet-400 via-fuchsia-400 to-cyan-400 text-white shadow-md disabled:opacity-40 disabled:cursor-not-allowed"
                aria-label="Send"
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              </motion.button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
