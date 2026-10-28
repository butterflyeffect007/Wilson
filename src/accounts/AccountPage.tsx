import { useEffect, useState } from "react";
import { api, errText, type AcctUser } from "./api";
import { updateUser } from "./store";
import { RecoveryCodeScreen } from "./AuthPages";
import { Avatar, Check, Foot, Password, Top, go, when } from "./ui";

type Panel = null | "email" | "password" | "code" | "claim" | "signout" | "delete";

export function AccountPage({ user, onClose, onSignOut, syncNote, notice }: { user: AcctUser | null; onClose: () => void; onSignOut: (removeLocal: boolean) => Promise<void> | void; syncNote: string | null; notice?: string }) {
  const [panel, setPanel] = useState<Panel>(null);
  const [unread, setUnread] = useState(0);
  const [betaReq, setBetaReq] = useState<string | null>(null);
  const [pw, setPw] = useState(""); const [pw2, setPw2] = useState("");
  const [email, setEmail] = useState(user?.email ?? "");
  const [claim, setClaim] = useState("");
  const [removeLocal, setRemoveLocal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [newCode, setNewCode] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    void api<{ user: AcctUser; unread_replies: number; beta_request: string | null }>("/acct/me").then((d) => { setUnread(d.unread_replies); setBetaReq(d.beta_request); updateUser(d.user); }).catch(() => {});
  }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const open = (p: Panel) => { setPanel(panel === p ? null : p); setErr(null); setOk(null); setPw(""); setPw2(""); setClaim(""); };
  const run = async (f: () => Promise<void>) => { setBusy(true); setErr(null); setOk(null); try { await f(); } catch (e) { setErr(errText(e)); } finally { setBusy(false); } };

  if (newCode) return <div className="wa-inner"><RecoveryCodeScreen code={newCode} again onDone={() => setNewCode(null)} /></div>;
  if (!user) return (
    <div className="wrap"><Top onClose={onClose} />
      <div className="card" style={{ textAlign: "center", marginTop: 30 }}>
        <h1>Your account</h1><div className="soft small" style={{ margin: "8px 0" }}>Sign in to keep your chats safe across devices.</div>
        <button type="button" className="btn" onClick={() => go("#signin")}>Sign in</button>
        <button type="button" className="btn ghost" onClick={() => go("#signup")}>Create account</button>
      </div>
    </div>
  );

  const errOk = <>{err && <div className="err" role="alert">{err}</div>}{ok && <div className="okmsg" role="status">{ok}</div>}</>;
  return (
    <div className="wrap">
      <Top onClose={onClose} />
      {notice && <div className="card soft small" role="status" style={{ marginBottom: 12 }}>🛡 {notice}</div>}
      <div className="card row" style={{ gap: 12 }}>
        <Avatar name={user.username} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="row" style={{ gap: 6, flexWrap: "wrap" }}><b style={{ fontWeight: 500, fontSize: 16 }}>{user.username}</b>
            {user.architect && <span className="pill arch">🛡 Architect</span>}{user.beta && <span className="pill">✦ beta</span>}</div>
          <div className="tiny soft">Joined {when(user.created_at)}{syncNote ? ` · ${syncNote}` : ""}</div>
        </div>
      </div>

      <div className="sec">Wilson</div>
      <div className="card">
        {user.architect && <button type="button" className="li link" style={{ width: "100%", color: "var(--text)" }} onClick={() => go("#architect")}>🛡 <span style={{ flex: 1, textAlign: "left" }}>Architect dashboard</span>›</button>}
        <button type="button" className="li link" style={{ width: "100%", color: "var(--text)" }} onClick={() => go("#room")}>💬 <span style={{ flex: 1, textAlign: "left" }}>Community room</span>›</button>
        <button type="button" className="li link" style={{ width: "100%", color: "var(--text)" }} onClick={() => go("#message")}>✉️ <span style={{ flex: 1, textAlign: "left" }}>Message the Architect{unread ? <span className="pill on" style={{ marginLeft: 8 }}>{unread} new repl{unread === 1 ? "y" : "ies"}</span> : null}</span>›</button>
        {!user.architect && <button type="button" className="li link" style={{ width: "100%", color: "var(--text)" }} onClick={() => go("#beta")}>✨ <span style={{ flex: 1, textAlign: "left" }}>Beta testing{user.beta ? " · you're in" : betaReq === "pending" ? " · request sent" : ""}</span>›</button>}
      </div>

      <div className="sec">Security</div>
      <div className="card">
        <button type="button" className="li link" style={{ width: "100%", color: "var(--text)" }} onClick={() => open("password")}>🔒 <span style={{ flex: 1, textAlign: "left" }}>Change password</span>{panel === "password" ? "⌄" : "›"}</button>
        {panel === "password" && <form className="sheet" onSubmit={(e) => { e.preventDefault(); void run(async () => { if (pw2.length < 10) throw new Error("New passwords need at least 10 characters."); await api("/acct/password", { body: { password: pw, new_password: pw2 } }); setOk("Password changed. Your other devices were signed out."); setPw(""); setPw2(""); }); }}>
          <label className="lbl" htmlFor="wa-ap1" style={{ marginTop: 0 }}>Current password</label><Password id="wa-ap1" value={pw} onChange={setPw} autoComplete="current-password" />
          <label className="lbl" htmlFor="wa-ap2">New password</label><Password id="wa-ap2" value={pw2} onChange={setPw2} autoComplete="new-password" placeholder="At least 10 characters" />
          {errOk}<button type="submit" className="btn sm" disabled={busy}>Change password</button>
        </form>}
        <button type="button" className="li link" style={{ width: "100%", color: "var(--text)" }} onClick={() => open("code")}>🗝️ <span style={{ flex: 1, textAlign: "left" }}>New recovery code</span>{panel === "code" ? "⌄" : "›"}</button>
        {panel === "code" && <form className="sheet" onSubmit={(e) => { e.preventDefault(); void run(async () => { const d = await api<{ recovery_code: string }>("/acct/recovery-code", { body: { password: pw } }); setPw(""); setPanel(null); setNewCode(d.recovery_code); }); }}>
          <div className="small soft">Lost your code? Make a new one. The old one stops working.</div>
          <label className="lbl" htmlFor="wa-ac1">Password</label><Password id="wa-ac1" value={pw} onChange={setPw} autoComplete="current-password" />
          {errOk}<button type="submit" className="btn sm" disabled={busy || !pw}>Make a new code</button>
        </form>}
        <button type="button" className="li link" style={{ width: "100%", color: "var(--text)" }} onClick={() => { open("email"); setEmail(user.email ?? ""); }}>✉ <span style={{ flex: 1, textAlign: "left" }}>Email <span className="soft tiny">{user.email ? user.email : "not added"}</span></span>{panel === "email" ? "⌄" : "›"}</button>
        {panel === "email" && <form className="sheet" onSubmit={(e) => { e.preventDefault(); void run(async () => { await api("/acct/email", { body: { email: email.trim() } }); updateUser({ ...user, email: email.trim() }); setOk(email.trim() ? "Saved." : "Email removed."); }); }}>
          <div className="small soft">Optional. Saved for future reset links. Resets currently use your recovery code.</div>
          <div className="field" style={{ marginTop: 8 }}><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" autoComplete="email" /></div>
          {errOk}<button type="submit" className="btn sm" disabled={busy}>Save</button>
        </form>}
        {!user.architect && <>
          <button type="button" className="li link" style={{ width: "100%", color: "var(--text)" }} onClick={() => open("claim")}>🛡 <span style={{ flex: 1, textAlign: "left" }}>Claim Architect</span>{panel === "claim" ? "⌄" : "›"}</button>
          {panel === "claim" && <form className="sheet" onSubmit={(e) => { e.preventDefault(); void run(async () => { const d = await api<{ user: AcctUser }>("/acct/claim-architect", { body: { claim: claim.trim() } }); setClaim(""); updateUser(d.user); setOk("You're the Architect now. 🛡"); }); }}>
            <div className="small soft">Only for Jenny. Paste the one-time Architect claim code.</div>
            <div className="field" style={{ marginTop: 8 }}><input className="mono" value={claim} onChange={(e) => setClaim(e.target.value)} autoComplete="off" autoCapitalize="none" spellCheck={false} aria-label="Architect claim code" /></div>
            {errOk}<button type="submit" className="btn sm" disabled={busy || !claim.trim()}>Claim</button>
          </form>}
        </>}
      </div>

      <div className="sec">Session</div>
      <div className="card">
        <button type="button" className="li link" style={{ width: "100%", color: "var(--text)" }} onClick={() => open("signout")}>↩ <span style={{ flex: 1, textAlign: "left" }}>Sign out</span>{panel === "signout" ? "⌄" : "›"}</button>
        {panel === "signout" && <div className="sheet">
          <div className="small soft">Your chats stay saved in your account.</div>
          <Check on={removeLocal} onChange={setRemoveLocal}>Also remove my synced chats from this device</Check>
          <button type="button" className="btn sm" disabled={busy} onClick={() => void run(async () => { await onSignOut(removeLocal); })}>Sign out</button>
        </div>}
        {!user.architect && <>
          <button type="button" className="li link" style={{ width: "100%", color: "var(--bad)" }} onClick={() => open("delete")}>🗑 <span style={{ flex: 1, textAlign: "left" }}>Delete my account &amp; data</span>{panel === "delete" ? "⌄" : "›"}</button>
          {panel === "delete" && <form className="sheet" onSubmit={(e) => { e.preventDefault(); void run(async () => { await api("/acct/me", { method: "DELETE", body: { password: pw } }); setPw(""); await onSignOut(removeLocal); }); }}>
            <div className="small">This permanently deletes your account, your saved chats, messages and room posts from Wilson's server. It can't be undone.</div>
            <label className="lbl" htmlFor="wa-ad1">Password</label><Password id="wa-ad1" value={pw} onChange={setPw} autoComplete="current-password" />
            <Check on={removeLocal} onChange={setRemoveLocal}>Also remove the chats on this device</Check>
            {errOk}<button type="submit" className="btn danger sm" disabled={busy || !pw}>Delete everything</button>
          </form>}
        </>}
      </div>
      <Foot />
    </div>
  );
}
