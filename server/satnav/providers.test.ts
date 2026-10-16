import { describe, expect, it } from "vitest";
import { splitViewport, viewportToWkt } from "./geo";
import { normalizeGDACSFeature, normalizeUSGSFeature } from "./providers";

describe("SATNAV provider normalization", () => {
  it("preserves USGS magnitude scale, source link, point and UTC event time", () => {
    const event = normalizeUSGSFeature({
      id: "us6000u2ev",
      type: "Feature",
      geometry: { type: "Point", coordinates: [175.3814, -38.5478, 286.008] },
      properties: {
        title: "M 5.3 - 43 km SSE of Otorohanga, New Zealand",
        place: "43 km SSE of Otorohanga, New Zealand",
        time: 1792041931942,
        updated: 1792049502327,
        mag: 5.3,
        magType: "mww",
        url: "https://earthquake.usgs.gov/earthquakes/eventpage/us6000u2ev",
        status: "reviewed",
      },
    }, 1792050000000);

    expect(event?.category).toBe("earthquake");
    expect(event?.longitude).toBe(175.3814);
    expect(event?.latitude).toBe(-38.5478);
    expect(event?.locationPrecision).toBe("point");
    expect(event?.severityLabel).toBe("M 5.3 mww");
    expect(event?.severityScale).toBe("mww");
    expect(event?.startTime).toBe(1792041931942);
    expect(event?.sources[0]?.url).toBe("https://earthquake.usgs.gov/earthquakes/eventpage/us6000u2ev");
  });

  it("labels GDACS source centroids as approximate and retains alert level without normalizing its scale", () => {
    const event = normalizeGDACSFeature({
      type: "Feature",
      geometry: { type: "Point", coordinates: [7.2272, 8.8796] },
      properties: {
        "event type": "FL",
        eventid: 1104186,
        episodeid: 8,
        name: "Flood in Nigeria",
        country: "Nigeria",
        alertlevel: "Green",
        fromdate: "2026-09-21T01:00:00",
        todate: "2026-10-07T01:00:00",
        datemodified: "2026-10-07T10:24:15",
        polygonlabel: "Centroid",
        Class: "Point_Centroid",
        url: { report: "https://www.gdacs.org/report.aspx?eventid=1104186" },
        severitydata: { severity: 0, severitytext: "Magnitude 0", severityunit: "" },
      },
    }, 1792050000000);

    expect(event?.category).toBe("flood");
    expect(event?.locationPrecision).toBe("centroid");
    expect(event?.status).toBe("alert");
    expect(event?.verification).toBe("single-source");
    expect(event?.severityLabel).toBe("Green GDACS alert");
    expect(event?.country).toBe("Nigeria");
    expect(event?.id).toBe("gdacs:1104186:8");
    expect(event?.startTime).toBe(Date.parse("2026-09-21T01:00:00Z"));
  });

  it("rejects invalid event coordinates rather than plotting them", () => {
    expect(normalizeUSGSFeature({
      id: "bad-coordinate",
      geometry: { type: "Point", coordinates: [200, 100] },
      properties: { time: 1, mag: 4 },
    })).toBeUndefined();
  });
});

describe("SATNAV viewport geography", () => {
  it("splits a viewport crossing the international date line", () => {
    expect(splitViewport({ west: 170, south: -15, east: 190, north: 15 })).toEqual([
      { west: 170, east: 180, south: -15, north: 15 },
      { west: -180, east: -170, south: -15, north: 15 },
    ]);
  });

  it("uses a global longitude query for a world view and builds WKT in longitude/latitude order", () => {
    expect(splitViewport({ west: -200, south: -90, east: 200, north: 90 })).toEqual([
      { west: -180, east: 180, south: -90, north: 90 },
    ]);
    expect(viewportToWkt({ west: -10, south: -20, east: 10, north: 20 })).toBe(
      "POLYGON((-10 -20,10 -20,10 20,-10 20,-10 -20))",
    );
  });
});
