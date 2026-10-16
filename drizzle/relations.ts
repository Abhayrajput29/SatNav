import { relations } from "drizzle-orm";
import { satnavAiExplanations, satnavClusters, satnavEvents, satnavEventSources } from "./schema";

export const satnavClusterRelations = relations(satnavClusters, ({ many }) => ({
  events: many(satnavEvents),
}));

export const satnavEventRelations = relations(satnavEvents, ({ one, many }) => ({
  cluster: one(satnavClusters, { fields: [satnavEvents.clusterId], references: [satnavClusters.id] }),
  sources: many(satnavEventSources),
  explanations: many(satnavAiExplanations),
}));

export const satnavEventSourceRelations = relations(satnavEventSources, ({ one }) => ({
  event: one(satnavEvents, { fields: [satnavEventSources.eventId], references: [satnavEvents.id] }),
}));

export const satnavExplanationRelations = relations(satnavAiExplanations, ({ one }) => ({
  event: one(satnavEvents, { fields: [satnavAiExplanations.eventId], references: [satnavEvents.id] }),
}));
