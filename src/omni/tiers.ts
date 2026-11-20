import type { OmniCaps } from "./caps";

export type OmniTierId = "e2b" | "phone" | "floor" | "rented";

export type OmniTier = {
  id: OmniTierId;
  label: string;
  blurb: string;
  sizeLabel: string;
  kind: "webllm" | "rented";
  /** Preferred WebLLM model ids, first match in the runtime catalog wins. f16 variants need shader-f16. */
  modelIds: string[];
  modelIdsNoF16: string[];
};

export const OMNI_TIERS: OmniTier[] = [
  {
    id: "e2b",
    label: "Gemma 4 E2B",
    blurb: "Owned-size WebLLM pack for capable devices. First download is large. Official MLC package is text + audio in; vision is not in this pack.",
    sizeLabel: "~2.5–2.7 GB",
    kind: "webllm",
    modelIds: ["gemma-4-E2B-it-q4f16_1-MLC"],
    modelIdsNoF16: ["gemma-4-E2B-it-q4f32_1-MLC"],
  },
  {
    id: "phone",
    label: "Qwen phone tier",
    blurb: "Auto-pick on iPhone and other phones. Tries Qwen3-0.6B first, then Qwen2.5-0.5B if that pack is not in the catalog.",
    sizeLabel: "~290–350 MB",
    kind: "webllm",
    modelIds: ["Qwen3-0.6B-q4f16_1-MLC", "Qwen2.5-0.5B-Instruct-q4f16_1-MLC"],
    modelIdsNoF16: ["Qwen3-0.6B-q4f32_1-MLC", "Qwen2.5-0.5B-Instruct-q4f32_1-MLC"],
  },
  {
    id: "floor",
    label: "SmolLM2-135M floor",
    blurb: "The smallest WebLLM pack we know has actually answered on an iPhone 15 Pro. Quality is limited; this is the survival floor.",
    sizeLabel: "~270 MB",
    kind: "webllm",
    modelIds: ["SmolLM2-135M-Instruct-q0f16-MLC", "SmolLM2-135M-Instruct-q4f16_1-MLC"],
    modelIdsNoF16: ["SmolLM2-135M-Instruct-q4f32_1-MLC", "SmolLM2-135M-Instruct-q0f32-MLC"],
  },
  {
    id: "rented",
    label: "Rented fallback",
    blurb: "Today's Wilson brain through the existing server (currently Gemma 4 31B, free route). Used if WebGPU is missing or a local pack fails to load.",
    sizeLabel: "no device download",
    kind: "rented",
    modelIds: [],
    modelIdsNoF16: [],
  },
];

const CRASH_KEY = "wilson_omni_crash";
const LOADING_KEY = "wilson_omni_loading";

export type CrashMap = Partial<Record<OmniTierId, string>>;

export function readCrashMap(): CrashMap {
  try {
    const raw = localStorage.getItem(CRASH_KEY);
    return raw ? JSON.parse(raw) as CrashMap : {};
  } catch {
    return {};
  }
}

export function markTierCrash(id: OmniTierId, reason: string): void {
  try {
    const map = readCrashMap();
    map[id] = reason;
    localStorage.setItem(CRASH_KEY, JSON.stringify(map));
  } catch { /* ignore */ }
}

export function clearTierCrash(id: OmniTierId): void {
  try {
    const map = readCrashMap();
    delete map[id];
    localStorage.setItem(CRASH_KEY, JSON.stringify(map));
  } catch { /* ignore */ }
}

/** Call before a load so a killed tab can be reported on the next visit. */
export function beginLoadWatch(id: OmniTierId): void {
  try { localStorage.setItem(LOADING_KEY, JSON.stringify({ id, at: Date.now() })); } catch { /* ignore */ }
}

export function endLoadWatch(): void {
  try { localStorage.removeItem(LOADING_KEY); } catch { /* ignore */ }
}

/** If a previous visit died mid-load, record it as a crash. */
export function harvestInterruptedLoad(): OmniTierId | null {
  try {
    const raw = localStorage.getItem(LOADING_KEY);
    if (!raw) return null;
    localStorage.removeItem(LOADING_KEY);
    const parsed = JSON.parse(raw) as { id?: OmniTierId };
    if (parsed.id) {
      markTierCrash(parsed.id, "The tab closed or was killed while this pack was loading. On iPhone this is often a memory limit.");
      return parsed.id;
    }
  } catch { /* ignore */ }
  return null;
}

/**
 * Auto-pick: phones (including iPhone, and Android phones) never start on E2B.
 * No WebGPU → rented. Otherwise phone/tablet → Qwen, unless that tier previously
 * crashed, then the floor, then rented. Capable desktop-class devices get E2B.
 */
export function isPhoneLike(caps: Pick<OmniCaps, "mobile" | "ios" | "deviceMemoryGB">): boolean {
  return !!(caps.mobile || caps.ios || (caps.deviceMemoryGB != null && caps.deviceMemoryGB <= 4));
}

/** The 2.5 GB Gemma pack can get an iPhone tab killed. Never start it on a phone. */
export function canStartTier(id: OmniTierId, caps: OmniCaps): boolean {
  if (id === "e2b" && isPhoneLike(caps)) return false;
  if (id !== "rented" && !caps.webgpu) return false;
  return true;
}

export function skipTierMessage(id: OmniTierId, caps: OmniCaps): string {
  if (id === "e2b" && isPhoneLike(caps)) {
    return "This pack is too large for this phone, so it wasn't started. Wilson can use the smaller on-device pack, or his usual cloud brain — both still work.";
  }
  if (id !== "rented" && !caps.webgpu) {
    return "This pack needs WebGPU, which this browser doesn't have. Wilson will keep using his usual cloud brain.";
  }
  return "This pack can't run on this device. Wilson will keep using his usual cloud brain.";
}

/** Soften mid-load tab-kill wording, especially after Gemma 4 on an iPhone. */
export function calmTierError(id: OmniTierId, caps: OmniCaps | null, raw: string | null | undefined): string | null {
  if (!raw) return null;
  if (id === "e2b" && caps && isPhoneLike(caps)) return skipTierMessage(id, caps);
  if (/tab closed or was killed/i.test(raw) || /memory limit/i.test(raw)) {
    return "The last download didn't finish on this phone, so Wilson skipped it. His usual cloud brain still works.";
  }
  return raw;
}

export function isSoftTierNote(blocked: boolean, note: string | null): boolean {
  if (blocked || !note) return true;
  return /usual cloud brain|wasn't started|didn't finish on this phone/i.test(note);
}

export function autoPickTier(caps: OmniCaps, crashes: CrashMap = readCrashMap()): OmniTierId {
  const skip = (id: OmniTierId) => !!crashes[id];
  const phoneLike = isPhoneLike(caps);
  if (!caps.webgpu) return "rented";
  if (phoneLike) {
    if (!skip("phone")) return "phone";
    if (!skip("floor")) return "floor";
    return "rented";
  }
  if (!skip("e2b")) return "e2b";
  if (!skip("phone")) return "phone";
  if (!skip("floor")) return "floor";
  return "rented";
}

export function pickReason(tier: OmniTierId, caps: OmniCaps, crashes: CrashMap): string {
  if (tier === "rented" && !caps.webgpu) return "No WebGPU on this browser, so the rented brain is the one that can actually answer.";
  if (tier === "phone" && (caps.mobile || caps.ios)) return "This looks like a phone. The large Gemma pack is too big for iPhone, so Wilson starts with the small Qwen pack.";
  if (tier === "e2b") return "This looks like a capable device with WebGPU, so the Gemma 4 E2B pack is the auto-pick. You can still test the smaller packs.";
  if (tier === "floor") return crashes.phone
    ? "The phone pack did not finish last time, so the floor model is the auto-pick."
    : "The floor pack is the auto-pick on this device.";
  if (tier === "rented") return "Local packs are unavailable or previously failed, so the rented fallback is the auto-pick.";
  return "Auto-picked for this device.";
}
