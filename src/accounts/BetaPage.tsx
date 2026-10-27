import { useEffect, useState } from "react";
import { api, errText, type AcctUser } from "./api";
import { BFLY, Foot, Top, go } from "./ui";

type BetaState = { beta: boolean; request: { status: string; created_at: number } | null; open: boolean };

export function BetaPage({ user, onClose }: { user: AcctUser | null; onClose: () => void }) {
  const [st, setSt] = useState<BetaState | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { if (user) void api<BetaState>("/acct/beta").then(setSt).catch((e) => setErr(errText(e))); }, [user]);
  const send = async () => {
    setErr(null); setBusy(true);
    try { await api("/acct/beta", { body: { note: note.trim(), uses: [] } }); setSt((s) => ({ beta: false, open: s?.open ?? true, request: { status: "pending", created_at: Date.now() } })); setNote(""); }
    catch (e) { setErr(errText(e)); } finally { setBusy(false); }
  };
  const isBeta = user?.beta || st?.beta;
  const status = st?.request?.status;
  return (
    <div className="wrap">
      <Top right={<span className="pill">Beta program</span>} onClose={onClose} />
      <div style={{ textAlign: "center", margin: "22px 0 20px" }}>
        <img src={BFLY} alt="" style={{ width: 58, filter: "drop-shadow(0 0 10px rgba(209,59,178,.7))" }} />
        <h1 style={{ marginTop: 8 }}>Want to help test <span className="grad" style={{ fontWeight: 500 }}>Wilson</span>?</h1>
        <div className="soft small" style={{ marginTop: 8, padding: "0 6px" }}>Beta testers try new features early, like new voices, tools, and the community room, and tell us what feels right and what doesn't.</div>
      </div>
      <div className="card small">
        <div className="row" style={{ alignItems: "flex-start", margin: "2px 0" }}><span>✨</span><span><b style={{ fontWeight: 500 }}>Early access</b> <span className="soft">to features before everyone else</span></span></div>
        <div className="row" style={{ alignItems: "flex-start", margin: "10px 0" }}><span>🪲</span><span><b style={{ fontWeight: 500 }}>A bug &amp; idea button</b> <span className="soft">that goes straight to the Architect</span></span></div>
        <div className="row" style={{ alignItems: "flex-start", margin: "2px 0" }}><span>🤍</span><span><b style={{ fontWeight: 500 }}>Totally optional.</b> <span className="soft">Leave the program anytime. Nothing extra is collected.</span></span></div>
      </div>
      <form className="card" onSubmit={(e) => { e.preventDefault(); if (user) void send(); }}>
        <h2>Request to join</h2>
        {isBeta ? (
          <div className="okmsg" style={{ marginTop: 0 }}>✦ You're a beta tester. Thank you! Use “Message the Architect” for bugs and ideas.</div>
        ) : status === "pending" ? (
          <div className="soft small">Request sent ✓ Jenny reviews every request personally. You'll see it here once you're approved.</div>
        ) : st && !st.open ? (
          <div className="soft small">Beta requests are closed right now. Check back soon.</div>
        ) : <>
          {status === "declined" && <div className="soft small" style={{ marginBottom: 6 }}>Your last request wasn't approved this round. You're welcome to ask again.</div>}
          <label className="lbl" htmlFor="wa-bu">Your Wilson username</label>
          <div className="field"><input id="wa-bu" value={user?.username ?? ""} readOnly placeholder="Sign in first" /></div>
          <label className="lbl" htmlFor="wa-bn">Anything you'd like to tell Jenny? <span className="opt">— optional</span></label>
          <div className="field"><textarea id="wa-bn" value={note} onChange={(e) => setNote(e.target.value)} maxLength={800} disabled={!user} /></div>
          {err && <div className="err" role="alert">{err}</div>}
          {user ? <button type="submit" className="btn" disabled={busy}>{busy ? "Sending…" : "Send request"}</button>
            : <button type="button" className="btn" onClick={() => go("#signup")}>Create an account first</button>}
          <div className="tiny soft" style={{ marginTop: 10, textAlign: "center" }}>Jenny (the Architect) reviews every request personally. You'll see a note in Wilson once you're approved.</div>
        </>}
      </form>
      {!user ? <Foot>Not signed in? <button type="button" className="link" style={{ fontSize: 11 }} onClick={() => go("#signup")}>Create an account first →</button> · <button type="button" className="link" style={{ fontSize: 11 }} onClick={() => go("#signin")}>Sign in</button></Foot> : <Foot />}
    </div>
  );
}
