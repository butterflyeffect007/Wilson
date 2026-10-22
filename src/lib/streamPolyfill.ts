/**
 * iPhone Safari (iOS 18 and earlier) can't do `for await (const chunk of readableStream)`. The voice library's
 * pronunciation dictionary (phonemizer/espeak) unpacks itself that way, which made Puck fail on iPhones with
 * "undefined is not a function (near '...P of G...')". This adds the missing piece. Must be imported before kokoro-js.
 */
const RS = (globalThis as any).ReadableStream;
if (RS && !RS.prototype[Symbol.asyncIterator]) {
  const iter = async function* (this: ReadableStream) {
    const reader = this.getReader();
    try {
      for (;;) { const { done, value } = await reader.read(); if (done) return; yield value; }
    } finally { try { reader.releaseLock(); } catch { /* ignore */ } }
  };
  Object.defineProperty(RS.prototype, Symbol.asyncIterator, { value: iter, writable: true, configurable: true });
  if (!RS.prototype.values) Object.defineProperty(RS.prototype, "values", { value: iter, writable: true, configurable: true });
}
export {};
