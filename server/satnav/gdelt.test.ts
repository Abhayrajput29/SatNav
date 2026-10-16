import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchGDELT } from "./gdelt";

afterEach(() => vi.unstubAllGlobals());

describe("GDELT relative-window coverage", () => {
  it("does not substitute recent articles for a selected historical interval", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const startAt = Date.parse("2026-10-09T17:00:00Z");
    const endAt = Date.parse("2026-10-09T19:00:00Z");

    await expect(fetchGDELT({ west: -81, south: 7, east: -80, north: 8 }, startAt, endAt))
      .rejects.toThrow("GDELT_HISTORICAL_WINDOW_UNSUPPORTED");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends a bounded timespan instead of relying on DOC's broad default search window", async () => {
    let requestedUrl: URL | undefined;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      requestedUrl = new URL(String(input));
      return new Response(JSON.stringify({ articles: [] }), { status: 200, headers: { "content-type": "application/json" } });
    }));
    const endAt = Date.now();
    await fetchGDELT({ west: -10, south: -10, east: 10, north: 10 }, endAt - 60 * 60_000, endAt);
    expect(requestedUrl?.searchParams.get("timespan")).toBe("60min");
    expect(requestedUrl?.searchParams.get("maxrecords")).toBe("75");
  });

  it("does not treat a JSON error object as a successful empty article response", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "temporarily unavailable" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })));
    const endAt = Date.now();
    await expect(fetchGDELT({ west: -10, south: -10, east: 10, north: 10 }, endAt - 60 * 60_000, endAt))
      .rejects.toThrow("GDELT returned an invalid article response");
  });
});
