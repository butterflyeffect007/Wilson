import { useEffect, useRef, useState } from "react";
import { api, errText, type AcctUser } from "./api";
import { setSession } from "./store";
import { BFLY, Check, Foot, Password, PrivacyNotice, Top, go } from "./ui";

type AuthRes = { token: string; user: AcctUser; recovery_code?: string };
const USER_RE = /^[a-z0-9][a-z0-9_.-]{2,23}$/;

function strength(pw: string): { n: number; label: string } {
  if (!pw) return { n: 0, label: "" };
  let n = 0;
  if (pw.length >= 10) n++;
  if (pw.length >= 14) n++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) n++;
  if (/\d/.test(pw) && /[^A-Za-z0-9]/.test(pw)) n++;
  if (pw.length < 10) n = Math.min(n, 1);
  return { n: Math.max(1, n), label: pw.length < 10 ? "Too short" : ["Weak", "Weak", "Okay", "Good", "Strong"][n] };
}

export function AuthPage({ mode, onClose, onSignedIn, onRecovery, signupsOpen }: {
  mode: "signin" | "signup"; onClose: () => void; onSignedIn: () => void; onRecovery: (code: string) => void; signupsOpen: boolean;
}) {
  const [username, setUsername] = useState(() => { try { return localStorage.getItem("wilson_acct_last_user") || ""; } catch { return ""; } });
  const [password, setPassword] = useState("");
  const [email, setEmail] = useState("");
  const [keep, setKeep] = useState(true);
  const [agreed, setAgreed] = useState(false);
  const [claimOpen, setClaimOpen] = useState(false);
  const [claim, setClaim] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [avail, setAvail] = useState<null | "checking" | "yes" | "no" | "bad">(null);
  const uNorm = username.trim().toLowerCase();
  const signup = mode === "signup";
  const t = useRef<number | null>(null);
  useEffect(() => { setErr(null); }, [mode]);
  useEffect(() => {
    if (!signup) { setAvail(null); return; }
    if (!uNorm) { setAvail(null); return; }
    if (!USER_RE.test(uNorm)) { setAvail("bad"); return; }
    setAvail("checking");
    if (t.current) clearTimeout(t.current);
    t.current = window.setTimeout(() => {
      void api<{ available: boolean }>(`/acct/available?u=${encodeURIComponent(uNorm)}`, { token: null }).then((d) => setAvail(d.available ? "yes" : "no")).catch(() => setAvail(null));
    }, 450);
  }, [uNorm, signup]);
  const st = strength(password);

  const submit = async () => {
    setErr(null);
    if (!uNorm) return setErr("Enter your username.");
    if (!password) return setErr("Enter your password.");
    if (signup) {
      if (!USER_RE.test(uNorm)) return setErr("Usernames are 3–24 letters, numbers, dots, dashes or underscores.");
      if (password.length < 10) return setErr("Passwords need at least 10 characters.");
      if (!agreed) return setErr("Please read the Privacy & Data notice and tick the box.");
    }
    setBusy(true);
    try {
      const d = await api<AuthRes>(signup ? "/acct/signup" : "/acct/login", { token: null, body: signup ? { username: uNorm, password, email: email.trim(), keep, claim: claim.trim() || undefined } : { username: uNorm, password, keep } });
      try { localStorage.setItem("wilson_acct_last_user", d.user.username); } catch { /* ignore */ }
      setSession(d.token, d.user, keep);
      setPassword(""); setClaim("");
      if (d.recovery_code) onRecovery(d.recovery_code); else onSignedIn();
    } catch (e) { setErr(errText(e)); } finally { setBusy(false); }
  };

  return (
    <div className="wrap">
      <Top onClose={onClose} />
      {signup ? (
        <div style={{ margin: "10px 2px 16px" }}><h1>Create your account</h1><div className="soft small" style={{ marginTop: 4 }}>So Wilson can keep your conversations safe and bring them back whenever you sign in.</div></div>
      ) : (
        <div style={{ textAlign: "center", margin: "18px 0 22px" }}>
          <img src={BFLY} alt="" style={{ width: 64, filter: "drop-shadow(0 0 10px rgba(209,59,178,.7))" }} />
          <h1 style={{ marginTop: 8 }}>Welcome back</h1>
          <div className="soft small" style={{ marginTop: 4 }}>Sign in to pick up your past conversations<br />from any device.</div>
        </div>
      )}
      <form className="card" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <div className="tabs" role="tablist">
          <button type="button" role="tab" aria-selected={!signup} className={!signup ? "on" : ""} onClick={() => go("#signin")}>Sign in</button>
          <button type="button" role="tab" aria-selected={signup} className={signup ? "on" : ""} onClick={() => go("#signup")}>Create account</button>
        </div>
        {signup && !signupsOpen && <div className="notice warn" style={{ marginTop: 10 }}>New sign-ups are paused right now. Please check back soon.</div>}
        <label className="lbl" htmlFor="wa-user">Username</label>
        <div className="field">
          <input id="wa-user" value={username} onChange={(e) => setUsername(e.target.value.replace(/\s/g, ""))} autoComplete="username" autoCapitalize="none" spellCheck={false} maxLength={24} placeholder={signup ? "Pick a username" : ""} />
          {signup && avail === "yes" && <span className="eye" style={{ color: "var(--ok)" }}>✓ available</span>}
          {signup && avail === "no" && <span className="eye" style={{ color: "var(--bad)" }}>taken</span>}
          {signup && avail === "bad" && <span className="eye">3–24 · a-z 0-9 . _ -</span>}
        </div>
        <label className="lbl" htmlFor="wa-pw">Password</label>
        <Password id="wa-pw" value={password} onChange={setPassword} autoComplete={signup ? "new-password" : "current-password"} placeholder={signup ? "At least 10 characters" : ""} />
        {signup && password && (
          <div className="row" style={{ gap: 4, marginTop: 7 }}>
            {[1, 2, 3, 4].map((i) => <div key={i} style={{ flex: 1, height: 4, borderRadius: 4, background: i <= st.n ? (st.n >= 3 ? "var(--ok)" : "var(--warn)") : "rgba(128,110,160,.2)" }} />)}
            <span className="tiny soft" style={{ marginLeft: 6, minWidth: 54 }}>{st.label}</span>
          </div>
        )}
        {signup && <>
          <label className="lbl" htmlFor="wa-email">Email <span className="opt">— optional, for future reset links</span></label>
          <div className="field"><input id="wa-email" type="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" placeholder="you@example.com" /></div>
          <div className="tiny soft" style={{ marginTop: 6 }}>Password resets currently use the one-time recovery code you'll get next. Email reset links aren't turned on yet.</div>
          {claimOpen ? <>
            <label className="lbl" htmlFor="wa-claim">Architect claim code</label>
            <div className="field"><input id="wa-claim" value={claim} onChange={(e) => setClaim(e.target.value)} autoComplete="off" autoCapitalize="none" spellCheck={false} className="mono" /></div>
          </> : null}
          <Check on={agreed} onChange={setAgreed}>I've read the Privacy &amp; Data notice below.</Check>
        </>}
        {!signup && (
          <div className="row between" style={{ marginTop: 12 }}>
            <div className="row small soft"><span style={{ transform: "scale(.8)", display: "inline-flex" }}><button type="button" role="switch" aria-checked={keep} aria-label="Keep me signed in" className={`toggle${keep ? " on" : ""}`} onClick={() => setKeep(!keep)} /></span>Keep me signed in</div>
            <button type="button" className="link" onClick={() => go("#forgot")}>Forgot password?</button>
          </div>
        )}
        {err && <div className="err" role="alert">{err}</div>}
        <button type="submit" className="btn" disabled={busy || (signup && (avail === "no" || (!signupsOpen && !claim.trim())))}>{busy ? (signup ? "Creating…" : "Signing in…") : signup ? "Create account" : "Sign in"}</button>
        <button type="button" className="btn ghost" onClick={onClose}>Continue without an account</button>
        <div className="tiny soft" style={{ textAlign: "center", marginTop: 8 }}>Without an account, chats stay only on this device.</div>
        {signup && !claimOpen && <div className="tiny" style={{ textAlign: "center", marginTop: 10 }}><button type="button" className="link tiny soft" style={{ fontSize: 10.5, color: "var(--soft)" }} onClick={() => setClaimOpen(true)}>Have an Architect claim code?</button></div>}
      </form>
      <PrivacyNotice />
      {signup ? <Foot>Want to help test new features? <button type="button" className="link" style={{ fontSize: 11 }} onClick={() => go("#beta")}>Become a beta tester →</button></Foot> : <Foot />}
    </div>
  );
}

export function RecoveryCodeScreen({ code, onDone, again }: { code: string; onDone: () => void; again?: boolean }) {
  const [saved, setSaved] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const flash = (s: string) => { setNote(s); setTimeout(() => setNote(null), 2500); };
  const text = `Wilson recovery code: ${code}\nUse it on “Forgot password?” if you ever lose your password. It works once.`;
  const copy = async () => { try { await navigator.clipboard.writeText(code); flash("Copied."); } catch { flash("Couldn't copy — select the code and copy it."); } };
  const file = () => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text + "\n"], { type: "text/plain" }));
    a.download = "wilson-recovery-code.txt"; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); flash("Saved to your downloads.");
  };
  const share = async () => {
    try { if (navigator.share) { await navigator.share({ title: "Wilson recovery code", text }); return; } } catch { return; }
    try { await navigator.clipboard.writeText(text); flash("Copied — paste it into your Notes app."); } catch { flash("Copy the code into your Notes app."); }
  };
  return (
    <div className="wrap">
      <Top />
      <div style={{ textAlign: "center", margin: "24px 0 18px" }}>
        <div style={{ fontSize: 34 }}>🗝️</div>
        <h1 style={{ marginTop: 6 }}>{again ? "Your new recovery code" : "Save your recovery code"}</h1>
        <div className="soft small" style={{ marginTop: 6, padding: "0 10px" }}>If you ever forget your password, this code lets you back in. It's shown <b style={{ color: "var(--text)", fontWeight: 500 }}>only once</b>.{again ? " Your old code no longer works." : ""}</div>
      </div>
      <div className="card" style={{ textAlign: "center", padding: "22px 16px" }}>
        <div className="tiny soft" style={{ letterSpacing: ".18em" }}>YOUR ONE-TIME RECOVERY CODE</div>
        <div className="code">{code}</div>
        <div className="row" style={{ gap: 10 }}>
          <button type="button" className="btn ghost sm" style={{ flex: 1 }} onClick={() => void copy()}>⧉ Copy</button>
          <button type="button" className="btn ghost sm" style={{ flex: 1 }} onClick={file}>⤓ Save file</button>
          <button type="button" className="btn ghost sm" style={{ flex: 1 }} onClick={() => void share()}>✉ Note</button>
        </div>
        {note && <div className="okmsg" role="status">{note}</div>}
      </div>
      <div className="card small soft" style={{ marginTop: 12 }}>
        <div style={{ margin: "2px 0" }}>• Keep it somewhere safe, like your Notes app or a password manager.</div>
        <div style={{ margin: "6px 0" }}>• Using it once signs you in and gives you a fresh code.</div>
        <div style={{ margin: "2px 0" }}>• The Architect can't see it. It's stored scrambled, like a password.</div>
      </div>
      <div style={{ padding: "0 4px" }}><Check on={saved} onChange={setSaved}>I saved my recovery code</Check></div>
      <button type="button" className="btn" disabled={!saved} onClick={onDone}>Continue to Wilson</button>
    </div>
  );
}

export function ForgotPage({ onClose, onRecovered }: { onClose: () => void; onRecovered: (code: string) => void }) {
  const [username, setUsername] = useState(() => { try { return localStorage.getItem("wilson_acct_last_user") || ""; } catch { return ""; } });
  const [code, setCode] = useState("");
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const submit = async () => {
    setErr(null);
    if (!username.trim() || !code.trim()) return setErr("Enter your username and recovery code.");
    if (pw.length < 10) return setErr("New passwords need at least 10 characters.");
    setBusy(true);
    try {
      const d = await api<AuthRes>("/acct/recover", { token: null, body: { username: username.trim().toLowerCase(), code, new_password: pw } });
      setSession(d.token, d.user, true); setPw(""); setCode("");
      if (d.recovery_code) onRecovered(d.recovery_code);
    } catch (e) { setErr(errText(e)); } finally { setBusy(false); }
  };
  return (
    <div className="wrap">
      <Top onClose={onClose} />
      <div style={{ margin: "12px 2px 16px" }}><h1>Forgot your password?</h1><div className="soft small" style={{ marginTop: 4 }}>No worries. Your recovery code gets you back in.</div></div>
      <form className="card" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <h2>🗝️ Use my recovery code</h2><div className="soft small">The one-time code you saved when you signed up.</div>
        <label className="lbl" htmlFor="wa-fu">Username</label>
        <div className="field"><input id="wa-fu" value={username} onChange={(e) => setUsername(e.target.value.replace(/\s/g, ""))} autoComplete="username" autoCapitalize="none" spellCheck={false} /></div>
        <label className="lbl" htmlFor="wa-fc">Recovery code</label>
        <div className="field"><input id="wa-fc" className="mono" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="XXXX-XXXX-XXXX-XXXX" autoComplete="one-time-code" autoCapitalize="characters" spellCheck={false} /></div>
        <label className="lbl" htmlFor="wa-fp">New password</label>
        <Password id="wa-fp" value={pw} onChange={setPw} autoComplete="new-password" placeholder="At least 10 characters" />
        {err && <div className="err" role="alert">{err}</div>}
        <button type="submit" className="btn" disabled={busy}>{busy ? "Resetting…" : "Reset password"}</button>
        <div className="tiny soft" style={{ marginTop: 8, textAlign: "center" }}>This signs you in, signs out your other devices, and gives you a fresh recovery code.</div>
      </form>
      <div className="row" style={{ margin: "16px 4px", gap: 10 }}><div style={{ flex: 1, height: 1, background: "var(--border)" }} /><span className="tiny soft">OR</span><div style={{ flex: 1, height: 1, background: "var(--border)" }} /></div>
      <div className="card" style={{ opacity: 0.8 }}>
        <h2>✉️ Email me a reset link</h2>
        <div className="soft small">Not available yet. Resets currently use your recovery code. If you added an email, it's saved for when reset links are turned on.</div>
        <button type="button" className="btn ghost" disabled>Coming later</button>
      </div>
      <Foot>Lost both? <button type="button" className="link" style={{ fontSize: 11 }} onClick={() => go("#message")}>Message the Architect</button> and Jenny can help.</Foot>
    </div>
  );
}
