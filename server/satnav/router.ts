import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { publicProcedure, router } from "../_core/trpc";
import { explainEvent, getAiStatus } from "./ai";
import { splitViewport } from "./geo";
import { searchPublicPlaces } from "./places";
import { getProviderStatuses, getViewportEvents, searchEvents } from "./service";

const MAX_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
const boundsSchema = z.object({
  west: z.number().min(-540).max(540),
  south: z.number().min(-90).max(90),
  east: z.number().min(-540).max(540),
  north: z.number().min(-90).max(90),
}).refine(bounds => bounds.east > bounds.west && bounds.north > bounds.south, "Invalid viewport bounds");

export const satnavRouter = router({
  viewport: publicProcedure.input(z.object({
    bounds: boundsSchema,
    startAt: z.number().int().positive(),
    endAt: z.number().int().positive(),
  })).query(async ({ input }) => {
    const now = Date.now();
    if (input.endAt <= input.startAt || input.endAt - input.startAt > MAX_WINDOW_MS || input.startAt < now - MAX_WINDOW_MS || input.endAt > now + 60_000) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Select a valid time window within the available 30-day feeds." });
    }
    try { splitViewport(input.bounds); } catch {
      throw new TRPCError({ code: "BAD_REQUEST", message: "The map viewport is invalid." });
    }
    return getViewportEvents(input.bounds, input.startAt, input.endAt);
  }),
  searchEvents: publicProcedure.input(z.object({ query: z.string().trim().min(2).max(120), limit: z.number().int().min(1).max(50).default(20) }))
    .query(({ input }) => searchEvents(input.query, input.limit)),
  searchPlace: publicProcedure.input(z.object({ query: z.string().trim().min(3).max(120) }))
    .mutation(async ({ input }) => {
      try { return await searchPublicPlaces(input.query); }
      catch (error) {
        const message = error instanceof Error && /^Place search returned HTTP \d{3}$/.test(error.message) ? error.message : "Place search is temporarily unavailable.";
        throw new TRPCError({ code: "BAD_GATEWAY", message });
      }
    }),
  sources: publicProcedure.query(() => getProviderStatuses()),
  aiStatus: publicProcedure.query(() => getAiStatus()),
  explain: publicProcedure.input(z.object({ eventId: z.string().min(1).max(191), action: z.enum(["summary", "uncertainty", "background"]) }))
    .mutation(({ input, ctx }) => explainEvent(input.eventId, input.action, ctx.req.ip ?? ctx.req.socket.remoteAddress ?? "local")),
});
