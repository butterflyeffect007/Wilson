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
    () => findPhraseMatches(phrase, library, cipherId, { limit: 100, excludeExactText: true }),
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
    <div className="fixed inset-0 z-[80] overflow-y-auto bg-[#100d20]/80 backdrop-blur-xl p-3 sm:p-6" role="dialog" aria-modal="true" aria-label="Wilson Gematria Observatory">
      <section className="mx-auto my-2 w-full max-w-3xl overflow-hidden rounded-[2rem] border border-white/20 bg-gradient-to-br from-[#fbf7ff] via-[#f5f2ff] to-[#eafcff] shadow-[0_25px_100px_rgba(10,5,35,.55)] text-violet-950">
        <header className="relative overflow-hidden border-b border-violet-200/60 px-5 py-5 sm:px-7">
          <div className="pointer-events-none absolute -right-12 -top-24 h-56 w-56 rounded-full bg-gradient-to-br from-fuchsia-300/70 via-violet-300/50 to-cyan-200/80 blur-3xl" />
          <div className="relative flex items-start justify-between gap-4">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[.24em] text-violet-500">Wilson · Discovery Lab</p>
              <h1 className="mt-1 text-2xl font-light tracking-tight sm:text-3xl">Gematria Observatory</h1>
              <p className="mt-2 max-w-xl text-sm leading-relaxed text-violet-800/70">Explore letter values, compare ciphers, and find phrases that share a number. Every match is calculated from the library shown here.</p>
            </div>
            <button type="button" onClick={onClose} className="rounded-full border border-violet-200 bg-white/70 px-3 py-2 text-sm text-violet-800 hover:bg-white" aria-label="Close Observatory">Close</button>
          </div>
        </header>

        <div className="grid gap-5 p-5 sm:p-7">
          <div className="grid gap-3 sm:grid-cols-[1fr_1fr]">
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-violet-600">Phrase or name</span>
              <input value={phrase} onChange={(event) => setPhrase(event.target.value)} className="w-full rounded-2xl border border-violet-200 bg-white/80 px-4 py-3 text-base outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-200" placeholder="Type a word or phrase" autoFocus />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-violet-600">Cipher</span>
              <select value={cipherId} onChange={(event) => setCipherId(event.target.value as CipherId)} className="w-full rounded-2xl border border-violet-200 bg-white/80 px-4 py-3 text-base outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-200">
                {CIPHERS.map((cipher) => <option key={cipher.id} value={cipher.id}>{cipher.label}</option>)}
              </select>
            </label>
          </div>

          <div className="rounded-3xl border border-white bg-gradient-to-br from-white/90 via-white/65 to-cyan-50/80 p-5 shadow-sm">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[.18em] text-violet-500">{result.label}</p>
                <p className="mt-1 text-5xl font-light tracking-tight tabular-nums">{result.total ?? "—"}</p>
              </div>
              <p className="max-w-xs text-right text-xs leading-relaxed text-violet-700/65">{CIPHERS.find((cipher) => cipher.id === cipherId)?.description}</p>
            </div>
            {result.total !== null && (
              <div className="mt-4 flex flex-wrap gap-1.5" aria-label="Letter values">
                {result.letters.map((letter, index) => (
                  <span key={`${index}-${letter.character}`} className="inline-flex min-w-10 flex-col items-center rounded-xl border border-violet-200/80 bg-white/80 px-2 py-1.5">
                    <span className="text-sm text-violet-950">{letter.character}</span>
                    <span className="text-[10px] tabular-nums text-violet-500">{letter.value}</span>
                  </span>
                ))}
              </div>
            )}
            {result.total === null && <p className="mt-3 text-sm text-violet-600/70">No letters from this cipher were found in the phrase.</p>}
          </div>

          <section>
            <div className="mb-3 flex items-end justify-between gap-3">
              <div>
                <h2 className="text-lg font-medium">Matching phrases</h2>
                <p className="text-xs text-violet-700/60">Exact same total · {matches.length} found in your current library</p>
              </div>
            </div>
            {matches.length ? (
              <div className="grid gap-2 sm:grid-cols-2">
                {matches.map((match) => (
                  <button key={match.id} type="button" onClick={() => setPhrase(match.phrase)} className="flex items-center justify-between gap-3 rounded-2xl border border-violet-200/70 bg-white/65 px-4 py-3 text-left transition hover:border-violet-300 hover:bg-white">
                    <span><span className="block text-sm font-medium">{match.phrase}</span><span className="block text-[11px] text-violet-600/60">{match.source ?? match.category ?? "Phrase library"}</span></span>
                    <span className="rounded-full bg-violet-100 px-3 py-1 text-sm tabular-nums text-violet-800">{match.total}</span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed border-violet-200 bg-white/45 px-4 py-5 text-sm text-violet-700/70">No exact matches yet. Add phrases below to grow your searchable library; Wilson will only report matches that calculate to the same total.</div>
            )}
          </section>

          <section className="rounded-3xl border border-violet-200/70 bg-white/45 p-4 sm:p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div><h2 className="text-lg font-medium">Your phrase library</h2><p className="text-xs text-violet-700/60">Saved locally in this browser. No external API required.</p></div>
              <span className="rounded-full bg-violet-100 px-3 py-1 text-xs text-violet-700">{library.length} phrases</span>
            </div>
            <form className="mt-4 flex gap-2" onSubmit={(event) => { event.preventDefault(); addPhrase(); }}>
              <input value={newPhrase} onChange={(event) => setNewPhrase(event.target.value)} className="min-w-0 flex-1 rounded-xl border border-violet-200 bg-white/80 px-3 py-2.5 text-sm outline-none focus:border-violet-400" placeholder="Add a word or phrase…" aria-label="New phrase" />
              <button type="submit" disabled={!newPhrase.trim()} className="rounded-xl bg-gradient-to-r from-violet-600 to-fuchsia-500 px-4 py-2 text-sm font-medium text-white disabled:opacity-40">Add phrase</button>
            </form>
            <input value={search} onChange={(event) => setSearch(event.target.value)} className="mt-3 w-full rounded-xl border border-violet-200/70 bg-white/70 px-3 py-2 text-sm outline-none focus:border-violet-400" placeholder="Search saved phrases…" aria-label="Search phrase library" />
            <div className="mt-3 max-h-48 space-y-1 overflow-y-auto">
              {filteredLibrary.map((item) => (
                <div key={item.id} className="flex items-center justify-between gap-3 rounded-xl px-3 py-2 hover:bg-white/70">
                  <button type="button" onClick={() => setPhrase(item.phrase)} className="min-w-0 flex-1 truncate text-left text-sm">{item.phrase}</button>
                  <span className="shrink-0 text-[10px] text-violet-500/70">{calculateCipher(item.phrase, cipherId).total ?? "—"}</span>
                  {!item.id.startsWith("starter-") && <button type="button" onClick={() => removePhrase(item.id)} className="shrink-0 px-1 text-xs text-rose-500" aria-label={`Remove ${item.phrase}`}>Remove</button>}
                </div>
              ))}
              {!filteredLibrary.length && <p className="px-3 py-4 text-sm text-violet-600/70">No phrases match that search.</p>}
            </div>
          </section>
          <p className="text-[11px] leading-relaxed text-violet-700/60">Calculation note: English and Hebrew ciphers are kept separate. Hebrew “final-letter large values” is explicitly labeled; it is not the same as standard Hebrew values. The built-in phrase set is only a starter library, not an exhaustive internet-wide search.</p>
        </div>
      </section>
    </div>
  );
}
