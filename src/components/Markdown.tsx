import React, { useEffect, useRef, useState } from "react";
import { Copy } from "lucide-react";
import { copyText } from "../lib/clipboard";
import { isLongInlineCommand, parseFenceAt } from "../lib/codeFence";

/** Instrument-grade markdown: headings, lists, quotes, tables, fenced code — no deps, no HTML injection. */
let HL = ""; // active search term (set by <Markdown highlight>)
const esc = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
function hl(t: string): React.ReactNode {
  if (!HL) return t;
  const parts = t.split(new RegExp(`(${esc(HL)})`, "gi"));
  if (parts.length === 1) return t;
  return parts.map((x, i) => (i % 2 ? <mark key={i} className="wl-hit">{x}</mark> : x));
}

function CodeBlock({ lang, code, compact = false }: { lang?: string; code: string; compact?: boolean }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const onCopy = async () => {
    const ok = await copyText(code);
    if (!ok) return;
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1500);
  };

  const label = lang || (compact ? "command" : "");
  return (
    <div className={`md-block${compact ? " md-block-compact" : ""}`} data-testid="md-block">
      <div className="md-block-bar">
        {label ? <div className="md-block-label">{label}</div> : <span className="md-block-label md-block-label-empty" aria-hidden="true" />}
        <button
          type="button"
          className={`md-copy${copied ? " is-copied" : ""}`}
          onClick={onCopy}
          aria-label={copied ? "Copied" : "Copy code"}
          data-testid="md-copy"
        >
          {copied ? null : <Copy className="md-copy-icon" aria-hidden="true" />}
          <span>{copied ? "Copied ✓" : "Copy"}</span>
        </button>
      </div>
      <pre><code>{hl(code)}</code></pre>
    </div>
  );
}

export function renderInline(text: string): React.ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*\s][^*]*\*|`[^`]+`|\[[^\]]+\]\(https?:\/\/[^)\s]+\))/g);
  return parts.map((p, i) => {
    if (p.length > 4 && p.startsWith("**") && p.endsWith("**")) return <strong key={i}>{hl(p.slice(2, -2))}</strong>;
    if (p.length > 2 && p.startsWith("*") && p.endsWith("*")) return <em key={i}>{hl(p.slice(1, -1))}</em>;
    if (p.length > 2 && p.startsWith("`") && p.endsWith("`")) {
      const code = p.slice(1, -1);
      if (isLongInlineCommand(code)) return <CodeBlock key={i} code={code} compact />;
      return <code key={i} className="md-code-inline">{hl(code)}</code>;
    }
    const link = p.match(/^\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)$/);
    if (link) return <a key={i} href={link[2]} target="_blank" rel="noopener noreferrer" className="md-link">{link[1]}</a>;
    return <React.Fragment key={i}>{hl(p)}</React.Fragment>;
  });
}

const isTableRow = (l: string) => /^\s*\|.*\|\s*$/.test(l);
const isSep = (l: string) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l);
const cells = (l: string) => l.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());

export function Markdown({ text, highlight = "" }: { text: string; highlight?: string }) {
  HL = highlight.trim().length >= 2 ? highlight.trim() : "";
  const lines = text.split("\n");
  const out: React.ReactNode[] = [];
  let i = 0, k = 0;
  while (i < lines.length) {
    const line = lines[i];
    const fence = parseFenceAt(lines, i);
    if (fence) {
      out.push(<CodeBlock key={k++} lang={fence.lang} code={fence.code} />);
      i = fence.end;
      continue;
    }
    if (isTableRow(line) && i + 1 < lines.length && isSep(lines[i + 1])) {
      const head = cells(line); i += 2;
      const rows: string[][] = [];
      while (i < lines.length && isTableRow(lines[i])) rows.push(cells(lines[i++]));
      out.push(
        <div key={k++} className="md-table-wrap"><table className="md-table">
          <thead><tr>{head.map((c, j) => <th key={j}>{renderInline(c)}</th>)}</tr></thead>
          <tbody>{rows.map((r, ri) => <tr key={ri}>{r.map((c, j) => <td key={j}>{renderInline(c)}</td>)}</tr>)}</tbody>
        </table></div>,
      );
      continue;
    }
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) { out.push(<div key={k++} className={`md-h md-h${h[1].length}`}>{renderInline(h[2])}</div>); i++; continue; }
    if (/^\s*(---|\*\*\*|___)\s*$/.test(line)) { out.push(<hr key={k++} className="md-hr" />); i++; continue; }
    if (/^\s*>\s?/.test(line)) {
      const q: string[] = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) q.push(lines[i++].replace(/^\s*>\s?/, ""));
      out.push(<blockquote key={k++} className="md-quote">{q.map((x, j) => <div key={j}>{renderInline(x)}</div>)}</blockquote>);
      continue;
    }
    const li = line.match(/^(\s*)([-*•]|\d+[.)])\s+(.*)$/);
    if (li) {
      const ordered = /\d/.test(li[2]);
      const items: { indent: number; text: string; n: string }[] = [];
      let m: RegExpMatchArray | null;
      while (i < lines.length && (m = lines[i].match(/^(\s*)([-*•]|\d+[.)])\s+(.*)$/))) { items.push({ indent: Math.min(3, Math.floor(m[1].length / 2)), text: m[3], n: m[2] }); i++; }
      out.push(
        <div key={k++} className="md-list">
          {items.map((it, j) => (
            <div key={j} className="md-li" style={{ paddingLeft: `${it.indent * 1.1}rem` }}>
              <span className="md-bullet">{ordered ? it.n : "•"}</span><span>{renderInline(it.text)}</span>
            </div>
          ))}
        </div>,
      );
      continue;
    }
    out.push(<div key={k++}>{line ? renderInline(line) : "\u00A0"}</div>);
    i++;
  }
  return <>{out}</>;
}
