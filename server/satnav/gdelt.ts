/**
 * GDELT DOC 2.0 adapter for SATNAV.
 *
 * Uses the GDELT Project's public GeoJSON API (no key required):
 *   https://gdeltcloud.com/api-docs
 *
 * This adapter fetches news-event clusters geolocated near the requested
 * viewport. GDELT article coordinates are journalist-coded and may be
 * country/city centroid level — never inferred boundaries or frontlines.
 *
 * Limitations:
 * - GDELT coverage is uneven; absence of a record does not mean absence of
 *   an event.
 * - GDELT articles' geographic attributes represent the primary location
 *   mentioned in the article, not the incident location.
 * - Publisher rights: GDELT indexes article metadata and links; we do not
 *   reproduce article text.
 * - Do not redistribute GDELT bulk exports under ACLED or similar
 *   restricted licences.
 */
import type { SatnavEvent, SatnavSourceRef } from "@shared/satnav";

const FETCH_TIMEOUT_MS = 10_000;
const GDELT_ATTRIBUTION = "GDELT Project (gdeltproject.org) — article metadata only. Verify via original publisher.";
const GDELT_BASE = "https://api.gdeltproject.org/api/v2/doc/doc";

export const COUNTRY_CENTROIDS: Record<string, [number, number]> = {
  "United States": [-98.5795, 39.8283],
  "US": [-98.5795, 39.8283],
  "United Kingdom": [-3.4360, 55.3781],
  "UK": [-3.4360, 55.3781],
  "Canada": [-106.3468, 56.1304],
  "Australia": [133.7751, -25.2744],
  "Japan": [138.2529, 36.2048],
  "China": [104.1954, 35.8617],
  "India": [78.9629, 20.5937],
  "Germany": [10.4515, 51.1657],
  "France": [2.2137, 46.2276],
  "Italy": [12.5674, 41.8719],
  "Spain": [-3.7492, 40.4637],
  "Brazil": [-51.9253, -14.2350],
  "Mexico": [-102.5528, 23.6345],
  "Indonesia": [113.9213, -0.7893],
  "Philippines": [121.7740, 12.8797],
  "Turkey": [35.2433, 38.9637],
  "Ukraine": [31.1656, 48.3794],
  "Russia": [105.3188, 61.5240],
  "South Africa": [22.9375, -30.5595],
  "Egypt": [30.8025, 26.8206],
  "Nigeria": [8.6753, 9.0820],
  "Kenya": [37.9062, -0.0236],
  "Saudi Arabia": [45.0792, 23.8859],
  "Iran": [53.6880, 32.4279],
  "Pakistan": [69.3451, 30.3753],
  "Bangladesh": [90.3563, 23.6850],
  "New Zealand": [174.8860, -40.9006],
  "Chile": [-71.5430, -35.6751],
  "Argentina": [-63.6167, -38.4161],
  "Colombia": [-74.2973, 4.5709],
  "Peru": [-75.0152, -9.1900],
  "Morocco": [-7.0926, 31.7917],
  "Greece": [21.8243, 39.0742],
  "Portugal": [-8.2245, 39.3999],
  "Netherlands": [5.2913, 52.1326],
  "Belgium": [4.4699, 50.5039],
  "Poland": [19.1451, 51.9194],
  "Switzerland": [8.2275, 46.8182],
  "Sweden": [18.6435, 60.1282],
  "Norway": [8.4689, 60.4720],
  "Finland": [25.7482, 61.9241],
  "South Korea": [127.7669, 35.9078],
  "Taiwan": [120.9605, 23.6978],
  "Thailand": [100.9925, 15.8700],
  "Vietnam": [108.2772, 14.0583],
};

interface GdeltArticle {
  url?: string;
  url_mobile?: string;
  urlmobile?: string;
  title?: string;
  seendate?: string;        // YYYYMMDDTHHMMSSZ
  domain?: string;
  language?: string;
  sourcecountry?: string;
  tone?: string;
  lat?: number;
  lon?: number;
  socialimage?: string;
}

interface GdeltGeoResponse {
  articles?: GdeltArticle[];
  status?: string;
}

function parseGdeltDate(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const cleaned = value.replace(/\s/g, "T").replace(/(\d{8})T(\d{6})/, "$1T$2");
  const iso = cleaned.length >= 15
    ? `${cleaned.slice(0, 4)}-${cleaned.slice(4, 6)}-${cleaned.slice(6, 8)}T${cleaned.slice(9, 11)}:${cleaned.slice(11, 13)}:${cleaned.slice(13, 15)}Z`
    : undefined;
  if (!iso) return undefined;
  const ts = Date.parse(iso);
  return Number.isNaN(ts) ? undefined : ts;
}

function articleToEvent(
  article: GdeltArticle,
  fetchedAt: number,
  index: number,
  bounds: { west: number; south: number; east: number; north: number }
): SatnavEvent | undefined {
  let lat = typeof article.lat === "number" && Number.isFinite(article.lat) && Math.abs(article.lat) <= 90 ? article.lat : undefined;
  let lon = typeof article.lon === "number" && Number.isFinite(article.lon) && Math.abs(article.lon) <= 180 ? article.lon : undefined;

  // If no lat/lon, attempt country centroid
  if (lat === undefined || lon === undefined) {
    const country = article.sourcecountry;
    if (country && COUNTRY_CENTROIDS[country]) {
      [lon, lat] = COUNTRY_CENTROIDS[country];
    }
  }

  if (lat === undefined || lon === undefined) return undefined;

  // Viewport bounds check
  const inLng = bounds.east >= bounds.west
    ? lon >= bounds.west && lon <= bounds.east
    : lon >= bounds.west || lon <= bounds.east;
  if (!inLng || lat < bounds.south || lat > bounds.north) {
    return undefined;
  }

  const title = (article.title ?? "").trim();
  if (!title) return undefined;

  const url = article.url ?? article.url_mobile ?? article.urlmobile;
  const seenAt = parseGdeltDate(article.seendate);
  const domain = article.domain ?? (url ? new URL(url).hostname.replace(/^www\./, "") : "gdeltproject.org");
  const providerId = `gdelt-${seenAt ?? Date.now()}-${index}`;

  const source: SatnavSourceRef = {
    provider: "gdelt",
    label: title,
    url: url ?? undefined,
    publisher: domain,
    publishedAt: seenAt,
    attribution: GDELT_ATTRIBUTION,
  };

  return {
    id: `gdelt:${btoa(url ?? providerId).slice(0, 36)}`,
    clusterId: `gdelt:${btoa(url ?? providerId).slice(0, 36)}`,
    providerId,
    category: "news",
    title,
    description: undefined,
    locationLabel: article.sourcecountry ?? undefined,
    country: article.sourcecountry ?? undefined,
    longitude: lon,
    latitude: lat,
    geometry: { type: "Point", coordinates: [lon, lat] },
    locationPrecision: "centroid",
    status: "report",
    verification: "single-source",
    fetchedAt,
    sources: [source],
    relatedArticles: [],
    sourceCount: 1,
    ...(seenAt !== undefined ? { startTime: seenAt, publishedAt: seenAt } : {}),
  };
}

async function getGdeltJson(url: URL): Promise<GdeltGeoResponse> {
  const response = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (response.status === 429) {
    throw new Error("Upstream returned HTTP 429");
  }
  if (!response.ok) {
    throw new Error(`Upstream returned HTTP ${response.status}`);
  }
  const text = await response.text();
  if (text.includes("limit requests to one every 5 seconds") || text.includes("429 Too Many Requests")) {
    throw new Error("Upstream returned HTTP 429");
  }
  let data: GdeltGeoResponse;
  try { data = JSON.parse(text) as GdeltGeoResponse; }
  catch {
    throw new Error("GDELT did not return JSON");
  }
  if (!data || !Array.isArray(data.articles)) throw new Error("GDELT returned an invalid article response");
  return data;
}

export interface GdeltFetchResult {
  events: SatnavEvent[];
  truncated: boolean;
  message?: string;
}

export async function fetchGDELT(
  bounds: { west: number; south: number; east: number; north: number },
  startAt: number,
  endAt: number,
): Promise<GdeltFetchResult> {
  if (endAt < Date.now() - 60_000) throw new Error("GDELT_HISTORICAL_WINDOW_UNSUPPORTED");

  const timespanMs = Math.min(endAt - startAt, 24 * 60 * 60 * 1000);
  const timespanMinutes = Math.max(15, Math.round(timespanMs / 60_000));

  const url = new URL(GDELT_BASE);
  url.searchParams.set("query", "disaster OR crisis OR earthquake OR flood OR wildfire OR storm OR emergency");
  url.searchParams.set("mode", "artlist");
  url.searchParams.set("maxrecords", "75");
  url.searchParams.set("format", "json");
  url.searchParams.set("sort", "DateDesc");
  // DOC searches default to a much wider historical range; constrain work to
  // the product's documented recent-coverage window (minimum 15 minutes).
  url.searchParams.set("timespan", `${timespanMinutes}min`);

  const fetchedAt = Date.now();
  const data = await getGdeltJson(url);

  const articles = Array.isArray(data.articles) ? data.articles : [];
  const seen = new Set<string>();
  const events: SatnavEvent[] = [];

  for (let i = 0; i < articles.length; i++) {
    const event = articleToEvent(articles[i]!, fetchedAt, i, bounds);
    if (!event) continue;
    if (seen.has(event.id)) continue;
    seen.add(event.id);
    events.push(event);
  }

  return {
    events,
    truncated: articles.length >= 75,
    message: events.length > 0
      ? `GDELT returns article metadata only; coordinates are journalist-coded and may be country-level centroids. Verify via original publishers. Coverage is limited to approximately the past ${timespanMinutes < 60 ? `${timespanMinutes} minutes` : `${Math.round(timespanMinutes / 60)} hours`}.`
      : undefined,
  };
}
