import { useMemo, useState, type FormEvent } from "react";
import {
  calculateCipher, CIPHERS, digitalRoot, type CipherId, type PhraseEntry,
} from "../gematria/gematria";
import corpus from "../gematria/foundational-corpus.json";

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
const FOUNDATIONAL: PhraseEntry[] = corpus as PhraseEntry[];

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
  } catch { return STARTER_PHRASES; }
}

function deltaLabel(value: number | null, target: number | null) {
  return value === null || target === null ? "—" : (value - target > 0 ? "+" : "") + String(value - target);
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
  const ordinal = useMemo(() => calculateCipher(phrase, "english-ordinal"), [phrase]);
  const reduction = useMemo(() => calculateCipher(phrase, "english-reduction"), [phrase]);
  const comparison = useMemo(() => FOUNDATIONAL.map((entry) => {
    const ord = calculateCipher(entry.phrase, "english-ordinal").total;
    const red = calculateCipher(entry.phrase, "english-reduction").total;
    const selected = calculateCipher(entry.phrase, cipherId).total;
    const ordDelta = ord === null || ordinal.total === null ? null : ord - ordinal.total;
    const redDelta = red === null || reduction.total === null ? null : red - reduction.total;
    return { ...entry, ordinal: ord, reduction: red, selected, ordDelta, redDelta,
      distance: Math.min(Math.abs(ordDelta ?? Number.MAX_SAFE_INTEGER), Math.abs(redDelta ?? Number.MAX_SAFE_INTEGER)) };
  }).sort((a,b) => a.distance - b.distance || a.phrase.localeCompare(b.phrase)), [phrase, cipherId, ordinal.total, reduction.total]);
  const filteredLibrary = useMemo(
    () => library.filter((item) => item.phrase.toLocaleLowerCase().includes(search.toLocaleLowerCase())),
    [library, search],
  );

  function calculatePhrase(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    const clean = phraseDraft.trim().replace(/\s+/g, " ");
    if (!clean) return;
    setPhraseDraft(clean); setPhrase(clean); setCalculated(true);
  }
  function choosePhrase(value: string) {
    setPhraseDraft(value); setPhrase(value); setCalculated(true);
  }
  function persist(next: PhraseEntry[]) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next.filter((item) => !item.id.startsWith("starter-")))); }
    catch { /* Current session remains usable if storage is unavailable. */ }
  }
  function addPhrase() {
    const clean = newPhrase.trim().replace(/\s+/g, " ");
    if (!clean) return;
    if (library.some((item) => item.phrase.toLocaleUpperCase() === clean.toLocaleUpperCase())) { setNewPhrase(""); return; }
    const entry: PhraseEntry = { id: "user-" + Date.now().toString(36), phrase: clean, category: "My phrases", source: "Added on this device" };
    const next = [...library, entry]; setLibrary(next); persist(next); setNewPhrase("");
  }
  function removePhrase(id: string) {
    if (id.startsWith("starter-")) return;
    const next = library.filter((item) => item.id !== id); setLibrary(next); persist(next);
  }

  return (
    <div className="go-shell fixed inset-0 z-[80] flex items-stretch justify-center overflow-hidden p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label="Wilson Gematria Observatory">
      <section className="go-panel relative mx-auto flex h-[100dvh] min-h-0 w-full max-w-7xl flex-col overflow-hidden sm:h-[min(94dvh,940px)] sm:rounded-xl">
        <header className="go-header flex shrink-0 items-start justify-between gap-4 px-4 py-4 sm:px-7">
          <div className="min-w-0">
            <p className="go-kicker">WILSON / ANALYTICAL SYSTEMS / 01</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">GEMATRIA OBSERVATORY</h1>
            <p className="go-muted mt-1 text-xs sm:text-sm">Phrase intelligence · numerical comparison · local corpus</p>
          </div>
          <button type="button" onClick={onClose} className="go-button shrink-0 px-4 py-2 text-xs" aria-label="Close Observatory">CLOSE ×</button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:px-7 sm:py-6">
          <div className="mx-auto grid max-w-6xl gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(18rem,.8fr)]">
            <main className="min-w-0 space-y-4">
              <section className="go-card p-4 sm:p-5">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <p className="go-kicker">01 / INPUT SCANNER</p><span className="go-status">● LOCAL / READY</span>
                </div>
                <form onSubmit={calculatePhrase} className="space-y-3">
                  <label className="block">
                    <span className="go-label mb-2 block">QUERY PHRASE</span>
                    <textarea rows={2} value={phraseDraft} onChange={(e) => { setPhraseDraft(e.target.value); setCalculated(false); }}
                      className="go-input w-full resize-y px-3 py-3 text-base" placeholder="Enter a word or phrase…" aria-label="Phrase or name to calculate" autoComplete="off" enterKeyHint="enter" />
                  </label>
                  <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
                    <label className="block min-w-0"><span className="go-label mb-2 block">ACTIVE CIPHER</span>
                      <select value={cipherId} onChange={(e) => setCipherId(e.target.value as CipherId)} className="go-input w-full px-3 py-3 text-sm">
                        {CIPHERS.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                      </select>
                    </label>
                    <button type="submit" disabled={!phraseDraft.trim()} className="go-primary mt-auto min-h-11 px-5 py-3 text-xs font-semibold disabled:opacity-40">RUN ANALYSIS ↗</button>
                  </div>
                  <p className="go-muted min-h-4 text-[11px]" aria-live="polite">{calculated ? "Updated analysis: " + phrase : "Return inserts a new line. Use Run Analysis to calculate."}</p>
                </form>
              </section>

              <section className="go-card p-4 sm:p-5" aria-live="polite">
                <div className="flex flex-wrap items-end justify-between gap-4">
                  <div><p className="go-kicker">02 / ACTIVE RESULT · {result.label.toUpperCase()}</p>
                    <p className="go-number mt-1">{result.total ?? "—"}</p>
                    <p className="go-muted text-xs">{result.matchedCharacters} recognized letters · digital root {result.total === null ? "—" : digitalRoot(result.total)}</p>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="go-metric"><span>ORDINAL</span><strong>{ordinal.total ?? "—"}</strong></div>
                    <div className="go-metric"><span>REDUCTION</span><strong>{reduction.total ?? "—"}</strong></div>
                  </div>
                </div>
                {result.total !== null && <div className="mt-4 flex flex-wrap gap-1.5">{result.letters.map((letter, i) =>
                  <span key={i + letter.character} className="go-letter"><b>{letter.character}</b><small>{letter.value}</small></span>)}</div>}
              </section>

              <section className="go-card overflow-hidden">
                <div className="flex flex-wrap items-end justify-between gap-3 border-b border-white/10 px-4 py-4 sm:px-5">
                  <div><p className="go-kicker">03 / CORPUS COMPARISON</p><h2 className="mt-1 text-lg font-semibold">Nearest numerical neighbors</h2>
                    <p className="go-muted mt-1 text-xs">Comparisons are calculated locally against {FOUNDATIONAL.length} preloaded phrases.</p></div>
                  <span className="go-status">LIVE DIFFERENCE METRICS</span>
                </div>
                <div className="overflow-x-auto">
                  <table className="go-table w-full text-left">
                    <thead><tr><th>PHRASE</th><th>ORDINAL</th><th>REDUCTION</th><th>Δ ORD</th><th>Δ RED</th></tr></thead>
                    <tbody>{comparison.map((item) => <tr key={item.id} onClick={() => choosePhrase(item.phrase)} className="cursor-pointer">
                      <td><strong>{item.phrase}</strong><small>{item.category}</small></td>
                      <td>{item.ordinal ?? "—"}</td><td>{item.reduction ?? "—"}</td>
                      <td className={item.ordDelta === 0 ? "go-exact" : ""}>{deltaLabel(item.ordDelta === null ? null : item.ordinal, ordinal.total)}</td>
                      <td className={item.redDelta === 0 ? "go-exact" : ""}>{deltaLabel(item.redDelta === null ? null : item.reduction, reduction.total)}</td>
                    </tr>)}</tbody>
                  </table>
                </div>
                <p className="go-muted px-4 py-3 text-[10px]">Δ = corpus phrase total minus query total. Select a row to load that phrase. The corpus is a curated local reference set, not a live Gematrix.org import.</p>
              </section>
            </main>

            <aside className="min-w-0">
              <section className="go-card p-4 sm:p-5">
                <div className="flex items-start justify-between gap-3"><div><p className="go-kicker">04 / PERSONAL DATASET</p><h2 className="mt-1 text-lg font-semibold">Your phrase library</h2><p className="go-muted mt-1 text-xs">Private to this browser and device.</p></div><span className="go-count">{library.length}</span></div>
                <form className="mt-4 flex gap-2" onSubmit={(e) => { e.preventDefault(); addPhrase(); }}>
                  <input value={newPhrase} onChange={(e) => setNewPhrase(e.target.value)} className="go-input min-w-0 flex-1 px-3 py-2.5 text-sm" placeholder="Add a phrase…" aria-label="New phrase" />
                  <button type="submit" disabled={!newPhrase.trim()} className="go-button px-3 text-xs disabled:opacity-40">ADD +</button>
                </form>
                <label className="mt-3 block"><span className="sr-only">Search saved phrases</span><input value={search} onChange={(e) => setSearch(e.target.value)} className="go-input w-full px-3 py-2.5 text-sm" placeholder="Filter your phrases…" /></label>
                <div className="mt-3 max-h-[min(45dvh,34rem)] space-y-1 overflow-y-auto rounded-lg border border-white/10 p-1">
                  {filteredLibrary.map((item) => <div key={item.id} className="flex items-center gap-2 px-2 py-2 hover:bg-white/5">
                    <button type="button" onClick={() => choosePhrase(item.phrase)} className="min-w-0 flex-1 truncate text-left text-sm">{item.phrase}</button>
                    <span className="go-muted text-xs tabular-nums">{calculateCipher(item.phrase, cipherId).total ?? "—"}</span>
                    {!item.id.startsWith("starter-") && <button type="button" onClick={() => removePhrase(item.id)} className="go-muted px-1 text-[10px]" aria-label={"Remove " + item.phrase}>×</button>}
                  </div>)}
                  {!filteredLibrary.length && <p className="go-muted px-3 py-4 text-xs">No phrases match that filter.</p>}
                </div>
                <p className="go-muted mt-4 text-[10px] leading-relaxed">Built-in reference phrases load immediately. Your additions remain local. English ordinal and full reduction are shown together for every comparison; the active cipher is selectable above.</p>
              </section>
            </aside>
          </div>
        </div>
      </section>
    </div>
  );
}
