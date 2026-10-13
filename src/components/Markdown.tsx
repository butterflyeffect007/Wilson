import React from "react";

/** Instrument-grade markdown: headings, lists, quotes, tables, fenced code — no deps, no HTML injection. */
export function renderInline(text: string): React.ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*\s][^*]*\*|`[^`]+`|\[[^\]]+\]\(https?:\/\/[^)\s]+\))/g);
  return parts.map((p, i) => {
    if (p.length > 4 && p.startsWith("**") && p.endsWith("**")) return <strong key={i}>{p.slice(2, -2)}</strong>;
    if (p.length > 2 && p.startsWith("*") && p.endsWith("*")) return <em key={i}>{p.slice(1, -1)}</em>;
    if (p.length > 2 && p.startsWith("`") && p.endsWith("`")) return <code key={i} className="md-code-inline">{p.slice(1, -1)}</code>;
    const link = p.match(/^\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)$/);
    if (link) return <a key={i} href={link[2]} target="_blank" rel="noopener noreferrer" className="md-link">{link[1]}</a>;
    return <React.Fragment key={i}>{p}</React.Fragment>;
  });
}

const isTableRow = (l: string) => /^\s*\|.*\|\s*$/.test(l);
const isSep = (l: string) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l);
const cells = (l: string) => l.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());

export function Markdown({ text }: { text: string }) {
  const lines = text.split("\n");
  const out: React.ReactNode[] = [];
  let i = 0, k = 0;
  while (i < lines.length) {
    const line = lines[i];
    const fence = line.match(/^\s*```\s*([\w+-]*)/);
    if (fence) {
      const body: string[] = []; i++;
      while (i < lines.length && !/^\s*```/.test(lines[i])) body.push(lines[i++]);
      i++;
      out.push(
        <div key={k++} className="md-block">
          {fence[1] && <div className="md-block-label">{fence[1]}</div>}
          <pre><code>{body.join("\n")}</code></pre>
        </div>,
      );
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
