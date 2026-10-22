/** Tiny pub/sub for the "saving…" telemetry pulse. */
let pending = 0;
const subs = new Set<(busy: boolean) => void>();
const emit = () => subs.forEach((f) => f(pending > 0));
export function beginSave() { pending++; emit(); }
export function endSave() { pending = Math.max(0, pending - 1); setTimeout(emit, 350); }
export function subscribeSaving(f: (busy: boolean) => void) { subs.add(f); return () => { subs.delete(f); }; }
