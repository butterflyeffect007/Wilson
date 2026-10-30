import type { TransactionIntent } from './types.js';

function encode(value: unknown, stack: Set<object>): string {
  if (value === null) return 'null';
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('non-finite numbers are unsupported');
    return JSON.stringify(Object.is(value, -0) ? 0 : value);
  }
  if (typeof value !== 'object') throw new TypeError('unsupported canonicalization value');
  if (stack.has(value)) throw new TypeError('cyclic values are unsupported');
  stack.add(value);
  try {
    if (Array.isArray(value)) {
      const keys = Object.keys(value);
      if (Reflect.ownKeys(value).some((key) => typeof key === 'symbol') ||
          keys.length !== value.length || keys.some((key, index) => key !== String(index))) {
        throw new TypeError('sparse arrays and extra array properties are unsupported');
      }
      const items: string[] = [];
      for (let i = 0; i < value.length; i++) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(i));
        if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) throw new TypeError('array accessors are unsupported');
        items.push(encode(descriptor.value, stack));
      }
      return '[' + items.join(',') + ']';
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) throw new TypeError('non-plain objects are unsupported');
    if (Object.getOwnPropertySymbols(value).length) throw new TypeError('symbol keys are unsupported');
    const names = Object.getOwnPropertyNames(value);
    const keys = Object.keys(value);
    if (names.length !== keys.length) throw new TypeError('non-enumerable properties are unsupported');
    keys.sort();
    const fields = keys.map((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) throw new TypeError('accessors are unsupported');
      return JSON.stringify(key) + ':' + encode(descriptor.value, stack);
    });
    return '{' + fields.join(',') + '}';
  } finally {
    stack.delete(value);
  }
}

export function canonicalizeIntent(intent: TransactionIntent): string {
  return encode(intent, new Set<object>());
}
