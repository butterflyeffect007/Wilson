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
  | "country" | "fx" | "books" | "news" | "place" | "web" | "quantum" | "scholar" | "wikidata" | "gdelt" | "flights" | "nearby"
  | "disasters" | "alerts" | "airquality" | "crypto" | "dictionary" | "holidays" | "grants"
  | "flightstatus" | "airport" | "ntrs" | "nasadoc";
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
  flights: "Live aircraft flying near a place right now (params: place)",
  flightstatus: "Live status of one flight by its number: on time/delayed, gates, times (params: q = flight number e.g. AA100 or UA 123)",
  airport: "Next departures or arrivals at an airport (params: q = airport code or name e.g. DFW, to = departures|arrivals)",
  nearby: "Nearby amenities from OpenStreetMap, e.g. library, cafe, pharmacy, hospital (params: place, q = amenity)",
  place: "Find a place/address on OpenStreetMap: coordinates + map link (params: q)",
  disasters: "Current major disaster alerts worldwide (GDACS: cyclones, floods, quakes, volcanoes, wildfires; last 7 days)",
  alerts: "Active US National Weather Service alerts/warnings for a US place (params: place)",
  airquality: "Air quality index (AQI, PM2.5, ozone) for a place (params: place)",
  crypto: "Cryptocurrency prices (params: q = coin names e.g. bitcoin,ethereum; to = fiat e.g. usd)",
  dictionary: "Dictionary definition of an English word (params: q = the word)",
  holidays: "Public holidays for a country (params: q = country name or ISO code, date = optional year)",
  grants: "Open US federal grant opportunities from Grants.gov (params: q = topic, e.g. community gardens)",
  ntrs: "NASA Technical Reports Server: search NASA's own research papers, tech briefs and reports (params: q = research topic, e.g. vibration control neural networks)",
  nasadoc: "Read a NASA Technical Reports Server document from its link (params: q = the ntrs.nasa.gov link, focus = what the user wants to know)",
};

const CUR: Record<string, string> = { dollar: "USD", dollars: "USD", buck: "USD", bucks: "USD", euro: "EUR", euros: "EUR", pound: "GBP", pounds: "GBP", quid: "GBP", yen: "JPY", peso: "MXN", pesos: "MXN", rupee: "INR", rupees: "INR", yuan: "CNY", renminbi: "CNY", franc: "CHF", francs: "CHF", real: "BRL", reais: "BRL", rand: "ZAR", lira: "TRY", zloty: "PLN", krona: "SEK", kronor: "SEK", krone: "NOK" };
const ISO = new Set("AUD BGN BRL CAD CHF CNY CZK DKK EUR GBP HKD HUF IDR ILS INR ISK JPY KRW MXN MYR NOK NZD PHP PLN RON SEK SGD THB TRY USD ZAR".split(" "));
const curOf = (w: string) => { const u = w.toUpperCase(); return ISO.has(u) ? u : CUR[w.toLowerCase()] || ""; };
const CUR_WORDS = `${[...ISO].join("|")}|dollars?|bucks?|euros?|pounds?|quid|yen|pesos?|rupees?|yuan|renminbi|francs?|reais|real|rand|lira|zloty|kron[aoe]r?`;
const FX_RE = new RegExp(`(?:(\\d[\\d,]*(?:\\.\\d+)?)\\s*)?\\b(${CUR_WORDS})\\b\\s+(?:to|in|into|vs\\.?|versus)\\s+(${CUR_WORDS})\\b`, "i");
function fxParams(m: string): Record<string, string> {
  const x = m.match(FX_RE); if (!x) return { q: "USD" };
  const from = curOf(x[2]), to = curOf(x[3]);
  if (!from) return { q: "USD" };
  return { q: from, ...(to && to !== from ? { to } : {}), ...(x[1] ? { amount: x[1].replace(/,/g, "") } : {}) };
}
const COINS = /\b(bitcoin|btc|ethereum|ether|eth|dogecoin|doge|solana|xrp|ripple|cardano|litecoin|ltc|shiba inu|shib|tether|usdt|usdc|polkadot|avalanche|avax|chainlink|stellar|tron|toncoin|pepe)\b/gi;
function dictWord(m: string): string {
  const x = m.match(/\b(?:define|definition of|meaning of|what does|what's the meaning of|what is the meaning of|how do you spell|synonyms? (?:of|for))\s+(?:the word\s+)?["'“]?([a-z][a-z'-]{1,40})/i);
  return x ? x[1].toLowerCase() : "";
}

const NASA_LINK = /https?:\/\/(?:ntrs\.nasa\.gov\/\S+|(?:[\w-]+\.)*nasa\.gov\/\S+?\.pdf\b)/i;
const NASA_RESEARCH = /\bnasa\b[^.?!\n]{0,60}\b(research\w*|stud(?:y|ies|ied)|papers?|(?:technical |tech )?reports?|tech briefs?|publications?|experiments?|investigat\w*|work(?:ed|ing)? on|done (?:on|with|about|in|for)|developed|invent\w*|findings?)\b|\b(research\w*|stud(?:y|ies)|papers?|reports?|work)\b[^.?!\n]{0,40}\b(?:by|from|at) nasa\b|\bntrs\b|\bnasa (?:technical reports?|tech briefs?)\b/i;

const RULES: [RegExp, (m: string) => ToolCall][] = [
  // NASA research (NTRS). A pasted NASA document link wins; otherwise "what has NASA researched/studied/done on X".
  [NASA_LINK, (m) => ({ name: "nasadoc", params: { q: (m.match(NASA_LINK)?.[0] || "").replace(/[)\].,;!?'"]+$/, ""), focus: m.replace(NASA_LINK, " ").replace(/\s+/g, " ").trim().slice(0, 160) } })],
  [NASA_RESEARCH, (m) => ({ name: "ntrs", params: { q: topic(m.replace(NASA_LINK, " "), /\b(nasa'?s?|ntrs|technical|tech|reports?|briefs?|research(?:ed|ing|ers?)?|stud(?:y|ies|ied)|papers?|publications?|experiments?|investigat\w*|findings?|work(?:ed|ing)?|done|did|do|does|has|have|had|ever|developed|invented|anything|on|about|with|into|in|for|of|by|from|at|the|a|an|any|find|search|look|up|me|show|latest|recent|know)\b/gi) || "space" } })],
  [/^\s*(?:hey wilson,?\s*)?(?:please\s+)?define\s+\w|\b(definition|meaning) of (?:the word )?["'“]?(?!life\b)[a-z'-]+["'”]?\s*\??$|\bwhat does ["'“]?[a-z'-]+["'”]? mean\b|\bsynonyms? (?:of|for)\b/i, (m) => ({ name: "dictionary", params: { q: dictWord(m) } })],
  [/\b(bitcoin|btc|ethereum|dogecoin|solana|xrp|cardano|litecoin|crypto(?:currency|currencies)?|shiba inu|tether|usdt|chainlink|polkadot)\b|\b(eth|doge|sol|ada|ltc) (price|to usd)\b/i, (m) => ({ name: "crypto", params: { q: [...new Set((m.match(COINS) || []).map((c) => c.toLowerCase().replace(/\s+/g, "")))].slice(0, 4).join(",") || "bitcoin,ethereum" } })],
  [/\b(grants?|funding opportunit(?:y|ies))\b.{0,30}\b(for|about|on|to fund|supporting|related to)\b|\b(find|search|look for|any|list|open|federal|available|new)\b.{0,20}\b(grants?|funding opportunit(?:y|ies))\b/i, (m) => ({ name: "grants", params: { q: topic(m, /\b(grants?|funding|opportunit(y|ies)|find|search|look|for|about|on|to|fund|supporting|related|any|list|open|federal|available|new|me|show|apply|applying|get|i|we|my|our|could|that|there|the|a|an|help|write|writing|proposal)\b/gi) || "community" } })],
  [/\b(weather|storm|tornado|flood|severe weather|heat|winter|hurricane|fire) (alerts?|warnings?|watch(?:es)?|advisor(?:y|ies))\b|\bnws alerts?\b|\b(?:any )?alerts? (?:in|for|near) [A-Z]/i, (m) => ({ name: "alerts", params: placeOf(m) })],
  [/\b(air quality|aqi|smog|air pollution|pm ?2\.?5|wildfire smoke)\b/i, (m) => ({ name: "airquality", params: placeOf(m) })],
  [/\b(public|bank|national|federal) holidays?\b|\bholidays? (?:in|for) [A-Z]|\bnext (?:public |bank |federal )?holiday\b|\bwhen is the next holiday\b/i, (m) => ({ name: "holidays", params: (() => { const p = placeOf(m); const y = m.match(/\b(20\d\d)\b/); return { ...(p.place ? { q: p.place } : {}), ...(y ? { date: y[1] } : {}) } as Record<string, string>; })() })],
  [/\b(natural )?disasters?\b|\b(any|current|active|latest|ongoing)\b.{0,15}\b(cyclones?|hurricanes?|typhoons?|tropical storms?|floods?|flooding|wildfires?|volcan(?:o|oes|ic)|eruptions?|tsunamis?|droughts?)\b|\b(cyclones?|hurricanes?|typhoons?|floods?|wildfires?|volcan(?:o|oes)|eruptions?|tsunamis?)\b.{0,25}\b(now|today|right now|this week|happening)\b/i, () => ({ name: "disasters" })],
  [/\bbooks? (by|about|on|like)\b|\bnovels? (by|about)\b|\bwho wrote\b/i, (m) => ({ name: "books", params: { q: topic(m, /\b(books?|novels?|by|about|on|like|who|wrote|recommend|good|best|some|find|me|any)\b/gi) } })],
  [/\bquantum (computer|computing|result|experiment|job|demo)s?\b|\bibm quantum\b|\bbell state\b|\bqubits?\b/i, () => ({ name: "quantum" })],
  [/\b(planes?|flights?|aircraft|airplanes?|jets?)\b[\w\s]{0,14}\b(overhead|above|near|over|flying|around)\b|\bwhat(?:'s| is) flying\b/i, (m) => ({ name: "flights", params: placeOf(m) })],
  [/\b(peer[- ]reviewed|scientific|scholarly|academic|journal) (papers?|articles?|studies|research)\b|\bstud(y|ies) (on|about)\b/i, (m) => ({ name: "scholar", params: { q: topic(m, /\b(peer[- ]reviewed|scientific|scholarly|academic|journal|papers?|articles?|studies|study|research|latest|recent|find|search|on|about|any|me|show)\b/gi) } })],
  [/\b(libraries|library|cafes?|coffee shops?|pharmac(y|ies)|hospitals?|parks?) (near|in|around)\b/i, (m) => ({ name: "nearby", params: { ...placeOf(m), q: (m.match(/\b(librar|cafe|coffee|pharmac|hospital|park)/i)?.[1] || "cafe").toLowerCase().replace(/^librar$/, "library").replace(/^coffee$/, "cafe").replace(/^pharmac$/, "pharmacy") } })],
  [/\b(iss|international space station|space station)\b/i, () => ({ name: "iss" })],
  [/\bstarlink|satellites? (over|above|near)\b/i, () => ({ name: "starlink" })],
  [/\bspace ?x|falcon|starship\b/i, () => ({ name: "spacex" })],
  [/\b(rocket )?launch(es)?\b.*\b(next|upcoming|today|week|soon)\b|\b(next|upcoming) (rocket |space )?launch(es)?\b|\brocket launch(es)? (this|today|tonight)\b/i, () => ({ name: "launches" })],
  [/\b(kp|aurora|northern lights|geomagnetic|solar wind|space weather)\b/i, () => ({ name: "swpc" })],
  [/\b(solar flares?|cme|coronal mass)\b/i, () => ({ name: "donki" })],
  [/\b(asteroids?|near[- ]earth|neo)\b/i, () => ({ name: "asteroids" })],
  [/\b(apod|astronomy picture|nasa (picture|photo|image) of the day)\b/i, () => ({ name: "apod" })],
  [/\b(mars|rover|perseverance|curiosity rover)\b.*\b(photo|picture|image)s?\b|\b(photo|picture|image)s?\b.*\b(mars|rover)\b/i, (m) => ({ name: "mars", params: { q: m } })],
  [/\b(earthquakes?|quakes?|seismic)\b/i, () => ({ name: "quakes" })],
  [/\bcern\b|\blhc\b|\b(cms|atlas|alice|lhcb) (data|dataset)/i, (m) => ({ name: "cern", params: { q: topic(m, /\b(cern|open data|data(sets?)?|search|find|on|about|for|the)\b/gi) || "higgs" } })],
  [/\barxiv\b|\b(papers?|preprints?|research) (on|about)\b/i, (m) => ({ name: "arxiv", params: { q: topic(m, /\b(arxiv|papers?|preprints?|research|latest|recent|find|search|on|about|any|me|show)\b/gi) } })],
  [/\b(news|headlines)\b/i, (m) => ({ name: "news", params: (() => { const q = topic(m, /\b(news|headlines|latest|recent|today|about|on|any|me|show|top)\b/gi); return q ? { q } : ({} as Record<string, string>); })() })],
  [/\bexchange rates?\b|\bconvert\b.{0,20}\b(usd|eur|gbp|jpy|dollars?|euros?|pounds?|yen|pesos?)\b/i, (m) => ({ name: "fx", params: fxParams(m) })],
  [FX_RE, (m) => ({ name: "fx", params: fxParams(m) })],
  [/\b(weather|forecast|temperature|rain(ing)?|snow(ing)?)\b/i, (m) => ({ name: "weather", params: placeOf(m) })],
];

// ---- flights (AirLabs on the worker) ----
const AIRLINE_NAMES = "american(?: airlines)?|united(?: airlines)?|delta(?: air lines)?|southwest|alaska(?: airlines)?|jetblue|spirit|frontier|allegiant|hawaiian|sun country|breeze|air canada|westjet|british airways|lufthansa|air france|klm|emirates|qatar(?: airways)?|aeromexico|volaris|virgin atlantic|iberia|turkish airlines|ryanair|easyjet|qantas|singapore airlines|japan airlines|cathay pacific|korean air|envoy|skywest|republic";
const FLIGHT_CTX = /\b(on time|delay(?:ed|s)?|late|land(?:ed|s|ing)?|status|gate|terminal|depart(?:ed|s|ing|ure)?|arriv(?:e|ed|es|ing|al)|boarding|cancel+ed|take ?off|took off|en route|in the air|where is|track|flight)\b/i;
/** Returns the flight-number text to send to the worker, or "". */
export function flightNumberOf(m: string): string {
  let x = m.match(new RegExp(`\\b(${AIRLINE_NAMES})\\s+(?:flight\\s+)?#?\\s?(\\d{1,4})\\b`, "i")); if (x) return `${x[1]} ${x[2]}`;
  x = m.match(/\bflight\s+(?:number\s+)?#?\s?((?:[a-z]{2}|[a-z]\d|\d[a-z])\s?\d{1,4})\b/i); if (x) return x[1];
  if (!FLIGHT_CTX.test(m)) return "";
  x = m.match(/\b((?:[A-Z]{2}|[A-Z]\d|\d[A-Z])\s?\d{1,4})\b/); if (x && !/^(AM|PM|MP|ID|OK|TV|PS|UK|US|EU)\s?\d/.test(x[1])) return x[1];
  x = m.match(/\b((?:[a-z]{2}|[a-z]\d)\d{2,4})\b/i); if (x && !/^(mp[34]|b12|covid|top|no|vs|pg)/i.test(x[1])) return x[1];
  return "";
}
/** Airport departures/arrivals ask -> { q, to }, or null. */
export function airportAskOf(m: string): Record<string, string> | null {
  if (/\b(cheap|price|prices|cost|fares?|tickets?|book(?:ing)?|deals?)\b/i.test(m)) return null;
  if (!/\b(departures?|arrivals?|departing|arriving|leaving|landing|taking off|coming in|flights? (?:out of|leaving|departing|from|into|arriving|landing|at|to)|(?:departure|arrivals?) board)\b/i.test(m)) return null;
  const to = /\b(arriv\w*|landing|coming in|into)\b/i.test(m) ? "arrivals" : "departures";
  const code = m.match(/\b(?!THE|AND|FOR|ARE|NOW|YOU|HOW|WHO|WHY|ANY|CAN|GET|OUT|ETA)([A-Z]{3,4})\b/);
  if (code) return { q: code[1], to };
  const p = m.match(/\b(?:at|from|out of|into|in|leaving|departing(?: from)?|arriving (?:at|in)|landing (?:at|in)|to)\s+(?!the next|next|now|today|soon|on time)([A-Za-z][\w .'\/-]{1,40}?)(?:\s+(?:airport|international|today|tomorrow|tonight|right now|now|this|soon|later|in the next)\b|[?.!,]|$)/i);
  return p ? { q: p[1].trim(), to } : null;
}

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
  const fn = flightNumberOf(message), ap = fn ? null : airportAskOf(message);
  if (fn) out.push({ name: "flightstatus", params: { q: fn } });
  else if (ap) out.push({ name: "airport", params: ap });
  for (const [re, mk] of RULES) if (re.test(message) && !out.some((c) => c.name === mk(message).name)) out.push(mk(message));
  // NASA research asks are answered from NASA's own library: drop the generic paper searches (and ntrs when a document was pasted).
  if (out.some((c) => c.name === "ntrs" || c.name === "nasadoc")) {
    const doc = out.some((c) => c.name === "nasadoc");
    for (let i = out.length - 1; i >= 0; i--) if (["arxiv", "scholar", "wikipedia"].includes(out[i].name) || (doc && out[i].name === "ntrs")) out.splice(i, 1);
  }
  if (!out.length && /^(who|what) (is|was|are|were)\b|\b(look up|tell me about|wikipedia)\b/i.test(message))
    out.push({ name: "wikipedia", params: { q: topic(message, /\b(who|what|is|was|are|were|look up|tell me about|wikipedia)\b/gi) } });
  return out.slice(0, 2);
}

const CURRENT = /\b(latest|current|currently|right now|today|tonight|this week|recent|recently|breaking|who won|score|price of|just happened|news)\b/i;

/** Ask the model for a JSON tool request when keywords miss but the turn sounds factual/current. */
export async function planWithModel(adapter: ModelAdapter, message: string): Promise<ToolCall[]> {
  if (!/\b(latest|current|now|today|tonight|right now|news|recent|look up|search|real[- ]time|live|flights?|airport|planes?|population|capital|currency|exchange|convert|book|author|novel|where is|address|map|located|how (many|big|far)|area of)\b/i.test(message)) return [];
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
  if ((call.name === "nearby" || call.name === "flights") && !params.place && location) { params.lat = String(location.lat); params.lon = String(location.lon); }
  if ((call.name === "alerts" || call.name === "airquality") && !params.place && location) { params.lat = String(location.lat); params.lon = String(location.lon); }
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
    ? `[${r.name}] ${JSON.stringify(r.data).slice(0, r.name === "nasadoc" ? 6000 : r.name === "ntrs" ? 5000 : 2500)}\nSources: ${r.sources.slice(0, r.name === "ntrs" ? 4 : 3).map((s) => `${s.title} <${s.url}>`).join("; ")}`
    : `[${r.name}] unavailable right now (${r.error}).`).join("\n\n");
  return `\n\n[Live public data fetched just now — ${new Date().toISOString()}]\n${body}\n\nUse this data for facts in your answer, in your own voice. Do not invent numbers beyond it. If a tool was unavailable, say so briefly. End with a short "Sources:" line listing the source names and links you used.`;
}
