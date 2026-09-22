import { resolvePlayer } from "@parlor/convex";
import { v } from "convex/values";
import { buildProductEvent, summarizeKindredEvents } from "./product-event-contract";
import {
  productEnvironmentValidator,
  productEventNameValidator,
  productEventPropsValidator,
} from "./product-event-validators";
import { internal } from "./_generated/api";
import { internalMutation, mutation, query, type MutationCtx } from "./_generated/server";

declare const process: { env: Record<string, string | undefined> };

const emissionArgs = {
  eventId: v.string(),
  eventName: productEventNameValidator,
  occurredAt: v.number(),
  sessionId: v.string(),
  props: productEventPropsValidator,
};

async function quarantine(
  ctx: MutationCtx,
  args: {
    eventId: string;
    eventName: string;
    occurredAt: number;
    sessionId: string;
  },
  reason: string,
): Promise<void> {
  await ctx.db.insert("productEventQuarantine", {
    eventId: args.eventId,
    eventName: args.eventName,
    occurredAt: args.occurredAt,
    sessionId: args.sessionId,
    reason,
    recordedAt: Date.now(),
  });
}

/**
 * Isolated event sink. Gameplay schedules this mutation after its own write so
 * analytics can fail or quarantine without rolling back a player's action.
 */
export const emit = internalMutation({
  args: emissionArgs,
  returns: v.object({ inserted: v.boolean(), quarantined: v.boolean() }),
  handler: async (ctx, args) => {
    const environment = process.env["PRODUCT_ENVIRONMENT"];
    if (environment !== "production" && environment !== "staging" && environment !== "test") {
      await quarantine(ctx, args, "environment-missing-or-invalid");
      return { inserted: false, quarantined: true };
    }

    let event;
    try {
      event = buildProductEvent({
        ...args,
        game: "kindred",
        environment,
        occurredAt: new Date(args.occurredAt).toISOString(),
        actorId: null,
        schemaVersion: 1,
      });
    } catch {
      await quarantine(ctx, args, "contract-validation-failed");
      return { inserted: false, quarantined: true };
    }

    const duplicate = await ctx.db
      .query("productEvents")
      .withIndex("by_event_id", (q) => q.eq("eventId", event.eventId))
      .unique();
    if (duplicate) return { inserted: false, quarantined: false };
    await ctx.db.insert("productEvents", event);
    return { inserted: true, quarantined: false };
  },
});

/** Records room creation/join from authenticated room state, never client claims. */
export const recordRoomEntry = mutation({
  args: {
    roomId: v.id("rooms"),
    guestToken: v.string(),
    eventId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const actor = await resolvePlayer(ctx, args.guestToken);
    const [room, player, member, members] = await Promise.all([
      ctx.db.get(args.roomId),
      ctx.db.get(actor.playerId),
      ctx.db
        .query("roomMembers")
        .withIndex("by_room_player", (q) =>
          q.eq("roomId", args.roomId).eq("playerId", actor.playerId),
        )
        .unique(),
      ctx.db
        .query("roomMembers")
        .withIndex("by_room_player", (q) => q.eq("roomId", args.roomId))
        .collect(),
    ]);
    if (!room || !player || !member || member.closedAt !== undefined) return null;

    const activeCount = members.filter((candidate) => candidate.closedAt === undefined).length;
    const eventName =
      room.hostPlayerId === actor.playerId && member.seatIndex === 0
        ? ("room_created" as const)
        : ("room_joined" as const);
    const now = Date.now();
    await Promise.all([
      ctx.scheduler.runAfter(0, internal.productEvents.emit, {
        eventId: `${args.eventId}:session`,
        eventName: "session_start",
        occurredAt: now,
        sessionId: args.roomId,
        props: {
          mode: "match",
          new_visitor: Math.abs(player._creationTime - member.joinedAt) < 5_000,
        },
      }),
      ctx.scheduler.runAfter(0, internal.productEvents.emit, {
        eventId: args.eventId,
        eventName,
        occurredAt: now,
        sessionId: args.roomId,
        props: { room_players: activeCount },
      }),
    ]);
    return null;
  },
});

/** Aggregate-only operational readback. Player content and ids never leave. */
export const summary = query({
  args: { environment: productEnvironmentValidator },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("productEvents")
      .withIndex("by_environment_time", (q) => q.eq("environment", args.environment))
      .order("desc")
      .take(1_000);
    const events = rows.map(({ _id: _ignoredId, _creationTime: _ignoredTime, ...event }) => event);
    return {
      environment: args.environment,
      sampledEvents: events.length,
      truncated: events.length === 1_000,
      ...summarizeKindredEvents(events, args.environment),
    };
  },
});

export const quarantineSummary = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("productEventQuarantine").order("desc").take(100);
    const reasons: Record<string, number> = {};
    for (const row of rows) reasons[row.reason] = (reasons[row.reason] ?? 0) + 1;
    return { sampled: rows.length, truncated: rows.length === 100, reasons };
  },
});
