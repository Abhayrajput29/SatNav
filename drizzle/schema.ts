import { double, index, int, json, mysqlEnum, mysqlTable, text, timestamp, uniqueIndex, varchar } from "drizzle-orm/mysql-core";
import type { RelatedArticle, SatnavCategory, SatnavGeometry, SatnavProvider, SatnavSourceRef } from "@shared/satnav";

/**
 * Core user table backing the existing OAuth flow. Do not repurpose or alter its rows.
 */
export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export const satnavClusters = mysqlTable("satnav_clusters", {
  id: varchar("id", { length: 191 }).primaryKey(),
  category: varchar("category", { length: 32 }).$type<SatnavCategory>().notNull(),
  title: text("title").notNull(),
  longitude: double("longitude"),
  latitude: double("latitude"),
  startTime: timestamp("startTime"),
  endTime: timestamp("endTime"),
  memberCount: int("memberCount").default(1).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, table => ({
  categoryTime: index("satnav_cluster_category_time_idx").on(table.category, table.startTime),
}));

export const satnavEvents = mysqlTable("satnav_events", {
  id: varchar("id", { length: 191 }).primaryKey(),
  clusterId: varchar("clusterId", { length: 191 }).notNull().references(() => satnavClusters.id, { onDelete: "cascade" }),
  provider: varchar("provider", { length: 16 }).$type<SatnavProvider>().notNull(),
  providerId: varchar("providerId", { length: 191 }).notNull(),
  title: text("title").notNull(),
  description: text("description"),
  category: varchar("category", { length: 32 }).$type<SatnavCategory>().notNull(),
  locationLabel: varchar("locationLabel", { length: 512 }),
  country: varchar("country", { length: 128 }),
  longitude: double("longitude"),
  latitude: double("latitude"),
  geometry: json("geometry").$type<SatnavGeometry | null>(),
  locationPrecision: varchar("locationPrecision", { length: 20 }).notNull(),
  status: varchar("status", { length: 20 }).notNull(),
  verification: varchar("verification", { length: 32 }).notNull(),
  severityLabel: varchar("severityLabel", { length: 191 }),
  severityValue: double("severityValue"),
  severityScale: varchar("severityScale", { length: 64 }),
  eventStart: timestamp("eventStart"),
  eventEnd: timestamp("eventEnd"),
  publishedAt: timestamp("publishedAt"),
  providerUpdatedAt: timestamp("providerUpdatedAt"),
  fetchedAt: timestamp("fetchedAt").notNull(),
  sources: json("sources").$type<SatnavSourceRef[]>().notNull(),
  relatedArticles: json("relatedArticles").$type<RelatedArticle[]>().notNull(),
  sourceCount: int("sourceCount").default(1).notNull(),
}, table => ({
  providerEvent: uniqueIndex("satnav_provider_event_idx").on(table.provider, table.providerId, table.id),
  categoryTime: index("satnav_event_category_time_idx").on(table.category, table.eventStart),
  pointTime: index("satnav_event_point_time_idx").on(table.latitude, table.longitude, table.eventStart),
  cluster: index("satnav_event_cluster_idx").on(table.clusterId),
}));

export const satnavEventSources = mysqlTable("satnav_event_sources", {
  id: varchar("id", { length: 64 }).primaryKey(),
  eventId: varchar("eventId", { length: 191 }).notNull().references(() => satnavEvents.id, { onDelete: "cascade" }),
  provider: varchar("provider", { length: 16 }).$type<SatnavProvider>().notNull(),
  providerId: varchar("providerId", { length: 191 }).notNull(),
  label: varchar("label", { length: 255 }).notNull(),
  publisher: varchar("publisher", { length: 255 }),
  url: varchar("url", { length: 2048 }),
  attribution: text("attribution").notNull(),
  publishedAt: timestamp("publishedAt"),
  updatedAt: timestamp("updatedAt"),
  fetchedAt: timestamp("fetchedAt").notNull(),
  metadata: json("metadata").$type<Record<string, unknown> | null>(),
}, table => ({
  event: index("satnav_source_event_idx").on(table.eventId),
  provider: index("satnav_source_provider_idx").on(table.provider, table.providerId),
}));

export const satnavAiExplanations = mysqlTable("satnav_ai_explanations", {
  id: varchar("id", { length: 64 }).primaryKey(),
  eventId: varchar("eventId", { length: 191 }).notNull().references(() => satnavEvents.id, { onDelete: "cascade" }),
  action: varchar("action", { length: 32 }).notNull(),
  model: varchar("model", { length: 128 }).notNull(),
  content: text("content").notNull(),
  citations: json("citations").$type<SatnavSourceRef[]>().notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  expiresAt: timestamp("expiresAt").notNull(),
}, table => ({
  eventActionTime: index("satnav_ai_event_action_time_idx").on(table.eventId, table.action, table.createdAt),
}));

export const satnavProviderStatus = mysqlTable("satnav_provider_status", {
  provider: varchar("provider", { length: 32 }).$type<SatnavProvider>().primaryKey(),
  state: varchar("state", { length: 20 }).notNull(),
  lastAttemptAt: timestamp("lastAttemptAt"),
  lastSuccessAt: timestamp("lastSuccessAt"),
  itemCount: int("itemCount").default(0).notNull(),
  message: text("message"),
  coverageNote: text("coverageNote").notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;
export type SatnavEventRow = typeof satnavEvents.$inferSelect;
