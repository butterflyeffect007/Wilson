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
