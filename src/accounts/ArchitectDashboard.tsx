import { useCallback, useEffect, useState } from "react";
import { api, errText, type AcctUser, type Flags } from "./api";
import { Avatar, Top, go, when } from "./ui";

type Overview = {
  people: { accounts: number; new_this_week: number; signins_7d: number; active_today: number; active_7d: number; active_prev_7d: number; chats_today: number; chat_fails_today: number; series: { day: string; chats: number }[] };
  brain: { kind: string; name: string; calls: number; fails: number }[];
  quotas: { name: string; used: number; limit: number | null; unit: string; note?: string }[];
  not_measured: string[];
  room: { online: number; open_reports: number };
  voice_today: { ok: number; fail: number };
  counts: { beta_pending: number; inbox_new: number };
  architect_claimed: boolean;
};
type U = { id: string; username: string; email: string; architect: boolean; beta: boolean; disabled: boolean; room_blocked: boolean; created_at: number; last_seen: number | null; chats: number };
type BetaReq = { id: number; user_id: string | null; username: string; note: string; uses: string[]; status: string; created_at: number; joined: number | null };
type InMsg = { id: number; user_id: string | null; username: string | null; contact: string | null; topic: string; body: string; context: string | null; status: string; created_at: number; replies: { body: string; created_at: number }[] };
type Report = { id: number; room_id: number; reason: string; status: string; created_at: number; username: string; body: string; user_id: string | null; hidden: number; reporter: string };
type Tab = "overview" | "users" | "inbox" | "controls";

const TOPIC: Record<string, string> = { idea: "💡 Idea", bug: "🪲 Bug", question: "❓ Question", hi: "👋 Hi", "lost-access": "🔑 Can't get in" };
const FLAG_INFO: [keyof Flags, string, string][] = [
  ["signups_open", "New sign-ups", "Let new people create accounts"],
  ["room_open", "Community room", "Room is open to everyone signed in"],
  ["wilson_in_room", "Wilson in the room", "Replies when someone says @Wilson"],
  ["slow_mode", "Slow mode", "One room message every 30 seconds"],
  ["beta_open", "Beta requests", "Accept new beta tester requests"],
  ["voice_for_all", "Server voice for everyone", "Off = only you get the server voice"],
  ["maintenance", "Maintenance mode", "Pauses chat for everyone but you"],
];
const n = (x: number) => x.toLocaleString();
const fmt = (v: number, unit: string) => unit === "bytes" ? (v < 1048576 ? `${(v / 1024).toFixed(0)} KB` : v < 1073741824 ? `${(v / 1048576).toFixed(1)} MB` : `${(v / 1073741824).toFixed(2)} GB`) : n(v);
const greet = () => { const h = new Date().getHours(); return h < 5 ? "Good night" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening"; };
const pct = (f: number, c: number) => c + f === 0 ? 0 : Math.round((f / (c + f)) * 100);

function Spark({ series }: { series: { day: string; chats: number }[] }) {
  const max = Math.max(1, ...series.map((s) => s.chats));
  const W = 300, H = 60, step = W / Math.max(1, series.length - 1);
  const pts = series.map((s, i) => [i * step, H - 4 - (s.chats / max) * (H - 10)]);
  const line = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="60" preserveAspectRatio="none" role="img" aria-label="Chats per day, last 14 days">
      <defs>
        <linearGradient id="wa-sl" x1="0" x2="1"><stop offset="0" stopColor="#38B2DA" /><stop offset=".5" stopColor="#6E21B0" /><stop offset="1" stopColor="#D13BB2" /></linearGradient>
        <linearGradient id="wa-sf" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#D13BB2" stopOpacity=".35" /><stop offset="1" stopColor="#D13BB2" stopOpacity="0" /></linearGradient>
      </defs>
      <path d={`${line} L${W},${H} L0,${H} Z`} fill="url(#wa-sf)" />
      <path d={line} fill="none" stroke="url(#wa-sl)" strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export function ArchitectDashboard({ user, onClose }: { user: AcctUser | null; onClose: () => void }) {
  const [tab, setTab] = useState<Tab>("overview");
  const [ov, setOv] = useState<Overview | null>(null);
  const [lat, setLat] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [beta, setBeta] = useState<BetaReq[] | null>(null);
  const [inbox, setInbox] = useState<{ messages: InMsg[]; reports: Report[] } | null>(null);
  const [users, setUsers] = useState<U[] | null>(null);
  const [q, setQ] = useState("");
  const [flags, setFlags] = useState<Flags | null>(null);
  const [banner, setBanner] = useState<{ text: string; until: number } | null>(null);

  const loadOv = useCallback(async () => {
    const t0 = performance.now();
    try { const d = await api<Overview>("/arch/overview"); setLat(Math.round(performance.now() - t0)); setOv(d); setErr(null); } catch (e) { setErr(errText(e)); }
  }, []);
  const loadBeta = useCallback(() => api<{ requests: BetaReq[] }>("/arch/beta").then((d) => setBeta(d.requests)).catch((e) => setErr(errText(e))), []);
  const loadInbox = useCallback(() => api<{ messages: InMsg[]; reports: Report[] }>("/arch/inbox").then(setInbox).catch((e) => setErr(errText(e))), []);
  const loadUsers = useCallback((s = "") => api<{ users: U[] }>(`/arch/users?q=${encodeURIComponent(s)}`).then((d) => setUsers(d.users)).catch((e) => setErr(errText(e))), []);
  const loadFlags = useCallback(() => api<{ flags: Flags; banner: { text: string; until: number } | null }>("/arch/flags").then((d) => { setFlags(d.flags); setBanner(d.banner && d.banner.until > Date.now() ? d.banner : null); }).catch((e) => setErr(errText(e))), []);

  useEffect(() => { void loadOv(); void loadBeta(); void loadInbox(); void loadUsers(); void loadFlags(); }, [loadOv, loadBeta, loadInbox, loadUsers, loadFlags]);
  useEffect(() => { const t = window.setInterval(() => { if (document.visibilityState === "visible") void loadOv(); }, 60000); return () => clearInterval(t); }, [loadOv]);

  const inboxCount = (inbox?.messages.filter((m) => m.status === "new").length ?? 0) + (inbox?.reports.filter((r) => r.status === "open").length ?? 0);
  const p = ov?.people;
  const trend = p && p.active_prev_7d > 0 ? Math.round(((p.active_7d - p.active_prev_7d) / p.active_prev_7d) * 100) : null;

  return (
    <div className="wrap wide">
      <Top right={<span className="pill arch">🛡 Architect</span>} onClose={onClose} />
      <div style={{ margin: "6px 2px 14px" }}>
        <h1>{greet()}, Jenny</h1>
        <div className="soft small" style={{ marginTop: 3 }}>Only you can see this dashboard.{user ? ` Signed in as ${user.username}.` : ""}</div>
      </div>
      <div className="tabs" role="tablist" style={{ marginBottom: 6 }}>
        {(["overview", "users", "inbox", "controls"] as Tab[]).map((t) => (
          <button key={t} type="button" role="tab" aria-selected={tab === t} className={tab === t ? "on" : ""} onClick={() => setTab(t)}>
            {t === "inbox" ? `Inbox${inboxCount ? ` · ${inboxCount}` : ""}` : t[0].toUpperCase() + t.slice(1)}
          </button>
        ))}
        <button type="button" role="tab" aria-selected={false} onClick={() => go("#room")}>Room</button>
      </div>
      {err && <div className="err" role="alert">{err}</div>}

      {tab === "overview" && (
        !ov ? <div className="soft small" style={{ margin: 20 }}>Loading real numbers…</div> : <>
          <div className="sec">People</div>
          <div className="card">
            <div className="stats">
              <div className="stat"><div className="v">{n(ov.people.accounts)}</div><div className="l">Accounts{ov.people.new_this_week ? ` · +${ov.people.new_this_week} this week` : ""}</div></div>
              <div className="stat"><div className="v">{n(ov.people.signins_7d)}</div><div className="l">Sign-ins · 7 days</div></div>
              <div className="stat"><div className="v">{n(ov.people.active_today)}</div><div className="l">Active today</div></div>
              <div className="stat"><div className="v">{n(ov.people.active_7d)}</div><div className="l">Active this week{trend !== null ? ` · ${trend >= 0 ? "▲" : "▼"} ${Math.abs(trend)}%` : ""}</div></div>
            </div>
            <div className="row between tiny soft" style={{ marginTop: 14 }}><span>Chats per day · last 14 days</span><span>today {n(ov.people.chats_today)}{ov.people.chat_fails_today ? ` · ${ov.people.chat_fails_today} failed` : ""}</span></div>
            <Spark series={ov.people.series} />
            <div className="tiny soft" style={{ marginTop: 4 }}>Counted by your worker itself. No outside trackers.</div>
          </div>

          <div className="sec">Wilson's brain · last 7 days</div>
          <div className="card">
            {ov.brain.length === 0 ? <div className="soft small">No tool or model calls counted yet. These fill in as people chat.</div> : ov.brain.slice(0, 14).map((b) => {
              const f = pct(b.fails, b.calls);
              return (
                <div key={`${b.kind}:${b.name}`} className="li">
                  <span style={{ width: 18 }}>{b.kind === "tool" ? "🛠" : b.kind === "voice" ? "🔊" : "🧠"}</span>
                  <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{b.name}</span>
                  <span className="tiny soft">{n(b.calls)} ok</span>
                  <span className="pill" style={{ color: f >= 20 ? "var(--bad)" : f >= 5 ? "var(--warn)" : "var(--ok)" }}>{f}% fail</span>
                </div>
              );
            })}
          </div>

          <div className="sec">Free-tier limits</div>
          <div className="card">
            {ov.quotas.map((x) => (
              <div key={x.name} style={{ margin: "4px 0 12px" }}>
                <div className="row between small"><span>{x.name}</span><span className="soft tiny">{fmt(x.used, x.unit)}{x.limit ? ` / ${fmt(x.limit, x.unit)}` : ` · ${x.note ?? "limit unknown"}`}</span></div>
                {x.limit ? <div className="bar"><i style={{ width: `${Math.min(100, Math.max(1.5, (x.used / x.limit) * 100))}%` }} /></div> : null}
              </div>
            ))}
            {ov.not_measured.map((x) => <div key={x} className="row between small" style={{ margin: "6px 0" }}><span className="soft">{x.split(" — ")[0]}</span><span className="pill">not measured</span></div>)}
          </div>

          <div className="sec">Service health</div>
          <div className="card">
            <div className="li"><span className={`dot ${lat === null ? "gr" : lat < 1500 ? "g" : "y"}`} /><span style={{ flex: 1 }}>Wilson worker</span><span className="soft tiny">{lat === null ? "—" : `${lat} ms just now`}</span></div>
            <div className="li"><span className={`dot ${ov.voice_today.ok + ov.voice_today.fail === 0 ? "gr" : pct(ov.voice_today.fail, ov.voice_today.ok) >= 20 ? "y" : "g"}`} /><span style={{ flex: 1 }}>Voice (server)</span><span className="soft tiny">{ov.voice_today.ok + ov.voice_today.fail === 0 ? "no voice calls today" : `${n(ov.voice_today.ok)} ok · ${n(ov.voice_today.fail)} failed today`}</span></div>
            <div className="li"><span className="dot gr" /><span style={{ flex: 1 }}>Silver Harbor</span><span className="soft tiny">unknown · not monitored</span></div>
            <div className="li"><span className="dot g" /><span style={{ flex: 1 }}>Community room</span><span className="soft tiny">{ov.room.online} here now{ov.room.open_reports ? ` · ⚑ ${ov.room.open_reports} open` : ""}</span></div>
          </div>

          <div className="sec">Beta requests{ov.counts.beta_pending ? ` · ${ov.counts.beta_pending} waiting` : ""}</div>
          <BetaList list={beta} reload={() => { void loadBeta(); void loadOv(); }} setErr={setErr} />

          <div className="sec">Inbox</div>
          <div className="card">
            {!inbox ? <div className="soft small">Loading…</div> : inbox.messages.length + inbox.reports.length === 0 ? <div className="soft small">Nothing yet.</div> : <>
              {inbox.messages.slice(0, 3).map((m) => <div key={`m${m.id}`} className="li"><span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{TOPIC[m.topic] ?? "✉"} · <b style={{ fontWeight: 500 }}>{m.username ?? "someone"}</b> <span className="soft">{m.body}</span></span>{m.status === "new" && <span className="dot rd" />}<button type="button" className="btn ghost sm" style={{ width: "auto", marginTop: 0 }} onClick={() => setTab("inbox")}>Reply</button></div>)}
              {inbox.reports.filter((r) => r.status === "open").slice(0, 2).map((r) => <div key={`r${r.id}`} className="li"><span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>⚑ Report · <b style={{ fontWeight: 500 }}>{r.username}</b> <span className="soft">{r.reason}</span></span><button type="button" className="btn ghost sm" style={{ width: "auto", marginTop: 0 }} onClick={() => setTab("inbox")}>Review</button></div>)}
            </>}
          </div>
          {!ov.architect_claimed && <div className="tiny soft" style={{ margin: "14px 4px" }}>No Architect account has been claimed yet. Claim yours from Account → Claim Architect (code is in your secrets file).</div>}
        </>
      )}

      {tab === "users" && (
        <>
          <form className="row" style={{ margin: "14px 0 8px" }} onSubmit={(e) => { e.preventDefault(); void loadUsers(q.trim()); }}>
            <div className="field" style={{ flex: 1 }}><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search usernames" autoCapitalize="none" spellCheck={false} /></div>
            <button type="submit" className="btn ghost sm" style={{ width: "auto", marginTop: 0 }}>Search</button>
          </form>
          <div className="card">
            {!users ? <div className="soft small">Loading…</div> : users.length === 0 ? <div className="soft small">No accounts yet.</div> : users.map((u) => <UserRow key={u.id} u={u} reload={() => { void loadUsers(q.trim()); void loadOv(); }} setErr={setErr} />)}
          </div>
        </>
      )}

      {tab === "inbox" && <InboxTab inbox={inbox} reload={() => { void loadInbox(); void loadOv(); }} setErr={setErr} />}

      {tab === "controls" && (
        <>
          <div className="sec">Broadcast banner</div>
          <BannerCard banner={banner} reload={loadFlags} setErr={setErr} />
          <div className="sec">Feature switches</div>
          <div className="card">
            {!flags ? <div className="soft small">Loading…</div> : FLAG_INFO.map(([k, label, hint]) => (
              <div key={k} className="li">
                <div style={{ flex: 1 }}><div>{label}</div><div className="tiny soft">{hint}</div></div>
                <button type="button" role="switch" aria-checked={!!flags[k]} aria-label={label} className={`toggle${flags[k] ? " on" : ""}`} onClick={async () => {
                  const v = !flags[k]; setFlags({ ...flags, [k]: v });
                  try { const d = await api<{ flags: Flags }>("/arch/flags", { body: { [k]: v } }); setFlags(d.flags); } catch (e) { setErr(errText(e)); void loadFlags(); }
                }} />
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function BetaList({ list, reload, setErr }: { list: BetaReq[] | null; reload: () => void; setErr: (s: string) => void }) {
  const decide = async (id: number, decision: "approve" | "decline") => { try { await api(`/arch/beta/${id}`, { body: { decision } }); reload(); } catch (e) { setErr(errText(e)); } };
  const shown = (list ?? []).filter((r) => r.status === "pending").concat((list ?? []).filter((r) => r.status !== "pending").slice(0, 3));
  return (
    <div className="card">
      {!list ? <div className="soft small">Loading…</div> : shown.length === 0 ? <div className="soft small">No requests yet.</div> : shown.map((r) => (
        <div key={r.id} className="li" style={{ alignItems: "flex-start" }}>
          <Avatar name={r.username} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div><b style={{ fontWeight: 500 }}>{r.username}</b> <span className="tiny soft">· {when(r.created_at)}{r.joined ? ` · joined ${when(r.joined)}` : ""}</span></div>
            {r.note && <div className="tiny soft" style={{ marginTop: 2 }}>“{r.note}”</div>}
          </div>
          {r.status === "pending" ? <div className="row" style={{ gap: 6 }}>
            <button type="button" className="btn sm" style={{ width: "auto", marginTop: 0 }} onClick={() => void decide(r.id, "approve")}>Approve</button>
            <button type="button" className="btn ghost sm" style={{ width: "auto", marginTop: 0 }} onClick={() => void decide(r.id, "decline")}>Decline</button>
          </div> : <span className="pill">{r.status}</span>}
        </div>
      ))}
    </div>
  );
}

function UserRow({ u, reload, setErr }: { u: U; reload: () => void; setErr: (s: string) => void }) {
  const [open, setOpen] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const [typed, setTyped] = useState("");
  const [code, setCode] = useState<string | null>(null);
  const act = async (path: string, body: unknown, method?: string) => { try { const d = await api<{ recovery_code?: string }>(path, { body, method }); if (d.recovery_code) setCode(d.recovery_code); reload(); return true; } catch (e) { setErr(errText(e)); return false; } };
  return (
    <div className="li" style={{ flexWrap: "wrap" }}>
      <Avatar name={u.username} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="row" style={{ gap: 6, flexWrap: "wrap" }}><b style={{ fontWeight: 500 }}>{u.username}</b>
          {u.architect && <span className="pill arch" style={{ padding: "0 7px", fontSize: 9.5 }}>🛡 Architect</span>}
          {u.beta && <span className="pill" style={{ padding: "0 7px", fontSize: 9.5 }}>beta</span>}
          {u.disabled && <span className="pill" style={{ padding: "0 7px", fontSize: 9.5, color: "var(--bad)" }}>off</span>}
          {u.room_blocked && <span className="pill" style={{ padding: "0 7px", fontSize: 9.5, color: "var(--warn)" }}>room blocked</span>}
        </div>
        <div className="tiny soft">{u.chats} chat{u.chats === 1 ? "" : "s"} · joined {when(u.created_at)}{u.last_seen ? ` · seen ${when(u.last_seen)}` : ""}{u.email ? ` · ${u.email}` : ""}</div>
      </div>
      {!u.architect && <button type="button" className="iconbtn" aria-label={`Actions for ${u.username}`} onClick={() => { setOpen(!open); setConfirmDel(false); setCode(null); }}>⋯</button>}
      {open && (
        <div className="sheet" style={{ width: "100%" }}>
          {code ? <>
            <div className="small">New recovery code for <b>{u.username}</b>. Give it to them privately; they use it on “Forgot password?”. It's shown only here.</div>
            <div className="code" style={{ fontSize: 18 }}>{code}</div>
            <button type="button" className="btn ghost sm" onClick={() => { void navigator.clipboard?.writeText(code); }}>⧉ Copy</button>
          </> : confirmDel ? <>
            <div className="small">This permanently removes <b>{u.username}</b> and all their chats, messages and room posts. Type the username to confirm.</div>
            <div className="field" style={{ marginTop: 8 }}><input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={u.username} autoCapitalize="none" spellCheck={false} /></div>
            <button type="button" className="btn danger sm" disabled={typed.trim().toLowerCase() !== u.username} onClick={() => void act(`/arch/users/${u.id}`, { confirm: typed.trim().toLowerCase() }, "DELETE")}>Remove account &amp; data</button>
            <button type="button" className="btn ghost sm" onClick={() => setConfirmDel(false)}>Cancel</button>
          </> : <div style={{ display: "grid", gap: 6 }}>
            <button type="button" className="btn ghost sm" style={{ marginTop: 0 }} onClick={() => { if (window.confirm(`Make a new recovery code for ${u.username}? This signs them out everywhere and their old code stops working.`)) void act(`/arch/users/${u.id}/reset`, {}); }}>🔑 Reset password (new recovery code)</button>
            <button type="button" className="btn ghost sm" style={{ marginTop: 0 }} onClick={() => void act(`/arch/users/${u.id}/disable`, { disabled: !u.disabled })}>{u.disabled ? "▶ Turn account back on" : "⏸ Disable account"}</button>
            <button type="button" className="btn ghost sm" style={{ marginTop: 0 }} onClick={() => void act(`/arch/users/${u.id}/beta`, { beta: !u.beta })}>{u.beta ? "Remove beta" : "✦ Make beta tester"}</button>
            <button type="button" className="btn ghost sm" style={{ marginTop: 0 }} onClick={() => void act(`/arch/users/${u.id}/block`, { blocked: !u.room_blocked })}>{u.room_blocked ? "Unblock from room" : "⛔ Block from room"}</button>
            <button type="button" className="btn danger sm" style={{ marginTop: 0 }} onClick={() => { setTyped(""); setConfirmDel(true); }}>🗑 Remove account &amp; data…</button>
          </div>}
        </div>
      )}
    </div>
  );
}

function InboxTab({ inbox, reload, setErr }: { inbox: { messages: InMsg[]; reports: Report[] } | null; reload: () => void; setErr: (s: string) => void }) {
  const [replyTo, setReplyTo] = useState<number | null>(null);
  const [text, setText] = useState("");
  const post = async (path: string, body: unknown) => { try { await api(path, { body }); reload(); return true; } catch (e) { setErr(errText(e)); return false; } };
  if (!inbox) return <div className="soft small" style={{ margin: 20 }}>Loading…</div>;
  const open = inbox.reports.filter((r) => r.status === "open");
  return (
    <>
      <div className="sec">Room reports{open.length ? ` · ${open.length} open` : ""}</div>
      <div className="card">
        {open.length === 0 ? <div className="soft small">No open reports.</div> : open.map((r) => (
          <div key={r.id} className="li" style={{ alignItems: "flex-start", flexWrap: "wrap" }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="small"><b style={{ fontWeight: 500 }}>{r.username}</b> <span className="soft">said</span> “{r.body}”</div>
              <div className="tiny soft">⚑ {r.reason || "no reason"} · reported by {r.reporter ?? "someone"} · {when(r.created_at)}{r.hidden ? " · already deleted" : ""}</div>
              <div className="mod">
                {!r.hidden && <button type="button" className="d" onClick={() => void post(`/arch/room/${r.room_id}/hide`, { hidden: true })}>🗑 Delete</button>}
                {r.user_id && <button type="button" className="d" onClick={() => { if (window.confirm(`Block ${r.username} from the room?`)) void post(`/arch/room/${r.room_id}/block`, {}); }}>⛔ Block</button>}
                <button type="button" onClick={() => void post(`/arch/reports/${r.id}`, { status: "resolved" })}>✓ Looks fine</button>
              </div>
            </div>
          </div>
        ))}
      </div>
      <div className="sec">Messages</div>
      <div className="card">
        {inbox.messages.length === 0 ? <div className="soft small">No messages yet.</div> : inbox.messages.map((m) => (
          <div key={m.id} className="li" style={{ alignItems: "flex-start", flexWrap: "wrap" }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="row between small"><span>{TOPIC[m.topic] ?? "✉"} · <b style={{ fontWeight: 500 }}>{m.username ?? "someone"}</b>{!m.user_id && <span className="soft"> · not signed in</span>}</span><span className="pill">{m.status}</span></div>
              <div className="small" style={{ marginTop: 4, whiteSpace: "pre-wrap" }}>{m.body}</div>
              {m.contact && <div className="tiny soft" style={{ marginTop: 3 }}>Contact they left: {m.contact}</div>}
              {m.context && <details className="tiny soft" style={{ marginTop: 4 }}><summary>Chat lines they attached</summary><div style={{ whiteSpace: "pre-wrap", marginTop: 4 }}>{m.context}</div></details>}
              {m.replies.map((r, i) => <div key={i} className="tiny" style={{ marginTop: 5, color: "var(--accent)" }}>↳ You · {when(r.created_at)}: <span style={{ color: "var(--text)" }}>{r.body}</span></div>)}
              <div className="tiny soft" style={{ marginTop: 3 }}>{when(m.created_at)}</div>
              {replyTo === m.id ? (
                <form onSubmit={async (e) => { e.preventDefault(); if (await post(`/arch/inbox/${m.id}/reply`, { body: text })) { setText(""); setReplyTo(null); } }}>
                  <div className="field" style={{ marginTop: 8 }}><textarea value={text} onChange={(e) => setText(e.target.value)} maxLength={2000} placeholder={`Reply to ${m.username ?? "them"}…`} /></div>
                  <div className="row"><button type="submit" className="btn sm" disabled={!text.trim()}>Send reply</button><button type="button" className="btn ghost sm" onClick={() => setReplyTo(null)}>Cancel</button></div>
                </form>
              ) : (
                <div className="mod">
                  {m.user_id ? <button type="button" onClick={() => { setReplyTo(m.id); setText(""); }}>↩ Reply</button> : <span>Reply using their contact</span>}
                  {m.status === "new" && <button type="button" onClick={() => void post(`/arch/inbox/${m.id}/status`, { status: "seen" })}>Mark seen</button>}
                  {m.status !== "done" && <button type="button" onClick={() => void post(`/arch/inbox/${m.id}/status`, { status: "done" })}>✓ Done</button>}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

function BannerCard({ banner, reload, setErr }: { banner: { text: string; until: number } | null; reload: () => void; setErr: (s: string) => void }) {
  const [text, setText] = useState("");
  const [hours, setHours] = useState(24);
  const [ok, setOk] = useState<string | null>(null);
  const publish = async (t: string) => {
    try { await api("/arch/banner", { body: { text: t, hours } }); setOk(t ? "Published. Everyone sees it on their next visit." : "Banner removed."); setText(""); reload(); setTimeout(() => setOk(null), 4000); } catch (e) { setErr(errText(e)); }
  };
  return (
    <div className="card">
      {banner && <div className="notice" style={{ marginBottom: 10 }}>Live now: “{banner.text}” <span className="soft">· until {new Date(banner.until).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span>
        <div><button type="button" className="link" style={{ fontSize: 12 }} onClick={() => void publish("")}>Remove banner</button></div></div>}
      <div className="field"><textarea value={text} onChange={(e) => setText(e.target.value)} maxLength={280} placeholder="A short message everyone sees at the top of Wilson" style={{ minHeight: 70 }} /></div>
      <div className="row" style={{ marginTop: 10 }}>
        <span className="small soft">Show for</span>
        <div className="field" style={{ width: 90, padding: "6px 10px" }}><input type="number" min={1} max={720} value={hours} onChange={(e) => setHours(Number(e.target.value) || 24)} aria-label="Hours" /></div>
        <span className="small soft">hours</span>
        <div className="sp" />
        <button type="button" className="btn sm" style={{ width: "auto", marginTop: 0 }} disabled={!text.trim()} onClick={() => void publish(text.trim())}>Publish</button>
      </div>
      {ok && <div className="okmsg">{ok}</div>}
    </div>
  );
}
