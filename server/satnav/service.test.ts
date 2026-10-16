import { afterEach, describe, expect, it, vi } from "vitest";
import type { SatnavEvent } from "@shared/satnav";

vi.mock("./providers", () => ({ fetchUSGS: vi.fn(), fetchGDACS: vi.fn() }));
vi.mock("./gdelt", () => ({ fetchGDELT: vi.fn() }));
vi.mock("./gdelt-cache", () => ({ loadOfflineGdeltSnapshot: vi.fn(), saveOfflineGdeltSnapshot: vi.fn(async () => undefined) }));
vi.mock("./store", () => ({
  getStoredEventById: vi.fn(),
  loadStoredEvents: vi.fn(),
  persistEvents: vi.fn(async () => true),
  persistProviderHealth: vi.fn(async () => undefined),
  searchStoredEvents: vi.fn(async () => []),
}));

import { fetchGDACS, fetchUSGS } from "./providers";
import { fetchGDELT } from "./gdelt";
import { loadOfflineGdeltSnapshot, saveOfflineGdeltSnapshot } from "./gdelt-cache";
import { loadStoredEvents } from "./store";
import { getViewportEvents } from "./service";

afterEach(() => vi.clearAllMocks());

describe("provider stale fallback", () => {
  it("saves successful live GDELT events as the offline snapshot", async () => {
    const endAt = Math.floor(Date.now() / 60_000) * 60_000;
    const startAt = endAt - 24 * 60 * 60_000;
    const bounds = { west: 40, south: -2, east: 42, north: 2 };
    const live: SatnavEvent = {
      id: "gdelt:live-success-cache",
      clusterId: "gdelt:live-success-cache",
      providerId: "gdelt-live-success-cache",
      category: "news",
      title: "Live provider article fixture",
      longitude: 41,
      latitude: 0,
      geometry: { type: "Point", coordinates: [41, 0] },
      locationPrecision: "centroid",
      status: "report",
      verification: "single-source",
      startTime: startAt + 1_000,
      publishedAt: startAt + 1_000,
      fetchedAt: endAt,
      sources: [{ provider: "gdelt", label: "Test provider article", url: "https://example.test/live", attribution: "Test fixture only" }],
      sourceCount: 1,
    };
    vi.mocked(fetchUSGS).mockResolvedValue({ events: [], truncated: false });
    vi.mocked(fetchGDACS).mockResolvedValue({ events: [], truncated: false });
    vi.mocked(fetchGDELT).mockResolvedValue({ events: [live], truncated: false });

    await getViewportEvents(bounds, startAt, endAt);

    expect(saveOfflineGdeltSnapshot).toHaveBeenCalledWith(bounds, startAt, endAt, [live]);
    expect(loadOfflineGdeltSnapshot).not.toHaveBeenCalled();
  });

  it("serves persisted GDELT viewport records with degraded health after a live timeout", async () => {
    const endAt = Math.floor(Date.now() / 60_000) * 60_000;
    const startAt = endAt - 24 * 60 * 60_000;
    const cached: SatnavEvent = {
      id: "gdelt:cached-article",
      clusterId: "gdelt:cached-article",
      providerId: "gdelt-cached-article",
      category: "news",
      title: "Cached public article fixture",
      longitude: 0,
      latitude: 0,
      geometry: { type: "Point", coordinates: [0, 0] },
      locationPrecision: "centroid",
      status: "report",
      verification: "single-source",
      startTime: startAt + 1_000,
      publishedAt: startAt + 1_000,
      fetchedAt: endAt - 20 * 60_000,
      sources: [{ provider: "gdelt", label: "Fixture article", url: "https://example.test/article", attribution: "Test-only fixture" }],
      sourceCount: 1,
    };
    vi.mocked(fetchUSGS).mockResolvedValue({ events: [], truncated: false });
    vi.mocked(fetchGDACS).mockResolvedValue({ events: [], truncated: false });
    vi.mocked(fetchGDELT).mockRejectedValue(new DOMException("Timed out", "TimeoutError"));
    vi.mocked(loadStoredEvents).mockResolvedValue([cached]);

    const result = await getViewportEvents({ west: -2, south: -2, east: 2, north: 2 }, startAt, endAt);
    const gdelt = result.sources.find(source => source.provider === "gdelt");

    expect(loadStoredEvents).toHaveBeenCalledOnce();
    expect(result.events.map(event => event.id)).toContain(cached.id);
    expect(gdelt?.state).toBe("degraded");
    expect(gdelt?.itemCount).toBe(1);
    expect(gdelt?.message).toContain("Showing cached public records");
    expect(result.mode).toBe("partial");
  });

  it("serves a persistent offline GDELT snapshot when the live request fails and the database is empty", async () => {
    const endAt = Math.floor(Date.now() / 60_000) * 60_000;
    const startAt = endAt - 24 * 60 * 60_000;
    const bounds = { west: 20, south: -2, east: 22, north: 2 };
    const cached: SatnavEvent = {
      id: "gdelt:offline-file-cache",
      clusterId: "gdelt:offline-file-cache",
      providerId: "gdelt-offline-file-cache",
      category: "news",
      title: "Cached source article, not live data",
      longitude: 21,
      latitude: 0,
      geometry: { type: "Point", coordinates: [21, 0] },
      locationPrecision: "centroid",
      status: "report",
      verification: "single-source",
      startTime: startAt + 1_000,
      publishedAt: startAt + 1_000,
      fetchedAt: endAt - 30 * 60_000,
      sources: [{ provider: "gdelt", label: "Test-only cached article", url: "https://example.test/offline", attribution: "Test fixture only" }],
      sourceCount: 1,
    };
    vi.mocked(fetchUSGS).mockResolvedValue({ events: [], truncated: false });
    vi.mocked(fetchGDACS).mockResolvedValue({ events: [], truncated: false });
    vi.mocked(fetchGDELT).mockRejectedValue(new DOMException("Timed out", "TimeoutError"));
    vi.mocked(loadStoredEvents).mockResolvedValue([]);
    vi.mocked(loadOfflineGdeltSnapshot).mockResolvedValue({ events: [cached], savedAt: endAt - 30 * 60_000, matchedEmptyQuery: false });

    const result = await getViewportEvents(bounds, startAt, endAt);
    const gdelt = result.sources.find(source => source.provider === "gdelt");

    expect(loadOfflineGdeltSnapshot).toHaveBeenCalledOnce();
    expect(saveOfflineGdeltSnapshot).not.toHaveBeenCalled();
    expect(result.events.map(event => event.id)).toContain(cached.id);
    expect(gdelt?.state).toBe("degraded");
    expect(gdelt?.itemCount).toBe(1);
    expect(gdelt?.message).toContain("offline cached public records");
  });

  it("marks a cached successful empty GDELT response degraded rather than unavailable", async () => {
    const endAt = Math.floor(Date.now() / 60_000) * 60_000;
    const startAt = endAt - 24 * 60 * 60_000;
    const bounds = { west: 30, south: -2, east: 32, north: 2 };
    vi.mocked(fetchUSGS).mockResolvedValue({ events: [], truncated: false });
    vi.mocked(fetchGDACS).mockResolvedValue({ events: [], truncated: false });
    vi.mocked(fetchGDELT).mockRejectedValue(new DOMException("Timed out", "TimeoutError"));
    vi.mocked(loadStoredEvents).mockResolvedValue([]);
    vi.mocked(loadOfflineGdeltSnapshot).mockResolvedValue({ events: [], savedAt: endAt - 10 * 60_000, matchedEmptyQuery: true });

    const result = await getViewportEvents(bounds, startAt, endAt);
    const gdelt = result.sources.find(source => source.provider === "gdelt");

    expect(gdelt?.state).toBe("degraded");
    expect(gdelt?.itemCount).toBe(0);
    expect(gdelt?.message).toContain("last successful GDELT request had no records");
  });
});
