import { afterEach, describe, expect, it, vi } from "vitest";
import { geometryIntersectsViewport } from "./geo";
import { fetchGDACS, fetchUSGS, normalizeGDACSFeature, normalizeUSGSFeature } from "./providers";

const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "content-type": "application/geo+json" },
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("expanded source coverage", () => {
  it("preserves USGS tsunami, depth, review and impact fields without calling origin time a publication time", () => {
    const event = normalizeUSGSFeature({
      id: "us6000u18k",
      type: "Feature",
      geometry: { type: "Point", coordinates: [-80.769, 7.5868, 12.647] },
      properties: {
        type: "earthquake",
        title: "M 7.7 - Panama",
        time: Date.parse("2026-10-09T17:56:06Z"),
        updated: Date.parse("2026-10-15T08:58:55Z"),
        mag: 7.7,
        magType: "mww",
        tsunami: 1,
        alert: "orange",
        status: "reviewed",
        felt: 1916,
        sig: 1790,
        url: "https://earthquake.usgs.gov/earthquakes/eventpage/us6000u18k",
      },
    }, Date.parse("2026-10-16T10:00:00Z"));

    expect(event?.sources[0]?.publishedAt).toBeUndefined();
    expect(event?.sources[0]?.updatedAt).toBe(Date.parse("2026-10-15T08:58:55Z"));
    expect(event?.sources[0]?.metadata).toMatchObject({
      depthKm: 12.647,
      tsunamiFlag: true,
      pagerAlert: "orange",
      reviewStatus: "reviewed",
      feltReports: 1916,
      significance: 1790,
    });
  });

  it("normalizes the live GDACS eventtype field and retains episode and severity metadata", () => {
    const event = normalizeGDACSFeature({
      type: "Feature",
      geometry: { type: "Point", coordinates: [-80.769, 7.5868] },
      properties: {
        eventtype: "EQ",
        eventid: 1570339,
        episodeid: 1738684,
        name: "Earthquake in Panama",
        country: "Panama",
        alertlevel: "Orange",
        fromdate: "2026-10-09T17:56:06",
        todate: "2026-10-09T17:56:06",
        datemodified: "2026-10-15T08:39:43",
        polygonlabel: "Centroid",
        Class: "Point_Centroid",
        source: "NEIC",
        url: { report: "https://www.gdacs.org/report.aspx?eventid=1570339&episodeid=1738684" },
        severitydata: { severity: 7.7, severitytext: "Magnitude 7.7M, Depth:12.647km", severityunit: "M" },
      },
    }, Date.parse("2026-10-16T10:00:00Z"));

    expect(event?.category).toBe("earthquake");
    expect(event?.locationPrecision).toBe("centroid");
    expect(event?.severityValue).toBe(7.7);
    expect(event?.sources[0]?.metadata).toMatchObject({
      eventType: "EQ",
      episodeId: "1738684",
      alertLevel: "Orange",
      severityUnit: "M",
      providerSource: "NEIC",
    });
  });

  it.each([
    ["EQ", "earthquake"], ["FL", "flood"], ["TC", "cyclone"], ["WF", "wildfire"],
    ["VO", "volcano"], ["TS", "tsunami"], ["DR", "drought"],
  ] as const)("maps GDACS eventtype %s to %s", (eventtype, category) => {
    const event = normalizeGDACSFeature({
      type: "Feature",
      geometry: { type: "Point", coordinates: [0, 0] },
      properties: { eventtype, eventid: eventtype, episodeid: 1, name: `${eventtype} fixture` },
    });
    expect(event?.category).toBe(category);
  });

  it("does not classify non-earthquake USGS ComCat types as earthquakes", () => {
    const event = normalizeUSGSFeature({
      id: "blast-fixture",
      geometry: { type: "Point", coordinates: [0, 0, 1] },
      properties: { type: "quarry blast", time: Date.parse("2026-10-16T00:00:00Z"), title: "Quarry blast fixture" },
    });
    expect(event?.category).toBe("other");
    expect(event?.sources[0]?.label).toBe("USGS quarry blast record");
  });

  it("pages USGS results beyond the first 1,000 records and retains the source tsunami metadata", async () => {
    const offsets: string[] = [];
    const makeFeature = (id: string) => ({
      type: "Feature",
      id,
      geometry: { type: "Point", coordinates: [-80.769, 7.5868, 12.647] },
      properties: { type: "earthquake", time: Date.parse("2026-10-09T17:56:06Z"), mag: 5, tsunami: 1 },
    });
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      offsets.push(url.searchParams.get("offset") ?? "");
      const features = url.searchParams.get("offset") === "1"
        ? Array.from({ length: 1_000 }, (_, index) => makeFeature(`usgs-${index}`))
        : [makeFeature("usgs-page-2")];
      return jsonResponse({ type: "FeatureCollection", metadata: { count: features.length }, features });
    }));

    const startAt = Date.parse("2026-10-09T17:00:00Z");
    const endAt = Date.parse("2026-10-09T19:00:00Z");
    const result = await fetchUSGS({ west: -81, south: 7, east: -80, north: 8 }, startAt, endAt);

    expect(offsets).toEqual(["1", "1001"]);
    expect(result.events).toHaveLength(1_001);
    expect(result.truncated).toBe(false);
    expect(result.events[1_000]?.sources[0]?.metadata?.tsunamiFlag).toBe(true);
  });

  it("uses paged GDACS search after area failure and filters the global fallback to the requested viewport", async () => {
    const urls: URL[] = [];
    const feature = (eventid: string, eventtype: string, longitude: number, latitude = 0) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [longitude, latitude] },
      properties: {
        eventtype,
        eventid,
        episodeid: 1,
        name: `${eventtype} fixture ${eventid}`,
        country: "Testland",
        alertlevel: "Orange",
        fromdate: "2026-10-09T17:56:06",
        todate: "2026-10-09T17:56:06",
        severitydata: { severity: 7.7, severitytext: "Magnitude 7.7M", severityunit: "M" },
      },
    });
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      urls.push(url);
      if (url.pathname.toLowerCase().endsWith("eventsbyarea")) return jsonResponse({ error: "area unavailable" }, 404);
      const page = url.searchParams.get("pageNumber");
      if (page === "1") {
        const firstPage = [feature("inside-eq", "EQ", 0), ...Array.from({ length: 99 }, (_, index) => feature(`outside-${index}`, "EQ", 80, 40))];
        return jsonResponse({ type: "FeatureCollection", features: firstPage });
      }
      return jsonResponse({ type: "FeatureCollection", features: [feature("inside-wildfire", "WF", 1)] });
    }));

    const startAt = Date.parse("2026-10-09T17:00:00Z");
    const endAt = Date.parse("2026-10-16T10:00:00Z");
    const result = await fetchGDACS({ west: -2, south: -2, east: 2, north: 2 }, startAt, endAt);
    const searchUrls = urls.filter(url => url.pathname.endsWith("/search"));

    expect(searchUrls).toHaveLength(2);
    expect(searchUrls[0]?.searchParams.get("eventlist")).toBe("EQ;FL;TC;WF;VO;TS;DR");
    expect(searchUrls[0]?.pathname).toBe("/gdacsapi/api/Events/geteventlist/search");
    expect(searchUrls[0]?.searchParams.get("fromDate")).toBe(new Date(startAt).toISOString());
    expect(searchUrls.map(url => url.searchParams.get("pageNumber"))).toEqual(["1", "2"]);
    expect(result.events.map(event => event.category).sort()).toEqual(["earthquake", "wildfire"]);
    expect(result.events).toHaveLength(2);
    expect(result.truncated).toBe(false);
    expect(result.message).toContain("time-bounded search");
  });

  it("uses area lookback days for recent ranges instead of treating the requested interval as an archive date", async () => {
    const urls: URL[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      urls.push(url);
      return jsonResponse({ type: "FeatureCollection", features: [] });
    }));
    const endAt = Date.now();
    const startAt = endAt - 24 * 60 * 60_000 - 30_000;
    const result = await fetchGDACS({ west: -2, south: -2, east: 2, north: 2 }, startAt, endAt);

    expect(urls).toHaveLength(1);
    expect(urls[0]?.pathname).toMatch(/\/eventsbyarea$/);
    expect(urls[0]?.searchParams.get("days")).toBe("2");
    expect(result.events).toEqual([]);
  });

  it("uses exact-date GDACS search for a historical range outside the rolling area window", async () => {
    const urls: URL[] = [];
    const endAt = Date.now() - 40 * 86_400_000;
    const startAt = endAt - 2 * 60 * 60_000;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      urls.push(url);
      if (!url.pathname.endsWith("/search")) return jsonResponse({ error: "rolling area is not historical" }, 500);
      return jsonResponse({
        type: "FeatureCollection",
        features: [{
          type: "Feature",
          geometry: { type: "Point", coordinates: [-80.769, 7.5868] },
          properties: { eventtype: "EQ", eventid: 1570339, episodeid: 1738684, name: "Earthquake in Panama", country: "Panama", fromdate: new Date(startAt + 60_000).toISOString(), severitydata: { severity: 7.7, severitytext: "Magnitude 7.7M", severityunit: "M" } },
        }],
      });
    }));

    const result = await fetchGDACS({ west: -81, south: 7, east: -80, north: 8 }, startAt, endAt);

    expect(urls).toHaveLength(1);
    expect(urls[0]?.pathname).toMatch(/\/search$/);
    expect(urls[0]?.searchParams.get("fromDate")).toBe(new Date(startAt).toISOString());
    expect(result.events).toHaveLength(1);
    expect(result.events[0]?.providerId).toBe("1570339");
    expect(result.message).toContain("historical window");
  });

  it("treats GDACS HTTP 204 from documented search as a successful empty result", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 204 })));
    const endAt = Date.now() - 40 * 86_400_000;
    const result = await fetchGDACS({ west: -2, south: -2, east: 2, north: 2 }, endAt - 86_400_000, endAt);
    expect(result.events).toEqual([]);
    expect(result.truncated).toBe(false);
    expect(result.message).toContain("time-bounded search");
  });

  it("stops paginated GDACS fallback work when its total time budget is exhausted", async () => {
    let now = Date.now();
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const searchPages: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/eventsbyarea")) return jsonResponse({ error: "area unavailable" }, 404);
      searchPages.push(url.searchParams.get("pageNumber") ?? "");
      now += 19_000;
      return jsonResponse({ type: "FeatureCollection", features: Array.from({ length: 100 }, () => ({})) });
    }));
    const endAt = now;

    await expect(fetchGDACS({ west: -2, south: -2, east: 2, north: 2 }, endAt - 4 * 60 * 60_000, endAt))
      .rejects.toThrow("GDACS search fallback exceeded its 18-second request budget");
    expect(searchPages).toEqual(["1"]);
  });

  it("intersects point and area geometry against ordinary and antimeridian viewports", () => {
    expect(geometryIntersectsViewport({ type: "Point", coordinates: [179, 10] }, { west: 170, south: -20, east: 190, north: 20 })).toBe(true);
    expect(geometryIntersectsViewport({ type: "Point", coordinates: [-179, 10] }, { west: 170, south: -20, east: 190, north: 20 })).toBe(true);
    expect(geometryIntersectsViewport({ type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] }, { west: -2, south: -2, east: 2, north: 2 })).toBe(true);
    expect(geometryIntersectsViewport({ type: "Polygon", coordinates: [[[179, 10], [-179, 10], [-179, 11], [179, 11], [179, 10]]] }, { west: 170, south: 0, east: 190, north: 20 })).toBe(true);
    expect(geometryIntersectsViewport({ type: "Polygon", coordinates: [[[179, 10], [-179, 10], [-179, 11], [179, 11], [179, 10]]] }, { west: -100, south: 0, east: -90, north: 20 })).toBe(false);
    expect(geometryIntersectsViewport({ type: "Point", coordinates: [20, 20] }, { west: -2, south: -2, east: 2, north: 2 })).toBe(false);
  });
});
