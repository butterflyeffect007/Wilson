import { useEffect, useState } from "react";
import { X } from "lucide-react";

/** Captured early so Android's install prompt isn't lost. */
type BIP = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };
let deferred: BIP | null = null;
const subs = new Set<() => void>();
if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); deferred = e as BIP; subs.forEach((f) => f()); });
  window.addEventListener("appinstalled", () => { deferred = null; subs.forEach((f) => f()); });
}

export const isInstalled = () => matchMedia("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
const ua = () => navigator.userAgent;
const isIOS = () => /iPhone|iPad|iPod/.test(ua()) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const isIOSSafari = () => isIOS() && /Safari/.test(ua()) && !/CriOS|FxiOS|EdgiOS|OPiOS|GSA|Instagram|FBAN|FBAV|Line\//.test(ua());

function ShareGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="inline w-5 h-5 align-[-4px] mx-0.5 text-sky-500" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-label="Share icon">
      <path d="M12 3v12" /><path d="M8 7l4-4 4 4" /><path d="M6 11v8a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2v-8" />
    </svg>
  );
}

export default function InstallCard({ onClose }: { onClose: () => void }) {
  const [, force] = useState(0);
  useEffect(() => { const f = () => force((n) => n + 1); subs.add(f); return () => { subs.delete(f); }; }, []);
  const installed = isInstalled();
  let body: React.ReactNode;
  if (installed) body = <p>Wilson is already on your Home Screen ✦</p>;
  else if (isIOSSafari()) body = <p>Tap <ShareGlyph /> <b>Share</b> at the bottom of Safari, then <b>“Add to Home Screen”</b>. Wilson opens full-screen, like a real app.</p>;
  else if (isIOS()) body = <p>On iPhone, Wilson installs from <b>Safari</b>. Open this page in Safari, tap <ShareGlyph /> <b>Share</b>, then <b>“Add to Home Screen”</b>.</p>;
  else if (deferred) body = (
    <div className="flex items-center gap-3">
      <p className="flex-1">Install Wilson so he's one tap away, full-screen.</p>
      <button type="button" className="px-4 py-2 rounded-xl bg-violet-500 text-white" onClick={async () => { const d = deferred; if (!d) return; await d.prompt(); await d.userChoice.catch(() => null); deferred = null; onClose(); }}>Install</button>
    </div>
  );
  else body = <p>Open your browser menu <b>⋮</b> and choose <b>“Install app”</b> or <b>“Add to Home screen”</b>.</p>;
  return (
    <div className="mb-2 mx-1 rounded-2xl glass-strong px-4 py-3 text-[15px] leading-[1.65] text-violet-900/90 relative" role="note">
      <div className="text-[11px] tracking-[0.12em] text-violet-500 mb-1">ADD WILSON TO YOUR HOME SCREEN</div>
      {body}
      <button type="button" onClick={onClose} aria-label="Dismiss" className="absolute top-2 right-2 p-1 text-violet-400"><X className="w-4 h-4" /></button>
    </div>
  );
}
