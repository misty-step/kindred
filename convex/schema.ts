import { parlorTables } from "@parlor/convex/schema";
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import {
  productEnvironmentValidator,
  productEventNameValidator,
  productEventPropsValidator,
} from "./product_event_validators";

/**
 * Kindred composes application-local Parlor tables with its own game tables.
 * Everything references roomId/matchId; Parlor owns rooms, identity, presence,
 * and match envelopes. Kindred owns rounds, secret answers, retained Jev
 * adjudications, reveal state, and scores.
 */
export default defineSchema({
  ...parlorTables,
  games: defineTable({
    matchId: v.id("matches"),
    /** Six main prompts and one reserved extra prompt. */
    promptIds: v.array(v.string()),
    tiedPairs: v.optional(
      v.array(v.object({ a: v.id("players"), b: v.id("players") })),
    ),
    result: v.optional(
      v.object({
        winners: v.array(v.object({ a: v.id("players"), b: v.id("players") })),
        shared: v.boolean(),
        decidedBy: v.union(v.literal("questions"), v.literal("extra")),
        total: v.number(),
      }),
    ),
  }).index("by_match", ["matchId"]),
  rounds: defineTable({
    gameId: v.id("games"),
    matchId: v.id("matches"),
    index: v.number(),
    promptId: v.string(),
    status: v.union(
      v.literal("answering"),
      v.literal("adjudicating"),
      v.literal("revealed"),
    ),
    tiebreak: v.boolean(),
    /** Adjudication attempts used; bounded with fair retry. */
    attempts: v.number(),
    /** Set only by the adjudication action; mutations stay deterministic. */
    revealedAt: v.optional(v.number()),
  })
    .index("by_game", ["gameId"])
    .index("by_game_index", ["gameId", "index"]),
  answers: defineTable({
    roundId: v.id("rounds"),
    playerId: v.id("players"),
    text: v.string(),
    normalized: v.string(),
  })
    .index("by_round", ["roundId"])
    .index("by_round_player", ["roundId", "playerId"]),
  /**
   * Versioned retained Jev adjudications, scoped per prompt (equivalence is
   * contextual to the prompt). Duplicate submissions hit this cache and never
   * reroll a judgment.
   */
  adjudications: defineTable({
    promptId: v.string(),
    pairKey: v.string(),
    a: v.string(),
    b: v.string(),
    verdict: v.union(v.literal("match"), v.literal("distinct")),
    probability: v.number(),
    model: v.string(),
    rubricVersion: v.number(),
  }).index("by_prompt_pair", ["promptId", "pairKey"]),
  roundResults: defineTable({
    roundId: v.id("rounds"),
    clusters: v.array(
      v.object({
        anchor: v.string(),
        answers: v.array(
          v.object({
            playerId: v.id("players"),
            text: v.string(),
            normalized: v.string(),
          }),
        ),
      }),
    ),
    pairs: v.array(
      v.object({
        a: v.id("players"),
        b: v.id("players"),
        scored: v.boolean(),
      }),
    ),
    rubricVersion: v.number(),
    model: v.string(),
  }).index("by_round", ["roundId"]),
  /** Versioned, content-free product signals. eventId makes retries idempotent. */
  productEvents: defineTable({
    eventId: v.string(),
    eventName: productEventNameValidator,
    game: v.literal("kindred"),
    environment: productEnvironmentValidator,
    occurredAt: v.string(),
    sessionId: v.string(),
    actorId: v.null(),
    schemaVersion: v.literal(1),
    props: productEventPropsValidator,
  })
    .index("by_event_id", ["eventId"])
    .index("by_environment_time", ["environment", "occurredAt"]),
  /** Malformed events are retained without player content for operational triage. */
  productEventQuarantine: defineTable({
    eventId: v.string(),
    eventName: v.string(),
    occurredAt: v.number(),
    sessionId: v.string(),
    reason: v.string(),
    recordedAt: v.number(),
  }).index("by_recorded_at", ["recordedAt"]),
});
