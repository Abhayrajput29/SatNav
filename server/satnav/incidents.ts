import type { IncidentMember, SatnavEvent, SatnavSourceRef } from "@shared/satnav";
import { haversineKm } from "./geo";

const MINUTE_MS = 60_000;
const MAGNITUDE_TOLERANCE = 0.6;
const MAGNITUDE_MATCH_DISTANCE_KM = 40;
const MAGNITUDE_MATCH_TIME_MS = 15 * MINUTE_MS;
const MISSING_MAGNITUDE_DISTANCE_KM = 5;
const MISSING_MAGNITUDE_TIME_MS = 2 * MINUTE_MS;

interface Candidate {
  usgs: SatnavEvent;
  gdacsProviderId: string;
  gdacsMembers: SatnavEvent[];
  score: number;
}

function eventProvider(event: SatnavEvent): string | undefined {
  return event.sources[0]?.provider;
}

function baseClusterId(event: SatnavEvent): string {
  const provider = eventProvider(event);
  if (provider === "usgs") return `usgs:${event.providerId}`;
  if (provider === "gdacs") return `gdacs:${event.providerId}`;
  if (provider === "gdelt") return event.id;
  return event.clusterId;
}

function isMagnitudeScale(scale: string | undefined): boolean {
  return Boolean(scale && /^(?:m|magnitude|usgs magnitude|mw|mww|mwr|mwb|mwc|mwp|mb|mb_lg|ms|ml|md|mn|mc|mlg)$/i.test(scale.trim()));
}

function eventMatchScore(usgs: SatnavEvent, gdacs: SatnavEvent): number | undefined {
  if (usgs.category !== "earthquake" || gdacs.category !== "earthquake") return undefined;
  if (usgs.longitude === undefined || usgs.latitude === undefined || gdacs.longitude === undefined || gdacs.latitude === undefined) return undefined;
  if (usgs.startTime === undefined || gdacs.startTime === undefined) return undefined;

  const timeDelta = Math.abs(usgs.startTime - gdacs.startTime);
  const distanceKm = haversineKm(
    { longitude: usgs.longitude, latitude: usgs.latitude },
    { longitude: gdacs.longitude, latitude: gdacs.latitude },
  );
  const hasBothMagnitudes = usgs.severityValue !== undefined && gdacs.severityValue !== undefined && isMagnitudeScale(usgs.severityScale) && isMagnitudeScale(gdacs.severityScale);

  if (hasBothMagnitudes) {
    const magnitudeDelta = Math.abs(usgs.severityValue! - gdacs.severityValue!);
    if (magnitudeDelta > MAGNITUDE_TOLERANCE || distanceKm > MAGNITUDE_MATCH_DISTANCE_KM || timeDelta > MAGNITUDE_MATCH_TIME_MS) return undefined;
    return distanceKm / MAGNITUDE_MATCH_DISTANCE_KM + timeDelta / MAGNITUDE_MATCH_TIME_MS + magnitudeDelta / MAGNITUDE_TOLERANCE;
  }

  if (distanceKm > MISSING_MAGNITUDE_DISTANCE_KM || timeDelta > MISSING_MAGNITUDE_TIME_MS) return undefined;
  return distanceKm / MISSING_MAGNITUDE_DISTANCE_KM + timeDelta / MISSING_MAGNITUDE_TIME_MS;
}

function toMember(event: SatnavEvent): IncidentMember {
  return {
    id: event.id,
    provider: eventProvider(event) as IncidentMember["provider"],
    providerId: event.providerId,
    title: event.title,
    ...(event.locationLabel ? { locationLabel: event.locationLabel } : {}),
    ...(event.country ? { country: event.country } : {}),
    ...(event.longitude !== undefined ? { longitude: event.longitude } : {}),
    ...(event.latitude !== undefined ? { latitude: event.latitude } : {}),
    locationPrecision: event.locationPrecision,
    ...(event.startTime !== undefined ? { startTime: event.startTime } : {}),
    ...(event.endTime !== undefined ? { endTime: event.endTime } : {}),
    ...(event.severityLabel ? { severityLabel: event.severityLabel } : {}),
    ...(event.severityValue !== undefined ? { severityValue: event.severityValue } : {}),
    ...(event.severityScale ? { severityScale: event.severityScale } : {}),
  };
}

function uniqueSources(events: SatnavEvent[]): SatnavSourceRef[] {
  const byKey = new Map<string, SatnavSourceRef>();
  for (const event of events) {
    for (const source of event.sources) {
      const key = [source.provider, source.providerId ?? "", source.url ?? "", source.publishedAt ?? "", source.metadata?.episodeId ?? ""].join("|");
      if (!byKey.has(key)) byKey.set(key, source);
    }
  }
  return [...byKey.values()];
}

function mergeMembers(members: SatnavEvent[], clusterId: string): SatnavEvent {
  const ordered = [...members].sort((a, b) => {
    const aPriority = eventProvider(a) === "usgs" ? 0 : 1;
    const bPriority = eventProvider(b) === "usgs" ? 0 : 1;
    return aPriority - bPriority || (a.startTime ?? 0) - (b.startTime ?? 0) || a.id.localeCompare(b.id);
  });
  const representative = ordered[0]!;
  const sources = uniqueSources(ordered);
  const relatedArticles = [...new Map(ordered.flatMap(event => event.relatedArticles ?? []).map(article => [article.id, article])).values()];
  return {
    ...representative,
    clusterId,
    fetchedAt: Math.max(...ordered.map(event => event.fetchedAt)),
    sources,
    relatedArticles,
    sourceCount: sources.length,
    incidentMembers: ordered.map(toMember),
  };
}

/**
 * Link only high-precision USGS/GDACS earthquake matches. News article centroids
 * and unrelated hazard categories are deliberately excluded. Source records
 * remain separate in `records`; the map receives one representative per match.
 */
export function reconcileCrossProviderIncidents(input: SatnavEvent[]): { records: SatnavEvent[]; incidents: SatnavEvent[] } {
  const byId = new Map<string, SatnavEvent>();
  for (const event of input) {
    const previous = byId.get(event.id);
    if (!previous || event.fetchedAt >= previous.fetchedAt) byId.set(event.id, event);
  }
  const records = [...byId.values()].map(event => ({ ...event, clusterId: baseClusterId(event) }));
  const usgsEvents = records.filter(event => eventProvider(event) === "usgs" && event.category === "earthquake");
  const gdacsGroups = new Map<string, SatnavEvent[]>();
  for (const event of records) {
    if (eventProvider(event) !== "gdacs" || event.category !== "earthquake") continue;
    const group = gdacsGroups.get(event.providerId) ?? [];
    group.push(event);
    gdacsGroups.set(event.providerId, group);
  }

  const candidates: Candidate[] = [];
  for (const usgs of usgsEvents) {
    for (const [gdacsProviderId, gdacsMembers] of gdacsGroups) {
      let bestScore = Infinity;
      for (const gdacs of gdacsMembers) {
        const score = eventMatchScore(usgs, gdacs);
        if (score !== undefined) bestScore = Math.min(bestScore, score);
      }
      if (Number.isFinite(bestScore)) candidates.push({ usgs, gdacsProviderId, gdacsMembers, score: bestScore });
    }
  }
  candidates.sort((a, b) => a.score - b.score || a.usgs.id.localeCompare(b.usgs.id) || a.gdacsProviderId.localeCompare(b.gdacsProviderId));

  const usedUsgs = new Set<string>();
  const usedGdacs = new Set<string>();
  const matchedIds = new Set<string>();
  const mergedByCluster = new Map<string, SatnavEvent>();
  const clusterByEventId = new Map<string, string>();
  for (const candidate of candidates) {
    if (usedUsgs.has(candidate.usgs.id) || usedGdacs.has(candidate.gdacsProviderId)) continue;
    usedUsgs.add(candidate.usgs.id);
    usedGdacs.add(candidate.gdacsProviderId);
    const clusterId = `incident:${candidate.usgs.id}`;
    const members = [candidate.usgs, ...candidate.gdacsMembers];
    mergedByCluster.set(clusterId, mergeMembers(members, clusterId));
    for (const member of members) {
      matchedIds.add(member.id);
      clusterByEventId.set(member.id, clusterId);
    }
  }

  const clusteredRecords = records.map(event => {
    const clusterId = clusterByEventId.get(event.id);
    return clusterId ? { ...event, clusterId } : event;
  });
  const incidents: SatnavEvent[] = [];
  const emitted = new Set<string>();
  for (const event of clusteredRecords) {
    if (!matchedIds.has(event.id)) {
      incidents.push(event);
      continue;
    }
    const clusterId = clusterByEventId.get(event.id)!;
    if (emitted.has(clusterId)) continue;
    emitted.add(clusterId);
    incidents.push(mergedByCluster.get(clusterId)!);
  }
  return { records: clusteredRecords, incidents };
}
