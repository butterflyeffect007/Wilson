import test from 'node:test';
import assert from 'node:assert/strict';
import { detectTools, toolContext } from '../../src/intelligence/tools/index';
for (const query of [
 'Can you use your Brave search to look up IP lawyers in Austin?',
 'find IP lawyers in Austin',
 'Find an IP attorney in Austin',
 'Use Brave to find IP lawyers in Austin',
]) {
 test(`deterministic search: ${query}`, () => {
   const calls = detectTools(query);
   assert.equal(calls[0]?.name, 'web');
   assert.match(calls[0]?.params?.q || '', /Austin/);
   assert.doesNotMatch(calls[0]?.params?.q || '', /Brave|use your|Can you/i);
 });
}
test('web context includes clickable-link instructions and current capability evidence', () => {
 const ctx = toolContext([{name:'web',ok:true,data:{results:[{title:'Test firm',url:'https://example.com',snippet:'IP lawyers'}]},sources:[{title:'Test firm',url:'https://example.com'}]}]);
 assert.match(ctx, /clickable Markdown links/);
 assert.match(ctx, /https:\/\/example.com/);
 assert.doesNotMatch(ctx, /never the full URL/);
});
test('unavailable search stays visible, not silently dropped', () => {
 const ctx = toolContext([{name:'web',ok:false,error:'web search unavailable (not configured)',sources:[]}]);
 assert.match(ctx, /unavailable/);
 assert.match(ctx, /do not invent results/);
});
