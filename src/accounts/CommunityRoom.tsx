import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError, errText, type AcctUser } from "./api";
import { Avatar, BFLY, Top, go, when } from "./ui";

type RoomMsg = { id: number; username: string; body: string; created_at: number; wilson: boolean; architect: boolean; hidden: boolean; mine: boolean; user_id?: string | null; reports?: number };
type RoomRes = { messages: RoomMsg[]; online: number; flags: { wilson_in_room: boolean; slow_mode: boolean; room_open: boolean }; me: { blocked: boolean; new_account: boolean }; open_reports?: number };
const REASONS = ["Spam", "Mean or hurtful", "Unsafe", "Something else"];

export function CommunityRoom({ user, onClose }: { user: AcctUser | null; onClose: () => void }) {
  const [d, setD] = useState<RoomRes | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [reporting, setReporting] = useState<number | null>(null);
  const [mine, setMine] = useState<Set<number>>(new Set());
  const endRef = useRef<HTMLDivElement | null>(null);
  const lastId = useRef(0);
  const arch = !!user?.architect;

  const load = useCallback(async () => {
    try { const r = await api<RoomRes>("/room"); setD(r); setErr(null); }
    catch (e) { setErr(errText(e)); if (e instanceof ApiError && e.status === 401) setD(null); }
  }, []);
  useEffect(() => {
    if (!user) return;
    void load();
    const t = window.setInterval(() => { if (document.visibilityState === "visible") void load(); }, 4000);
    return () => clearInterval(t);
  }, [user, load]);
  useEffect(() => {
    const last = d?.messages[d.messages.length - 1]?.id ?? 0;
    if (last > lastId.current) { lastId.current = last; endRef.current?.scrollIntoView({ block: "end" }); }
  }, [d]);
  const flash = (s: string) => { setNote(s); setTimeout(() => setNote(null), 4000); };

  const send = async () => {
    const body = text.trim(); if (!body || busy) return;
    setBusy(true); setErr(null);
    try {
      const r = await api<{ ok: boolean; id: number; wilson: string | null }>("/room", { body: { body } });
      setText(""); setMine((s) => new Set(s).add(r.id));
      if (r.wilson === "thinking") flash("🦋 Wilson is thinking…");
      else if (r.wilson === "cooldown") flash("Wilson just spoke. Give him a moment before mentioning him again.");
      else if (r.wilson === "cap") flash("Wilson has talked a lot in the room today. He'll be back tomorrow.");
      else if (r.wilson === "off") flash("Wilson is taking a break from the room right now.");
      await load();
      if (r.wilson === "thinking") { setTimeout(() => void load(), 6000); setTimeout(() => void load(), 14000); }
    } catch (e) { setErr(errText(e)); } finally { setBusy(false); }
  };
  const report = async (id: number, reason: string) => {
    setReporting(null);
    try { await api("/room/report", { body: { id, reason } }); flash("Thanks. The Architect will take a look."); } catch (e) { setErr(errText(e)); }
  };
  const archDo = async (path: string, body: unknown, confirmText?: string) => {
    if (confirmText && !window.confirm(confirmText)) return;
    try { await api(path, { body }); await load(); } catch (e) { setErr(errText(e)); }
  };
  const flag = (k: "wilson_in_room" | "slow_mode", v: boolean) => archDo("/arch/flags", { [k]: v });

  if (!user) return (
    <div className="wrap">
      <Top onClose={onClose} />
      <div className="card" style={{ textAlign: "center", marginTop: 30 }}>
        <div style={{ fontSize: 30 }}>💬</div>
        <h1 style={{ marginTop: 6 }}>Community Room</h1>
        <div className="soft small" style={{ margin: "8px 0 4px" }}>Sign in to chat with other Wilson people. Say @Wilson and he'll join in.</div>
        <button type="button" className="btn" onClick={() => go("#signin")}>Sign in</button>
        <button type="button" className="btn ghost" onClick={() => go("#signup")}>Create account</button>
      </div>
    </div>
  );

  const msgs = d?.messages ?? [];
  return (
    <div className="wrap wide" style={{ paddingBottom: 0 }}>
      <Top right={arch ? <span className="pill arch">🛡 Architect view</span> : undefined} onClose={onClose} />
      <div className="chathead">
        <div style={{ fontSize: 22 }}>💬</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="t">Community Room</div>
          <div className="tiny soft">{d && !d.flags.wilson_in_room ? "Wilson is taking a break from the room" : <>Wilson is listening · say <b className="grad" style={{ fontWeight: 500 }}>@Wilson</b> to ask him</>}</div>
        </div>
        <span className="pill"><span className="dot g" />{d?.online ?? 0} here</span>
      </div>
      {arch && d && (
        <div className="row" style={{ flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
          <span className="pill" style={d.open_reports ? { color: "var(--warn)", borderColor: "rgba(252,188,126,.45)" } : undefined}>⚑ {d.open_reports ?? 0} open report{d.open_reports === 1 ? "" : "s"}</span>
          <button type="button" className={`pill${d.flags.wilson_in_room ? " on" : ""}`} onClick={() => void flag("wilson_in_room", !d.flags.wilson_in_room)}>Wilson in room: {d.flags.wilson_in_room ? "on" : "off"}</button>
          <button type="button" className={`pill${d.flags.slow_mode ? " on" : ""}`} onClick={() => void flag("slow_mode", !d.flags.slow_mode)}>Slow mode: {d.flags.slow_mode ? "on" : "off"}</button>
          {!d.flags.room_open && <span className="pill" style={{ color: "var(--bad)" }}>Room closed to others</span>}
        </div>
      )}
      <div className="notice warn" style={{ marginBottom: 6 }}>⚠️ <b>Use at your own risk.</b> This is a public room. Be kind, don't share private info, and use ⚑ Report if something's wrong. Wilson can make mistakes.</div>
      {d?.me.new_account && !arch && <div className="tiny soft" style={{ margin: "6px 2px" }}>New accounts can post once every 30 seconds for their first day.</div>}
      {!d && !err && <div className="soft small" style={{ margin: 20, textAlign: "center" }}>Loading the room…</div>}
      {d && msgs.length === 0 && <div className="soft small" style={{ margin: 20, textAlign: "center" }}>It's quiet in here. Say hi 👋</div>}
      {msgs.map((m) => {
        const me = m.mine || mine.has(m.id);
        return (
          <div key={m.id} className={`msg${me ? " me" : ""}${m.wilson ? " wil" : ""}${m.hidden ? " hid" : ""}`}>
            {m.wilson ? <img src={BFLY} alt="" style={{ width: 30, height: 30, objectFit: "contain", filter: "drop-shadow(0 0 6px rgba(209,59,178,.7))", flex: "none" }} /> : !me && <Avatar name={m.username} />}
            <div style={{ minWidth: 0, display: "flex", flexDirection: "column", alignItems: me ? "flex-end" : "flex-start" }}>
              <div className="n">
                <span>{me ? "You" : m.username}</span>
                {m.wilson && <span className="pill" style={{ padding: "0 7px", fontSize: 9.5 }}>AI · live</span>}
                {m.architect && <span className="pill arch" style={{ padding: "0 7px", fontSize: 9.5 }}>🛡 Architect</span>}
                <span>· {when(m.created_at)}</span>
                {m.hidden && <span style={{ color: "var(--bad)" }}>· deleted</span>}
              </div>
              <div className="b">{m.body}</div>
              {arch ? (
                <div className="mod">
                  {m.hidden ? <button type="button" onClick={() => void archDo(`/arch/room/${m.id}/hide`, { hidden: false })}>↩ Restore</button>
                    : <button type="button" className="d" onClick={() => void archDo(`/arch/room/${m.id}/hide`, { hidden: true })}>🗑 Delete</button>}
                  {!m.wilson && !m.architect && m.user_id && <button type="button" className="d" onClick={() => void archDo(`/arch/room/${m.id}/block`, {}, `Block ${m.username} from the room? Their message will be hidden too.`)}>⛔ Block</button>}
                  {!!m.reports && <span className="w">⚑ {m.reports} report{m.reports === 1 ? "" : "s"}</span>}
                </div>
              ) : !me && !m.hidden ? (
                reporting === m.id ? (
                  <div className="mod">{REASONS.map((r) => <button key={r} type="button" onClick={() => void report(m.id, r)}>{r}</button>)}<button type="button" onClick={() => setReporting(null)}>Cancel</button></div>
                ) : <button type="button" className="flag" onClick={() => setReporting(m.id)}>⚑ Report</button>
              ) : null}
            </div>
          </div>
        );
      })}
      <div ref={endRef} />
      {msgs.length < 5 && <div aria-hidden style={{ minHeight: "max(0px, calc(100dvh - 560px))" }} />}
      {note && <div className="okmsg" role="status" style={{ textAlign: "center" }}>{note}</div>}
      {err && <div className="err" role="alert" style={{ textAlign: "center" }}>{err}</div>}
      {d?.me.blocked ? (
        <div className="composer"><div className="soft small" style={{ flex: 1, textAlign: "center" }}>You can't post in the room right now. You can still Message the Architect.</div></div>
      ) : (
        <form className="composer" onSubmit={(e) => { e.preventDefault(); void send(); }}>
          <div className="field"><input value={text} onChange={(e) => setText(e.target.value)} placeholder="Message the room…" maxLength={1000} aria-label="Message the room" disabled={!d} /></div>
          <button type="submit" className="sendb" disabled={busy || !text.trim() || !d} aria-label="Send">➤</button>
        </form>
      )}
    </div>
  );
}
