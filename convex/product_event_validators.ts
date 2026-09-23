import { v } from "convex/values";

export const productEnvironmentValidator = v.union(
  v.literal("production"),
  v.literal("staging"),
  v.literal("test"),
);

export const productEventNameValidator = v.union(
  v.literal("session_start"),
  v.literal("room_created"),
  v.literal("room_joined"),
  v.literal("match_start"),
  v.literal("round_start"),
  v.literal("answer_submitted"),
  v.literal("round_adjudicated"),
  v.literal("round_complete"),
  v.literal("match_complete"),
  v.literal("replay"),
  v.literal("match_abandoned"),
);

/**
 * Storage validator. Rows written before the pair rule carry `game_mode`; it stays
 * optional here so existing analytics history remains valid. New events never emit it
 * (the contract in product_event_contract.ts rejects it).
 */
const legacyGameMode = v.optional(
  v.union(v.literal("hive-mind"), v.literal("soulmate")),
);

export const productEventPropsValidator = v.union(
  v.object({ mode: v.literal("match"), new_visitor: v.boolean() }),
  v.object({ room_players: v.number() }),
  v.object({
    room_players: v.number(),
    round_count: v.number(),
    game_mode: legacyGameMode,
  }),
  v.object({ round_index: v.number(), prompt_id: v.string() }),
  v.object({ round_index: v.number(), answer_length: v.number() }),
  v.object({
    round_index: v.number(),
    result: v.union(
      v.literal("matched"),
      v.literal("unmatched"),
      v.literal("failed"),
    ),
  }),
  v.object({ round_index: v.number(), score: v.number() }),
  v.object({ rounds_played: v.number(), total_score: v.number() }),
  v.object({
    previous_result: v.union(v.literal("completed"), v.literal("abandoned")),
    game_mode: legacyGameMode,
  }),
  v.object({
    rounds_completed: v.number(),
    reason: v.union(
      v.literal("hard-deadline"),
      v.literal("everyone-away"),
      v.literal("host-ended"),
    ),
  }),
);
