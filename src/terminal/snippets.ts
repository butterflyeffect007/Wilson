const KEY = "wilson_terminal_snippets";
const DRAFT = "wilson_terminal_draft";
const FILE = "wilson_terminal_filename";

export type TerminalSnippet = { id: string; name: string; code: string; savedAt: string };

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function loadSnippets(): TerminalSnippet[] {
  const list = readJson<TerminalSnippet[]>(KEY, []);
  return Array.isArray(list) ? list : [];
}

export function saveSnippets(list: TerminalSnippet[]): void {
  try { localStorage.setItem(KEY, JSON.stringify(list.slice(0, 40))); } catch { /* full */ }
}

export function upsertSnippet(name: string, code: string, id?: string): TerminalSnippet {
  const list = loadSnippets();
  const item: TerminalSnippet = {
    id: id || ("snip-" + Math.random().toString(36).slice(2, 10)),
    name: name.trim() || "untitled.py",
    code,
    savedAt: new Date().toISOString(),
  };
  const i = list.findIndex((s) => s.id === item.id);
  if (i >= 0) list[i] = item; else list.unshift(item);
  saveSnippets(list);
  return item;
}

export function deleteSnippet(id: string): void {
  saveSnippets(loadSnippets().filter((s) => s.id !== id));
}

export function loadDraft(): { code: string; filename: string } | null {
  try {
    const code = localStorage.getItem(DRAFT);
    const filename = localStorage.getItem(FILE) || "matrix.py";
    return code != null ? { code, filename } : null;
  } catch {
    return null;
  }
}

export function saveDraft(code: string, filename: string): void {
  try {
    localStorage.setItem(DRAFT, code);
    localStorage.setItem(FILE, filename);
  } catch { /* full */ }
}
