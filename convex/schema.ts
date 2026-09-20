import { parlorTables } from "@parlor/convex/schema";
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

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
    mode: v.union(v.literal("hive-mind"), v.literal("soulmate")),
    /** Ordered prompt ids for this match's rounds. */
    promptIds: v.array(v.string()),
    /** Soulmate frozen pairings by player id, sorted by seat. */
    pairs: v.optional(
      v.array(v.object({ a: v.id("players"), b: v.id("players") })),
    ),
    /** Final two-player Hive Mind session record. */
    sessionRecord: v.optional(
      v.object({
        roundsPlayed: v.number(),
        sharedThoughts: v.number(),
        record: v.string(),
      }),
    ),
    /** Final per-player totals for scored modes. */
    totals: v.optional(
      v.array(v.object({ playerId: v.id("players"), points: v.number() })),
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
      v.literal("names"),
    ),
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
    scores: v.array(v.object({ playerId: v.id("players"), points: v.number() })),
    overrides: v.array(
      v.object({ playerA: v.id("players"), playerB: v.id("players") }),
    ),
    pendingPairs: v.number(),
    rubricVersion: v.number(),
    model: v.string(),
  }).index("by_round", ["roundId"]),
  /** Mutual shared-memory override consents; applied when both players agree. */
  overrideConsents: defineTable({
    roundId: v.id("rounds"),
    /** Sorted player-id pair, order-independent. */
    pairKey: v.string(),
    playerId: v.id("players"),
  })
    .index("by_round_pair", ["roundId", "pairKey"])
    .index("by_round_player", ["roundId", "playerId"]),
});