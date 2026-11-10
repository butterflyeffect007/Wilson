import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import scene from "../assets/observatory/cloud-reference-scene.webp";
import "./GematriaObservatory.css";
import { calculateCipher, CIPHERS, findPhraseMatches, type CipherId, type PhraseEntry } from "../gematria/gematria";

const STORAGE_KEY = "wilson_gematria_phrase_library_v1";
const WATER_KEY = "wilson_observatory_water_memory_v1";
const IMPORT_ENDPOINT = import.meta.env.VITE_GEMATRIX_ENDPOINT || "https://wilson-proxy.butterflyeffect007.workers.dev/gematrix";
const STARTER_PHRASES: PhraseEntry[] = [
  ...["COSMIC PEACE", "HEART MIND", "INNER LIFE", "SACRED SELF", "THE KEY IS HIDDEN", "DIVINE LIGHT", "STAR OF DAVID", "COSMIC WISDOM", "HELLO", "WELL", "LOVE", "WILSON", "THE ONLY ONE", "IMAGINATION", "INTELLIGENCE"].map((phrase) => ({ id: "starter-" + phrase.toLowerCase().replace(/ /g, "-"), phrase, category: "Starter", source: "Built-in example" })),
];
function loadPhraseLibrary(): PhraseEntry[] {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    if (!Array.isArray(saved)) return STARTER_PHRASES;
    return [...STARTER_PHRASES, ...saved.filter((p): p is PhraseEntry => !!p && typeof p.id === "string" && typeof p.phrase === "string" && !p.id.startsWith("starter-"))];
  } catch { return STARTER_PHRASES; }
}
interface WaterEntry { id: string; phrase: string; note: string; at: string }
function loadWater(): WaterEntry[] {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(WATER_KEY) || "[]");
    return Array.isArray(saved) ? saved.filter((p): p is WaterEntry => !!p && typeof p.id === "string" && typeof p.phrase === "string" && typeof p.note === "string" && typeof p.at === "string") : [];
  } catch { return []; }
}
export async function fetchGematrixMatches(word: string, signal?: AbortSignal): Promise<string[]> {
  const res = await fetch(`${IMPORT_ENDPOINT}?word=${encodeURIComponent(word)}`, { signal });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Could not import from gematrix.org.");
  if (!Array.isArray(data.phrases)) throw new Error("The import returned an unreadable response.");
  return [...new Set<string>(data.phrases.map((p: { phrase?: unknown }) => p?.phrase).filter((p: unknown): p is string => typeof p === "string" && p.trim().length > 0))];
}
const PRIMARY = [
  { label: "English", id: "english-gematria" },
  { label: "Simple", id: "english-ordinal" },
  { label: "Hebrew", id: "hebrew-ordinal" },
] as const;

export default function GematriaObservatory({ onClose }: { onClose: () => void }) {
  const [phraseDraft, setPhraseDraft] = useState("WILSON");
  const phrase = phraseDraft.trim().replace(/\s+/g, " ");
  const [cipherId, setCipherId] = useState<CipherId>("english-ordinal");
  const [tab, setTab] = useState<"matches" | "library">("matches");
  const [library, setLibrary] = useState<PhraseEntry[]>(loadPhraseLibrary);
  const [newPhrase, setNewPhrase] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [water, setWater] = useState(loadWater);
  const [note, setNote] = useState("");
  const [waterNotice, setWaterNotice] = useState("");
  const request = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => { const el = inputRef.current; if (!el) return; el.style.height = "auto"; el.style.height = `${el.scrollHeight}px`; }, [phraseDraft]);
  const opener = useRef<HTMLElement | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const result = useMemo(() => calculateCipher(phrase, cipherId), [phrase, cipherId]);
  const matches = useMemo(() => phrase ? findPhraseMatches(phrase, library, cipherId, { excludeExactText: true }) : [], [phrase, library, cipherId]);
  const filtered = useMemo(() => library.filter(p => p.phrase.toLowerCase().includes(search.toLowerCase())), [library, search]);
  const totalText = result.total === null ? "—" : String(result.total);

  useEffect(() => {
    opener.current = document.activeElement as HTMLElement;
    rootRef.current?.focus({ preventScroll: true });
    return () => { request.current?.abort(); opener.current?.focus({ preventScroll: true }); };
  }, []);
  function persist(next: PhraseEntry[]) {
    setLibrary(next);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next.filter(p => !p.id.startsWith("starter-")))); }
    catch { setError("Device storage is unavailable. Changes will last only for this session."); }
  }
  function changePhrase(value: string) {
    request.current?.abort(); request.current = null;
    setLoading(false); setError(""); setNotice(""); setPhraseDraft(value);
  }
  function chooseCipher(id: CipherId) {
    request.current?.abort(); request.current = null;
    setLoading(false); setError(""); setNotice(""); setCipherId(id);
  }
  function addPhrase() {
    const clean = newPhrase.trim().replace(/\s+/g, " ");
    if (!clean) return;
    if (!library.some(p => p.phrase.toUpperCase() === clean.toUpperCase())) persist([...library, { id: crypto.randomUUID(), phrase: clean, category: "My phrases", source: "Added on this device" }]);
    setNewPhrase("");
  }
  async function importPhrases() {
    if (!phrase || loading) return;
    request.current?.abort();
    const controller = new AbortController(); request.current = controller;
    const timeout = window.setTimeout(() => controller.abort("timeout"), 22000);
    setLoading(true); setError(""); setNotice("");
    try {
      const found = await fetchGematrixMatches(phrase, controller.signal);
      if (controller.signal.aborted) return;
      const existing = new Set(library.map(p => p.phrase.toUpperCase()));
      const entries = found.filter(p => !existing.has(p.toUpperCase())).map(p => ({ id: "gematrix-" + crypto.randomUUID(), phrase: p, category: "gematrix.org", source: "Imported from gematrix.org" }));
      if (entries.length) persist([...entries, ...library]);
      const exact = findPhraseMatches(phrase, [...library, ...entries], cipherId, { excludeExactText: true });
      setNotice(`Imported ${entries.length} new phrases from gematrix.org. ${exact.length} exact matches in the selected cipher.`);
      setTab("matches");
    } catch (e) {
      if (controller.signal.reason === "timeout") setError("The import timed out. Please try again.");
      else if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "Could not reach gematrix.org.");
    } finally { window.clearTimeout(timeout); if (request.current === controller) { setLoading(false); request.current = null; } }
  }
  function saveWater() {
    if (!note.trim()) return;
    const next = [{ id: crypto.randomUUID(), phrase, note: note.trim(), at: new Date().toISOString() }, ...water];
    setWater(next); setNote("");
    try { localStorage.setItem(WATER_KEY, JSON.stringify(next)); setWaterNotice("Reflection saved on this device."); }
    catch { setWaterNotice("Saved for this session only; device storage is unavailable."); }
  }
  function trapKeys(event: React.KeyboardEvent) {
    if (event.key === "Escape") { event.stopPropagation(); onClose(); }
    if (event.key !== "Tab") return;
    const nodes = [...(rootRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input, textarea, select, summary, a[href], [tabindex="0"]') || [])].filter(n => n.getClientRects().length);
    const first = nodes[0], last = nodes[nodes.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }
  return <div ref={rootRef} tabIndex={-1} className="obs-root" style={{ "--obs-scene": `url(${scene})` } as React.CSSProperties} role="dialog" aria-modal="true" aria-label="Wilson Gematria Observatory" onKeyDown={trapKeys}>
    <div className="obs-scroll"><div className="obs-column">
      <header className="obs-header"><h1>GEMATRIA OBSERVATORY</h1><button type="button" className="obs-close" aria-label="Close Observatory" onClick={onClose}>×</button></header>
      <div className="obs-hero" aria-live="polite"><p className={`obs-total${totalText.length > 3 ? " obs-total--xs" : totalText.length === 3 ? " obs-total--sm" : ""}`} aria-label={`${result.label}: ${totalText}`}>{totalText}</p></div>
      <form className="obs-input-wrap" onSubmit={e => { e.preventDefault(); setPhraseDraft(phrase); }}><textarea ref={inputRef} rows={1} className={`obs-input${phraseDraft.length > 50 ? " obs-input--xl" : phraseDraft.length > 24 ? " obs-input--lg" : phraseDraft.length > 16 ? " obs-input--md" : ""}`} value={phraseDraft} onChange={e => changePhrase(e.target.value.replace(/[\r\n]+/g, " "))} onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); e.currentTarget.form?.requestSubmit(); } }} placeholder="Type a word or phrase" aria-label="Phrase or name to calculate" autoComplete="off" spellCheck={false}/></form>
      <div className="obs-ciphers" role="radiogroup" aria-label="Cipher" onKeyDown={e => { if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) return; e.preventDefault(); const current = PRIMARY.findIndex(c => c.id === cipherId || (c.id === "hebrew-ordinal" && cipherId === "hebrew-final-large")); const index = (Math.max(0,current) + (["ArrowLeft", "ArrowUp"].includes(e.key) ? 2 : 1)) % 3; chooseCipher(PRIMARY[index].id); e.currentTarget.querySelectorAll<HTMLButtonElement>("button")[index]?.focus(); }}>{PRIMARY.map((cipher, i) => <span key={cipher.id}>{i > 0 && <span className="obs-cipher-sep" aria-hidden="true">|</span>}<button type="button" className="obs-cipher" role="radio" tabIndex={cipherId === cipher.id || (cipher.id === "hebrew-ordinal" && cipherId === "hebrew-final-large") ? 0 : -1} aria-checked={cipherId === cipher.id || (cipher.id === "hebrew-ordinal" && cipherId === "hebrew-final-large")} onClick={() => chooseCipher(cipher.id)}>{cipher.label}</button></span>)}</div>
      <div className="obs-tabs" role="tablist" aria-label="Observatory panels" onKeyDown={e => { if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return; e.preventDefault(); const next = e.key === "Home" ? "matches" : e.key === "End" ? "library" : tab === "matches" ? "library" : "matches"; setTab(next); requestAnimationFrame(() => document.getElementById(`obs-tab-${next}`)?.focus()); }}>{([['matches', 'Matches'], ['library', 'Library of Light']] as const).map(([id, label]) => <button type="button" key={id} id={`obs-tab-${id}`} role="tab" tabIndex={tab === id ? 0 : -1} aria-controls={`obs-panel-${id}`} aria-selected={tab === id} className={`obs-tab${tab === id ? ' is-active' : ''}`} onClick={() => setTab(id)}>{label}</button>)}</div>
      <section className={`obs-card${tab === 'library' ? ' obs-card--library' : ''}`} id={`obs-panel-${tab}`} role="tabpanel" aria-labelledby={`obs-tab-${tab}`}>
        {tab === "matches" ? <>
          {matches.length ? <ul className="obs-rows">{matches.map(match => <li key={match.id}><button type="button" className="obs-row" title={match.source} onClick={() => changePhrase(match.phrase)}><span className="obs-row-phrase">{match.phrase}</span><span className="obs-row-value">{match.total}</span></button></li>)}</ul> : <p className="obs-empty">{result.total === null ? (cipherId.startsWith('hebrew') ? 'Enter Hebrew letters (א–ת) for the Hebrew cipher.' : 'Enter a phrase to find matches.') : `No saved phrases equal ${result.total} yet. Open Library of Light to import more.`}</p>}
        </> : <div className="obs-library">
          <button type="button" className="obs-action" disabled={loading || !phrase} onClick={importPhrases}>{loading ? 'Importing gematrix.org…' : 'Import matching phrases from gematrix.org'}</button>
          <p className="obs-caption">Imports all three result tables; Matches compares using your selected cipher. Gematrix’s Latin “Jewish” cipher is not Wilson’s Hebrew-letter cipher.</p>
          <details><summary>Cipher options</summary><select className="obs-field" aria-label="All cipher options" value={cipherId} onChange={e => chooseCipher(e.target.value as CipherId)}>{CIPHERS.map(c => <option key={c.id} value={c.id}>{c.id === 'english-ordinal' ? 'Simple (A=1 … Z=26)' : c.label}</option>)}</select></details>
          <details open><summary>Living Library · {library.length} saved phrases</summary>
            <form className="obs-lib-add" onSubmit={e => { e.preventDefault(); addPhrase(); }}><input className="obs-field" aria-label="New phrase" placeholder="Add a phrase…" value={newPhrase} onChange={e => setNewPhrase(e.target.value)}/><button className="obs-action" disabled={loading || !newPhrase.trim()}>Add</button></form>
            <input className="obs-field" aria-label="Search saved phrases" placeholder="Search saved phrases…" value={search} onChange={e => setSearch(e.target.value)}/>
            <ul className="obs-rows obs-library-rows">{filtered.map(p => <li key={p.id} className="obs-lib-item"><button type="button" className="obs-row" onClick={() => { changePhrase(p.phrase); setTab('matches'); }} title={p.source}><span className="obs-row-phrase">{p.phrase}</span><span className="obs-row-value">{calculateCipher(p.phrase, cipherId).total ?? '—'}</span></button>{!p.id.startsWith('starter-') && <button type="button" className="obs-remove" disabled={loading} aria-label={`Remove ${p.phrase}`} onClick={() => persist(library.filter(entry => entry.id !== p.id))}>×</button>}</li>)}</ul>
          </details>
          <details><summary>Water Memory · personal reflections</summary><p className="obs-caption">A private reflection journal on this device, not a scientific claim about water.</p><textarea className="obs-field" aria-label="Water Memory reflection" placeholder="Your reflection on this phrase…" value={note} onChange={e => setNote(e.target.value)}/><button type="button" className="obs-action" disabled={!note.trim()} onClick={saveWater}>Save reflection</button><p className="obs-caption" role="status">{waterNotice}</p>{water.map(entry => <article key={entry.id} className="obs-water-entry"><strong>{entry.phrase}</strong><p>{entry.note}</p><time dateTime={entry.at}>{new Date(entry.at).toLocaleString('en-US', { timeZone: 'America/Chicago' })} Central</time></article>)}</details>
        </div>}
      </section>
      {error && <p className="obs-error" role="alert">{error}</p>}
      {notice && <p className="obs-notice" role="status">{notice}</p>}
    </div></div>
  </div>;
}
