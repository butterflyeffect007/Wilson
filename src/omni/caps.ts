/** Device / WebGPU probe used to auto-pick an Omni Lab tier. No secrets. */

export type OmniCaps = {
  webgpu: boolean;
  shaderF16: boolean;
  deviceMemoryGB: number | null;
  mobile: boolean;
  ios: boolean;
  android: boolean;
  ua: string;
  error: string | null;
};

function uaString(): string {
  try { return navigator.userAgent || ""; } catch { return ""; }
}

export function isIos(ua = uaString()): boolean {
  if (/iPhone|iPod|iPad/i.test(ua)) return true;
  // iPadOS can report Macintosh + touch
  try {
    return /Macintosh/i.test(ua) && navigator.maxTouchPoints > 1;
  } catch {
    return false;
  }
}

export function isAndroid(ua = uaString()): boolean {
  return /Android/i.test(ua);
}

export function isMobileDevice(ua = uaString()): boolean {
  try {
    const uaData = (navigator as Navigator & { userAgentData?: { mobile?: boolean } }).userAgentData;
    if (uaData && typeof uaData.mobile === "boolean") return uaData.mobile || isIos(ua);
  } catch { /* ignore */ }
  if (isIos(ua)) return true;
  if (/Android.+Mobile/i.test(ua)) return true;
  if (/\b(webOS|BlackBerry|IEMobile|Opera Mini|Mobi)\b/i.test(ua)) return true;
  return false;
}

export async function probeOmniCaps(): Promise<OmniCaps> {
  const ua = uaString();
  const caps: OmniCaps = {
    webgpu: false,
    shaderF16: false,
    deviceMemoryGB: null,
    mobile: isMobileDevice(ua),
    ios: isIos(ua),
    android: isAndroid(ua),
    ua: ua.slice(0, 180),
    error: null,
  };
  try {
    const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
    if (typeof mem === "number" && mem > 0) caps.deviceMemoryGB = mem;
  } catch { /* iOS often hides this */ }
  try {
    const gpu = (navigator as Navigator & { gpu?: { requestAdapter: (opts?: unknown) => Promise<{ features: { has: (n: string) => boolean } } | null> } }).gpu;
    if (!gpu) {
      caps.error = "This browser has no WebGPU.";
      return caps;
    }
    const adapter = await gpu.requestAdapter();
    if (!adapter) {
      caps.error = "WebGPU is present but no adapter was available.";
      return caps;
    }
    caps.webgpu = true;
    caps.shaderF16 = !!adapter.features?.has("shader-f16");
  } catch (err) {
    caps.error = err instanceof Error ? err.message : "WebGPU probe failed.";
  }
  return caps;
}

export function describeCaps(c: OmniCaps): string {
  const parts = [
    c.webgpu ? "WebGPU yes" : "WebGPU no",
    c.shaderF16 ? "shader-f16 yes" : "shader-f16 no",
    c.deviceMemoryGB != null ? `memory ~${c.deviceMemoryGB} GB` : "memory unknown",
    c.ios ? "iOS" : c.android ? "Android" : c.mobile ? "phone" : "desktop-class",
  ];
  return parts.join(" · ");
}
