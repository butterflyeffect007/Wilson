/**
 * Browser-side ("direct") versions of tools whose free upstreams block
 * Cloudflare's IPs. These run from the user's own browser when the upstream
 * allows CORS, and produce the same { data, sources } shape as the worker's
 * /tools/<name>. The worker version stays as the fallback.
 *
 * CORS checked 2026-10-17 with Origin https://butterflyeffect007.github.io:
 *  - GDELT DOC 2.0 (api.gdeltproject.org): Access-Control-Allow-Origin: *  -> direct
 *  - Overpass (overpass-api.de, maps.mail.ru mirror): ACAO *               -> direct
 *  - Open-Meteo geocoding: ACAO *                                          -> direct
 *  - adsb.lol / adsb.fi / OpenSky: no usable ACAO header                  -> NOT direct (worker only)
 *  - USGS, GDACS, wheretheiss.at, Launch Library 2, api.weather.gov, Open-Meteo air quality,
 *    Frankfurter, CoinGecko, Open Library, dictionaryapi.dev, Wiktionary REST, Nager.Date: ACAO *  -> direct
 *  - api.nasa.gov echoes our origin -> direct (DEMO_KEY per user IP, not the worker's shared IP)
 *  - Grants.gov search2: ACAO * on POST but the preflight is 403 -> direct with Content-Type text/plain
 */
import type { ToolCall, ToolName, ToolSource } from "./index";

type Out = { data: unknown; sources: ToolSource[] };
const PREFIX = "wilson.direct.";

function cacheGet(k: string): Out | null {
  try {
    const raw = localStorage.getItem(PREFIX + k); if (!raw) return null;
    const v = JSON.parse(raw) as { exp: number; val: Out };
    if (Date.now() > v.exp) { localStorage.removeItem(PREFIX + k); return null; }
    return v.val;
  } catch { return null; }
}
function cacheSet(k: string, val: Out, ttlSec: number) {
  try { localStorage.setItem(PREFIX + k, JSON.stringify({ exp: Date.now() + ttlSec * 1000, val })); } catch { /* quota/private mode */ }
}

async function getJson(url: string, ms: number): Promise<any> {
  const ctl = new AbortController(); const to = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctl.signal, headers: { Accept: "application/json" } });
    if (!r.ok) throw new Error(`${new URL(url).host} ${r.status}`);
    const txt = await r.text();
    try { return JSON.parse(txt); } catch { throw new Error(`${new URL(url).host}: ${txt.slice(0, 80)}`); } // GDELT sends plain-text errors with 200
  } finally { clearTimeout(to); }
}
const clip = (s: unknown, n = 400) => (s ? String(s).replace(/\s+/g, " ").trim().slice(0, n) : "");

async function geocode(q: string): Promise<{ lat: number; lon: number; name: string }> {
  q = q.trim(); if (!q) throw new Error("place required");
  const k = "geo:" + q.toLowerCase(); const c = cacheGet(k); if (c) return c.data as any;
  const d = await getJson(`https://geocoding-api.open-meteo.com/v1/search?count=1&name=${encodeURIComponent(q)}`, 5000);
  const g = d.results?.[0]; if (!g) throw new Error("place not found");
  const out = { lat: g.latitude, lon: g.longitude, name: `${g.name}${g.admin1 ? ", " + g.admin1 : ""}, ${g.country}` };
  cacheSet(k, { data: out, sources: [] }, 7 * 86400);
  return out;
}

const DIRECT: Partial<Record<ToolName, { ttl: number; run: (p: Record<string, string>) => Promise<Out> }>> = {
  gdelt: { ttl: 900, run: async (p) => {
    const q = String(p.q || "").replace(/["]/g, "").trim().slice(0, 120); if (!q) throw new Error("query required");
    const d = await getJson(`https://api.gdeltproject.org/api/v2/doc/doc?mode=artlist&format=json&maxrecords=8&sort=datedesc&timespan=3d&query=${encodeURIComponent(q.includes(" ") ? `"${q}"` : q)}%20sourcelang:english`, 10000);
    const r = (d.articles || []).slice(0, 8).map((a: any) => ({ title: clip(a.title, 160), source: a.domain, country: a.sourcecountry, seen: a.seendate, url: a.url }));
    return { data: { query: q, window: "last 3 days", articles: r, note: "Headlines only (GDELT); don't claim details beyond titles." },
      sources: r.slice(0, 3).map((x: any) => ({ title: `${x.source}: ${x.title}`, url: x.url })) };
  } },
  nearby: { ttl: 86400, run: async (p) => {
    const g = p.lat != null && p.lat !== "" ? { lat: +p.lat, lon: +p.lon, name: p.place || "your location" } : await geocode(p.place || "");
    const kind = String(p.q || "cafe").toLowerCase().replace(/[^a-z_]/g, "").slice(0, 30) || "cafe";
    const ql = `[out:json][timeout:8];nwr(around:2000,${g.lat},${g.lon})["amenity"="${kind}"];out center 10;`;
    const hosts = ["https://overpass-api.de/api/interpreter", "https://maps.mail.ru/osm/tools/overpass/api/interpreter"];
    // Race both public servers; first good answer wins (they can be slow under load).
    const d: any = await new Promise((resolve, reject) => {
      let failed = 0;
      for (const h of hosts) getJson(`${h}?data=${encodeURIComponent(ql)}`, 12000).then(resolve, () => { if (++failed === hosts.length) reject(new Error("overpass servers busy or unreachable")); });
    });
    const r = (d.elements || []).map((e: any) => ({ name: e.tags?.name || "(unnamed)", street: [e.tags?.["addr:housenumber"], e.tags?.["addr:street"]].filter(Boolean).join(" ") || null, lat: e.lat ?? e.center?.lat, lon: e.lon ?? e.center?.lon })).slice(0, 10);
    return { data: { place: g.name, amenity: kind, radius_m: 2000, results: r }, sources: [{ title: "OpenStreetMap (Overpass)", url: `https://www.openstreetmap.org/#map=15/${g.lat}/${g.lon}` }] };
  } },
  // ---- live sources added 2026-10-17 (all send Access-Control-Allow-Origin: * or echo our origin) ----
  quakes: { ttl: 300, run: async () => {
    const d = await getJson(`https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson`, 8000);
    const f = d.features.sort((a: any, b: any) => b.properties.mag - a.properties.mag).slice(0, 8).map((x: any) => ({ mag: x.properties.mag, place: x.properties.place, time: new Date(x.properties.time).toISOString(), url: x.properties.url }));
    return { data: { count_24h_m2_5plus: d.metadata.count, strongest: f }, sources: [{ title: "USGS Earthquake Hazards", url: "https://earthquake.usgs.gov/earthquakes/map/" }] };
  } },
  disasters: { ttl: 1800, run: async () => {
    const from = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10);
    const d = await getJson(`https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH?alertlevel=Orange;Red&fromdate=${from}`, 9000);
    const T: Record<string, string> = { EQ: "earthquake", TC: "tropical cyclone", FL: "flood", VO: "volcano", DR: "drought", WF: "wildfire", TS: "tsunami" };
    const ev = (d.features || []).map((f: any) => f.properties).sort((a: any, b: any) => String(b.fromdate).localeCompare(String(a.fromdate))).slice(0, 8)
      .map((p: any) => ({ type: T[p.eventtype] || p.eventtype, name: p.name, alert: p.alertlevel, where: p.country, from: String(p.fromdate).slice(0, 10), to: String(p.todate).slice(0, 10), severity: p.severitydata?.severitytext || null, url: p.url?.report }));
    return { data: { window: "last 7 days, Orange/Red alerts only", events: ev, note: "GDACS (UN/EU) disaster alerts; Green-level events not included." }, sources: [{ title: "GDACS disaster alerts", url: "https://www.gdacs.org/" }] };
  } },
  apod: { ttl: 3600, run: async (p) => {
    const d = await getJson(`https://api.nasa.gov/planetary/apod?api_key=DEMO_KEY${p.date ? "&date=" + encodeURIComponent(p.date) : ""}`, 8000);
    return { data: { date: d.date, title: d.title, explanation: clip(d.explanation, 600), media: d.url }, sources: [{ title: "NASA APOD", url: "https://apod.nasa.gov/apod/" }] };
  } },
  iss: { ttl: 5, run: async () => {
    const d = await getJson(`https://api.wheretheiss.at/v1/satellites/25544`, 6000);
    return { data: { lat: +d.latitude.toFixed(2), lon: +d.longitude.toFixed(2), alt_km: Math.round(d.altitude), speed_kmh: Math.round(d.velocity), visibility: d.visibility, at: new Date(d.timestamp * 1000).toISOString() }, sources: [{ title: "Where the ISS at?", url: "https://wheretheiss.at/" }] };
  } },
  launches: { ttl: 900, run: async () => {
    const d = await getJson(`https://ll.thespacedevs.com/2.2.0/launch/upcoming/?limit=6&mode=list`, 8000);
    return { data: d.results.map((l: any) => ({ name: l.name, provider: l.lsp_name, net: l.net, status: l.status?.name, pad: l.location })), sources: [{ title: "Launch Library 2 (The Space Devs)", url: "https://thespacedevs.com/llapi" }] };
  } },
  alerts: { ttl: 600, run: async (p) => {
    const g = p.lat ? { lat: +p.lat, lon: +p.lon, name: p.place || "your location" } : p.place ? await geocode(p.place) : null;
    const u = g ? `https://api.weather.gov/alerts/active?point=${g.lat.toFixed(4)},${g.lon.toFixed(4)}` : `https://api.weather.gov/alerts/active?status=actual&severity=Extreme`;
    let d: any;
    try { d = await getJson(u, 8000); }
    catch (e) { if (g && /\b(400|404)\b/.test(String((e as Error).message))) return { data: { place: g.name, alerts: [], note: "The US National Weather Service only covers the United States and its territories; no alerts available for this place." }, sources: [{ title: "US National Weather Service", url: "https://www.weather.gov/" }] }; throw e; }
    const a = (d.features || []).slice(0, 8).map((f: any) => f.properties).map((x: any) => ({ event: x.event, severity: x.severity, headline: clip(x.headline, 200), area: clip(x.areaDesc, 160), ends: x.ends || x.expires, sender: x.senderName }));
    return { data: { place: g ? g.name : "United States (Extreme alerts only)", count: (d.features || []).length, alerts: a, note: a.length ? "Active NWS watches/warnings/advisories" : "No active NWS alerts right now for this area." }, sources: [{ title: "US National Weather Service alerts", url: "https://alerts.weather.gov/" }] };
  } },
  airquality: { ttl: 1800, run: async (p) => {
    const g = p.lat ? { lat: +p.lat, lon: +p.lon, name: p.place || "your location" } : await geocode(p.place || "New York");
    const d = await getJson(`https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${g.lat}&longitude=${g.lon}&current=us_aqi,european_aqi,pm2_5,pm10,ozone,nitrogen_dioxide&timezone=auto`, 8000);
    const aqi = d.current?.us_aqi as number | undefined;
    const band = aqi == null ? null : aqi <= 50 ? "Good" : aqi <= 100 ? "Moderate" : aqi <= 150 ? "Unhealthy for sensitive groups" : aqi <= 200 ? "Unhealthy" : aqi <= 300 ? "Very unhealthy" : "Hazardous";
    return { data: { place: g.name, time: d.current?.time, us_aqi: aqi, category: band, european_aqi: d.current?.european_aqi, pm2_5: d.current?.pm2_5, pm10: d.current?.pm10, ozone: d.current?.ozone, units: d.current_units, note: "Modelled air quality (CAMS via Open-Meteo), not a ground sensor." }, sources: [{ title: "Open-Meteo Air Quality", url: "https://open-meteo.com/en/docs/air-quality-api" }] };
  } },
  fx: { ttl: 3600, run: async (p) => {
    const from = String(p.q || "USD").toUpperCase().replace(/[^A-Z]/g, "").slice(0, 3) || "USD"; const to = String(p.to || "").toUpperCase().replace(/[^A-Z,]/g, "").slice(0, 40);
    const d = await getJson(`https://api.frankfurter.dev/v1/latest?base=${from}${to ? "&symbols=" + to : ""}`, 6000);
    const amt = Number(p.amount); const conv = amt > 0 ? Object.fromEntries(Object.entries(d.rates as Record<string, number>).map(([k, v]) => [k, +(v * amt).toFixed(4)])) : undefined;
    return { data: { base: d.base, date: d.date, rates: d.rates, ...(conv ? { amount: amt, converted: conv } : {}), note: "European Central Bank reference rates (business days)" }, sources: [{ title: "Frankfurter (ECB rates)", url: "https://frankfurter.dev/" }] };
  } },
  crypto: { ttl: 120, run: async (p) => {
    const A: Record<string, string> = { btc: "bitcoin", bitcoin: "bitcoin", eth: "ethereum", ether: "ethereum", ethereum: "ethereum", sol: "solana", solana: "solana", doge: "dogecoin", dogecoin: "dogecoin", xrp: "ripple", ripple: "ripple", ada: "cardano", cardano: "cardano", ltc: "litecoin", litecoin: "litecoin", shib: "shiba-inu", shibainu: "shiba-inu", usdt: "tether", tether: "tether", usdc: "usd-coin", dot: "polkadot", polkadot: "polkadot", avax: "avalanche-2", avalanche: "avalanche-2", link: "chainlink", chainlink: "chainlink", xlm: "stellar", stellar: "stellar", tron: "tron", toncoin: "the-open-network", pepe: "pepe" };
    const words = String(p.q || "bitcoin,ethereum").toLowerCase().split(/[\s,]+/).filter(Boolean).slice(0, 6);
    const ids = [...new Set(words.map((w) => A[w]).filter(Boolean))]; if (!ids.length) throw new Error("unknown coin (worker will search)");
    const vs = String(p.to || "usd").toLowerCase().replace(/[^a-z,]/g, "") || "usd";
    const d = await getJson(`https://api.coingecko.com/api/v3/simple/price?ids=${ids.join(",")}&vs_currencies=${vs}&include_24hr_change=true&include_market_cap=true&include_last_updated_at=true`, 6000);
    const out = Object.entries(d as Record<string, Record<string, number>>).map(([id, v]) => ({ coin: id, ...Object.fromEntries(Object.entries(v).map(([k, x]) => [k, /change/.test(k) ? +x.toFixed(2) : x])), updated: v.last_updated_at ? new Date(v.last_updated_at * 1000).toISOString() : null }));
    if (!out.length) throw new Error("coin not found");
    return { data: { prices: out, note: "CoinGecko public prices; crypto moves fast, so this is a snapshot." }, sources: [{ title: "CoinGecko", url: "https://www.coingecko.com/" }] };
  } },
  books: { ttl: 86400, run: async (p) => {
    const d = await getJson(`https://openlibrary.org/search.json?limit=5&fields=title,author_name,first_publish_year,key,edition_count&q=${encodeURIComponent(p.q || "")}`, 8000);
    const docs = (d.docs || []).map((x: any) => ({ title: x.title, authors: (x.author_name || []).slice(0, 3), first_published: x.first_publish_year, editions: x.edition_count, url: `https://openlibrary.org${x.key}` }));
    return { data: { found: d.numFound, results: docs }, sources: [{ title: "Open Library", url: "https://openlibrary.org/" }] };
  } },
  dictionary: { ttl: 604800, run: async (p) => {
    const w = String(p.q || "").toLowerCase().replace(/[^a-z' -]/g, "").trim().slice(0, 40); if (!w) throw new Error("word required");
    try {
      const d = await getJson(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(w)}`, 5000);
      const e = d[0];
      const meanings = (e.meanings || []).slice(0, 4).map((m: any) => ({ part_of_speech: m.partOfSpeech, definitions: (m.definitions || []).slice(0, 3).map((x: any) => ({ definition: clip(x.definition, 250), example: x.example ? clip(x.example, 160) : undefined })), synonyms: (m.synonyms || []).slice(0, 5) }));
      return { data: { word: e.word, phonetic: e.phonetic || e.phonetics?.find((x: any) => x.text)?.text || null, meanings }, sources: [{ title: "Free Dictionary API (Wiktionary data)", url: `https://en.wiktionary.org/wiki/${encodeURIComponent(w)}` }] };
    } catch {
      const d = await getJson(`https://en.wiktionary.org/api/rest_v1/page/definition/${encodeURIComponent(w)}`, 6000);
      const strip = (s: unknown) => clip(String(s || "").replace(/<[^>]+>/g, "").replace(/&[a-z#0-9]+;/gi, " "), 250);
      const meanings = (d.en || []).slice(0, 4).map((m: any) => ({ part_of_speech: m.partOfSpeech, definitions: (m.definitions || []).filter((x: any) => strip(x.definition)).slice(0, 3).map((x: any) => ({ definition: strip(x.definition), example: x.examples?.[0] ? strip(x.examples[0]) : undefined })) }));
      if (!meanings.length) throw new Error("word not found");
      return { data: { word: w, meanings }, sources: [{ title: "Wiktionary", url: `https://en.wiktionary.org/wiki/${encodeURIComponent(w)}` }] };
    }
  } },
  holidays: { ttl: 86400, run: async (p) => {
    let cc = String(p.q || "US").trim();
    const N: Record<string, string> = { usa: "US", "united states": "US", america: "US", uk: "GB", britain: "GB", england: "GB", "united kingdom": "GB" };
    if (N[cc.toLowerCase()]) cc = N[cc.toLowerCase()];
    if (!/^[A-Za-z]{2}$/.test(cc)) {
      const list = await getJson(`https://date.nager.at/api/v3/AvailableCountries`, 6000);
      const hit = list.find((c: any) => c.name.toLowerCase() === cc.toLowerCase()) || list.find((c: any) => c.name.toLowerCase().startsWith(cc.toLowerCase()));
      if (!hit) throw new Error(`no holiday data for "${cc}"`); cc = hit.countryCode;
    }
    cc = cc.toUpperCase(); const yr = /^\d{4}$/.test(String(p.date || "")) ? p.date : null;
    const d = await getJson(yr ? `https://date.nager.at/api/v3/PublicHolidays/${yr}/${cc}` : `https://date.nager.at/api/v3/NextPublicHolidays/${cc}`, 6000);
    const h = d.slice(0, 12).map((x: any) => ({ date: x.date, name: x.name, local_name: x.localName !== x.name ? x.localName : undefined, nationwide: x.global, types: x.types }));
    return { data: { country: cc, scope: yr ? `public holidays in ${yr}` : "next public holidays (coming 365 days)", holidays: h }, sources: [{ title: "Nager.Date public holidays", url: "https://date.nager.at/" }] };
  } },
  grants: { ttl: 21600, run: async (p) => {
    const q = String(p.q || "").replace(/["\\]/g, "").trim().slice(0, 100); if (!q) throw new Error("topic required");
    // text/plain keeps this a "simple" CORS request (Grants.gov rejects the preflight that application/json would need).
    const search = async (keyword: string) => {
      const ctl = new AbortController(); const to = setTimeout(() => ctl.abort(), 9000);
      try {
        const r = await fetch(`https://api.grants.gov/v1/api/search2`, { method: "POST", signal: ctl.signal, headers: { "Content-Type": "text/plain" }, body: JSON.stringify({ keyword, oppStatuses: "forecasted|posted", rows: 8 }) });
        if (!r.ok) throw new Error(`api.grants.gov ${r.status}`);
        return (await r.json()).data;
      } finally { clearTimeout(to); }
    };
    const ent = (s: unknown) => String(s || "").replace(/&ndash;/g, "–").replace(/&mdash;/g, "—").replace(/&rsquo;|&#39;/g, "'").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&[a-z]+;/g, " ");
    let d = q.includes(" ") ? await search(`"${q}"`) : null, exact = true;
    if (!d || (d.oppHits || []).length < 2) { d = await search(q); exact = false; }
    const hits = (d.oppHits || []).slice(0, 6).map((h: any) => ({ title: clip(ent(h.title), 180), agency: h.agency, number: h.number, status: h.oppStatus, opens: h.openDate || null, closes: h.closeDate || null, url: `https://www.grants.gov/search-results-detail/${h.id}` }));
    return { data: { query: q, total_matches: d.hitCount, match: exact ? "exact phrase" : "any of the words (looser)", opportunities: hits, note: "US federal grants from Grants.gov (open or forecasted). Check eligibility and deadlines on each link before applying." },
      sources: hits.length ? hits.slice(0, 3).map((h: any) => ({ title: `Grants.gov: ${h.title}`, url: h.url })) : [{ title: "Grants.gov", url: "https://www.grants.gov/search-grants" }] };
  } },
};

export function hasDirect(name: ToolName): boolean { return name in DIRECT; }

/** Runs a tool from the browser. Throws on failure so the caller can fall back to the worker. */
export async function runDirect(call: ToolCall, params: Record<string, string>): Promise<Out> {
  const t = DIRECT[call.name]; if (!t) throw new Error("no direct version");
  const k = `${call.name}:${JSON.stringify(Object.entries(params).sort())}`;
  const c = cacheGet(k); if (c) return c;
  const out = await t.run(params);
  cacheSet(k, out, t.ttl);
  return out;
}
