import { useEffect, useState } from "react";
import { api, errText, type AcctUser } from "./api";
import { Foot, Toggle, Top, go, when } from "./ui";

type Mine = { id: number; topic: string; body: string; status: string; created_at: number; replies: { body: string; created_at: number }[] };
const TOPICS = [["idea", "💡 Idea"], ["bug", "🪲 Bug"], ["question", "❓ Question"], ["hi", "👋 Just saying hi"]] as const;
const ICON: Record<string, string> = { idea: "💡", bug: "🪲", question: "❓", hi: "👋" };

export function MessageArchitect({ user, onClose, context }: { user: AcctUser | null; onClose: () => void; context: string }) {
  const [topic, setTopic] = useState<string>(user ? "idea" : "question");
  const [body, setBody] = useState("");
  const [attach, setAttach] = useState(false);
  const [contact, setContact] = useState("");
  const [uname, setUname] = useState(() => { try { return localStorage.getItem("wilson_acct_last_user") || ""; } catch { return ""; } });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [mine, setMine] = useState<Mine[] | null>(null);
  const load = () => { if (user) void api<{ messages: Mine[] }>("/acct/messages").then((d) => setMine(d.messages)).catch(() => {}); };
  useEffect(load, [user]);
  const send = async () => {
    setErr(null);
    if (body.trim().length < 3) return setErr("Write a short message first.");
    setBusy(true);
    try {
      if (user) await api("/acct/message", { body: { topic, body: body.trim(), context: attach && context ? context : undefined } });
      else await api("/acct/message", { token: null, body: { topic: topic === "question" ? "lost-access" : topic, body: body.trim(), contact: contact.trim(), username: uname.trim() } });
      setBody(""); setSent(true); setTimeout(() => setSent(false), 5000); load();
    } catch (e) { setErr(errText(e)); } finally { setBusy(false); }
  };
  return (
    <div className="wrap">
      <Top onClose={onClose} />
      <div style={{ margin: "10px 2px 16px" }}><h1>Message the Architect</h1><div className="soft small" style={{ marginTop: 4 }}>Send a note straight to Jenny, who builds Wilson. Questions, bugs, ideas, or just hello.</div></div>
      <form className="card" onSubmit={(e) => { e.preventDefault(); void send(); }}>
        <label className="lbl" style={{ marginTop: 0 }}>What's this about?</label>
        <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
          {TOPICS.map(([k, l]) => <button key={k} type="button" className={`pill big${topic === k ? " on" : ""}`} onClick={() => setTopic(k)}>{!user && k === "question" ? "🔑 Can't get in" : l}</button>)}
        </div>
        {!user && <>
          <label className="lbl" htmlFor="wa-mu">Your Wilson username <span className="opt">— if you have one</span></label>
          <div className="field"><input id="wa-mu" value={uname} onChange={(e) => setUname(e.target.value.replace(/\s/g, ""))} autoCapitalize="none" spellCheck={false} maxLength={24} /></div>
          <label className="lbl" htmlFor="wa-mc">How can Jenny reach you? <span className="opt">— optional (email or @handle)</span></label>
          <div className="field"><input id="wa-mc" value={contact} onChange={(e) => setContact(e.target.value)} maxLength={200} /></div>
        </>}
        <label className="lbl" htmlFor="wa-mb">Message</label>
        <div className="field"><textarea id="wa-mb" value={body} onChange={(e) => setBody(e.target.value)} maxLength={2000} style={{ minHeight: 150 }} /></div>
        {user && context && <div className="row small soft" style={{ marginTop: 12 }}><span style={{ transform: "scale(.8)", display: "inline-flex" }}><Toggle on={attach} onChange={setAttach} label="Attach the last few lines of my chat" /></span>Attach the last few lines of my chat for context</div>}
        {err && <div className="err" role="alert">{err}</div>}
        {sent && <div className="okmsg" role="status">Sent ✓ {user ? "Replies show up below and in your Wilson inbox." : "Jenny will reach out if you left a way to contact you."}</div>}
        <button type="submit" className="btn" disabled={busy}>{busy ? "Sending…" : "Send to the Architect ➤"}</button>
        <div className="tiny soft" style={{ marginTop: 10, textAlign: "center" }}>Only Jenny can read this. {user ? "Replies show up in your Wilson inbox." : "Without an account, replies can only reach you through the contact you leave."}</div>
      </form>
      {user && (
        <div className="card" style={{ marginTop: 12 }}>
          <div className="row between"><h2 style={{ margin: 0 }}>Your messages</h2></div>
          {!mine ? <div className="soft small" style={{ marginTop: 10 }}>Loading…</div> : mine.length === 0 ? <div className="soft small" style={{ marginTop: 10 }}>Nothing sent yet.</div> : mine.map((m) => (
            <div key={m.id} style={{ marginTop: 10 }}>
              <div className="row between small">
                <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{ICON[m.topic] ?? "✉"} {m.body.slice(0, 60)}</span>
                <span className="pill" style={m.replies.length ? { color: "var(--ok)", borderColor: "rgba(94,234,212,.4)" } : undefined}>{m.replies.length ? "Replied" : m.status === "new" ? "Sent" : "Seen"}</span>
              </div>
              {m.replies.map((r, i) => <div key={i} className="msg wil" style={{ margin: "6px 0 0 14px" }}><div><div className="n">Jenny · {when(r.created_at)}</div><div className="b">{r.body}</div></div></div>)}
            </div>
          ))}
        </div>
      )}
      {!user && <Foot>Have an account? <button type="button" className="link" style={{ fontSize: 11 }} onClick={() => go("#signin")}>Sign in</button> to see replies here.</Foot>}
    </div>
  );
}
