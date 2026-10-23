/**
 * Frictionless claim for OG 100 seats.
 * - Zero friction to chat (existing anon + beta number stays).
 * - Optional claim: Passkey (Face ID / Touch ID) or light name + contact.
 * - Gives Architect a recoverable identity for rewards / payments.
 */
import { WILSON_PROXY_URL } from "../App";
import { anonId, betaNumber } from "./beta";

const CLAIM_KEY = "wilson_claim";

export type ClaimMethod = "passkey" | "name" | "email";

export type ClaimRecord = {
  number: number;
  method: ClaimMethod;
  displayName?: string;
  contact?: string;          // email, X handle, or wallet
  credentialId?: string;     // for passkey
  claimedAt: string;
};

export function loadClaim(): ClaimRecord | null {
  try {
    const raw = localStorage.getItem(CLAIM_KEY);
    return raw ? (JSON.parse(raw) as ClaimRecord) : null;
  } catch {
    return null;
  }
}

export function saveClaim(c: ClaimRecord) {
  try {
    localStorage.setItem(CLAIM_KEY, JSON.stringify(c));
  } catch { /* ignore */ }
}

export function clearClaim() {
  try {
    localStorage.removeItem(CLAIM_KEY);
  } catch { /* ignore */ }
}

/** Does this device already have a claimed OG seat? */
export function isClaimed(): boolean {
  return !!loadClaim();
}

/** Browser supports WebAuthn / passkeys? */
export function passkeySupported(): boolean {
  return typeof window !== "undefined" && !!window.PublicKeyCredential;
}

/**
 * Create a new passkey credential bound to this OG number.
 * Returns the credential ID (base64) on success.
 */
export async function createPasskey(number: number, displayName: string): Promise<string | null> {
  if (!passkeySupported()) return null;
  try {
    const challenge = crypto.getRandomValues(new Uint8Array(32));
    const userId = new TextEncoder().encode(`wilson-og-${number}-${anonId().slice(0, 8)}`);

    const cred = (await navigator.credentials.create({
      publicKey: {
        challenge,
        rp: { name: "Wilson", id: location.hostname },
        user: {
          id: userId,
          name: `og${number}@wilson.local`,
          displayName: displayName || `OG #${number}`,
        },
        pubKeyCredParams: [
          { alg: -7, type: "public-key" },   // ES256
          { alg: -257, type: "public-key" }, // RS256
        ],
        authenticatorSelection: {
          authenticatorAttachment: "platform", // Face ID / Touch ID preferred
          userVerification: "preferred",
          residentKey: "preferred",
        },
        timeout: 60_000,
        attestation: "none",
      },
    })) as PublicKeyCredential | null;

    if (!cred) return null;
    const id = btoa(String.fromCharCode(...new Uint8Array(cred.rawId)));
    return id;
  } catch (e) {
    console.warn("[claim] passkey create failed", e);
    return null;
  }
}

/**
 * Assert an existing passkey (for future recovery / Architect unlock).
 */
export async function assertPasskey(credentialId: string): Promise<boolean> {
  if (!passkeySupported() || !credentialId) return false;
  try {
    const challenge = crypto.getRandomValues(new Uint8Array(32));
    const rawId = Uint8Array.from(atob(credentialId), (c) => c.charCodeAt(0));
    const assertion = await navigator.credentials.get({
      publicKey: {
        challenge,
        allowCredentials: [{ id: rawId, type: "public-key" }],
        userVerification: "preferred",
        timeout: 60_000,
      },
    });
    return !!assertion;
  } catch {
    return false;
  }
}

/**
 * Submit a claim to the worker.
 * Worker contract (expected):
 *   POST /beta/claim
 *   body: { anon, number, method, displayName?, contact?, credentialId? }
 *   → { ok: true } | { error: string }
 */
export async function submitClaim(opts: {
  method: ClaimMethod;
  displayName?: string;
  contact?: string;
  credentialId?: string;
}): Promise<{ ok: boolean; error?: string }> {
  const number = betaNumber();
  if (!number) return { ok: false, error: "No beta number yet" };

  try {
    const r = await fetch(`${WILSON_PROXY_URL}/beta/claim`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        anon: anonId(),
        number,
        method: opts.method,
        displayName: opts.displayName?.trim() || undefined,
        contact: opts.contact?.trim() || undefined,
        credentialId: opts.credentialId,
      }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) return { ok: false, error: d.error || "Claim failed" };

    const record: ClaimRecord = {
      number,
      method: opts.method,
      displayName: opts.displayName?.trim(),
      contact: opts.contact?.trim(),
      credentialId: opts.credentialId,
      claimedAt: new Date().toISOString(),
    };
    saveClaim(record);
    return { ok: true };
  } catch {
    return { ok: false, error: "You're offline — try again soon." };
  }
}
