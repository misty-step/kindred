import { v } from "convex/values";
import {
  buildProductEvent,
  partitionProductEventsForAnalytics,
  summarizeKindredEvents,
} from "./product_event_contract";
import {
  productEnvironmentValidator,
  productEventNameValidator,
  productEventPropsValidator,
} from "./product_event_validators";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalMutation, query, type MutationCtx } from "./_generated/server";

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
    if (
      environment !== "production" &&
      environment !== "staging" &&
      environment !== "test"
    ) {
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

/**
 * Schedule authenticated room-entry signals from the same transaction that
 * created the membership. Membership ids make retries idempotent without
 * retaining player ids in analytics.
 */
export async function scheduleRoomEntry(
  ctx: MutationCtx,
  input: {
    roomId: Id<"rooms">;
    playerId: Id<"players">;
    eventName: "room_created" | "room_joined";
  },
): Promise<void> {
  const [player, member, members] = await Promise.all([
    ctx.db.get(input.playerId),
    ctx.db
      .query("roomMembers")
      .withIndex("by_room_player", (q) =>
        q.eq("roomId", input.roomId).eq("playerId", input.playerId),
      )
      .unique(),
    ctx.db
      .query("roomMembers")
      .withIndex("by_room_player", (q) => q.eq("roomId", input.roomId))
      .collect(),
  ]);
  if (!player || !member || member.closedAt !== undefined) return;
  const activeCount = members.filter(
    (candidate) => candidate.closedAt === undefined,
  ).length;
  const now = Date.now();
  await Promise.all([
    ctx.scheduler.runAfter(0, internal.productEvents.emit, {
      eventId: `${member._id}:session-start`,
      eventName: "session_start",
      occurredAt: now,
      sessionId: input.roomId,
      props: {
        mode: "match",
        new_visitor: Math.abs(player._creationTime - member.joinedAt) < 5_000,
      },
    }),
    ctx.scheduler.runAfter(0, internal.productEvents.emit, {
      eventId: `${member._id}:room-entry`,
      eventName: input.eventName,
      occurredAt: now,
      sessionId: input.roomId,
      props: { room_players: activeCount },
    }),
  ]);
}

/** Record an abandoned match after Parlor has committed the canonical reason. */
export async function scheduleMatchAbandoned(
  ctx: MutationCtx,
  input: {
    matchId: Id<"matches">;
    reason: "hard-deadline" | "everyone-away" | "host-ended";
    occurredAt: number;
  },
): Promise<void> {
  const game = await ctx.db
    .query("games")
    .withIndex("by_match", (q) => q.eq("matchId", input.matchId))
    .unique();
  const completedRounds = game
    ? await ctx.db
        .query("rounds")
        .withIndex("by_game", (q) => q.eq("gameId", game._id))
        .filter((q) => q.neq(q.field("revealedAt"), undefined))
        .collect()
    : [];
  await ctx.scheduler.runAfter(0, internal.productEvents.emit, {
    eventId: `${input.matchId}:abandoned`,
    eventName: "match_abandoned",
    occurredAt: input.occurredAt,
    sessionId: input.matchId,
    props: { rounds_completed: completedRounds.length, reason: input.reason },
  });
}

/** Aggregate-only operational readback. Player content and ids never leave. */
export const summary = query({
  args: { environment: productEnvironmentValidator },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("productEvents")
      .withIndex("by_environment_time", (q) =>
        q.eq("environment", args.environment),
      )
      .order("desc")
      .take(1_000);
    const events = rows.map(
      ({ _id: _ignoredId, _creationTime: _ignoredTime, ...event }) => event,
    );
    const partition = partitionProductEventsForAnalytics(
      events,
      args.environment,
    );
    const unclassifiedEventsRetained = partition.unclassifiedEvents.length;
    return {
      environment: args.environment,
      sampledEvents: events.length,
      fixtureEventsExcluded: partition.fixtureEvents.length,
      unclassifiedEventsRetained,
      // Backward-compatible alias; this does not certify human traffic.
      genuineEventsRetained: unclassifiedEventsRetained,
      truncated: events.length === 1_000,
      ...summarizeKindredEvents(partition.unclassifiedEvents, args.environment),
    };
  },
});

export const quarantineSummary = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db
      .query("productEventQuarantine")
      .order("desc")
      .take(100);
    const reasons: Record<string, number> = {};
    for (const row of rows)
      reasons[row.reason] = (reasons[row.reason] ?? 0) + 1;
    return { sampled: rows.length, truncated: rows.length === 100, reasons };
  },
});
