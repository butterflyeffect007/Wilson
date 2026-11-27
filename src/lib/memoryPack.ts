/**
 * Signed-in memory pack: Teach Wilson lessons, state-of-you, quiet memory, and text facts.
 * Merged on this device, then synced to the account (/acct/memory) when signed in.
 */
import { loadLessons, saveLessons } from "../core/wilson/WilsonLearning";
import { loadStateOfYou, applyStateOfYou } from "./stateOfYou";
import { loadQuietMemory, applyQuietMemory } from "./quietMemory";
import { loadTextFacts, replaceTextFacts } from "./longMemory";
import { mergePacks, type MemoryPack } from "./memoryPackMerge";

export { mergePacks, type MemoryPack } from "./memoryPackMerge";
export const MEMORY_PACK_EVENT = "wilson-memory-pack-dirty";

export function bumpMemoryPack(): void {
  try { window.dispatchEvent(new Event(MEMORY_PACK_EVENT)); } catch { /* ignore */ }
}

export function gatherLocalPack(): MemoryPack {
  return {
    updatedAt: Date.now(),
    lessons: loadLessons(),
    stateOfYou: loadStateOfYou(),
    quietMemory: loadQuietMemory(),
    facts: loadTextFacts(),
  };
}

/** Write a pack onto this device (does not bump a sync by itself). */
export function applyLocalPack(pack: MemoryPack, emit = true): void {
  saveLessons(pack.lessons || []);
  applyStateOfYou(pack.stateOfYou as Parameters<typeof applyStateOfYou>[0], emit);
  applyQuietMemory(pack.quietMemory, emit);
  replaceTextFacts(pack.facts || []);
}
