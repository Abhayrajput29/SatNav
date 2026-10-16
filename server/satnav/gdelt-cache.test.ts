import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { SatnavEvent, ViewportBounds } from "@shared/satnav";
import { loadOfflineGdeltSnapshot, saveOfflineGdeltSnapshot } from "./gdelt-cache";

const bounds: ViewportBounds = { west: -2, south: -2, east: 2, north: 2 };
const endAt = Math.floor(Date.now() / 60_000) * 60_000;
const startAt = endAt - 24 * 60 * 60_000;
const cachePath = join(process.cwd(), ".work", "tmp", `gdelt-cache-${randomUUID()}.json`);
const originalPath = process.env.SATNAV_GDELT_CACHE_PATH;

const article = (fetchedAt: number): SatnavEvent => ({
  id: "gdelt:cache-test-article",
  clusterId: "gdelt:cache-test-article",
  providerId: "gdelt-cache-test-article",
  category: "news",
  title: "Test-only cached article",
  longitude: 0,
  latitude: 0,
  geometry: { type: "Point", coordinates: [0, 0] },
  locationPrecision: "centroid",
  status: "report",
  verification: "single-source",
  startTime: startAt + 1_000,
  publishedAt: startAt + 1_000,
  fetchedAt,
  sources: [{ provider: "gdelt", label: "Test-only cached article", url: "https://example.test/article", attribution: "Test fixture only" }],
  sourceCount: 1,
});

beforeEach(() => { process.env.SATNAV_GDELT_CACHE_PATH = cachePath; });
afterEach(async () => {
  await rm(cachePath, { force: true });
  if (originalPath === undefined) delete process.env.SATNAV_GDELT_CACHE_PATH;
  else process.env.SATNAV_GDELT_CACHE_PATH = originalPath;
});

describe("GDELT offline snapshot cache", () => {
  it("round-trips only actual-shaped article records that match the requested time and viewport", async () => {
    const savedAt = Date.now() - 5 * 60_000;
    await saveOfflineGdeltSnapshot(bounds, startAt, endAt, [article(savedAt)], savedAt);
    const cached = await loadOfflineGdeltSnapshot(bounds, startAt, endAt);

    expect(cached?.events.map(event => event.id)).toEqual(["gdelt:cache-test-article"]);
    expect(cached?.savedAt).toBe(savedAt);
    expect(cached?.matchedEmptyQuery).toBe(false);
    await expect(loadOfflineGdeltSnapshot({ west: 10, south: 10, east: 12, north: 12 }, startAt, endAt)).resolves.toBeUndefined();
    await expect(loadOfflineGdeltSnapshot(bounds, startAt - 3 * 24 * 60 * 60_000, startAt - 2 * 24 * 60 * 60_000)).resolves.toBeUndefined();
  });

  it("retains an exact successful empty query so a timeout can be labeled as cached-empty", async () => {
    const savedAt = Date.now() - 2 * 60_000;
    await saveOfflineGdeltSnapshot(bounds, startAt, endAt, [], savedAt);
    await expect(loadOfflineGdeltSnapshot(bounds, startAt, endAt)).resolves.toEqual({
      events: [],
      savedAt,
      matchedEmptyQuery: true,
    });
    await expect(loadOfflineGdeltSnapshot({ west: -1.99, south: -2, east: 2, north: 2 }, startAt, endAt)).resolves.toBeUndefined();
  });

  it("expires snapshots older than the 72-hour stale-data limit", async () => {
    const savedAt = Date.now() - 73 * 60 * 60_000;
    await saveOfflineGdeltSnapshot(bounds, startAt, endAt, [article(savedAt)], savedAt);
    await expect(loadOfflineGdeltSnapshot(bounds, startAt, endAt)).resolves.toBeUndefined();
  });
});
