const KW = /^(and|as|assert|async|await|break|class|continue|def|del|elif|else|except|False|finally|for|from|global|if|import|in|is|lambda|None|nonlocal|not|or|pass|raise|return|True|try|while|with|yield)$/;

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Lightweight Python highlighter. Returns trusted HTML (input is escaped first). */
export function highlightPython(src: string): string {
  let out = "";
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    if (c === "#") {
      let j = src.indexOf("\n", i);
      if (j < 0) j = n;
      out += `<span class="c">${esc(src.slice(i, j))}</span>`;
      i = j;
      continue;
    }
    if (c === "'" || c === '"') {
      const q = c;
      const trip = src.startsWith(q + q + q, i);
      let j = i + (trip ? 3 : 1);
      if (trip) {
        const end = src.indexOf(q + q + q, j);
        j = end < 0 ? n : end + 3;
      } else {
        while (j < n && src[j] !== q && src[j] !== "\n") {
          if (src[j] === "\\") j += 2;
          else j++;
        }
        if (j < n && src[j] === q) j++;
      }
      out += `<span class="s">${esc(src.slice(i, j))}</span>`;
      i = j;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      let j = i + 1;
      while (j < n && /[A-Za-z0-9_]/.test(src[j])) j++;
      const word = src.slice(i, j);
      const call = j < n && src[j] === "(";
      if (KW.test(word)) out += `<span class="k">${esc(word)}</span>`;
      else if (call) out += `<span class="f">${esc(word)}</span>`;
      else out += esc(word);
      i = j;
      continue;
    }
    if (/[0-9]/.test(c) || (c === "." && i + 1 < n && /[0-9]/.test(src[i + 1]))) {
      let j = i + 1;
      while (j < n && /[0-9eE._xX]/.test(src[j])) j++;
      out += `<span class="n">${esc(src.slice(i, j))}</span>`;
      i = j;
      continue;
    }
    out += esc(c);
    i++;
  }
  return out;
}
