import { useState, type ReactNode } from "react";
import bfly from "../assets/concept/bfly1.webp";

export const ICON = `${import.meta.env.BASE_URL}icon-192.png`;
export const BFLY = bfly;
export const go = (hash: string) => { location.hash = hash; };

export function Top({ right, onClose }: { right?: ReactNode; onClose?: () => void }) {
  return (
    <div className="top">
      <HomeTitle />
      <div className="sp" />
      {right}
      {onClose && <button type="button" className="iconbtn" aria-label="Close" onClick={onClose}>✕</button>}
    </div>
  );
}

/** The Wilson title: tap it anywhere to get back to the landing page (#home). */
export function HomeTitle() {
  const home = () => { if (location.hash === "#home") document.querySelector(".wa")?.scrollTo({ top: 0, behavior: "smooth" }); else go("#home"); };
  return (
    <button type="button" className="rb wa-home" aria-label="Wilson home" title="Wilson home" onClick={home}>
      <img src={ICON} alt="" />
      <span className="brand"><span className="w">WILSON</span><span className="o">+ THE ONLY ONE</span></span>
    </button>
  );
}

export function Foot({ children }: { children?: ReactNode }) {
  return <div className="foot">{children ?? <>Wilson + The Only One · <i>Imagination becomes intelligence™</i></>}</div>;
}

export function PrivacyNotice() {
  return (
    <div className="notice" style={{ marginTop: 14 }}>
      <div className="row" style={{ gap: 7, fontWeight: 500, color: "var(--text)" }}>🔒 Privacy &amp; Data</div>
      <ul>
        <li><b>What we keep:</b> your account, your chats, and basic usage counts (like how many chats per day).</li>
        <li><b>Never sold.</b> No ads. No data scraping. No product pushing.</li>
        <li>Usage counts only help us see how many people use Wilson.</li>
        <li><b>Delete your account and all your data anytime</b> in Settings.</li>
      </ul>
    </div>
  );
}

export function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return <button type="button" role="switch" aria-checked={on} aria-label={label} className={`toggle${on ? " on" : ""}`} onClick={() => onChange(!on)} />;
}

export function Check({ on, onChange, children }: { on: boolean; onChange: (v: boolean) => void; children: ReactNode }) {
  return (
    <div className="row small" style={{ marginTop: 14, alignItems: "flex-start" }}>
      <button type="button" role="checkbox" aria-checked={on} className={`check${on ? " on" : ""}`} onClick={() => onChange(!on)}>{on ? "✓" : ""}</button>
      <span className="soft" onClick={() => onChange(!on)} style={{ cursor: "pointer" }}>{children}</span>
    </div>
  );
}

export function Password({ value, onChange, placeholder, autoComplete, id }: { value: string; onChange: (v: string) => void; placeholder?: string; autoComplete: string; id: string }) {
  const [show, setShow] = useState(false);
  return (
    <div className="field">
      <input id={id} type={show ? "text" : "password"} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} autoComplete={autoComplete} autoCapitalize="none" spellCheck={false} />
      <button type="button" className="eye" onClick={() => setShow((s) => !s)}>{show ? "Hide" : "Show"}</button>
    </div>
  );
}

const AV = ["linear-gradient(135deg,#38B2DA,#6E21B0)", "linear-gradient(135deg,#EB7B59,#D13BB2)", "linear-gradient(135deg,#6E21B0,#D13BB2)", "linear-gradient(135deg,#F39F5F,#DB5669)", "linear-gradient(135deg,#38B2DA,#5EEAD4)"];
export function Avatar({ name }: { name: string }) {
  let h = 0; for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return <div className="av" style={{ background: AV[h % AV.length] }}>{(name[0] || "?").toUpperCase()}</div>;
}

export const when = (t: number) => {
  const d = new Date(t), now = new Date();
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (d.toDateString() === now.toDateString()) return time;
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return `Yesterday ${time}`;
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
};
