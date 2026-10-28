# Wilson Biometric Unlock — Architecture

Status: v1 scaffold on branch `biometric-unlock` · Owner: Jenny Cox (The Architect) · Date: 2026-10-28

Wilson gets its own identity layer: a biometric gate that runs on Jenny's own hardware and unlocks Wilson itself, then the things Wilson holds for her (GitHub first), without passwords. It is **not** a web-wide password replacement. It is a Wilson-native gate.

Code: `src/lib/biometrics/` (`biometric-gate.ts`, `key-store.ts`, `index.ts`), UI: `src/components/BiometricGate.tsx`, wired in `src/main.tsx`, tests: `tests/biometrics/biometric-gate.test.ts`.

---

## 1. Goals and non-goals

**Goals**
- Wilson can't be used until the person in front of the device passes a biometric check.
- Raw biometrics never leave the device's secure hardware, and Wilson never sees them. Wilson stores only derived-key hashes and encrypted blobs.
- One unlock opens Wilson and lets Wilson release the secrets it holds for her (GitHub CLI token first).
- Runs entirely on her own device first. No server holds a biometric, key, or template.
- The protocol is clean enough to publish later as an open spec.

**Non-goals (v1)**
- Replacing passwords on third-party sites. Passkeys already do that per site.
- Multi-user accounts. One enrolled person per device.
- Server-side verification. That comes later with a sync or recovery service (see Roadmap).

## 2. Components

```
┌─────────────────────────── device (Jenny's hardware) ───────────────────────────┐
│  Secure enclave / TPM / StrongBox                                               │
│    • fingerprint / face template  (never exported)                              │
│    • WebAuthn credential private key (never exported)                           │
│    • PRF / hmac-secret per-credential secret (released only after a match)      │
│            ▲  WebAuthn (userVerification: "required")                           │
│  Browser / PWA / Capacitor shell                                                │
│    BiometricGate (biometric-gate.ts)  ── enroll / unlock / lock / isEnrolled    │
│      │  HKDF-SHA256 → unlock key (AES-GCM, non-extractable, memory only)        │
│      ▼                                                                          │
│    KeyStore (key-store.ts) ── IndexedDB                                         │
│      • device key: non-extractable AES-GCM-256 CryptoKey handle                 │
│      • rec:enrollment  → sealed {credId, publicKey, salts, signCount, keyCheck} │
│      • secret:<name>   → sealed(device key, sealed(unlock key, secret))         │
│    <BiometricGate> React wrapper → mounts <App/> only when unlocked             │
└─────────────────────────────────────────────────────────────────────────────────┘
```

## 3. Local biometric capture

Order of preference, picked automatically by `BiometricGate.availableMethod()`:

| Method | When | Biometric check done by | Unlock-key source |
|---|---|---|---|
| `webauthn-prf` | A platform authenticator exists **and** supports the PRF extension (iCloud Keychain passkeys on iOS 18+/macOS 15+, Chrome/Android with Google Password Manager, Windows Hello in recent Chrome/Edge) | Platform authenticator (Face ID / Touch ID / Windows Hello / BiometricPrompt) | PRF output, which only exists after a successful match |
| `webauthn` | Platform authenticator present but no PRF | Same | Random seed sealed under the device key. The assertion is the gate. |
| `fallback-stub` | No WebAuthn (some embedded webviews, old browsers) | **Nothing yet.** `LocalStubProvider` is a TODO stub | Seed hashed by the stub |

- WebAuthn is always called with `authenticatorAttachment: "platform"` and `userVerification: "required"`. The UV flag is checked on every response, so a bare "tap" that skips the biometric is refused.
- **Native path (TODO):** `NativeBiometricProvider` is the hook for a Capacitor plugin: iOS `LocalAuthentication` with a Secure Enclave key whose access control is `.biometryCurrentSet`, and Android `BiometricPrompt` with a Keystore key where `setUserAuthenticationRequired(true)` and `setInvalidatedByBiometricEnrollment(true)`. The plugin must release a hardware-held 32-byte secret only after a match and set `verifiesUser = true`. Until then the stub is **disabled in production builds** (`allowInsecureFallback` defaults to dev-only).

## 4. Key derivation: "from the biometric template" without storing biometrics

Browsers and phone OSes deliberately never expose biometric templates, and a template is noisy anyway, so it can't feed a KDF directly. Wilson derives keys from the **biometric-bound secret**. The authenticator releases that secret only after its own template match.

```
prfOut   = WebAuthn PRF(credential, prfSalt)        // 32 bytes; requires a biometric match
okm      = HKDF-SHA256(ikm = prfOut, salt = hkdfSalt, info = "wilson/biometric-unlock/v1", L = 64)
unlockKey= AES-GCM-256(okm[0..32])                   // non-extractable, memory only
keyCheck = SHA-256("wilson-keycheck-v1" || okm[32..64])  // the ONLY thing stored
```

- At rest the store keeps `prfSalt`, `hkdfSalt` and `keyCheck` (all sealed), plus the credential ID and public key (also sealed). There is no template, no PRF output, and no unlock key.
- `keyCheck` comes from the second half of the HKDF output, so knowing it gives no information about the encryption half.
- On unlock the gate re-derives and compares `keyCheck` in constant time. A different authenticator, or a re-enrolled finger or face that invalidates the credential, produces a mismatch.

## 5. Unlock flow: Wilson dashboard

1. Page load → `<BiometricGate>` → `gate.init()`. State is `not-enrolled`, `locked`, or `unsupported`. Unlocks never persist across reloads.
2. **Enroll** (first run): `navigator.credentials.create()` with the PRF extension → verify clientData (type, challenge, origin, not cross-origin) and authData (rpId hash, UP+UV flags) → read the SPKI public key. If PRF is enabled but no result came back at create time (the common case), run one assertion right away, which is a second biometric prompt. Derive the key and store the sealed enrollment record. The gate is now unlocked.
3. **Unlock**: `navigator.credentials.get()` with a fresh 32-byte challenge, restricted to the enrolled credential, `userVerification: "required"`, PRF salt. The gate verifies:
   - clientData: `type`, exact `challenge`, `origin`, `crossOrigin` false
   - authData: rpId hash, UP and UV flags
   - signature over `authData || SHA-256(clientDataJSON)` with the stored key (ES256 DER→raw, or RS256)
   - `signCount` strictly increasing, unless the authenticator always reports 0
   - re-derived `keyCheck` matches

   Only then is `<App/>` mounted.
4. **Lock**: `gate.lock()` drops the unlock key and unmounts the app. Triggers: 15 minutes with no pointer or key activity (`autoLockMs`), returning after more than 5 minutes in the background, or `window.dispatchEvent(new Event("wilson-lock"))` from anywhere in Wilson.

## 6. Unlock flow: GitHub repo access (GitHub CLI token exchange)

Goal: Wilson's GitHub abilities (and `gh` on her machine) work only after a biometric unlock, with no token in plaintext anywhere.

1. **Bind once.** While unlocked, Jenny runs `gh auth login` (or creates a fine-grained PAT scoped to her repos) and pastes the token into Wilson. Wilson calls `gate.sealSecret(GITHUB_TOKEN_SECRET, token)`. The token is AES-GCM sealed under the biometric-derived unlock key, then wrapped again under the device key. Nothing is written in plaintext.
2. **Use in Wilson.** After unlock, `gate.openSecret("github-cli-token")` returns the token in memory for the GitHub helper (`src/lib/github.ts`). When the gate locks, the key is gone and the token can't be decrypted.
3. **Exchange to the CLI** (roadmap, local helper). A small loopback helper (`wilson-unlock`, Node or Go, bound to 127.0.0.1) accepts a one-time request from the unlocked Wilson tab and runs `gh auth login --with-token` (stdin) or `GH_TOKEN=… gh …` for a single command. It never writes the token to disk outside `gh`'s own keychain-backed store. Each request carries a fresh nonce signed by the WebAuthn assertion that just happened, so a captured request can't be replayed.
4. **Short-lived.** Preferred: use the stored credential only to mint short-lived tokens, either GitHub App installation tokens (1 h) or `gh auth refresh`, so a leaked in-memory token expires quickly. Revoke the long-lived one from GitHub settings after device loss.

> Today `src/lib/github.ts` keeps its PAT in plaintext `localStorage` (`wilson_github_token`). Migrating it to `gate.sealSecret()` is the first follow-up (see Decisions D7).

## 7. Threat model

| Threat | Mitigation | Residual risk |
|---|---|---|
| **Replay** of a captured WebAuthn response | Fresh random challenge per ceremony, checked byte-exact. Origin and rpId hash checked. `signCount` must increase. Tests cover replayed assertions and counter rollback. | Authenticators that always report `signCount = 0` (most synced passkeys) rely on the challenge check alone. That is sufficient for replay, but cloning can't be detected this way. |
| **Phishing / other origin** | WebAuthn binds credentials to the rpId. The gate also checks `origin` and refuses `crossOrigin`. | None material. |
| **Template theft** | No template is ever stored or seen. Templates stay in the Secure Enclave / TPM / StrongBox. Wilson stores only sealed salts, a credential public key, and a one-way `keyCheck`. | A compromise of the OS biometric stack itself is out of scope. |
| **Storage theft** (IndexedDB copied off the device) | Every record is AES-GCM sealed under a non-extractable device key. In `webauthn-prf` mode, secrets are also sealed under a key that needs a live biometric match. | With `webauthn` (no PRF) or the stub, an attacker running code *on the unlocked device* could open secrets with the device key. That is why PRF is preferred and the stub is dev-only. |
| **XSS / malicious script in Wilson's origin** | Non-extractable keys can't be exported. The unlock key lives in memory only while unlocked. | Script running in the origin while Wilson is unlocked can call `openSecret`. Keep the CSP tight, add no third-party scripts to the gate path, and auto-lock. |
| **Device loss / theft** | An attacker needs her biometric. The device OS lock still applies. Wilson auto-locks. | Recovery: clear Wilson's site data on the new device and re-enroll (`unenroll()` needs an unlocked gate). Revoke the GitHub token and remove the passkey from the platform account (iCloud Keychain / Google Password Manager). Sealed secrets on the lost device are unrecoverable without her biometric, which is intended. |
| **Coerced or sleeping-user unlock** | OS-level attention detection (Face ID "Require Attention"). | Outside what a web gate can solve. |
| **Synced passkey on another of her devices** | Expected: the same credential can unlock Wilson there. With PRF, each device still has its own device key, so secrets don't follow automatically. | If her platform account (Apple ID / Google) is taken over, the attacker gets the passkey. Use strong account security for those accounts. |
| **Downgrade to the stub** | The stub is off unless `allowInsecureFallback` (dev builds). The enrollment method is recorded, and unlock refuses the stub in prod. | — |
| **Build-time bypass** (`VITE_BIOMETRIC_GATE=off`) | Only someone who controls the build or deploy can set it. | Same trust boundary as the code itself. |

## 8. Roadmap: open-sourcing the protocol

1. **v1 (this branch).** Local gate, PRF key derivation, sealed key store, React gate, unit tests with a mock authenticator.
2. **v1.1.** Move the GitHub token into the sealed store. Add a "Lock" control to Wilson's header. Add a settings screen (re-enroll, auto-lock time). Add an e2e test with Chrome's virtual authenticator (CDP `WebAuthn.addVirtualAuthenticator`, which supports PRF).
3. **v1.2.** Capacitor `NativeBiometricProvider` (iOS/Android) to replace `LocalStubProvider`. Loopback `wilson-unlock` helper for `gh`.
4. **v2.** Multi-device: enroll more than one credential, and use an optional server-side verifier (Cloudflare Worker, alongside `wilson-proxy`) that stores only public keys and counters for remote unlocks. Recovery codes sealed offline.
5. **Spec.** Publish "Wilson Unlock Protocol" (WUP) as a short RFC-style document covering record formats (`EnrollmentRecord`, `SealedBlob` v1), the derivation (`HKDF info = "wilson/biometric-unlock/v1"`, key-check construction), ceremony verification rules, the native-provider contract, and test vectors generated from the mock authenticator. License the spec CC-BY-4.0 and the reference implementation (`src/lib/biometrics`) MIT/Apache-2.0. Ask for review on the W3C WebAuthn / FIDO community channels before calling it 1.0.

## 9. Decisions

Calls made without asking, per the directive:

- **D1. "Derive from the biometric template" means "derive from the biometric-bound PRF secret".** Web and mobile platforms never expose templates, and storing one would break the "never store raw biometrics" rule. The PRF / hmac-secret output is released only after the authenticator's own template match, so it is the correct stand-in.
- **D2. The gate wraps `<App/>` in `src/main.tsx`.** It wraps the whole app rather than one dashboard route, so nothing in Wilson (chat, Architect dashboard, accounts) renders before unlock. App is unmounted on lock. Chats persist through Wilson's existing local storage, so only in-flight UI state is lost.
- **D3. The stub fallback is dev-only by default.** It does no user verification. Turning it on in production would make the gate decorative on browsers without WebAuthn. Those browsers see an "unavailable" screen instead.
- **D4. Platform authenticators only** (`authenticatorAttachment: "platform"`), not roaming security keys. This matches "her own hardware, her biometrics". It is easy to relax later.
- **D5. Local verification only, no server.** Signature, counter, and challenge checks run in the client against the stored public key. This fits "runs on her hardware first". A server verifier is on the v2 roadmap.
- **D6. Auto-lock** after 15 minutes idle, or more than 5 minutes in the background. Unlocks never survive a reload.
- **D7. `src/lib/github.ts` is unchanged in this pass.** Its plaintext `localStorage` token is flagged, and migrating it to `gate.sealSecret()` is the first follow-up. Changing it now would silently break existing GitHub pushes for anyone who already set a token.
- **D8. Escape hatch:** `VITE_BIOMETRIC_GATE=off` at build time renders Wilson without the gate (local dev / emergency). The default is **on**. No deploy configs were changed.
- **D9. Tests use `node:test` + `tsx`**, the same runner as `workers/federation-ingest`, under `tests/biometrics/` so `tsc -b` for the app doesn't need `@types/node`. `npm run test:biometrics` runs them. No new dependencies were added to `package.json`.
- **D10. Credential algorithms:** ES256 (-7) is preferred, RS256 (-257) is accepted (Windows Hello). Any other algorithm is refused.
- **D11. Shipping impact.** The gate applies to everyone who loads the build, not only Jenny. Merging this branch to `main` triggers `deploy-pages.yml` and puts the gate in front of every Wilson user. Merge only when that is wanted, or build with `VITE_BIOMETRIC_GATE=off` for public builds.
