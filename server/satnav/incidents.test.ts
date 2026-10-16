import { describe, expect, it } from "vitest";
import type { SatnavEvent, SatnavProvider } from "@shared/satnav";
import { reconcileCrossProviderIncidents } from "./incidents";

const t0 = Date.parse("2026-10-09T17:56:06Z");

function event(input: {
  id: string;
  provider: SatnavProvider;
  providerId: string;
  longitude?: number;
  latitude?: number;
  startTime?: number;
  magnitude?: number;
  magnitudeScale?: string;
  category?: SatnavEvent["category"];
}): SatnavEvent {
  const { id, provider, providerId, longitude, latitude, startTime, magnitude, magnitudeScale, category = "earthquake" } = input;
  return {
    id,
    clusterId: `${provider}:${providerId}`,
    providerId,
    category,
    title: `${provider.toUpperCase()} earthquake fixture`,
    ...(longitude !== undefined ? { longitude } : {}),
    ...(latitude !== undefined ? { latitude } : {}),
    ...(longitude !== undefined && latitude !== undefined ? { geometry: { type: "Point", coordinates: [longitude, latitude] } } : {}),
    locationPrecision: provider === "gdacs" ? "centroid" : "point",
    status: provider === "gdacs" ? "alert" : "observed",
    verification: provider === "usgs" ? "official-feed" : "single-source",
    ...(magnitude !== undefined ? { severityValue: magnitude, severityLabel: `M ${magnitude}`, severityScale: magnitudeScale ?? (provider === "usgs" ? "mww" : "M") } : {}),
    ...(startTime !== undefined ? { startTime } : {}),
    fetchedAt: t0 + 60_000,
    sources: [{ provider, providerId, label: `${provider.toUpperCase()} record`, attribution: "Test fixture only" }],
    sourceCount: 1,
  };
}

function matchPair(overrides: { usgs?: Partial<Parameters<typeof event>[0]>; gdacs?: Partial<Parameters<typeof event>[0]> } = {}) {
  return [
    event({ id: "usgs:us6000u18k", provider: "usgs", providerId: "us6000u18k", longitude: -80.769, latitude: 7.5868, startTime: t0, magnitude: 7.7, ...overrides.usgs }),
    event({ id: "gdacs:1570339:1738684", provider: "gdacs", providerId: "1570339", longitude: -80.769, latitude: 7.5868, startTime: t0, magnitude: 7.7, ...overrides.gdacs }),
  ];
}

describe("cross-provider incident reconciliation", () => {
  it("collapses an exact USGS/GDACS earthquake match while retaining both raw records and claims", () => {
    const input = matchPair();
    const result = reconcileCrossProviderIncidents(input);

    expect(result.records).toHaveLength(2);
    expect(result.records.map(item => item.clusterId)).toEqual(["incident:usgs:us6000u18k", "incident:usgs:us6000u18k"]);
    expect(result.incidents).toHaveLength(1);
    expect(result.incidents[0]?.id).toBe("usgs:us6000u18k");
    expect(result.incidents[0]?.sourceCount).toBe(2);
    expect(result.incidents[0]?.sources.map(source => source.provider).sort()).toEqual(["gdacs", "usgs"]);
    expect(result.incidents[0]?.incidentMembers?.map(member => member.provider).sort()).toEqual(["gdacs", "usgs"]);
    expect(result.incidents[0]?.verification).toBe("official-feed");
  });

  it.each([
    ["distant point", { gdacs: { longitude: -80.4 } }],
    ["late separate event", { gdacs: { startTime: t0 + 16 * 60_000 } }],
    ["different reported magnitude", { gdacs: { magnitude: 6.5 } }],
    ["incompatible severity unit", { gdacs: { startTime: t0 + 5 * 60_000, magnitudeScale: "km" } }],
    ["missing source time", { gdacs: { startTime: undefined } }],
    ["missing source coordinates", { gdacs: { longitude: undefined, latitude: undefined } }],
  ] as const)("does not merge a %s", (_label, overrides) => {
    const result = reconcileCrossProviderIncidents(matchPair(overrides));
    expect(result.incidents).toHaveLength(2);
    expect(result.incidents.every(item => !item.incidentMembers)).toBe(true);
  });

  it("keeps news article centroids and different hazard categories out of earthquake matching", () => {
    const [usgs, gdacs] = matchPair();
    const news = event({ id: "gdelt:story", provider: "gdelt", providerId: "story", longitude: -80.769, latitude: 7.5868, startTime: t0, category: "news" });
    const differentCategory = { ...gdacs!, id: "gdacs:flood", category: "flood" as const };

    expect(reconcileCrossProviderIncidents([usgs!, news]).incidents).toHaveLength(2);
    expect(reconcileCrossProviderIncidents([usgs!, differentCategory]).incidents).toHaveLength(2);
  });

  it("matches one GDACS event only to its closest USGS candidate", () => {
    const [usgs] = matchPair({ usgs: { startTime: t0 + 30_000 } });
    const closer = event({ id: "usgs:closer", provider: "usgs", providerId: "closer", longitude: -80.769, latitude: 7.5868, startTime: t0, magnitude: 7.7 });
    const gdacs = event({ id: "gdacs:1570339:1738684", provider: "gdacs", providerId: "1570339", longitude: -80.769, latitude: 7.5868, startTime: t0, magnitude: 7.7 });
    const result = reconcileCrossProviderIncidents([usgs!, closer, gdacs]);

    expect(result.incidents).toHaveLength(2);
    expect(result.incidents.find(item => item.id === "usgs:closer")?.incidentMembers).toHaveLength(2);
    expect(result.incidents.find(item => item.id === "usgs:us6000u18k")?.incidentMembers).toBeUndefined();
  });
});
