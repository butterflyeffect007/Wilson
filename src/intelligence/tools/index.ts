/**
 * Wilson public-data tools (client side). Tools run on the Wilson worker at
 * /tools/<name>; this module decides WHEN to call them (intent detection +
 * optional model JSON planning) and formats results for the final answer.
 */
import type { ModelAdapter } from "../ModelAdapter";
import { hasDirect, runDirect } from "./direct";

export type ToolName =
  | "apod" | "donki" | "asteroids" | "mars" | "cern" | "launches" | "spacex" | "iss"
  | "starlink" | "swpc" | "quakes" | "weather" | "wikipedia" | "arxiv"
  | "country" | "fx" | "books" | "news" | "place" | "web" | "quantum" | "scholar" | "wikidata" | "gdelt" | "flights" | "nearby";
export interface ToolCall { name: ToolName; params?: Record<string, string> }
export interface ToolSource { title: string; url: string }
export interface ToolResult { name: ToolName; ok: boolean; data?: unknown; sources: ToolSource[]; error?: string }

export const TOOL_DESCRIPTIONS: Record<ToolName, string> = {
  apod: "NASA Astronomy Picture of the Day",
  donki: "NASA DONKI: solar flares, CMEs, geomagnetic storms (last 7 days)",
  asteroids: "NASA NeoWs: asteroids passing Earth today/tomorrow",
  mars: "NASA Image Library search for Mars/rover images (params: q)",
  cern: "CERN Open Data portal search (params: q)",
  launches: "Upcoming rocket launches worldwide",
  spacex: "Latest / upcoming SpaceX launches",
  iss: "Live ISS position",
  starlink: "Starlink satellite positions, nearest to a lat/lon (params: lat, lon)",
  swpc: "NOAA space weather now: Kp index, solar wind, alerts",
  quakes: "USGS earthquakes M2.5+ last 24h",
  weather: "Open-Meteo weather forecast (params: place)",
  wikipedia: "Wikipedia search + summary (params: q)",
  arxiv: "arXiv paper search (params: q)",
  country: "Country facts from Wikidata: population, capital, area, currency (params: q = English country name, e.g. Japan)",
  fx: "Currency exchange rates, ECB reference (params: q = base ISO code e.g. USD, to = comma ISO codes e.g. EUR,JPY)",
  books: "Open Library book/author search (params: q)",
  news: "Recent tech headlines (Hacker News) + space news; optional topic (params: q). Not general world news.",
  web: "General web search (Brave) — ONLY for open-web/current questions no other tool covers (params: q = concise search query)",
  quantum: "Saved result of a real IBM quantum computer run (Bell state) with date + backend — NOT a live run",
  scholar: "Peer-reviewed paper search (Semantic Scholar / OpenAlex / Crossref) with citations (params: q)",
  wikidata: "Structured facts about a person, place, organization or thing from Wikidata (params: q = name)",
  gdelt: "Worldwide news articles from the last 3 days (GDELT) on a topic (params: q = topic)",
  flights: "Live aircraft overhead near a place (ADS-B) (params: place)",
  nearby: "Nearby amenities from OpenStreetMap, e.g. library, cafe, pharmacy, hospital (params: place, q = amenity)",
  place: "Find a place/address on OpenStreetMap: coordinates + map link (params: q)",
};

const RULES: [RegExp, (m: string) => ToolCall][] = [
  [/\bquantum (computer|computing|result|experiment|job|demo)s?\b|\bibm quantum\b|\bbell state\b|\bqubits?\b/i, () => ({ name: "quantum" })],
  [/\b(planes?|flights?|aircraft|airplanes?|jets?)\b[\w\s]{0,14}\b(overhead|above|near|over|flying|around)\b|\bwhat(?:'s| is) flying\b/i, (m) => ({ name: "flights", params: placeOf(m) })],
  [/\b(peer[- ]reviewed|scientific|scholarly|academic|journal) (papers?|articles?|studies|research)\b|\bstud(y|ies) (on|about)\b/i, (m) => ({ name: "scholar", params: { q: topic(m, /\b(peer[- ]reviewed|scientific|scholarly|academic|journal|papers?|articles?|studies|study|research|latest|recent|find|search|on|about|any|me|show)\b/gi) } })],
  [/\b(libraries|library|cafes?|coffee shops?|pharmac(y|ies)|hospitals?|parks?) (near|in|around)\b/i, (m) => ({ name: "nearby", params: { ...placeOf(m), q: (m.match(/\b(librar|cafe|coffee|pharmac|hospital|park)/i)?.[1] || "cafe").toLowerCase().replace(/^librar$/, "library").replace(/^coffee$/, "cafe").replace(/^pharmac$/, "pharmacy") } })],
  [/\b(iss|international space station|space station)\b/i, () => ({ name: "iss" })],
  [/\bstarlink|satellites? (over|above|near)\b/i, () => ({ name: "starlink" })],
  [/\bspace ?x|falcon|starship\b/i, () => ({ name: "spacex" })],
  [/\b(rocket )?launch(es)?\b.*\b(next|upcoming|today|week|soon)\b|\bnext launch\b/i, () => ({ name: "launches" })],
  [/\b(kp|aurora|northern lights|geomagnetic|solar wind|space weather)\b/i, () => ({ name: "swpc" })],
  [/\b(solar flares?|cme|coronal mass)\b/i, () => ({ name: "donki" })],
  [/\b(asteroids?|near[- ]earth|neo)\b/i, () => ({ name: "asteroids" })],
  [/\b(apod|astronomy picture|nasa (picture|photo|image) of the day)\b/i, () => ({ name: "apod" })],
  [/\b(mars|rover|perseverance|curiosity rover)\b.*\b(photo|picture|image)s?\b|\b(photo|picture|image)s?\b.*\b(mars|rover)\b/i, (m) => ({ name: "mars", params: { q: m } })],
  [/\b(earthquakes?|quakes?|seismic)\b/i, () => ({ name: "quakes" })],
  [/\bcern\b|\blhc\b|\b(cms|atlas|alice|lhcb) (data|dataset)/i, (m) => ({ name: "cern", params: { q: topic(m, /\b(cern|open data|data(sets?)?|search|find|on|about|for|the)\b/gi) || "higgs" } })],
  [/\barxiv\b|\b(papers?|preprints?|research) (on|about)\b/i, (m) => ({ name: "arxiv", params: { q: topic(m, /\b(arxiv|papers?|preprints?|research|latest|recent|find|search|on|about|any|me|show)\b/gi) } })],
  [/\b(news|headlines)\b/i, (m) => ({ name: "news", params: (() => { const q = topic(m, /\b(news|headlines|latest|recent|today|about|on|any|me|show|top)\b/gi); return q ? { q } : ({} as Record<string, string>); })() })],
  [/\bexchange rates?\b|\b(usd|eur|gbp|jpy|cad|aud|mxn|dollars?|euros?|pounds?|yen) (to|in) /i, () => ({ name: "fx" })],
  [/\b(weather|forecast|temperature|rain(ing)?|snow(ing)?)\b/i, (m) => ({ name: "weather", params: placeOf(m) })],
];

function topic(m: string, strip: RegExp): string {
  return m.replace(/[?!.]/g, "").replace(strip, " ").replace(/\b(what|whats|what's|is|are|there|can|you|tell|wilson|hey|please|give|some)\b/gi, " ").replace(/\s+/g, " ").trim().slice(0, 120);
}
function placeOf(m: string): Record<string, string> {
  const p = m.match(/\b(?:in|for|at|near|over|above)\s+([A-Z][\w .'-]{1,40}?)(?:\s+(?:today|tomorrow|this|right|now|tonight)\b|[?.!,]|$)/);
  return p ? { place: p[1].trim() } : {};
}

/** Cheap, reliable intent detection. Returns at most 2 calls. */
export function detectTools(message: string): ToolCall[] {
  const out: ToolCall[] = [];
  for (const [re, mk] of RULES) if (re.test(message) && !out.some((c) => c.name === mk(message).name)) out.push(mk(message));
  if (!out.length && /^(who|what) (is|was|are|were)\b|\b(look up|tell me about|wikipedia)\b/i.test(message))
    out.push({ name: "wikipedia", params: { q: topic(message, /\b(who|what|is|was|are|were|look up|tell me about|wikipedia)\b/gi) } });
  return out.slice(0, 2);
}

const CURRENT = /\b(latest|current|currently|right now|today|tonight|this week|recent|recently|breaking|who won|score|price of|just happened|news)\b/i;

/** Ask the model for a JSON tool request when keywords miss but the turn sounds factual/current. */
export async function planWithModel(adapter: ModelAdapter, message: string): Promise<ToolCall[]> {
  if (!/\b(latest|current|now|today|tonight|right now|news|recent|look up|search|real[- ]time|live|population|capital|currency|exchange|convert|book|author|novel|where is|address|map|located|how (many|big|far)|area of)\b/i.test(message)) return [];
  const list = Object.entries(TOOL_DESCRIPTIONS).map(([k, v]) => `- ${k}: ${v}`).join("\n");
  try {
    const r = await adapter.generate({
      systemContext: `You are a tool router. Decide if live public data would help answer the user. Tools:\n${list}\nReply with ONLY JSON: {"tools":[{"name":"<tool>","params":{...}}]} (max 2) or {"tools":[]}.`,
      userInput: message,
      generation: { temperature: 0, maxTokens: 150 },
      metadata: { task: "router" },
    });
    const m = r.text.match(/\{[\s\S]*\}/);
    let tools: ToolCall[] = [];
    if (m) { try { tools = JSON.parse(m[0]).tools ?? []; } catch { tools = []; } }
    // Some models answer the router with a native tool call instead of JSON text.
    if (!tools.length && Array.isArray(r.toolCalls)) {
      for (const tc of r.toolCalls as { function?: { name?: string; arguments?: string } }[]) {
        const fn = tc?.function; if (!fn?.name) continue;
        let params: Record<string, string> = {}; try { params = JSON.parse(fn.arguments || "{}"); } catch { /* ignore */ }
        if (fn.name === "tools" && Array.isArray((params as unknown as { tools?: ToolCall[] }).tools)) tools.push(...(params as unknown as { tools: ToolCall[] }).tools);
        else tools.push({ name: fn.name as ToolName, params: Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])) });
      }
    }
    tools = tools.filter((t: ToolCall) => t && t.name in TOOL_DESCRIPTIONS).slice(0, 2);
    if (!tools.length && CURRENT.test(message)) tools = [{ name: "web", params: { q: message.replace(/\s+/g, " ").trim().slice(0, 150) } }];
    return tools;
  } catch { return CURRENT.test(message) ? [{ name: "web", params: { q: message.replace(/\s+/g, " ").trim().slice(0, 150) } }] : []; }
}

export async function runTool(baseUrl: string, call: ToolCall, location?: { lat: number; lon: number }): Promise<ToolResult> {
  const params = { ...(call.params ?? {}) };
  if ((call.name === "starlink" || (call.name === "weather" && !params.place)) && location) { params.lat = String(location.lat); params.lon = String(location.lon); }
  if (call.name === "nearby" && !params.place && location) { params.lat = String(location.lat); params.lon = String(location.lon); }
  // Some free upstreams block Cloudflare but allow CORS: try them from the browser first, worker as fallback.
  let directErr = "";
  if (hasDirect(call.name)) {
    try { const d = await runDirect(call, params); return { name: call.name, ok: true, data: d.data, sources: d.sources }; }
    catch (e) { directErr = String((e as Error)?.message ?? e); }
  }
  const qs = new URLSearchParams(params).toString();
  try {
    const ctl = new AbortController(); const to = setTimeout(() => ctl.abort(), directErr ? 8000 : 12000); // shorter fallback budget if the browser path already used time
    const r = await fetch(`${baseUrl.replace(/\/$/, "")}/tools/${call.name}${qs ? "?" + qs : ""}`, { signal: ctl.signal });
    clearTimeout(to);
    const d = await r.json();
    if (!r.ok || d.error) return { name: call.name, ok: false, sources: [], error: (d.error ?? `HTTP ${r.status}`) + (directErr ? `; direct: ${directErr}` : "") };
    return { name: call.name, ok: true, data: d.data, sources: d.sources ?? [] };
  } catch (e) { return { name: call.name, ok: false, sources: [], error: String(e) + (directErr ? `; direct: ${directErr}` : "") }; }
}

/** Formats tool output as system context for the final answer, with citation instructions. */
export function toolContext(results: ToolResult[]): string {
  results = results.filter((r) => !(r.name === "web" && /not configured/.test(r.error ?? ""))); // inert until BRAVE_API_KEY is set
  if (!results.length) return "";
  const body = results.map((r) => r.ok
    ? `[${r.name}] ${JSON.stringify(r.data).slice(0, 2500)}\nSources: ${r.sources.slice(0, 3).map((s) => `${s.title} <${s.url}>`).join("; ")}`
    : `[${r.name}] unavailable right now (${r.error}).`).join("\n\n");
  return `\n\n[Live public data fetched just now — ${new Date().toISOString()}]\n${body}\n\nUse this data for facts in your answer, in your own voice. Do not invent numbers beyond it. If a tool was unavailable, say so briefly. End with a short "Sources:" line listing the source names and links you used.`;
}
