# OG Claim, Telemetry Redesign & Nightly Notes

Shipped on main (frontend):

- `src/lib/claim.ts` — passkey + name/email claim helpers
- `src/components/ClaimSeat.tsx` — frictionless claim UI
- `src/lib/admin.ts` — richer `Telemetry` + `RosterEntry` + `setRosterLabel`
- `src/components/AdminPanel.tsx` — Health numbers + filterable claimed roster with labels

## Still needed in App.tsx (manual patch — file is large)

### 1. Imports (after AdminPanel import)

```ts
import { ClaimSeat } from "./components/ClaimSeat";
import { isClaimed, loadClaim } from "./lib/claim";
```

### 2. State + soft prompt (right after `betaNum` state)

```ts
const [showClaim, setShowClaim] = useState(false);
useEffect(() => {
  if (!betaNum || betaNum > 100 || isClaimed()) return;
  if (localStorage.getItem("wilson_claim_prompted")) return;
  const t = setTimeout(() => {
    setShowClaim(true);
    try { localStorage.setItem("wilson_claim_prompted", "1"); } catch {}
  }, 8000);
  return () => clearTimeout(t);
}, [betaNum]);
```

### 3. Nightly notes scroll fix (replace the awayNote block)

```tsx
{awayNote && (
  <div className="fixed bottom-28 left-1/2 -translate-x-1/2 z-[55] w-[min(92vw,30rem)] max-h-[min(42vh,22rem)] glass-strong rounded-2xl px-4 py-3 shadow-lg text-[15px] leading-[1.65] text-violet-950/90 flex flex-col">
    <div className="text-[11px] tracking-[0.12em] text-violet-500 mb-1 shrink-0">WHILE YOU WERE AWAY</div>
    <div className="whitespace-pre-wrap overflow-y-auto overscroll-contain flex-1 min-h-0 pr-1">{awayNote.text}</div>
    <div className="flex gap-4 mt-2 text-[13px] shrink-0">
      <button type="button" className="underline text-violet-700" onClick={() => { markNoteSeen(awayNote.ts); setInput(`About your note: `); setAwayNote(null); }}>Talk about it</button>
      <button type="button" className="underline text-violet-500" onClick={() => { markNoteSeen(awayNote.ts); setAwayNote(null); }}>Got it</button>
    </div>
  </div>
)}
{showClaim && betaNum && betaNum <= 100 && !isClaimed() && (
  <ClaimSeat onClose={() => setShowClaim(false)} onClaimed={() => setShowClaim(false)} />
)}
```

Optional: add a "Claim your OG seat" button in settings when `betaNum <= 100 && !isClaimed()`.

---

## Worker contracts to implement (Cloudflare Worker)

### POST /beta/claim

```json
// request
{
  "anon": "uuid",
  "number": 42,
  "method": "passkey" | "name" | "email",
  "displayName": "optional",
  "contact": "optional email/X/wallet",
  "credentialId": "optional base64 (passkey)"
}
// response
{ "ok": true } | { "error": "..." }
```

Store claim on the beta record. CredentialId is for future recovery only (never treat as secret on the server beyond association).

### POST /admin/roster/label

```json
{ "number": 42, "label": "real" | "bot" | "duplicate" | "jenny-test" | "paid" | "unlabeled" }
```

### GET /admin/telemetry (extend existing)

Return the richer shape already typed in `src/lib/admin.ts`:

- `beta.claimed` — count of claimed seats
- `beta.activeToday` — unique devices with ≥1 message in last 24h
- `beta.roster[]` — full `RosterEntry` objects (number, ts, lastActive, messages, claimed, method, displayName, contact, label)
- `reports.open` — unresolved count
- `health.uniqueHumans7d`, `health.retention3d`, `health.retention7d` (optional but useful)

---

## What this unlocks for you

1. **Nightly notes** now scroll when long.
2. **OG 100** can claim with Face ID / Touch ID or a light name + contact — zero friction to chat, optional identity for rewards.
3. **Architect roster** shows claimed status, contact, and lets you label Real / Bot / Duplicate / Jenny-test / Paid.
4. **Telemetry** focuses on seats claimed, active humans, retention, and open reports instead of vanity RPM only.

After the App.tsx patch + worker endpoints, you can export the claimed roster and pay the real people.
