import { createHash } from "node:crypto";
import { and, desc, eq, gte, lte, like, or, sql } from "drizzle-orm";
import type { ProviderHealth, SatnavEvent, SatnavProvider, SatnavSourceRef, ViewportBounds } from "@shared/satnav";
import { satnavAiExplanations, satnavClusters, satnavEvents, satnavEventSources, satnavProviderStatus } from "../../drizzle/schema";
import { getDb } from "../db";
import { splitViewport } from "./geo";

const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const date = (value?: number) => value === undefined ? null : new Date(value);
const chunk = <T>(items: T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
};

function mapEventRow(row: typeof satnavEvents.$inferSelect): SatnavEvent {
  return {
    id: row.id,
    clusterId: row.clusterId,
    providerId: row.providerId,
    category: row.category,
    title: row.title,
    ...(row.description ? { description: row.description } : {}),
    ...(row.locationLabel ? { locationLabel: row.locationLabel } : {}),
    ...(row.country ? { country: row.country } : {}),
    ...(row.longitude !== null ? { longitude: row.longitude } : {}),
    ...(row.latitude !== null ? { latitude: row.latitude } : {}),
    ...(row.geometry ? { geometry: row.geometry } : {}),
    locationPrecision: row.locationPrecision as SatnavEvent["locationPrecision"],
    status: row.status as SatnavEvent["status"],
    verification: row.verification as SatnavEvent["verification"],
    ...(row.severityLabel ? { severityLabel: row.severityLabel } : {}),
    ...(row.severityValue !== null ? { severityValue: row.severityValue } : {}),
    ...(row.severityScale ? { severityScale: row.severityScale } : {}),
    ...(row.eventStart ? { startTime: row.eventStart.getTime() } : {}),
    ...(row.eventEnd ? { endTime: row.eventEnd.getTime() } : {}),
    ...(row.publishedAt ? { publishedAt: row.publishedAt.getTime() } : {}),
    ...(row.providerUpdatedAt ? { providerUpdatedAt: row.providerUpdatedAt.getTime() } : {}),
    fetchedAt: row.fetchedAt.getTime(),
    sources: row.sources ?? [],
    relatedArticles: row.relatedArticles ?? [],
    sourceCount: row.sourceCount,
  };
}

export async function persistEvents(events: SatnavEvent[]): Promise<boolean> {
  if (!events.length) return true;
  const db = await getDb();
  if (!db) return false;

  const uniqueEvents = [...new Map(events.map(event => [event.id, event])).values()];
  const grouped = new Map<string, SatnavEvent[]>();
  for (const event of uniqueEvents) {
    const group = grouped.get(event.clusterId) ?? [];
    group.push(event);
    grouped.set(event.clusterId, group);
  }
  const clusters = [...grouped.entries()].map(([id, members]) => {
    const times = members.map(event => event.startTime).filter((value): value is number => value !== undefined);
    const first = members[0]!;
    return {
      id,
      category: first.category,
      title: first.title,
      longitude: first.longitude ?? null,
      latitude: first.latitude ?? null,
      startTime: times.length ? new Date(Math.min(...times)) : null,
      endTime: members.some(event => event.endTime !== undefined) ? new Date(Math.max(...members.map(event => event.endTime ?? 0))) : null,
      memberCount: members.length,
    };
  });
  const eventRows = uniqueEvents.map(event => ({
    id: event.id,
    clusterId: event.clusterId,
    provider: event.sources[0]?.provider ?? "usgs" as SatnavProvider,
    providerId: event.providerId,
    title: event.title,
    description: event.description ?? null,
    category: event.category,
    locationLabel: event.locationLabel ?? null,
    country: event.country ?? null,
    longitude: event.longitude ?? null,
    latitude: event.latitude ?? null,
    geometry: event.geometry ?? null,
    locationPrecision: event.locationPrecision,
    status: event.status,
    verification: event.verification,
    severityLabel: event.severityLabel ?? null,
    severityValue: event.severityValue ?? null,
    severityScale: event.severityScale ?? null,
    eventStart: date(event.startTime),
    eventEnd: date(event.endTime),
    publishedAt: date(event.publishedAt),
    providerUpdatedAt: date(event.providerUpdatedAt),
    fetchedAt: new Date(event.fetchedAt),
    sources: event.sources,
    relatedArticles: event.relatedArticles ?? [],
    sourceCount: event.sourceCount,
  }));
  const sourceRows = uniqueEvents.flatMap(event => event.sources.map(source => ({
    id: digest(`${event.id}:${source.provider}:${source.providerId ?? ""}`),
    eventId: event.id,
    provider: source.provider,
    providerId: source.providerId ?? event.providerId,
    label: source.label,
    publisher: source.publisher ?? null,
    url: source.url ?? null,
    attribution: source.attribution,
    publishedAt: date(source.publishedAt),
    updatedAt: date(source.updatedAt),
    fetchedAt: new Date(event.fetchedAt),
    metadata: source.metadata ?? null,
  })));

  await db.transaction(async tx => {
    for (const rows of chunk(clusters, 100)) {
      await tx.insert(satnavClusters).values(rows).onDuplicateKeyUpdate({ set: {
        category: sql`VALUES(${satnavClusters.category})`,
        title: sql`VALUES(${satnavClusters.title})`,
        longitude: sql`VALUES(${satnavClusters.longitude})`,
        latitude: sql`VALUES(${satnavClusters.latitude})`,
        startTime: sql`VALUES(${satnavClusters.startTime})`,
        endTime: sql`VALUES(${satnavClusters.endTime})`,
        memberCount: sql`VALUES(${satnavClusters.memberCount})`,
        updatedAt: new Date(),
      } });
    }
    for (const rows of chunk(eventRows, 100)) {
      await tx.insert(satnavEvents).values(rows).onDuplicateKeyUpdate({ set: {
        clusterId: sql`VALUES(${satnavEvents.clusterId})`,
        title: sql`VALUES(${satnavEvents.title})`,
        description: sql`VALUES(${satnavEvents.description})`,
        category: sql`VALUES(${satnavEvents.category})`,
        locationLabel: sql`VALUES(${satnavEvents.locationLabel})`,
        country: sql`VALUES(${satnavEvents.country})`,
        longitude: sql`VALUES(${satnavEvents.longitude})`,
        latitude: sql`VALUES(${satnavEvents.latitude})`,
        geometry: sql`VALUES(${satnavEvents.geometry})`,
        locationPrecision: sql`VALUES(${satnavEvents.locationPrecision})`,
        status: sql`VALUES(${satnavEvents.status})`,
        verification: sql`VALUES(${satnavEvents.verification})`,
        severityLabel: sql`VALUES(${satnavEvents.severityLabel})`,
        severityValue: sql`VALUES(${satnavEvents.severityValue})`,
        severityScale: sql`VALUES(${satnavEvents.severityScale})`,
        eventStart: sql`VALUES(${satnavEvents.eventStart})`,
        eventEnd: sql`VALUES(${satnavEvents.eventEnd})`,
        publishedAt: sql`VALUES(${satnavEvents.publishedAt})`,
        providerUpdatedAt: sql`VALUES(${satnavEvents.providerUpdatedAt})`,
        fetchedAt: sql`VALUES(${satnavEvents.fetchedAt})`,
        sources: sql`VALUES(${satnavEvents.sources})`,
        relatedArticles: sql`VALUES(${satnavEvents.relatedArticles})`,
        sourceCount: sql`VALUES(${satnavEvents.sourceCount})`,
      } });
    }
    for (const rows of chunk(sourceRows, 100)) {
      await tx.insert(satnavEventSources).values(rows).onDuplicateKeyUpdate({ set: {
        label: sql`VALUES(${satnavEventSources.label})`,
        publisher: sql`VALUES(${satnavEventSources.publisher})`,
        url: sql`VALUES(${satnavEventSources.url})`,
        attribution: sql`VALUES(${satnavEventSources.attribution})`,
        publishedAt: sql`VALUES(${satnavEventSources.publishedAt})`,
        updatedAt: sql`VALUES(${satnavEventSources.updatedAt})`,
        fetchedAt: sql`VALUES(${satnavEventSources.fetchedAt})`,
        metadata: sql`VALUES(${satnavEventSources.metadata})`,
      } });
    }
  });
  return true;
}

export async function persistProviderHealth(health: ProviderHealth[]): Promise<void> {
  const db = await getDb();
  if (!db || !health.length) return;
  const rows = health.map(item => ({
    provider: item.provider,
    state: item.state,
    lastAttemptAt: date(item.lastAttemptAt),
    lastSuccessAt: date(item.lastSuccessAt),
    itemCount: item.itemCount,
    message: item.message ?? null,
    coverageNote: item.coverageNote,
  }));
  await db.insert(satnavProviderStatus).values(rows).onDuplicateKeyUpdate({ set: {
    state: sql`VALUES(${satnavProviderStatus.state})`,
    lastAttemptAt: sql`VALUES(${satnavProviderStatus.lastAttemptAt})`,
    lastSuccessAt: sql`VALUES(${satnavProviderStatus.lastSuccessAt})`,
    itemCount: sql`VALUES(${satnavProviderStatus.itemCount})`,
    message: sql`VALUES(${satnavProviderStatus.message})`,
    coverageNote: sql`VALUES(${satnavProviderStatus.coverageNote})`,
    updatedAt: new Date(),
  } });
}

export async function loadStoredEvents(bounds: ViewportBounds, startAt: number, endAt: number, limit = 500): Promise<SatnavEvent[]> {
  const db = await getDb();
  if (!db) return [];
  const start = new Date(startAt);
  const end = new Date(endAt);
  const condition = or(
    and(gte(satnavEvents.eventStart, start), lte(satnavEvents.eventStart, end)),
    and(lte(satnavEvents.eventStart, start), gte(satnavEvents.eventEnd, start)),
  );
  if (!condition) return [];
  const rows = await db.select().from(satnavEvents).where(condition).orderBy(desc(satnavEvents.eventStart)).limit(Math.min(1000, Math.max(1, limit)));
  const parts = splitViewport(bounds);
  return rows.filter(row => row.longitude !== null && row.latitude !== null && parts.some(part =>
    row.longitude! >= part.west && row.longitude! <= part.east && row.latitude! >= part.south && row.latitude! <= part.north,
  )).map(mapEventRow);
}

export async function getStoredEventById(id: string): Promise<SatnavEvent | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db.select().from(satnavEvents).where(eq(satnavEvents.id, id)).limit(1);
  return rows[0] ? mapEventRow(rows[0]) : undefined;
}

export async function searchStoredEvents(query: string, limit = 25, now = Date.now()): Promise<SatnavEvent[]> {
  const db = await getDb();
  const clean = query.trim().replace(/[\\%_]/g, "\\$&");
  if (!db || clean.length < 2) return [];
  const pattern = `%${clean}%`;
  const rows = await db.select().from(satnavEvents).where(and(
    or(
      like(satnavEvents.title, pattern),
      like(satnavEvents.locationLabel, pattern),
      like(satnavEvents.country, pattern),
    ),
    gte(satnavEvents.eventStart, new Date(now - 365 * 86_400_000)),
  )).orderBy(desc(satnavEvents.eventStart)).limit(Math.min(50, Math.max(1, limit)));
  return rows.map(mapEventRow);
}

export async function getCachedExplanation(eventId: string, action: string, now = Date.now()): Promise<{ content: string; model: string; createdAt: number; citations: SatnavSourceRef[] } | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db.select().from(satnavAiExplanations).where(and(
    eq(satnavAiExplanations.eventId, eventId),
    eq(satnavAiExplanations.action, action),
    gte(satnavAiExplanations.expiresAt, new Date(now)),
  )).orderBy(desc(satnavAiExplanations.createdAt)).limit(1);
  const row = rows[0];
  return row ? { content: row.content, model: row.model, createdAt: row.createdAt.getTime(), citations: row.citations ?? [] } : undefined;
}

export async function persistExplanation(input: { eventId: string; action: string; model: string; content: string; citations: SatnavSourceRef[]; createdAt?: number; expiresAt?: number }): Promise<void> {
  const db = await getDb();
  if (!db) return;
  const createdAt = input.createdAt ?? Date.now();
  await db.insert(satnavAiExplanations).values({
    id: digest(`${input.eventId}:${input.action}:${createdAt}`),
    eventId: input.eventId,
    action: input.action,
    model: input.model,
    content: input.content,
    citations: input.citations,
    createdAt: new Date(createdAt),
    expiresAt: new Date(input.expiresAt ?? createdAt + 6 * 60 * 60 * 1000),
  });
}

export async function loadProviderHealth(): Promise<ProviderHealth[]> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select().from(satnavProviderStatus);
  return rows.map(row => ({
    provider: row.provider,
    label: row.provider === "usgs" ? "USGS earthquakes" : row.provider === "gdacs" ? "GDACS disasters" : row.provider === "gdelt" ? "GDELT news" : "Location search",
    state: row.state as ProviderHealth["state"],
    ...(row.lastAttemptAt ? { lastAttemptAt: row.lastAttemptAt.getTime() } : {}),
    ...(row.lastSuccessAt ? { lastSuccessAt: row.lastSuccessAt.getTime() } : {}),
    itemCount: row.itemCount,
    ...(row.message ? { message: row.message } : {}),
    coverageNote: row.coverageNote,
  }));
}
