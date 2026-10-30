import { useMemo, useState, type FormEvent } from "react";
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
  const [phraseDraft, setPhraseDraft] = useState("HELLO");
  const [cipherId, setCipherId] = useState<CipherId>("english-ordinal");
  const [library, setLibrary] = useState<PhraseEntry[]>(loadPhraseLibrary);
  const [newPhrase, setNewPhrase] = useState("");
  const [search, setSearch] = useState("");
  const [calculated, setCalculated] = useState(false);

  const result = useMemo(() => calculateCipher(phrase, cipherId), [phrase, cipherId]);
  const matches = useMemo(
    () => findPhraseMatches(phrase, library, cipherId, { excludeExactText: true }),
    [phrase, library, cipherId],
  );
  const filteredLibrary = useMemo(
    () => library.filter((item) => item.phrase.toLocaleLowerCase().includes(search.toLocaleLowerCase())),
    [library, search],
  );

  function calculatePhrase(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    const clean = phraseDraft.trim().replace(/\s+/g, " ");
    if (!clean) return;
    setPhraseDraft(clean);
    setPhrase(clean);
    setCalculated(true);
  }

  function choosePhrase(value: string) {
    setPhraseDraft(value);
    setPhrase(value);
    setCalculated(true);
  }

  function addPhrase() {
    const clean = newPhrase.trim().replace(/\s+/g, " ");
    if (!clean) return;
    const key = clean.toLocaleUpperCase();
    if (library.some((item) => item.phrase.toLocaleUpperCase() === key)) {
      setNewPhrase("");
      return;
    }
    const entry: PhraseEntry = {
      id: "user-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 7),
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
    <div
      className="fixed inset-0 z-[80] flex items-stretch justify-center overflow-hidden p-0 sm:items-center sm:p-4"
      style={{ background: "radial-gradient(ellipse at 18% 10%,rgba(255,184,213,.34),transparent 34%),radial-gradient(ellipse at 82% 18%,rgba(117,225,255,.26),transparent 36%),radial-gradient(ellipse at 50% 100%,rgba(183,153,255,.34),transparent 48%),linear-gradient(150deg,#17152f 0%,#292044 48%,#102b42 100%)" }}
      role="dialog"
      aria-modal="true"
      aria-label="Wilson Gematria Observatory"
    >
      <section className="relative isolate mx-auto flex h-[100dvh] min-h-0 w-full max-w-6xl flex-col overflow-hidden border border-white/40 bg-[#f7f2ff]/95 text-violet-950 shadow-[0_0_0_1px_rgba(255,255,255,.2),0_0_50px_rgba(103,232,249,.2),0_0_100px_rgba(217,70,239,.16)] backdrop-blur-2xl sm:h-[min(94dvh,900px)] sm:rounded-[2rem]">
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 opacity-80" style={{ background: "radial-gradient(ellipse at 15% 0%,rgba(255,190,218,.42),transparent 38%),radial-gradient(ellipse at 100% 25%,rgba(111,232,255,.28),transparent 38%),radial-gradient(ellipse at 45% 100%,rgba(182,156,255,.28),transparent 42%)" }} />
        <div aria-hidden="true" className="pointer-events-none absolute right-[8%] top-[18%] h-44 w-32 rotate-6 rounded-[1.6rem] border border-white/50 bg-gradient-to-br from-white/25 via-cyan-200/10 to-fuchsia-200/20 shadow-[0_0_35px_rgba(103,232,249,.18)] sm:right-[12%] sm:top-[15%]" />
        <header className="relative z-10 flex shrink-0 items-start justify-between gap-4 border-b border-white/70 bg-white/45 px-4 pb-4 pt-[max(1rem,env(safe-area-inset-top))] backdrop-blur-2xl sm:px-8 sm:py-6">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[.25em] text-violet-700">Wilson · Discovery Lab</p>
            <h1 className="mt-1 text-[1.65rem] font-light tracking-tight text-violet-950 sm:text-3xl">Gematria Observatory</h1>
            <p className="mt-1.5 max-w-2xl text-xs leading-relaxed text-violet-900/75 sm:text-sm">A quiet space to explore letter values, compare ciphers, and discover phrases that share a number.</p>
          </div>
          <button type="button" onClick={onClose} className="shrink-0 rounded-full border border-white/90 bg-white/75 px-4 py-2 text-xs font-medium text-violet-900 shadow-sm backdrop-blur-xl transition hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500" aria-label="Close Observatory">Close</button>
        </header>

        <div className="relative z-10 min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:px-8 sm:py-6">
          <div className="mx-auto grid w-full max-w-5xl gap-5 lg:grid-cols-[minmax(0,1.15fr)_minmax(18rem,.85fr)]">
            <div className="min-w-0 space-y-5">
              <section className="relative overflow-hidden rounded-[1.8rem] border border-white/80 bg-gradient-to-br from-white/75 via-violet-100/65 to-cyan-100/65 p-4 shadow-[0_12px_38px_rgba(87,63,153,.12),inset_0_1px_0_white] sm:p-6">
                <div aria-hidden="true" className="pointer-events-none absolute -right-12 -top-16 h-52 w-52 rounded-full bg-gradient-to-br from-fuchsia-200/60 via-violet-200/50 to-cyan-200/60 blur-3xl" />
                <div className="relative">
                  <div className="mb-4 flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_12px_rgba(52,211,153,.9)]" />
                    <p className="text-[10px] font-semibold uppercase tracking-[.22em] text-violet-700">Phrase scanner · Ready</p>
                  </div>
                  <form onSubmit={calculatePhrase} className="space-y-3">
                    <label className="block">
                      <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-violet-900">Enter a word or phrase</span>
                      <input
                        value={phraseDraft}
                        onChange={(event) => { setPhraseDraft(event.target.value); setCalculated(false); }}
                        onKeyDown={(event) => { if (event.key === "Escape") { setPhraseDraft(phrase); setCalculated(false); } }}
                        className="w-full rounded-2xl border border-violet-300/90 bg-white/90 px-4 py-3.5 text-base font-medium text-violet-950 caret-violet-700 shadow-[inset_0_1px_8px_rgba(139,92,246,.08)] outline-none placeholder:text-violet-400 focus:border-cyan-500 focus:ring-2 focus:ring-cyan-200"
                        placeholder="Type a word or phrase"
                        aria-label="Phrase or name to calculate"
                        autoComplete="off"
                        enterKeyHint="go"
                      />
                    </label>
                    <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
                      <label className="block min-w-0">
                        <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-violet-900">Cipher system</span>
                        <select value={cipherId} onChange={(event) => setCipherId(event.target.value as CipherId)} className="w-full rounded-2xl border border-violet-300/90 bg-white/90 px-4 py-3 text-sm font-medium text-violet-950 outline-none focus:border-cyan-500 focus:ring-2 focus:ring-cyan-200">
                          {CIPHERS.map((cipher) => <option key={cipher.id} value={cipher.id}>{cipher.label}</option>)}
                        </select>
                      </label>
                      <button type="submit" disabled={!phraseDraft.trim()} className="mt-auto inline-flex min-h-[48px] items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-violet-600 via-fuchsia-500 to-cyan-500 px-5 py-3 text-sm font-semibold text-white shadow-[0_8px_24px_rgba(139,92,246,.3)] transition hover:brightness-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-45">
                        <span aria-hidden="true">✧</span> Calculate
                      </button>
                    </div>
                    <p className="min-h-4 text-[11px] text-violet-800/70" aria-live="polite">{calculated ? "Calculation updated for “" + phrase + "”." : "Press Enter or tap Calculate to run the phrase."}</p>
                  </form>
                </div>
              </section>

              <section className="relative overflow-hidden rounded-[1.8rem] border border-white/85 bg-gradient-to-br from-white/90 via-cyan-50/85 to-fuchsia-50/80 p-5 shadow-[0_12px_34px_rgba(87,63,153,.12),inset_0_1px_0_white] sm:p-6" aria-live="polite">
                <div className="flex flex-wrap items-end justify-between gap-3">
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-[.2em] text-violet-700">{result.label}</p>
                    <p className="mt-1 text-6xl font-light tracking-tight tabular-nums text-violet-950">{result.total ?? "—"}</p>
                    <p className="mt-1 text-xs text-violet-800/70">{result.matchedCharacters} letters recognized</p>
                  </div>
                  <p className="max-w-[13rem] text-right text-xs leading-relaxed text-violet-900/80">{CIPHERS.find((cipher) => cipher.id === cipherId)?.description}</p>
                </div>
                {result.total !== null ? (
                  <div className="mt-5 flex flex-wrap gap-1.5" aria-label="Letter values">
                    {result.letters.map((letter, index) => (
                      <span key={index + "-" + letter.character} className="inline-flex min-w-10 flex-col items-center rounded-xl border border-white bg-white/85 px-2 py-1.5 shadow-sm">
                        <span className="text-sm text-violet-950">{letter.character}</span>
                        <span className="text-xs font-medium tabular-nums text-violet-800">{letter.value}</span>
                      </span>
                    ))}
                  </div>
                ) : <p className="mt-3 text-sm text-violet-800">No letters from this cipher were found in the phrase.</p>}
              </section>

              <section>
                <div className="mb-3 flex items-end justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-medium text-violet-950">Matching phrases</h2>
                    <p className="text-xs text-violet-800/75">Exact same total · {matches.length} found in your current library</p>
                  </div>
                  <span className="rounded-full border border-white bg-white/65 px-3 py-1 text-[10px] font-medium text-violet-800">LOCAL LIBRARY</span>
                </div>
                {matches.length ? (
                  <div className="grid gap-2 sm:grid-cols-2">
                    {matches.map((match) => (
                      <button key={match.id} type="button" onClick={() => choosePhrase(match.phrase)} className="flex items-center justify-between gap-3 rounded-2xl border border-white/90 bg-white/70 px-4 py-3 text-left shadow-sm transition hover:border-cyan-300 hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500">
                        <span className="min-w-0"><span className="block truncate text-sm font-medium text-violet-950">{match.phrase}</span><span className="block text-[11px] text-violet-800/70">{match.source ?? match.category ?? "Phrase library"}</span></span>
                        <span className="rounded-full bg-gradient-to-r from-violet-100 to-cyan-100 px-3 py-1 text-sm tabular-nums text-violet-950">{match.total}</span>
                      </button>
                    ))}
                  </div>
                ) : <div className="rounded-2xl border border-dashed border-violet-300/80 bg-white/45 px-4 py-5 text-sm text-violet-900/80">No exact matches yet. Add phrases below to grow your searchable library. Only equal calculated totals appear here.</div>}
              </section>
            </div>

            <aside className="min-w-0">
              <section className="h-full rounded-[1.8rem] border border-white/85 bg-gradient-to-br from-white/75 via-violet-100/65 to-cyan-100/60 p-4 shadow-[0_12px_38px_rgba(87,63,153,.12),inset_0_1px_0_white] sm:p-5">
                <div className="flex items-start justify-between gap-3">
                  <div><h2 className="text-lg font-medium text-violet-950">Your phrase library</h2><p className="mt-1 text-xs leading-relaxed text-violet-800/75">Saved on this device. No external API required.</p></div>
                  <span className="shrink-0 rounded-full border border-white bg-white/70 px-3 py-1 text-xs text-violet-900">{library.length}</span>
                </div>
                <form className="mt-4 flex gap-2" onSubmit={(event) => { event.preventDefault(); addPhrase(); }}>
                  <input value={newPhrase} onChange={(event) => setNewPhrase(event.target.value)} className="min-w-0 flex-1 rounded-xl border border-violet-300 bg-white/90 px-3 py-2.5 text-sm text-violet-950 outline-none placeholder:text-violet-400 focus:border-cyan-500 focus:ring-2 focus:ring-cyan-100" placeholder="Add a word or phrase…" aria-label="New phrase" />
                  <button type="submit" disabled={!newPhrase.trim()} className="shrink-0 rounded-xl bg-gradient-to-r from-violet-600 to-fuchsia-500 px-3 py-2.5 text-xs font-semibold text-white shadow-sm disabled:opacity-40">Add</button>
                </form>
                <label className="mt-3 block">
                  <span className="sr-only">Search saved phrases</span>
                  <input value={search} onChange={(event) => setSearch(event.target.value)} className="w-full rounded-xl border border-violet-300/80 bg-white/80 px-3 py-2.5 text-sm text-violet-950 outline-none placeholder:text-violet-400 focus:border-cyan-500" placeholder="Search saved phrases…" />
                </label>
                <div className="mt-3 max-h-[min(42dvh,28rem)] space-y-1 overflow-y-auto overscroll-contain rounded-xl border border-white/80 bg-white/55 p-2 lg:max-h-[55dvh]">
                  {filteredLibrary.map((item) => (
                    <div key={item.id} className="flex items-center justify-between gap-2 rounded-xl px-2 py-2 hover:bg-white/80">
                      <button type="button" onClick={() => choosePhrase(item.phrase)} className="min-w-0 flex-1 truncate text-left text-sm text-violet-950">{item.phrase}</button>
                      <span className="shrink-0 text-[10px] tabular-nums text-violet-800/80">{calculateCipher(item.phrase, cipherId).total ?? "—"}</span>
                      {!item.id.startsWith("starter-") && <button type="button" onClick={() => removePhrase(item.id)} className="shrink-0 rounded-lg px-2 py-1 text-[10px] text-rose-700 hover:bg-rose-50" aria-label={"Remove " + item.phrase}>Remove</button>}
                    </div>
                  ))}
                  {!filteredLibrary.length && <p className="px-3 py-4 text-sm text-violet-800/75">No phrases match that search.</p>}
                </div>
                <p className="mt-4 text-[11px] leading-relaxed text-violet-800/75">Calculation note: English and Hebrew ciphers are kept separate. Hebrew final-letter large values are explicitly labeled. The built-in phrases are a starter library, not an exhaustive internet-wide search.</p>
              </section>
            </aside>
          </div>
        </div>
      </section>
    </div>
  );
}
