import { useMemo, useState } from "react";
import {
  calculateCipher,
  CIPHERS,
  findPhraseMatches,
  type CipherId,
  type PhraseEntry,
} from "../gematria/gematria";

const STORAGE_KEY = "wilson_gematria_phrase_library_v1";
const STARTER_PHRASES: PhraseEntry[] = [
  { id: "starter-hello", phrase: "HELLO", category: "Starter", source: "Built-in example" },
  { id: "starter-well", phrase: "WELL", category: "Starter", source: "Built-in example" },
  { id: "starter-love", phrase: "LOVE", category: "Starter", source: "Built-in example" },
  { id: "starter-wilson", phrase: "WILSON", category: "Starter", source: "Built-in example" },
  { id: "starter-the-only-one", phrase: "THE ONLY ONE", category: "Starter", source: "Built-in example" },
  { id: "starter-imagination", phrase: "IMAGINATION", category: "Starter", source: "Built-in example" },
  { id: "starter-intelligence", phrase: "INTELLIGENCE", category: "Starter", source: "Built-in example" },
];

function loadPhraseLibrary(): PhraseEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return STARTER_PHRASES;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return STARTER_PHRASES;
    const valid = parsed.filter((item): item is PhraseEntry =>
      Boolean(item && typeof item.id === "string" && typeof item.phrase === "string"),
    );
    return [...STARTER_PHRASES, ...valid.filter((item) => !item.id.startsWith("starter-"))];
  } catch {
    return STARTER_PHRASES;
  }
}

export default function GematriaObservatory({ onClose }: { onClose: () => void }) {
  const [phrase, setPhrase] = useState("HELLO");
  const [cipherId, setCipherId] = useState<CipherId>("english-ordinal");
  const [library, setLibrary] = useState<PhraseEntry[]>(loadPhraseLibrary);
  const [newPhrase, setNewPhrase] = useState("");
  const [search, setSearch] = useState("");
  const result = useMemo(() => calculateCipher(phrase, cipherId), [phrase, cipherId]);
  const matches = useMemo(
    () => findPhraseMatches(phrase, library, cipherId, { excludeExactText: true }),
    [phrase, library, cipherId],
  );
  const filteredLibrary = useMemo(
    () => library.filter((item) => item.phrase.toLocaleLowerCase().includes(search.toLocaleLowerCase())),
    [library, search],
  );

  function addPhrase() {
    const clean = newPhrase.trim().replace(/\s+/g, " ");
    if (!clean) return;
    const key = clean.toLocaleUpperCase();
    if (library.some((item) => item.phrase.toLocaleUpperCase() === key)) {
      setNewPhrase("");
      return;
    }
    const entry: PhraseEntry = {
      id: `user-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      phrase: clean,
      category: "My phrases",
      source: "Added on this device",
    };
    const next = [...library, entry];
    setLibrary(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next.filter((item) => !item.id.startsWith("starter-"))));
    } catch { /* Keep the current session usable when storage is unavailable. */ }
    setNewPhrase("");
  }

  function removePhrase(id: string) {
    if (id.startsWith("starter-")) return;
    const next = library.filter((item) => item.id !== id);
    setLibrary(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next.filter((item) => !item.id.startsWith("starter-"))));
    } catch { /* Keep the current session usable when storage is unavailable. */ }
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center overflow-hidden p-0 sm:p-5" style={{ background: "radial-gradient(ellipse at 18% 12%, rgba(244,114,182,.24), transparent 35%), radial-gradient(ellipse at 82% 18%, rgba(34,211,238,.22), transparent 34%), radial-gradient(ellipse at 48% 92%, rgba(167,139,250,.28), transparent 42%), linear-gradient(145deg,#090b22 0%,#171336 48%,#081a2d 100%)" }} role="dialog" aria-modal="true" aria-label="Wilson Gematria Observatory">
      <section className="relative mx-auto my-0 flex max-h-[100dvh] min-h-0 w-full max-w-5xl flex-col overflow-y-auto overscroll-contain rounded-none border border-white/50 text-slate-950 shadow-[0_0_0_1px_rgba(255,255,255,.25),0_0_38px_rgba(103,232,249,.22),0_0_90px_rgba(217,70,239,.18)] sm:max-h-[calc(100dvh-2.5rem)] sm:rounded-[2rem]" style={{ background: "linear-gradient(135deg,rgba(255,255,255,.94),rgba(238,231,255,.92) 28%,rgba(222,248,255,.92) 58%,rgba(255,235,246,.94))" }}>
        <header className="sticky top-0 z-20 relative overflow-hidden border-b border-white/80 px-4 pb-4 pt-[max(1.25rem,env(safe-area-inset-top))] sm:px-8 sm:py-6" style={{ background: "linear-gradient(110deg,rgba(255,255,255,.88),rgba(220,248,255,.82),rgba(255,226,245,.84),rgba(238,228,255,.88))", boxShadow: "0 8px 30px rgba(139,92,246,.12)" }}>
          <div className="pointer-events-none absolute inset-0 opacity-60" style={{ backgroundImage: "radial-gradient(circle at 8% 22%,#fff 0 1px,transparent 2px),radial-gradient(circle at 78% 18%,#fff 0 1px,transparent 2px),radial-gradient(circle at 92% 72%,rgba(168,85,247,.8) 0 1px,transparent 3px),radial-gradient(circle at 35% 82%,rgba(34,211,238,.8) 0 1px,transparent 3px)" }} />
          <div className="relative flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-bold uppercase tracking-[.22em] text-violet-950">Wilson · Discovery Lab</p>
              <h1 className="mt-1 text-[2rem] font-light tracking-tight text-slate-950 sm:text-4xl">Gematria Observatory</h1>
              <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-800 sm:text-base">Explore letter values, compare ciphers, and find phrases that share a number. Every match is calculated from the library shown here.</p>
            </div>
            <button type="button" onClick={onClose} className="shrink-0 rounded-full border border-violet-200 bg-white/80 px-4 py-2 text-sm font-medium text-violet-950 shadow-[0_2px_14px_rgba(139,92,246,.16)] backdrop-blur-xl hover:bg-white" aria-label="Close Observatory">Close</button>
          </div>
        </header>

        <div className="grid min-h-0 gap-5 p-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:p-7">
          <div className="grid gap-3 sm:grid-cols-[1fr_1fr]">
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-slate-900">Phrase or name</span>
              <input value={phrase} onChange={(event) => setPhrase(event.target.value)} className="w-full rounded-2xl border border-violet-300 bg-white/90 px-4 py-3 text-base font-medium text-slate-950 caret-violet-700 shadow-[inset_0_1px_8px_rgba(139,92,246,.08)] outline-none placeholder:text-slate-500 focus:border-cyan-600 focus:ring-2 focus:ring-cyan-200" placeholder="Type a word or phrase" />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-slate-900">Cipher</span>
              <select value={cipherId} onChange={(event) => setCipherId(event.target.value as CipherId)} className="w-full rounded-2xl border border-violet-300 bg-white/90 px-4 py-3 text-base font-medium text-slate-950 shadow-[inset_0_1px_8px_rgba(139,92,246,.08)] outline-none focus:border-cyan-600 focus:ring-2 focus:ring-cyan-200">
                {CIPHERS.map((cipher) => <option key={cipher.id} value={cipher.id}>{cipher.label}</option>)}
              </select>
            </label>
          </div>

          <div className="relative overflow-hidden rounded-3xl border border-white/90 bg-gradient-to-br from-white/90 via-cyan-50/90 to-fuchsia-50/90 p-5 shadow-[0_8px_32px_rgba(139,92,246,.16),inset_0_1px_0_white]">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <p className="text-sm font-semibold uppercase tracking-[.14em] text-slate-800">{result.label}</p>
                <p className="mt-1 text-6xl font-semibold tracking-tight tabular-nums text-slate-950">{result.total ?? "—"}</p>
              </div>
              <p className="max-w-xs text-right text-xs leading-relaxed text-slate-900">{CIPHERS.find((cipher) => cipher.id === cipherId)?.description}</p>
            </div>
            {result.total !== null && (
              <div className="mt-4 flex flex-wrap gap-1.5" aria-label="Letter values">
                {result.letters.map((letter, index) => (
                  <span key={`${index}-${letter.character}`} className="inline-flex min-w-10 flex-col items-center rounded-xl border border-slate-300 bg-white px-2 py-1.5">
                    <span className="text-sm text-violet-950">{letter.character}</span>
                    <span className="text-xs font-medium tabular-nums text-slate-800">{letter.value}</span>
                  </span>
                ))}
              </div>
            )}
            {result.total === null && <p className="mt-3 text-sm text-slate-700">No letters from this cipher were found in the phrase.</p>}
          </div>

          <section>
            <div className="mb-3 flex items-end justify-between gap-3">
              <div>
                <h2 className="text-lg font-medium">Matching phrases</h2>
                <p className="text-sm text-slate-800">Exact same total · {matches.length} found in your current library</p>
              </div>
            </div>
            {matches.length ? (
              <div className="grid gap-2 sm:grid-cols-2">
                {matches.map((match) => (
                  <button key={match.id} type="button" onClick={() => setPhrase(match.phrase)} className="flex items-center justify-between gap-3 rounded-2xl border border-slate-300 bg-white px-4 py-4 text-left transition hover:border-violet-300 hover:bg-white">
                    <span><span className="block text-sm font-medium">{match.phrase}</span><span className="block text-sm text-slate-700">{match.source ?? match.category ?? "Phrase library"}</span></span>
                    <span className="rounded-full bg-[#dff7f5] px-3 py-1 text-sm tabular-nums text-slate-900">{match.total}</span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-4 py-5 text-sm text-slate-900">No exact matches yet. Add phrases below to grow your searchable library; Wilson will only report matches that calculate to the same total.</div>
            )}
          </section>

          <section className="rounded-3xl border border-white/90 bg-gradient-to-br from-white/85 via-violet-50/90 to-cyan-50/85 p-4 shadow-[0_8px_32px_rgba(139,92,246,.14),inset_0_1px_0_white] sm:p-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div><h2 className="text-lg font-medium">Your phrase library</h2><p className="text-sm text-slate-800">Saved locally in this browser. No external API required.</p></div>
              <span className="rounded-full bg-[#dff7f5] px-3 py-1 text-sm text-slate-800">{library.length} phrases</span>
            </div>
            <form className="mt-4 flex gap-2" onSubmit={(event) => { event.preventDefault(); addPhrase(); }}>
              <input value={newPhrase} onChange={(event) => setNewPhrase(event.target.value)} className="min-w-0 flex-1 rounded-xl border border-violet-300 bg-white/95 px-3 py-2.5 text-sm font-medium text-slate-950 outline-none placeholder:text-slate-500 focus:border-violet-500" placeholder="Add a word or phrase…" aria-label="New phrase" />
              <button type="submit" disabled={!newPhrase.trim()} className="rounded-xl bg-gradient-to-r from-violet-600 to-fuchsia-500 px-4 py-2 text-sm font-medium text-white disabled:opacity-40">Add phrase</button>
            </form>
            <input value={search} onChange={(event) => setSearch(event.target.value)} className="mt-3 w-full rounded-xl border border-violet-300 bg-white/95 px-3 py-2 text-sm font-medium text-slate-950 outline-none placeholder:text-slate-500 focus:border-violet-500" placeholder="Search saved phrases…" aria-label="Search phrase library" />
            <div className="mt-3 max-h-72 space-y-1 overflow-y-auto rounded-xl border border-violet-200 bg-white/90 p-2 sm:max-h-[28rem]">
              {filteredLibrary.map((item) => (
                <div key={item.id} className="flex items-center justify-between gap-3 rounded-xl px-3 py-2 hover:bg-white/70">
                  <button type="button" onClick={() => setPhrase(item.phrase)} className="min-w-0 flex-1 truncate text-left text-sm">{item.phrase}</button>
                  <span className="shrink-0 text-[10px] text-slate-700">{calculateCipher(item.phrase, cipherId).total ?? "—"}</span>
                  {!item.id.startsWith("starter-") && <button type="button" onClick={() => removePhrase(item.id)} className="shrink-0 px-1 text-xs text-rose-500" aria-label={`Remove ${item.phrase}`}>Remove</button>}
                </div>
              ))}
              {!filteredLibrary.length && <p className="px-3 py-4 text-sm text-slate-700">No phrases match that search.</p>}
            </div>
          </section>
          <p className="text-sm leading-relaxed text-slate-800">Calculation note: English and Hebrew ciphers are kept separate. Hebrew “final-letter large values” is explicitly labeled; it is not the same as standard Hebrew values. The built-in phrase set is only a starter library, not an exhaustive internet-wide search.</p>
        </div>
      </section>
    </div>
  );
}
