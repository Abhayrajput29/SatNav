import type {
  LocationPrecision,
  SatnavCategory,
  SatnavEvent,
  SatnavGeometry,
  SatnavProvider,
  SatnavSourceRef,
  VerificationStatus,
} from "@shared/satnav";
import { geometryIntersectsViewport, pointFromGeometry, splitViewport, viewportToWkt, validPosition } from "./geo";

const USGS_ATTRIBUTION = "USGS Earthquake Hazards Program";
const GDACS_ATTRIBUTION = "Global Disaster Alert and Coordination System (GDACS)";
const FETCH_TIMEOUT_MS = 10_000;
const GDACS_AREA_TIMEOUT_MS = 7_000;
const GDACS_SEARCH_BUDGET_MS = 18_000;
const USGS_PAGE_SIZE = 1_000;
const USGS_MAX_PAGES_PER_BOX = 20;
const GDACS_SEARCH_PAGE_SIZE = 100;
const GDACS_SEARCH_MAX_PAGES = 5;
const GDACS_EVENT_TYPES = ["EQ", "FL", "TC", "WF", "VO", "TS", "DR"] as const;

interface GeoJsonFeature {
  id?: string | number;
  type?: string;
  geometry?: unknown;
  properties?: Record<string, unknown> | null;
}

interface FeatureCollection {
  type?: string;
  features?: GeoJsonFeature[];
  metadata?: { count?: number };
}

const str = (value: unknown): string | undefined => typeof value === "string" && value.trim() ? value.trim() : undefined;
const num = (value: unknown): number | undefined => typeof value === "number" && Number.isFinite(value) ? value : undefined;
const idStr = (value: unknown): string | undefined =>
  typeof value === "number" && Number.isSafeInteger(value) ? String(value) : str(value);
const timeMs = (value: unknown): number | undefined => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const utc = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(value) ? `${value}Z` : value;
    const parsed = Date.parse(utc);
    return Number.isNaN(parsed) ? undefined : parsed;
  }
  return undefined;
};
const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" ? value as Record<string, unknown> : {};

function safeGeometry(value: unknown): SatnavGeometry | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  if (record.type === "GeometryCollection" && Array.isArray(record.geometries)) {
    const geometries: SatnavGeometry[] = [];
    for (const item of record.geometries) {
      const geometry = safeGeometry(item);
      if (!geometry) return undefined;
      geometries.push(geometry);
    }
    return { type: "GeometryCollection", geometries };
  }
  if (record.type === "Point" && validPosition(record.coordinates)) return { type: "Point", coordinates: record.coordinates };
  if (record.type === "MultiPoint" && Array.isArray(record.coordinates) && record.coordinates.every(validPosition)) return { type: "MultiPoint", coordinates: record.coordinates };
  if (record.type === "LineString" && Array.isArray(record.coordinates) && record.coordinates.every(validPosition)) return { type: "LineString", coordinates: record.coordinates };
  if (record.type === "MultiLineString" && Array.isArray(record.coordinates) && record.coordinates.every(line => Array.isArray(line) && line.every(validPosition))) return { type: "MultiLineString", coordinates: record.coordinates };
  if (record.type === "Polygon" && Array.isArray(record.coordinates) && record.coordinates.every(ring => Array.isArray(ring) && ring.every(validPosition))) return { type: "Polygon", coordinates: record.coordinates };
  if (record.type === "MultiPolygon" && Array.isArray(record.coordinates) && record.coordinates.every(polygon => Array.isArray(polygon) && polygon.every((ring: unknown) => Array.isArray(ring) && ring.every(validPosition)))) return { type: "MultiPolygon", coordinates: record.coordinates };
  return undefined;
}

function providerSource(provider: SatnavProvider, providerId: string, url: string | undefined, updatedAt?: number, publishedAt?: number, metadata?: Record<string, string | number | boolean>): SatnavSourceRef {
  return {
    provider,
    label: provider === "usgs"
      ? metadata?.eventType && String(metadata.eventType).toLowerCase() !== "earthquake" ? `USGS ${metadata.eventType} record` : "USGS earthquake record"
      : "GDACS disaster alert",
    publisher: provider === "usgs" ? USGS_ATTRIBUTION : GDACS_ATTRIBUTION,
    providerId,
    ...(url ? { url } : {}),
    ...(publishedAt ? { publishedAt } : {}),
    ...(updatedAt ? { updatedAt } : {}),
    attribution: provider === "usgs" ? "Data from USGS Earthquake Hazards Program." : "Automated disaster information from GDACS; validate against local/national authorities.",
    ...(metadata && Object.keys(metadata).length ? { metadata } : {}),
  };
}

export function normalizeUSGSFeature(feature: GeoJsonFeature, fetchedAt = Date.now()): SatnavEvent | undefined {
  const properties = object(feature.properties);
  const geometry = safeGeometry(feature.geometry);
  const point = pointFromGeometry(geometry);
  if (!point) return undefined;
  const providerId = str(feature.id) ?? str(properties.code) ?? str(properties.ids)?.split(",").filter(Boolean)[0];
  if (!providerId) return undefined;
  const providerUrl = str(properties.url);
  const depthKm = geometry?.type === "Point" ? num(geometry.coordinates[2]) : undefined;
  const tsunamiFlag = properties.tsunami === 1 ? true : properties.tsunami === 0 ? false : undefined;
  const metadata: Record<string, string | number | boolean> = {
    ...(depthKm !== undefined ? { depthKm } : {}),
    ...(tsunamiFlag !== undefined ? { tsunamiFlag } : {}),
    ...(str(properties.alert) ? { pagerAlert: str(properties.alert)! } : {}),
    ...(str(properties.status) ? { reviewStatus: str(properties.status)! } : {}),
    ...(num(properties.sig) !== undefined ? { significance: num(properties.sig)! } : {}),
    ...(num(properties.felt) !== undefined ? { feltReports: num(properties.felt)! } : {}),
    ...(num(properties.cdi) !== undefined ? { cdi: num(properties.cdi)! } : {}),
    ...(num(properties.mmi) !== undefined ? { mmi: num(properties.mmi)! } : {}),
    ...(str(properties.type) ? { eventType: str(properties.type)! } : {}),
    ...(str(properties.types) ? { productTypes: str(properties.types)! } : {}),
  };
  const source = providerSource("usgs", providerId, providerUrl, timeMs(properties.updated), undefined, metadata);
  const mag = num(properties.mag);
  const magType = str(properties.magType);
  const eventType = str(properties.type);
  const title = str(properties.title) ?? str(properties.place) ?? (eventType ? `${eventType} event` : "Earthquake");
  const eventTime = timeMs(properties.time);
  return {
    id: `usgs:${providerId}`,
    clusterId: `usgs:${providerId}`,
    providerId,
    category: !eventType || eventType.toLowerCase() === "earthquake" ? "earthquake" : "other",
    title,
    ...(str(properties.place) ? { locationLabel: str(properties.place) } : {}),
    longitude: point.longitude,
    latitude: point.latitude,
    geometry,
    locationPrecision: "point",
    status: "observed",
    verification: "official-feed",
    ...(mag !== undefined ? { severityValue: mag, severityLabel: `M ${mag.toFixed(1)}${magType ? ` ${magType}` : ""}`, severityScale: magType ?? "USGS magnitude" } : {}),
    ...(eventTime ? { startTime: eventTime } : {}),
    ...(timeMs(properties.updated) ? { providerUpdatedAt: timeMs(properties.updated) } : {}),
    fetchedAt,
    sources: [source],
    sourceCount: 1,
  };
}

const gdacsCategory = (value: unknown): SatnavCategory => {
  const type = String(value ?? "").toUpperCase();
  if (type === "EQ") return "earthquake";
  if (type === "FL") return "flood";
  if (type === "TC") return "cyclone";
  if (type === "WF") return "wildfire";
  if (type === "VO") return "volcano";
  if (type === "TS") return "tsunami";
  if (type === "DR") return "drought";
  return "other";
};

export function normalizeGDACSFeature(feature: GeoJsonFeature, fetchedAt = Date.now()): SatnavEvent | undefined {
  const properties = object(feature.properties);
  const geometry = safeGeometry(feature.geometry);
  if (!geometry) return undefined;
  const providerId = idStr(properties.eventid) ?? idStr(feature.id);
  if (!providerId) return undefined;
  const urls = object(properties.url);
  const sourceUrl = str(urls.report) ?? str(urls.details) ?? str(properties.link);
  const eventType = str(properties.eventtype) ?? str(properties["event type"]);
  const episodeId = idStr(properties.episodeid);
  const alertLevel = str(properties.alertlevel);
  const upstreamSourceId = idStr(properties.sourceid);
  const severityData = object(properties.severitydata);
  const metadata: Record<string, string | number | boolean> = {
    ...(eventType ? { eventType } : {}),
    ...(episodeId ? { episodeId } : {}),
    ...(alertLevel ? { alertLevel } : {}),
    ...(str(severityData.severitytext) ? { severityText: str(severityData.severitytext)! } : {}),
    ...(str(severityData.severityunit) ? { severityUnit: str(severityData.severityunit)! } : {}),
    ...(str(properties.source) ? { providerSource: str(properties.source)! } : {}),
    ...(upstreamSourceId ? { providerSourceId: upstreamSourceId } : {}),
  };
  const source = providerSource("gdacs", providerId, sourceUrl, timeMs(properties.datemodified), undefined, metadata);
  const point = pointFromGeometry(geometry);
  const locationClass = str(properties.Class) ?? "";
  const pointIsCentroid = /centroid/i.test(locationClass) || /centroid/i.test(str(properties.polygonlabel) ?? "");
  const precision: LocationPrecision = point ? (pointIsCentroid ? "centroid" : "point") : geometry.type === "Polygon" || geometry.type === "MultiPolygon" ? "area" : "regional";
  const severityValue = num(severityData.severity);
  const eventTime = timeMs(properties.fromdate);
  const endTime = timeMs(properties.todate);
  const title = str(properties.name) ?? str(properties.description) ?? `${eventType ?? "Disaster"} alert`;
  return {
    id: `gdacs:${providerId}:${idStr(properties.episodeid) ?? "current"}`,
    clusterId: `gdacs:${providerId}`,
    providerId,
    category: gdacsCategory(eventType),
    title,
    ...(str(properties.description) ? { description: str(properties.description) } : {}),
    ...(str(properties.country) ? { locationLabel: str(properties.country) } : {}),
    ...(str(properties.country) ? { country: str(properties.country) } : {}),
    ...(point ? { longitude: point.longitude, latitude: point.latitude } : {}),
    geometry,
    locationPrecision: precision,
    status: "alert",
    verification: "single-source",
    ...(alertLevel ? { severityLabel: `${alertLevel} GDACS alert` } : {}),
    ...(severityValue !== undefined ? { severityValue, severityScale: str(severityData.severityunit) ?? "GDACS source scale" } : {}),
    ...(eventTime ? { startTime: eventTime } : {}),
    ...(endTime ? { endTime } : {}),
    ...(timeMs(properties.datemodified) ? { providerUpdatedAt: timeMs(properties.datemodified) } : {}),
    fetchedAt,
    sources: [source],
    sourceCount: 1,
  };
}

async function getJson<T>(url: URL, timeoutMs = FETCH_TIMEOUT_MS): Promise<T> {
  const response = await fetch(url, {
    headers: { Accept: "application/geo+json, application/json" },
    signal: AbortSignal.timeout(Math.max(1, timeoutMs)),
  });
  if (!response.ok) throw new Error(`Upstream returned HTTP ${response.status}`);
  // GDACS uses HTTP 204 to mean a successful query with no matching records.
  if (response.status === 204) return { type: "FeatureCollection", features: [] } as T;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("json")) throw new Error("Upstream did not return JSON");
  return await response.json() as T;
}

function collectionFeatures(data: FeatureCollection, provider: string): GeoJsonFeature[] {
  if (!data || (data.type !== undefined && data.type !== "FeatureCollection") || !Array.isArray(data.features)) {
    throw new Error(`${provider} did not return a GeoJSON FeatureCollection`);
  }
  return data.features;
}

export interface ProviderFetchResult {
  events: SatnavEvent[];
  truncated: boolean;
  message?: string;
}

async function fetchUSGSPart(part: { west: number; south: number; east: number; north: number }, startAt: number, endAt: number) {
  const features: GeoJsonFeature[] = [];
  for (let page = 0; page < USGS_MAX_PAGES_PER_BOX; page++) {
    const url = new URL("https://earthquake.usgs.gov/fdsnws/event/1/query");
    url.search = new URLSearchParams({
      format: "geojson",
      starttime: new Date(startAt).toISOString(),
      endtime: new Date(endAt).toISOString(),
      minlatitude: String(part.south),
      maxlatitude: String(part.north),
      minlongitude: String(part.west),
      maxlongitude: String(part.east),
      limit: String(USGS_PAGE_SIZE),
      offset: String(page * USGS_PAGE_SIZE + 1),
      orderby: "time",
    }).toString();
    const data = await getJson<FeatureCollection>(url);
    const batch = collectionFeatures(data, "USGS");
    features.push(...batch);
    if (batch.length < USGS_PAGE_SIZE) return { features, truncated: false };
  }
  return { features, truncated: true };
}

export async function fetchUSGS(bounds: { west: number; south: number; east: number; north: number }, startAt: number, endAt: number): Promise<ProviderFetchResult> {
  const parts = splitViewport(bounds);
  const results = await Promise.all(parts.map(part => fetchUSGSPart(part, startAt, endAt)));
  const fetchedAt = Date.now();
  const byId = new Map<string, SatnavEvent>();
  results.flatMap(result => result.features).forEach(feature => {
    const event = normalizeUSGSFeature(feature, fetchedAt);
    if (event) byId.set(event.id, event);
  });
  const truncated = results.some(result => result.truncated);
  return { events: [...byId.values()], truncated, ...(truncated ? { message: "USGS results reached the 20,000-record cap per antimeridian-safe area; narrow the time range or zoom in." } : {}) };
}

function eventMatchesWindow(event: SatnavEvent, startAt: number, endAt: number): boolean {
  const start = event.startTime ?? event.endTime;
  const end = event.endTime ?? event.startTime;
  return start === undefined || start <= endAt && (end === undefined || end >= startAt);
}

function normalizeGDACSFeatures(features: GeoJsonFeature[], bounds: { west: number; south: number; east: number; north: number }, startAt: number, endAt: number, fetchedAt: number): SatnavEvent[] {
  const byId = new Map<string, SatnavEvent>();
  for (const feature of features) {
    const event = normalizeGDACSFeature(feature, fetchedAt);
    if (!event || !eventMatchesWindow(event, startAt, endAt) || !geometryIntersectsViewport(event.geometry, bounds)) continue;
    byId.set(event.id, event);
  }
  return [...byId.values()];
}

async function fetchGDACSSearch(bounds: { west: number; south: number; east: number; north: number }, startAt: number, endAt: number, fetchedAt: number): Promise<ProviderFetchResult> {
  const features: GeoJsonFeature[] = [];
  let truncated = false;
  const deadline = Date.now() + GDACS_SEARCH_BUDGET_MS;
  for (let page = 1; page <= GDACS_SEARCH_MAX_PAGES; page++) {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) throw new Error("GDACS search fallback exceeded its 18-second request budget.");
    const url = new URL("https://www.gdacs.org/gdacsapi/api/Events/geteventlist/search");
    url.search = new URLSearchParams({
      eventlist: GDACS_EVENT_TYPES.join(";"),
      fromDate: new Date(startAt).toISOString(),
      toDate: new Date(endAt).toISOString(),
      pageSize: String(GDACS_SEARCH_PAGE_SIZE),
      pageNumber: String(page),
    }).toString();
    const data = await getJson<FeatureCollection>(url, Math.min(FETCH_TIMEOUT_MS, remainingMs));
    const batch = collectionFeatures(data, "GDACS search");
    features.push(...batch);
    if (batch.length < GDACS_SEARCH_PAGE_SIZE) break;
    if (page === GDACS_SEARCH_MAX_PAGES) truncated = true;
  }
  return {
    events: normalizeGDACSFeatures(features, bounds, startAt, endAt, fetchedAt),
    truncated,
    message: `GDACS used its documented time-bounded search for a historical window or an unavailable rolling area query (maximum ${GDACS_SEARCH_MAX_PAGES * GDACS_SEARCH_PAGE_SIZE} global records), then filtered source geometry to this viewport. Some point geometries are provider centroids.${truncated ? " The search reached its record cap; coverage may be incomplete." : ""}`,
  };
}

export async function fetchGDACS(bounds: { west: number; south: number; east: number; north: number }, startAt: number, endAt: number): Promise<ProviderFetchResult> {
  const parts = splitViewport(bounds);
  const fetchedAt = Date.now();
  const days = Math.max(1, Math.min(30, Math.ceil((fetchedAt - startAt) / 86_400_000)));
  if (startAt < fetchedAt - 30 * 86_400_000) {
    return fetchGDACSSearch(bounds, startAt, endAt, fetchedAt);
  }
  try {
    const collections = await Promise.all(parts.map(async part => {
      const url = new URL("https://www.gdacs.org/gdacsapi/api/Events/geteventlist/eventsbyarea");
      url.search = new URLSearchParams({ geometryArea: viewportToWkt(part), days: String(days) }).toString();
      return getJson<FeatureCollection>(url, GDACS_AREA_TIMEOUT_MS);
    }));
    const features = collections.flatMap(collection => collectionFeatures(collection, "GDACS area query"));
    return {
      events: normalizeGDACSFeatures(features, bounds, startAt, endAt, fetchedAt),
      truncated: false,
      message: "GDACS rolling area query covers at most 30 days from the current date; exact-date paged search is used for older selected windows. Event types include earthquake, flood, tropical cyclone, wildfire, volcano, tsunami and drought. Some point geometries are provider centroids, not affected-area boundaries.",
    };
  } catch {
    return fetchGDACSSearch(bounds, startAt, endAt, fetchedAt);
  }
}
