import type { PlaceResult } from "@shared/satnav";

const CACHE_MS = 6 * 60 * 60 * 1000;
const cache = new Map<string, { expiresAt: number; results: PlaceResult[] }>();
let nextStartAt = 0;
let queue: Promise<void> = Promise.resolve();

interface NominatimRow {
  place_id?: number | string;
  display_name?: string;
  lon?: string;
  lat?: string;
  class?: string;
  type?: string;
  addresstype?: string;
}

const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

async function fetchAtPublicRate(url: URL): Promise<Response> {
  const previous = queue;
  let release!: () => void;
  queue = new Promise<void>(resolve => { release = resolve; });
  await previous;
  try {
    const wait = Math.max(0, nextStartAt - Date.now());
    if (wait) await delay(wait);
    nextStartAt = Date.now() + 1_100;
    return await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": "SATNAV/1.0 (local map workspace)",
        Referer: process.env.SATNAV_PUBLIC_ORIGIN || "http://localhost:3000",
      },
      signal: AbortSignal.timeout(8_000),
    });
  } finally {
    release();
  }
}

function precisionFor(row: NominatimRow): PlaceResult["precision"] {
  const kind = `${row.class ?? ""} ${row.type ?? ""} ${row.addresstype ?? ""}`.toLowerCase();
  if (/house|building|address|postcode/.test(kind)) return "address";
  if (/city|town|village|hamlet|suburb|neighbourhood|amenity|shop|tourism/.test(kind)) return "place";
  if (/country|state|province|county|region|administrative/.test(kind)) return "region";
  return "unknown";
}

export async function searchPublicPlaces(query: string): Promise<PlaceResult[]> {
  const normalized = query.trim().replace(/\s+/g, " ");
  if (normalized.length < 3 || normalized.length > 120) return [];
  const cacheKey = normalized.toLocaleLowerCase();
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.results;

  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.search = new URLSearchParams({ q: normalized, format: "jsonv2", limit: "6", addressdetails: "1" }).toString();
  const response = await fetchAtPublicRate(url);
  if (!response.ok) throw new Error(`Place search returned HTTP ${response.status}`);
  const rows = await response.json() as NominatimRow[];
  const results = (Array.isArray(rows) ? rows : []).flatMap((row, index) => {
    const longitude = Number(row.lon);
    const latitude = Number(row.lat);
    if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180 || !Number.isFinite(latitude) || latitude < -90 || latitude > 90 || !row.display_name) return [];
    return [{
      id: String(row.place_id ?? `${cacheKey}-${index}`),
      label: row.display_name.slice(0, 500),
      longitude,
      latitude,
      precision: precisionFor(row),
      attribution: "© OpenStreetMap contributors · Nominatim",
    } satisfies PlaceResult];
  });
  cache.set(cacheKey, { expiresAt: Date.now() + CACHE_MS, results });
  while (cache.size > 200) cache.delete(cache.keys().next().value!);
  return results;
}
