/**
 * Frictionless claim card for the first 100.
 * Shown only when the user has an unclaimed beta number ≤ 100.
 * Passkey (Face ID / Touch ID) is the preferred path; name + optional contact is the light fallback.
 */
import { useState } from "react";
import { Fingerprint, User, X, Check, Loader2 } from "lucide-react";
import {
  passkeySupported,
  createPasskey,
  submitClaim,
  loadClaim,
  type ClaimMethod,
} from "../lib/claim";
import { betaNumber } from "../lib/beta";

type Props = {
  onClose: () => void;
  onClaimed?: () => void;
};

export function ClaimSeat({ onClose, onClaimed }: Props) {
  const number = betaNumber();
  const existing = loadClaim();
  const [mode, setMode] = useState<"choose" | "passkey" | "name">("choose");
  const [name, setName] = useState("");
  const [contact, setContact] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [done, setDone] = useState(!!existing);

  if (!number || number > 100) return null;

  const finish = (ok: boolean, error?: string) => {
    setBusy(false);
    if (ok) {
      setDone(true);
      setMsg(null);
      onClaimed?.();
    } else {
      setMsg(error || "Something went wrong");
    }
  };

  const doPasskey = async () => {
    setBusy(true);
    setMsg(null);
    const display = name.trim() || `OG #${number}`;
    const credId = await createPasskey(number, display);
    if (!credId) {
      finish(false, "Passkey not available on this device — try the name option.");
      return;
    }
    const r = await submitClaim({
      method: "passkey",
      displayName: display,
      contact: contact.trim() || undefined,
      credentialId: credId,
    });
    finish(r.ok, r.error);
  };

  const doName = async () => {
    if (!name.trim()) {
      setMsg("A short name is enough.");
      return;
    }
    setBusy(true);
    setMsg(null);
    const method: ClaimMethod = contact.trim().includes("@") ? "email" : "name";
    const r = await submitClaim({
      method,
      displayName: name.trim(),
      contact: contact.trim() || undefined,
    });
    finish(r.ok, r.error);
  };

  if (done) {
    return (
      <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm p-4" onClick={onClose}>
        <div className="glass-strong rounded-3xl w-full max-w-sm p-5 text-violet-950/90 shadow-xl" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center gap-2 mb-3">
            <div className="w-9 h-9 rounded-full bg-violet-600 text-white flex items-center justify-center">
              <Check className="w-5 h-5" />
            </div>
            <div>
              <div className="text-[11px] tracking-[0.14em] text-violet-500">OG #{number}</div>
              <div className="font-semibold">Seat claimed</div>
            </div>
          </div>
          <p className="text-[14px] leading-relaxed opacity-80 mb-4">
            You’re on the founding roster. If rewards open later, this identity is how you’ll be found.
          </p>
          <button type="button" onClick={onClose} className="w-full rounded-full bg-violet-600 text-white py-2.5 text-[14px] font-medium active:scale-[0.98]">
            Continue
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="glass-strong rounded-3xl w-full max-w-sm p-5 text-violet-950/90 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between mb-1">
          <div>
            <div className="text-[11px] tracking-[0.14em] text-violet-500">FOUNDING SEAT</div>
            <h3 className="text-lg font-semibold tracking-tight">Claim OG #{number}</h3>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="p-1 -m-1 text-violet-400">
            <X className="w-5 h-5" />
          </button>
        </div>
        <p className="text-[13.5px] leading-relaxed opacity-75 mb-4">
          Optional. Chat already works. Claiming lets the Architect know who you are if rewards or payments ever open.
        </p>

        {mode === "choose" && (
          <div className="space-y-2.5">
            {passkeySupported() && (
              <button
                type="button"
                onClick={() => setMode("passkey")}
                className="w-full flex items-center gap-3 rounded-2xl bg-white/70 px-4 py-3.5 text-left active:scale-[0.98]"
              >
                <div className="w-10 h-10 rounded-full bg-violet-100 flex items-center justify-center text-violet-700">
                  <Fingerprint className="w-5 h-5" />
                </div>
                <div>
                  <div className="font-medium text-[14px]">Face ID / Touch ID</div>
                  <div className="text-[12px] opacity-60">Fastest · stays on this device</div>
                </div>
              </button>
            )}
            <button
              type="button"
              onClick={() => setMode("name")}
              className="w-full flex items-center gap-3 rounded-2xl bg-white/70 px-4 py-3.5 text-left active:scale-[0.98]"
            >
              <div className="w-10 h-10 rounded-full bg-violet-100 flex items-center justify-center text-violet-700">
                <User className="w-5 h-5" />
              </div>
              <div>
                <div className="font-medium text-[14px]">Name + contact</div>
                <div className="text-[12px] opacity-60">Email, X, or wallet — whatever works for you</div>
              </div>
            </button>
          </div>
        )}

        {mode === "passkey" && (
          <div className="space-y-3">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Display name (optional)"
              className="w-full rounded-xl bg-white/70 px-3.5 py-2.5 text-[14px] outline-none placeholder:text-violet-400"
            />
            <input
              value={contact}
              onChange={(e) => setContact(e.target.value)}
              placeholder="Email / X / wallet (optional)"
              className="w-full rounded-xl bg-white/70 px-3.5 py-2.5 text-[14px] outline-none placeholder:text-violet-400"
            />
            <button
              type="button"
              disabled={busy}
              onClick={doPasskey}
              className="w-full rounded-full bg-violet-600 text-white py-2.5 text-[14px] font-medium flex items-center justify-center gap-2 disabled:opacity-50 active:scale-[0.98]"
            >
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Fingerprint className="w-4 h-4" />}
              {busy ? "Creating passkey…" : "Create passkey"}
            </button>
            <button type="button" onClick={() => setMode("choose")} className="w-full text-[13px] text-violet-500">
              Back
            </button>
          </div>
        )}

        {mode === "name" && (
          <div className="space-y-3">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Display name"
              className="w-full rounded-xl bg-white/70 px-3.5 py-2.5 text-[14px] outline-none placeholder:text-violet-400"
              autoFocus
            />
            <input
              value={contact}
              onChange={(e) => setContact(e.target.value)}
              placeholder="Email / X / wallet (optional but recommended)"
              className="w-full rounded-xl bg-white/70 px-3.5 py-2.5 text-[14px] outline-none placeholder:text-violet-400"
            />
            <button
              type="button"
              disabled={busy || !name.trim()}
              onClick={doName}
              className="w-full rounded-full bg-violet-600 text-white py-2.5 text-[14px] font-medium flex items-center justify-center gap-2 disabled:opacity-50 active:scale-[0.98]"
            >
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              {busy ? "Claiming…" : "Claim seat"}
            </button>
            <button type="button" onClick={() => setMode("choose")} className="w-full text-[13px] text-violet-500">
              Back
            </button>
          </div>
        )}

        {msg && <p className="mt-3 text-[13px] text-rose-600">{msg}</p>}
      </div>
    </div>
  );
}
