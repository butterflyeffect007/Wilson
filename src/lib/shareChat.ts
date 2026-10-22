/** Export a conversation as a styled, self-contained HTML showcase; share via iOS share sheet or download. */
interface Msg { role: string; content: string; timestamp: string }
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
const md = (s: string) => esc(s).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/\*(.+?)\*/g, "<i>$1</i>").replace(/\n/g, "<br>");

export function buildShowcaseHtml(title: string, messages: Msg[], userName: string, dark: boolean): string {
  const bg = dark ? "radial-gradient(circle at 50% 0%,#2e1065,#05010f 70%)" : "linear-gradient(180deg,#f8f0ff,#f3e8ff 35%,#e8f4ff 70%,#f0f9ff)";
  const fg = dark ? "#ede9fe" : "#2e1065";
  const card = dark ? "rgba(30,27,75,.55)" : "rgba(255,255,255,.6)";
  const rows = messages.filter((m) => m.role === "user" || m.role === "assistant").map((m) => `
  <div class="m ${m.role}"><div class="who">${m.role === "assistant" ? "Wilson" : esc(userName)} · ${new Date(m.timestamp).toLocaleString()}</div><div>${md(m.content)}</div></div>`).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)} — Wilson</title>
<link href="https://fonts.googleapis.com/css2?family=Lexend:wght@300;400&display=swap" rel="stylesheet">
<style>body{margin:0;font-family:Lexend,system-ui,sans-serif;font-weight:300;background:${bg};color:${fg};min-height:100vh}
.w{max-width:680px;margin:0 auto;padding:32px 18px 48px}h1{font-weight:300;letter-spacing:.35em;text-align:center;margin:0 0 4px}
.sub{text-align:center;opacity:.65;font-size:14px;margin-bottom:28px}.m{background:${card};backdrop-filter:blur(14px);border:1px solid rgba(167,139,250,.35);border-radius:18px;padding:14px 16px;margin:12px 0;line-height:1.6;max-width:88%}
.m.user{margin-left:auto;background:${dark ? "rgba(88,28,135,.45)" : "rgba(237,233,254,.85)"}}.who{font-size:12px;letter-spacing:.06em;opacity:.6;margin-bottom:4px}
.f{text-align:center;opacity:.55;font-size:12px;margin-top:28px}</style></head><body><div class="w"><h1>✦ WILSON + THE ONLY ONE</h1><div class="sub">${esc(title)}</div>${rows}
<div class="f">Shared from Wilson · butterflyeffect007.github.io/Wilson</div></div></body></html>`;
}

export async function shareChat(title: string, messages: Msg[], userName: string, dark: boolean): Promise<"shared" | "downloaded" | "cancelled"> {
  const html = buildShowcaseHtml(title, messages, userName, dark);
  const name = `wilson-${(title || "chat").toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40)}.html`;
  const file = new File([html], name, { type: "text/html" });
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (nav.share) {
    try {
      if (nav.canShare?.({ files: [file] })) await nav.share({ files: [file], title: `Wilson — ${title}` });
      else await nav.share({ title: `Wilson — ${title}`, text: messages.map((m) => `${m.role === "assistant" ? "Wilson" : userName}: ${m.content}`).join("\n\n") });
      return "shared";
    } catch (e) {
      if ((e as Error)?.name === "AbortError") return "cancelled";
    }
  }
  const url = URL.createObjectURL(file);
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return "downloaded";
}
