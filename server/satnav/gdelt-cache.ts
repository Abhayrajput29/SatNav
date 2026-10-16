import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { SatnavEvent, ViewportBounds } from "@shared/satnav";
import { geometryIntersectsViewport, isSatnavGeometry } from "./geo";

const CACHE_VERSION = 1;
const MAX_CACHE_AGE_MS = 72 * 60 * 60 * 1000;
const MAX_SNAPSHOTS = 24;
const MAX_EVENTS_PER_SNAPSHOT = 75;
const MAX_CACHE_BYTES = 4_000_000;

interface GdeltSnapshot {
  queryKey: string;
  savedAt: number;
  bounds: ViewportBounds;
  startAt: number;
  endAt: number;
  events: SatnavEvent[];
}

interface GdeltCacheFile {
  version: typeof CACHE_VERSION;
  snapshots: GdeltSnapshot[];
}

export interface OfflineGdeltSnapshot {
  events: SatnavEvent[];
  savedAt: number;
  matchedEmptyQuery: boolean;
}

function cacheFilePath(): string {
  const configured = process.env.SATNAV_GDELT_CACHE_PATH?.trim();
  return resolve(configured || ".cache/satnav/gdelt-v1.json");
}

function queryKey(bounds: ViewportBounds, startAt: number, endAt: number): string {
  return `${bounds.west},${bounds.south},${bounds.east},${bounds.north}|${Math.floor(startAt / 60_000)}|${Math.floor(endAt / 60_000)}`;
}

function finiteBounds(value: unknown): value is ViewportBounds {
  if (!value || typeof value !== "object") return false;
  const bounds = value as Record<string, unknown>;
  return [bounds.west, bounds.south, bounds.east, bounds.north].every(item => typeof item === "number" && Number.isFinite(item)) &&
    (bounds.west as number) >= -540 && (bounds.west as number) <= 540 &&
    (bounds.east as number) >= -540 && (bounds.east as number) <= 540 &&
    (bounds.south as number) >= -90 && (bounds.south as number) <= 90 &&
    (bounds.north as number) >= -90 && (bounds.north as number) <= 90 &&
    (bounds.east as number) > (bounds.west as number) && (bounds.north as number) > (bounds.south as number);
}

function validEvent(value: unknown): value is SatnavEvent {
  if (!value || typeof value !== "object") return false;
  const event = value as Partial<SatnavEvent>;
  return typeof event.id === "string" && typeof event.title === "string" && typeof event.providerId === "string" &&
    typeof event.fetchedAt === "number" && Number.isFinite(event.fetchedAt) &&
    typeof event.longitude === "number" && Number.isFinite(event.longitude) && event.longitude >= -180 && event.longitude <= 180 &&
    typeof event.latitude === "number" && Number.isFinite(event.latitude) && event.latitude >= -90 && event.latitude <= 90 &&
    isSatnavGeometry(event.geometry) && Array.isArray(event.sources) &&
    event.sources.some(source => source?.provider === "gdelt");
}

function validSnapshot(value: unknown, now: number): value is GdeltSnapshot {
  if (!value || typeof value !== "object") return false;
  const snapshot = value as Partial<GdeltSnapshot>;
  return typeof snapshot.queryKey === "string" && typeof snapshot.savedAt === "number" && Number.isFinite(snapshot.savedAt) &&
    snapshot.savedAt <= now + 60_000 && now - snapshot.savedAt <= MAX_CACHE_AGE_MS &&
    finiteBounds(snapshot.bounds) && typeof snapshot.startAt === "number" && Number.isFinite(snapshot.startAt) &&
    snapshot.startAt > 0 && typeof snapshot.endAt === "number" && Number.isFinite(snapshot.endAt) && snapshot.endAt > snapshot.startAt &&
    snapshot.queryKey === queryKey(snapshot.bounds, snapshot.startAt, snapshot.endAt) &&
    Array.isArray(snapshot.events) && snapshot.events.length <= MAX_EVENTS_PER_SNAPSHOT && snapshot.events.every(validEvent);
}

async function readCache(path: string, now: number): Promise<GdeltSnapshot[]> {
  try {
    const fileInfo = await stat(path);
    if (fileInfo.size <= 0 || fileInfo.size > MAX_CACHE_BYTES) return [];
    const parsed = JSON.parse(await readFile(path, "utf8")) as Partial<GdeltCacheFile>;
    if (parsed.version !== CACHE_VERSION || !Array.isArray(parsed.snapshots)) return [];
    return parsed.snapshots.filter((snapshot): snapshot is GdeltSnapshot => validSnapshot(snapshot, now))
      .sort((left, right) => right.savedAt - left.savedAt)
      .slice(0, MAX_SNAPSHOTS);
  } catch {
    return [];
  }
}

let writeQueue: Promise<void> = Promise.resolve();

export function saveOfflineGdeltSnapshot(
  bounds: ViewportBounds,
  startAt: number,
  endAt: number,
  events: SatnavEvent[],
  savedAt = Date.now(),
): Promise<void> {
  if (!finiteBounds(bounds) || !Number.isFinite(startAt) || !Number.isFinite(endAt) || startAt <= 0 || endAt <= startAt) return Promise.resolve();
  const path = cacheFilePath();
  const snapshot: GdeltSnapshot = {
    queryKey: queryKey(bounds, startAt, endAt),
    savedAt,
    bounds,
    startAt,
    endAt,
    events: events.filter(validEvent).slice(0, MAX_EVENTS_PER_SNAPSHOT),
  };
  const operation = writeQueue.then(async () => {
    const now = Date.now();
    const previous = await readCache(path, now);
    let snapshots = [snapshot, ...previous.filter(item => item.queryKey !== snapshot.queryKey)]
      .filter(item => Number.isFinite(item.savedAt) && item.savedAt <= now + 60_000 && now - item.savedAt <= MAX_CACHE_AGE_MS)
      .slice(0, MAX_SNAPSHOTS);
    let content = JSON.stringify({ version: CACHE_VERSION, snapshots } satisfies GdeltCacheFile);
    while (Buffer.byteLength(content, "utf8") > MAX_CACHE_BYTES && snapshots.length > 1) {
      snapshots = snapshots.slice(0, -1);
      content = JSON.stringify({ version: CACHE_VERSION, snapshots } satisfies GdeltCacheFile);
    }
    if (Buffer.byteLength(content, "utf8") > MAX_CACHE_BYTES) return;

    await mkdir(dirname(path), { recursive: true });
    const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporaryPath, content, { encoding: "utf8", mode: 0o600 });
      await rename(temporaryPath, path);
    } catch (error) {
      try { await unlink(temporaryPath); } catch { /* best-effort temporary-file cleanup */ }
      throw error;
    }
  });
  writeQueue = operation.then(() => undefined, () => undefined);
  return operation;
}

export async function loadOfflineGdeltSnapshot(
  bounds: ViewportBounds,
  startAt: number,
  endAt: number,
  now = Date.now(),
): Promise<OfflineGdeltSnapshot | undefined> {
  const snapshots = await readCache(cacheFilePath(), now);
  if (!snapshots.length) return undefined;

  const matchedEvents = new Map<string, { event: SatnavEvent; savedAt: number }>();
  for (const snapshot of snapshots) {
    for (const event of snapshot.events) {
      const eventAt = event.publishedAt ?? event.startTime;
      if (eventAt === undefined || eventAt < startAt || eventAt > endAt || !event.geometry ||
        !geometryIntersectsViewport(event.geometry, bounds)) continue;
      const previous = matchedEvents.get(event.id);
      if (!previous || event.fetchedAt >= previous.event.fetchedAt) matchedEvents.set(event.id, { event, savedAt: snapshot.savedAt });
    }
  }

  const events = [...matchedEvents.values()].map(item => item.event);
  if (events.length) {
    return {
      events,
      savedAt: Math.max(...[...matchedEvents.values()].map(item => item.savedAt)),
      matchedEmptyQuery: false,
    };
  }

  const exactEmpty = snapshots.find(snapshot => snapshot.queryKey === queryKey(bounds, startAt, endAt) && snapshot.events.length === 0);
  return exactEmpty ? { events: [], savedAt: exactEmpty.savedAt, matchedEmptyQuery: true } : undefined;
}
