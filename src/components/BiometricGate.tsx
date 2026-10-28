import React, { useCallback, useEffect, useRef, useState } from "react";
import { Fingerprint, Loader2, Lock, ShieldAlert } from "lucide-react";
import WilsonOrb from "./WilsonOrb";
import { getBiometricGate, GateError, type GateState } from "../lib/biometrics";

/**
 * Wraps Wilson: not enrolled → enroll screen; enrolled + locked → unlock prompt; unlocked → children.
 * Children are not mounted at all until the gate is unlocked, and are unmounted again on lock.
 * Build-time escape hatch: VITE_BIOMETRIC_GATE=off renders children directly (local dev / emergencies).
 */

const HIDDEN_LOCK_MS = 5 * 60 * 1000; // lock if Wilson sat in the background this long

const GATE_OFF = String(import.meta.env.VITE_BIOMETRIC_GATE ?? "on").toLowerCase() === "off";

function friendly(e: unknown): string {
  if (e instanceof GateError) {
    switch (e.code) {
      case "cancelled": return "No worries — the prompt was closed. Tap when you're ready.";
      case "unsupported": return "This device can't do a biometric check here.";
      case "replay": return "That unlock looked replayed, so Wilson refused it. Try again.";
      case "verification-failed": return "Wilson couldn't verify that it's you. Try again.";
      case "already-enrolled": return "This device is already bound to you.";
      default: return e.message;
    }
  }
  return "Something hiccuped during the biometric check. Try again.";
}

export default function BiometricGate({ children }: { children: React.ReactNode }) {
  if (GATE_OFF) return <>{children}</>;
  return <Gate>{children}</Gate>;
}

function Gate({ children }: { children: React.ReactNode }) {
  const gate = getBiometricGate();
  const [state, setState] = useState<GateState | "loading">("loading");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hiddenAt = useRef<number | null>(null);

  useEffect(() => {
    const off = gate.subscribe(setState);
    gate.init().then(setState).catch(() => setState("unsupported"));
    return off;
  }, [gate]);

  // Activity extends the auto-lock window; long stays in the background lock immediately on return.
  useEffect(() => {
    if (state !== "unlocked") return;
    const touch = () => gate.touch();
    const vis = () => {
      if (document.visibilityState === "hidden") { hiddenAt.current = Date.now(); return; }
      if (hiddenAt.current && Date.now() - hiddenAt.current > HIDDEN_LOCK_MS) gate.lock();
      hiddenAt.current = null;
    };
    const lockNow = () => gate.lock();
    window.addEventListener("pointerdown", touch, { passive: true });
    window.addEventListener("keydown", touch);
    document.addEventListener("visibilitychange", vis);
    window.addEventListener("wilson-lock", lockNow);
    return () => {
      window.removeEventListener("pointerdown", touch);
      window.removeEventListener("keydown", touch);
      document.removeEventListener("visibilitychange", vis);
      window.removeEventListener("wilson-lock", lockNow);
    };
  }, [state, gate]);

  const run = useCallback(async (fn: () => Promise<unknown>) => {
    setBusy(true); setError(null);
    try { await fn(); } catch (e) { setError(friendly(e)); } finally { setBusy(false); }
  }, []);

  if (state === "unlocked") return <>{children}</>;

  const copy = {
    loading: { title: "Waking Wilson", body: "", action: null as string | null },
    "not-enrolled": {
      title: "Bind Wilson to you",
      body: "Wilson unlocks with your face or fingerprint on this device. Your biometrics stay inside the device's secure hardware — Wilson only keeps a derived key hash.",
      action: "Enroll this device",
    },
    locked: { title: "Wilson is locked", body: "Only you can open this. Use your face or fingerprint to continue.", action: "Unlock Wilson" },
    unsupported: {
      title: "Biometric unlock unavailable",
      body: "This browser or device has no biometric authenticator Wilson can use. Open Wilson on a device with Face ID, Touch ID, Windows Hello or an Android fingerprint/face unlock.",
      action: null,
    },
  }[state];

  const onAction = () => run(() => (state === "not-enrolled" ? gate.enroll() : gate.unlock()));

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center overflow-hidden px-6"
      style={{ background: "radial-gradient(120% 90% at 50% 38%, #141a3a 0%, #0a0c22 45%, #04040d 100%)", color: "#F8F0FF" }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="wl-gate-title"
    >
      {/* ice / pearl haze */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0"
        style={{ background: "radial-gradient(40% 30% at 50% 36%, rgba(186,230,253,0.16), transparent 70%), radial-gradient(30% 22% at 62% 60%, rgba(233,213,255,0.10), transparent 70%)" }} />
      <div aria-hidden="true" className="wilson-field-particles" style={{ opacity: 0.35 }} />

      <div className="relative flex w-full max-w-sm flex-col items-center text-center">
        <div className="relative mb-8 flex items-center justify-center">
          <span aria-hidden="true" className="absolute h-40 w-40 rounded-full"
            style={{ border: "1px solid rgba(186,230,253,0.25)", boxShadow: "0 0 60px 10px rgba(165,243,252,0.12), inset 0 0 40px rgba(248,240,255,0.08)" }} />
          <span aria-hidden="true" className={`absolute h-52 w-52 rounded-full ${busy ? "animate-ping" : ""}`}
            style={{ border: "1px solid rgba(248,240,255,0.10)", animationDuration: "2.4s" }} />
          <WilsonOrb size="mdx" vibe="calm" isThinking={busy || state === "loading"} />
        </div>

        <h1 id="wl-gate-title" className="text-[22px] font-light tracking-wide" style={{ color: "#F8F0FF" }}>{copy.title}</h1>
        {copy.body && <p className="mt-3 text-[14px] leading-relaxed" style={{ color: "rgba(224,242,254,0.72)" }}>{copy.body}</p>}

        {copy.action && (
          <button
            type="button"
            onClick={onAction}
            disabled={busy}
            className="mt-8 inline-flex items-center gap-2 rounded-full px-6 py-3 text-[15px] font-normal transition disabled:opacity-60"
            style={{
              background: "linear-gradient(135deg, rgba(248,240,255,0.16), rgba(186,230,253,0.10))",
              border: "1px solid rgba(224,242,254,0.35)",
              boxShadow: "0 0 24px rgba(165,243,252,0.18), inset 0 1px 0 rgba(255,255,255,0.18)",
              color: "#F8F0FF",
              backdropFilter: "blur(12px)",
            }}
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : state === "locked" ? <Lock className="h-4 w-4" /> : <Fingerprint className="h-4 w-4" />}
            {busy ? "Waiting for your biometric…" : copy.action}
          </button>
        )}
        {state === "unsupported" && <ShieldAlert aria-hidden="true" className="mt-6 h-6 w-6" style={{ color: "rgba(224,242,254,0.6)" }} />}

        <p role="status" aria-live="polite" className="mt-5 min-h-[1.25rem] text-[13px]" style={{ color: "#fbcfe8" }}>{error ?? ""}</p>
      </div>
    </div>
  );
}
