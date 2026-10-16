import type { ProviderHealth, SatnavEvent, SatnavProvider, ViewportBounds, ViewportEventsResult } from "@shared/satnav";
import { bboxKey } from "./geo";
import { reconcileCrossProviderIncidents } from "./incidents";
import { fetchGDACS, fetchUSGS } from "./providers";
import { fetchGDELT } from "./gdelt";
import { loadOfflineGdeltSnapshot, saveOfflineGdeltSnapshot } from "./gdelt-cache";
import { getStoredEventById, loadStoredEvents, persistEvents, persistProviderHealth, searchStoredEvents } from "./store";

const CACHE_MS = 60_000;
const STALE_MS = 6 * 60 * 60 * 1000;
const MAX_MEMORY_EVENTS = 8_000;
const providerNotes: Record<"usgs" | "gdacs" | "gdelt", string> = {
  usgs: "USGS FDSN ComCat query for this viewport/time window; paged to a maximum of 20,000 records per antimeridian-safe area. Depth, tsunami flag, alert and review metadata are retained when supplied.",
  gdacs: "GDACS earthquake, flood, cyclone, wildfire, volcano, tsunami and drought alerts; area queries cover at most 30 days, with a capped time-bounded search fallback. Some point geometries are provider centroids.",
  gdelt: "GDELT article metadata (past 24 h max); coordinates are journalist-coded centroid-level. On upstream failure, a bounded last-success offline snapshot may be shown as degraded data for up to 72 hours.",
};

interface ProviderCache { events: SatnavEvent[]; fetchedAt: number; staleUntil: number }
interface CachedResult { value: ViewportEventsResult; expiresAt: number }
const providerCache = new Map<string, ProviderCache>();
const resultCache = new Map<string, CachedResult>();
const inFlight = new Map<string, Promise<ViewportEventsResult>>();
const eventMemory = new Map<string, SatnavEvent>();
const incidentMemory = new Map<string, SatnavEvent>();
const healthMemory = new Map<SatnavProvider, ProviderHealth>();

const seedHealth = (provider: "usgs" | "gdacs" | "gdelt"): ProviderHealth => ({
  provider,
  label: provider === "usgs" ? "USGS earthquakes" : provider === "gdacs" ? "GDACS disaster alerts" : "GDELT news articles",
  state: "pending",
  itemCount: 0,
  coverageNote: providerNotes[provider],
  message: "No successful request has been recorded in this server session yet.",
});

function rememberEvents(events: SatnavEvent[]) {
  for (const event of events) {
    eventMemory.delete(event.id);
    eventMemory.set(event.id, event);
  }
  while (eventMemory.size > MAX_MEMORY_EVENTS) {
    const oldest = eventMemory.keys().next().value;
    if (!oldest) break;
    eventMemory.delete(oldest);
  }
}

function rememberIncidents(events: SatnavEvent[]) {
  for (const event of events) {
    incidentMemory.delete(event.id);
    incidentMemory.set(event.id, event);
  }
  while (incidentMemory.size > MAX_MEMORY_EVENTS) {
    const oldest = incidentMemory.keys().next().value;
    if (!oldest) break;
    incidentMemory.delete(oldest);
  }
}

function safeFailureMessage(error: unknown): string {
  if (error instanceof Error && error.message.includes("GDELT_HISTORICAL_WINDOW_UNSUPPORTED")) return "GDELT supports only recent relative windows; historical article coverage is unavailable here, so no current articles were substituted.";
  if (error instanceof Error && error.message.match(/Upstream returned HTTP \d{3}/)) return error.message.match(/Upstream returned HTTP \d{3}/)![0];
  if (error instanceof Error && /timeout/i.test(error.name)) return "The upstream request timed out.";
  return "The upstream request failed; unrelated providers remain available.";
}

type Settled<T> = { ok: true; value: T } | { ok: false; error: unknown };
const settle = <T>(promise: Promise<T>): Promise<Settled<T>> =>
  promise.then(value => ({ ok: true as const, value })).catch(error => ({ ok: false as const, error }));
const uniqueById = (events: SatnavEvent[]) => {
  const byId = new Map<string, SatnavEvent>();
  for (const event of events) {
    const previous = byId.get(event.id);
    if (!previous || event.fetchedAt >= previous.fetchedAt) byId.set(event.id, event);
  }
  return [...byId.values()];
};

export async function getViewportEvents(bounds: ViewportBounds, startAt: number, endAt: number): Promise<ViewportEventsResult> {
  const key = `${bboxKey(bounds)}|${Math.floor(startAt / 60_000)}|${Math.floor(endAt / 60_000)}`;
  const now = Date.now();
  const cached = resultCache.get(key);
  if (cached && cached.expiresAt > now) return cached.value;
  const pending = inFlight.get(key);
  if (pending) return pending;

  const request = (async () => {
    const attemptedAt = Date.now();
    const [usgs, gdacs, gdelt] = await Promise.all([
      settle(fetchUSGS(bounds, startAt, endAt)),
      settle(fetchGDACS(bounds, startAt, endAt)),
      settle(fetchGDELT(bounds, startAt, endAt)),
    ]);
    let dbFallback: SatnavEvent[] = [];
    let offlineGdelt: Awaited<ReturnType<typeof loadOfflineGdeltSnapshot>>;
    if (gdelt.ok) {
      try { await saveOfflineGdeltSnapshot(bounds, startAt, endAt, gdelt.value.events); }
      catch (error) { console.warn("[SATNAV] GDELT offline cache write failed; live results are retained.", error instanceof Error ? error.name : "unknown"); }
    } else {
      try { offlineGdelt = await loadOfflineGdeltSnapshot(bounds, startAt, endAt, now); }
      catch { offlineGdelt = undefined; }
    }
    if (!usgs.ok || !gdacs.ok || !gdelt.ok) {
      try { dbFallback = await loadStoredEvents(bounds, startAt, endAt, 500); } catch { dbFallback = []; }
    }

    const liveEvents: SatnavEvent[] = [];
    const resultEvents: SatnavEvent[] = [];
    const statuses: ProviderHealth[] = [];
    let truncated = false;
    const sourcePairs = [
      { provider: "usgs" as const, settled: usgs },
      { provider: "gdacs" as const, settled: gdacs },
      { provider: "gdelt" as const, settled: gdelt },
    ];

    for (const item of sourcePairs) {
      const cacheKey = `${key}|${item.provider}`;
      const prior = providerCache.get(cacheKey);
      const persisted = dbFallback.filter(event => event.sources.some(source => source.provider === item.provider));
      if (item.settled.ok) {
        const fetched = item.settled.value;
        liveEvents.push(...fetched.events);
        resultEvents.push(...fetched.events);
        const health: ProviderHealth = {
          provider: item.provider,
          label: item.provider === "usgs" ? "USGS earthquakes" : item.provider === "gdacs" ? "GDACS disaster alerts" : "GDELT news articles",
          state: "available",
          lastAttemptAt: attemptedAt,
          lastSuccessAt: Date.now(),
          itemCount: fetched.events.length,
          ...(fetched.message ? { message: fetched.message } : {}),
          coverageNote: providerNotes[item.provider],
        };
        statuses.push(health);
        healthMemory.set(item.provider, health);
        providerCache.set(cacheKey, { events: fetched.events, fetchedAt: Date.now(), staleUntil: Date.now() + STALE_MS });
        truncated ||= fetched.truncated;
      } else {
        const memoryHit = !!prior && prior.staleUntil > now;
        const fileEvents = item.provider === "gdelt" ? offlineGdelt?.events ?? [] : [];
        const stale = memoryHit ? prior.events : persisted.length ? persisted : fileEvents;
        const fileHit = item.provider === "gdelt" && !memoryHit && !persisted.length && !!offlineGdelt;
        const cachedEmptyHit = fileHit && offlineGdelt?.matchedEmptyQuery === true;
        const hasCachedData = stale.length > 0 || memoryHit || cachedEmptyHit;
        resultEvents.push(...stale);
        const lastKnown = healthMemory.get(item.provider);
        const newestStaleAt = stale.length ? Math.max(...stale.map(event => event.fetchedAt)) : undefined;
        const staleAge = newestStaleAt === undefined ? undefined : Math.max(0, now - newestStaleAt);
        const cachedAt = fileHit ? offlineGdelt?.savedAt : memoryHit ? prior?.fetchedAt : undefined;
        const lastSuccessAt = lastKnown?.lastSuccessAt ?? cachedAt ?? (newestStaleAt === undefined ? undefined : newestStaleAt);
        const cacheAgeMs = cachedAt !== undefined ? Math.max(0, now - cachedAt) : staleAge;
        const cacheAgeMinutes = cacheAgeMs === undefined ? undefined : Math.round(cacheAgeMs / 60_000);
        const cacheMessage = stale.length
          ? ` Showing ${fileHit ? "offline cached" : "cached"} public records (${cacheAgeMinutes ?? 0} min old).`
          : cachedEmptyHit
            ? ` The last successful GDELT request had no records for this viewport (${cacheAgeMinutes ?? 0} min old).`
            : " No cached records are available for this viewport.";
        const health: ProviderHealth = {
          provider: item.provider,
          label: item.provider === "usgs" ? "USGS earthquakes" : item.provider === "gdacs" ? "GDACS disaster alerts" : "GDELT news articles",
          state: hasCachedData ? "degraded" : "unavailable",
          lastAttemptAt: attemptedAt,
          ...(lastSuccessAt ? { lastSuccessAt } : {}),
          itemCount: stale.length,
          message: `${safeFailureMessage(item.settled.error)}${cacheMessage}`,
          coverageNote: providerNotes[item.provider],
        };
        statuses.push(health);
        healthMemory.set(item.provider, health);
      }
    }

    const reconciliation = reconcileCrossProviderIncidents(uniqueById(resultEvents));
    const events = reconciliation.incidents;
    rememberEvents(reconciliation.records);
    rememberIncidents(events);
    if (liveEvents.length) {
      try { await persistEvents(reconciliation.records); } catch (error) { console.warn("[SATNAV] Public event persistence failed; live results are retained.", error instanceof Error ? error.name : "unknown"); }
    }
    try { await persistProviderHealth(statuses); } catch (error) { console.warn("[SATNAV] Provider status persistence failed.", error instanceof Error ? error.name : "unknown"); }

    const successfulCount = statuses.filter(status => status.state === "available").length;
    const newestDataAt = events.length ? Math.max(...events.map(event => event.fetchedAt)) : undefined;
    const mode: ViewportEventsResult["mode"] = successfulCount >= 3 ? "live" : successfulCount >= 1 ? "partial" : "stale";
    const result: ViewportEventsResult = {
      events,
      sources: statuses,
      fetchedAt: Date.now(),
      truncated,
      mode,
      ...(mode !== "live" && newestDataAt !== undefined ? { staleAgeMs: Math.max(0, Date.now() - newestDataAt) } : {}),
      coverageNote: "This viewport includes USGS ComCat, GDACS disaster alerts and GDELT article metadata. Closely matching USGS/GDACS earthquake records are linked using time, point and magnitude; article centroids remain separate and a link is not independent corroboration. Coverage varies; conflict, political, weather, health, humanitarian, transport and space records are not connected. SATNAV is not an emergency-warning service.",
    };
    resultCache.set(key, { value: result, expiresAt: Date.now() + CACHE_MS });
    return result;
  })();

  inFlight.set(key, request);
  try { return await request; }
  finally { inFlight.delete(key); }
}

export async function searchEvents(query: string, limit = 20): Promise<SatnavEvent[]> {
  const normalized = query.trim().toLocaleLowerCase();
  if (normalized.length < 2) return [];
  const fromMemory = [...eventMemory.values()].filter(event =>
    `${event.title} ${event.locationLabel ?? ""} ${event.country ?? ""}`.toLocaleLowerCase().includes(normalized),
  );
  let fromDatabase: SatnavEvent[] = [];
  try { fromDatabase = await searchStoredEvents(query, limit); } catch { fromDatabase = []; }
  const reconciliation = reconcileCrossProviderIncidents(uniqueById([...fromMemory, ...fromDatabase]));
  rememberEvents(reconciliation.records);
  rememberIncidents(reconciliation.incidents);
  return reconciliation.incidents
    .sort((a, b) => (b.startTime ?? 0) - (a.startTime ?? 0))
    .slice(0, Math.min(50, Math.max(1, limit)));
}

export async function getEventForExplanation(id: string): Promise<SatnavEvent | undefined> {
  return incidentMemory.get(id) ?? eventMemory.get(id) ?? await getStoredEventById(id);
}

export function getProviderStatuses(): ProviderHealth[] {
  return (["usgs", "gdacs", "gdelt"] as const).map(provider => healthMemory.get(provider) ?? seedHealth(provider));
}
// Keep this list limited to implemented adapters with verified attribution and status handling.
