import { useState } from "react";
import type { AcctUser } from "./api";
import { Top, PrivacyNotice, go } from "./ui";
import logo from "../assets/w22-logo.webp";

/** Wilson's landing page (#home): first stop for new visitors, and where every tap on the Wilson title goes. */
export function HomePage({ user, onStart }: { user: AcctUser | null; onStart: () => void }) {
  const [priv, setPriv] = useState(false);
  const showPrivacy = () => { setPriv(true); setTimeout(() => document.getElementById("wa-privacy")?.scrollIntoView({ behavior: "smooth", block: "center" }), 30); };
  return (
    <div className="wrap home">
      <Top right={user
        ? <button type="button" className="si" onClick={() => go("#account")}>Account</button>
        : <button type="button" className="si" onClick={() => go("#signin")}>Sign in</button>} />
      <div className="hero">
        <div className="logowrap"><div className="halo" aria-hidden="true" /><img className="logo" src={logo} alt="W22 Wilson logo" width={300} height={169} /></div>
        <h1>Wilson + The Only One</h1>
        <div className="tag grad">Imagination becomes intelligence™</div>
        <p className="d">Wilson is a warm, thoughtful AI companion that lives in your browser. Talk or type, think out loud, plan, or explore an idea. He listens, and he remembers what matters to you.</p>
      </div>
      <div className="ctas">
        <button type="button" className="btn" onClick={onStart}>Start chatting <span aria-hidden="true" style={{ fontSize: 17 }}>→</span></button>
        {user
          ? <button type="button" className="btn ghost" onClick={() => go("#account")}>Your account</button>
          : <button type="button" className="btn ghost" onClick={() => go("#signin")}>Sign in / Create account</button>}
        <div className="note">{user ? "You're signed in, so your chats sync to any device you sign in on." : <>Free to use. No account needed. Sign in only if you want<br />your chats back on any device.</>}</div>
      </div>
      <div className="sec" style={{ marginTop: 26 }}>More from Wilson</div>
      <button type="button" className="lcard" onClick={() => go("#beta")}><span className="ic" aria-hidden="true">✨</span><span><span className="t">Become a beta tester</span><span className="s">Try new features early and tell us what works.</span></span><span className="ch" aria-hidden="true">›</span></button>
      <button type="button" className="lcard" onClick={() => go("#room")}><span className="ic" aria-hidden="true">💬</span><span><span className="t">Community room</span><span className="s">Talk with other Wilson users. Say @Wilson to bring him in.</span></span><span className="ch" aria-hidden="true">›</span></button>
      <button type="button" className="lcard" onClick={() => go("#message")}><span className="ic" aria-hidden="true">✉️</span><span><span className="t">Message the Architect</span><span className="s">Send an idea, a question, or a bug report to Wilson's creator.</span></span><span className="ch" aria-hidden="true">›</span></button>
      <div className="only"><div className="h">The Only One</div><p>“+ The Only One” is you. Same Wilson, shaped by your conversations, your goals, and your way of thinking. A different story for everyone.</p></div>
      <div className="priv"><span aria-hidden="true" style={{ fontSize: 15 }}>🔒</span><div><b>Your data stays yours.</b> Sign-in is optional; if you sign in, your chats sync to your account. No ads. Never sold. Delete your account and chats anytime. <button type="button" className="link" onClick={() => (priv ? setPriv(false) : showPrivacy())} aria-expanded={priv}>Privacy &amp; data {priv ? "↑" : "→"}</button></div></div>
      {priv && <div id="wa-privacy"><PrivacyNotice /></div>}
      <div className="lfoot">
        <div>Wilson + The Only One · <i>Imagination becomes intelligence™</i></div>
        <div className="links"><button type="button" onClick={showPrivacy}>Privacy</button><button type="button" onClick={() => go("#room")}>Community</button><button type="button" onClick={() => go("#message")}>Contact</button></div>
        <div style={{ marginTop: 8, opacity: 0.85 }}>© 2026 · Free &amp; independent</div>
      </div>
    </div>
  );
}
