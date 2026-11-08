import { useMemo, useState, type FormEvent } from "react";
import skyTall from "../assets/observatory/sky-tall.webp";
import skyWide from "../assets/observatory/sky-wide.webp";
import crystalHero from "../assets/observatory/crystal-hero.webp";
import "./GematriaObservatory.css";
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

async function fetchGematrixMatches(word: string): Promise<string[]> {
  const url = `https://gematrix.org/?word=${encodeURIComponent(word)}`;
  // Try direct, fall back to a CORS proxy if needed
  const proxies = [
    url,
    `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
    `https://corsproxy.io/?${encodeURIComponent(url)}`,
  ];
  for (const target of proxies) {
    try {
      const res = await fetch(target);
      if (!res.ok) continue;
      const html = await res.text();
      const phrases = new Set<string>();
      // Extract words from table links like <a href="/?word=...">word</a>
      const re = /<a[^>]+href="\/?\?word=([^"]+)"[^>]*>([^<]+)<\/a>/gi;
      let m: RegExpExecArray | null;
      while ((m = re.exec(html))) {
        const phrase = decodeURIComponent(m[2]).trim();
        if (phrase && phrase.length > 1 && !/^\d+$/.test(phrase)) phrases.add(phrase);
      }
      if (phrases.size) return Array.from(phrases).slice(0, 80);
    } catch { /* try next */ }
  }
  return [];
}

const PRIMARY_CIPHERS: { label: string; ids: CipherId[] }[] = [
  { label: "English", ids: ["english-ordinal", "english-reverse-ordinal"] },
  { label: "Reduction", ids: ["english-reduction", "english-reverse-reduction"] },
  { label: "Hebrew", ids: ["hebrew-ordinal", "hebrew-final-large"] },
];

export default function GematriaObservatory({ onClose }: { onClose: () => void }) {
  const [phraseDraft, setPhraseDraft] = useState("Wilson");
  const phrase = phraseDraft.trim().replace(/\s+/g, " ");
  const [cipherId, setCipherId] = useState<CipherId>("english-ordinal");
  const [tab, setTab] = useState<"matches" | "library">("matches");
  const [library, setLibrary] = useState<PhraseEntry[]>(loadPhraseLibrary);
  const [newPhrase, setNewPhrase] = useState("");
  const [search, setSearch] = useState("");
  const [gematrixLoading, setGematrixLoading] = useState(false);
  const [gematrixPhrases, setGematrixPhrases] = useState<string[]>([]);
  const [gematrixError, setGematrixError] = useState("");

  const result = useMemo(() => calculateCipher(phrase, cipherId), [phrase, cipherId]);
  const matches = useMemo(
    () => (phrase ? findPhraseMatches(phrase, library, cipherId, { excludeExactText: true }) : []),
    [phrase, library, cipherId],
  );
  const filteredLibrary = useMemo(
    () => library.filter((item) => item.phrase.toLocaleLowerCase().includes(search.toLocaleLowerCase())),
    [library, search],
  );
  const cipherDef = CIPHERS.find((cipher) => cipher.id === cipherId);
  const activeGroup = PRIMARY_CIPHERS.find((group) => group.ids.includes(cipherId)) ?? PRIMARY_CIPHERS[0];
  const isReverseVariant = activeGroup.ids[1] === cipherId;
  const total = result.total;

  function persist(next: PhraseEntry[]) {
    setLibrary(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next.filter((item) => !item.id.startsWith("starter-"))));
    } catch { /* Keep the current session usable when storage is unavailable. */ }
  }

  function onPhraseChange(value: string) {
    setPhraseDraft(value);
    setGematrixPhrases([]);
    setGematrixError("");
  }

  function submitPhrase(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPhraseDraft(phrase);
  }

  async function importFromGematrix() {
    if (!phrase) return;
    setGematrixLoading(true);
    setGematrixError("");
    try {
      const found = await fetchGematrixMatches(phrase);
      setGematrixPhrases(found);
      if (!found.length) setGematrixError("No phrases returned from gematrix.org (or blocked).");
    } catch {
      setGematrixError("Could not reach gematrix.org");
    } finally {
      setGematrixLoading(false);
    }
  }

  function addImportedPhrases() {
    const existing = new Set(library.map((p) => p.phrase.toLocaleUpperCase()));
    const toAdd: PhraseEntry[] = gematrixPhrases
      .filter((p) => !existing.has(p.toLocaleUpperCase()))
      .map((p) => ({
        id: "gematrix-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 6),
        phrase: p,
        category: "gematrix.org",
        source: "Imported from gematrix.org",
      }));
    if (toAdd.length) persist([...library, ...toAdd]);
    setGematrixPhrases([]);
  }

  function choosePhrase(value: string) {
    onPhraseChange(value);
  }

  function addPhrase() {
    const clean = newPhrase.trim().replace(/\s+/g, " ");
    if (!clean) return;
    const key = clean.toLocaleUpperCase();
    if (library.some((item) => item.phrase.toLocaleUpperCase() === key)) {
      setNewPhrase("");
      return;
    }
    persist([...library, {
      id: "user-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 7),
      phrase: clean,
      category: "My phrases",
      source: "Added on this device",
    }]);
    setNewPhrase("");
  }

  function removePhrase(id: string) {
    if (id.startsWith("starter-")) return;
    persist(library.filter((item) => item.id !== id));
  }

  const totalText = total === null ? "—" : String(total);
  const totalSize = totalText.length >= 4 ? "obs-total--xs" : totalText.length === 3 ? "obs-total--sm" : "";

  return (
    <div
      className="obs-root"
      style={{ ["--obs-sky-tall" as string]: `url(${skyTall})`, ["--obs-sky-wide" as string]: `url(${skyWide})` }}
      role="dialog"
      aria-modal="true"
      aria-label="Wilson Gematria Observatory"
    >
      <div className="obs-sky" aria-hidden="true" />
      <div className="obs-stars" aria-hidden="true" />
      <div className="obs-scroll">
        <div className="obs-column">
          <header className="obs-header">
            <h1 className="obs-title">Gematria Observatory</h1>
            <button type="button" onClick={onClose} className="obs-close" aria-label="Close Observatory">
              <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
            </button>
          </header>

          <div className="obs-hero" aria-live="polite">
            <div className="obs-hero-float">
              <img src={crystalHero} alt="" className="obs-hero-img" draggable={false} />
              <p className={"obs-total " + totalSize} aria-label={`${cipherDef?.label ?? "Total"}: ${totalText}`}>{totalText}</p>
            </div>
            <span className="obs-sparkle obs-sparkle--a" aria-hidden="true" />
            <span className="obs-sparkle obs-sparkle--b" aria-hidden="true" />
            <span className="obs-sparkle obs-sparkle--c" aria-hidden="true" />
          </div>

          <form onSubmit={submitPhrase} className="obs-input-wrap">
            <input
              value={phraseDraft}
              onChange={(event) => onPhraseChange(event.target.value)}
              className="obs-input"
              placeholder="Type a word or phrase"
              aria-label="Phrase or name to calculate"
              autoComplete="off"
              spellCheck={false}
            />
            <span className="obs-input-sheen" aria-hidden="true" />
          </form>

          <div className="obs-ciphers" role="radiogroup" aria-label="Cipher">
            {PRIMARY_CIPHERS.map((group, index) => {
              const active = group === activeGroup;
              return (
                <span key={group.label} className="obs-cipher-item">
                  {index > 0 && <span className="obs-cipher-sep" aria-hidden="true">|</span>}
                  <button
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => setCipherId(active ? cipherId : group.ids[0])}
                    className={"obs-cipher" + (active ? " is-active" : "")}
                  >{group.label}</button>
                </span>
              );
            })}
          </div>
          <div className="obs-cipher-meta">
            <span>{cipherDef?.label}</span>
            <button type="button" className="obs-variant" onClick={() => setCipherId(activeGroup.ids[isReverseVariant ? 0 : 1])}>
              {activeGroup.label === "Hebrew" ? (isReverseVariant ? "Standard finals" : "Large finals") : (isReverseVariant ? "Forward" : "Reverse")}
            </button>
          </div>
          {total === null && phrase && (
            <p className="obs-hint">{cipherDef?.alphabet === "hebrew" ? "Type Hebrew letters (א–ת) to use a Hebrew cipher." : "No letters from this cipher were found."}</p>
          )}

          <div className="obs-tabs" role="tablist">
            <button type="button" role="tab" aria-selected={tab === "matches"} className={"obs-tab" + (tab === "matches" ? " is-active" : "")} onClick={() => setTab("matches")}>Matches</button>
            <button type="button" role="tab" aria-selected={tab === "library"} className={"obs-tab" + (tab === "library" ? " is-active" : "")} onClick={() => setTab("library")}>Library of Light</button>
          </div>

          <section className="obs-card" role="tabpanel">
            {tab === "matches" ? (
              <>
                {matches.length ? (
                  <ul className="obs-rows">
                    {matches.map((match) => (
                      <li key={match.id}>
                        <button type="button" className="obs-row" onClick={() => choosePhrase(match.phrase)}>
                          <span className="obs-row-phrase">{match.phrase}</span>
                          <span className="obs-row-value">{match.total}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="obs-empty">
                    {total === null ? "Type a phrase to find matches." : <>No phrases in your Library of Light equal <span className="obs-gold">{total}</span> yet.</>}
                  </p>
                )}
                {gematrixPhrases.length > 0 && (
                  <div className="obs-import">
                    <div className="obs-import-head">
                      <span>From gematrix.org · {gematrixPhrases.length}</span>
                      <button type="button" className="obs-link" onClick={addImportedPhrases}>Add all to library</button>
                    </div>
                    <ul className="obs-rows obs-rows--compact">
                      {gematrixPhrases.map((p) => (
                        <li key={p}>
                          <button type="button" className="obs-row" onClick={() => choosePhrase(p)}>
                            <span className="obs-row-phrase">{p}</span>
                            <span className="obs-row-value">{calculateCipher(p, cipherId).total ?? "—"}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                <button type="button" className="obs-more" onClick={importFromGematrix} disabled={gematrixLoading || !phrase}>
                  {gematrixLoading ? "Searching gematrix.org…" : "Find more matches on gematrix.org"}
                </button>
                {gematrixError && <p className="obs-error">{gematrixError}</p>}
              </>
            ) : (
              <>
                <form className="obs-lib-add" onSubmit={(event) => { event.preventDefault(); addPhrase(); }}>
                  <input value={newPhrase} onChange={(event) => setNewPhrase(event.target.value)} className="obs-field" placeholder="Add a word or phrase…" aria-label="New phrase" />
                  <button type="submit" className="obs-add" disabled={!newPhrase.trim()}>Add</button>
                </form>
                <input value={search} onChange={(event) => setSearch(event.target.value)} className="obs-field obs-field--search" placeholder={`Search ${library.length} saved phrases…`} aria-label="Search saved phrases" />
                <ul className="obs-rows obs-rows--library">
                  {filteredLibrary.map((item) => (
                    <li key={item.id} className="obs-lib-item">
                      <button type="button" className="obs-row" onClick={() => choosePhrase(item.phrase)}>
                        <span className="obs-row-phrase">{item.phrase}</span>
                        <span className="obs-row-value">{calculateCipher(item.phrase, cipherId).total ?? "—"}</span>
                      </button>
                      {!item.id.startsWith("starter-") && (
                        <button type="button" onClick={() => removePhrase(item.id)} className="obs-remove" aria-label={"Remove " + item.phrase}>×</button>
                      )}
                    </li>
                  ))}
                  {!filteredLibrary.length && <li className="obs-empty">No phrases match that search.</li>}
                </ul>
              </>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
