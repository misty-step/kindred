import assert from "node:assert/strict";
import test from "node:test";
import {
  buildProductEvent,
  KINDRED_EVENT_NAMES,
  summarizeKindredEvents,
  validateProductEvent,
} from "../convex/product-event-contract.ts";

const environment = "test" as const;
const occurredAt = "2026-09-21T12:00:00.000Z";

function event(overrides: Record<string, unknown> = {}) {
  return {
    eventId: "evt_01J8TEST000000000000000001",
    eventName: "match_start",
    game: "kindred",
    environment,
    occurredAt,
    sessionId: "session_opaque",
    actorId: null,
    schemaVersion: 1,
    props: { room_players: 4, round_count: 5, game_mode: "hive-mind" },
    ...overrides,
  };
}

test("Kindred taxonomy covers the complete product loop", () => {
  for (const name of [
    "room_created",
    "room_joined",
    "match_start",
    "round_start",
    "answer_submitted",
    "round_adjudicated",
    "round_complete",
    "match_complete",
    "replay",
    "match_abandoned",
  ]) {
    assert.ok(KINDRED_EVENT_NAMES.includes(name as never), `missing ${name}`);
  }
});

test("buildProductEvent accepts typed, content-free measurements", () => {
  const built = buildProductEvent(event());
  assert.deepEqual(built, event());
  assert.equal(validateProductEvent(built).ok, true);
});

test("product events require explicit environment and anonymous actors", () => {
  assert.throws(() => buildProductEvent(event({ environment: undefined })), /environment/);
  assert.throws(() => buildProductEvent(event({ environment: "prod" })), /environment/);
  assert.throws(() => buildProductEvent(event({ actorId: "player@example.com" })), /actorId/);
});

test("product events reject player content and PII-shaped props", () => {
  assert.throws(
    () => buildProductEvent(event({ props: { ...event().props, answer: "my secret thought" } })),
    /props/,
  );
  assert.throws(
    () => buildProductEvent(event({ props: { ...event().props, email: "p@example.com" } })),
    /props/,
  );
  assert.throws(
    () => buildProductEvent(event({ props: { ...event().props, player_name: "Pat" } })),
    /props/,
  );
});

test("event-specific runtime validation rejects malformed measurements", () => {
  assert.throws(
    () => buildProductEvent(event({ props: { room_players: -1, round_count: 5, game_mode: "hive-mind" } })),
    /props/,
  );
  assert.throws(
    () => buildProductEvent(event({ props: { room_players: 4, round_count: 5, game_mode: "unknown" } })),
    /props/,
  );
  assert.throws(() => buildProductEvent(event({ occurredAt: "yesterday" })), /occurredAt/);
});

test("summary excludes test traffic, deduplicates, and exposes replay and failures", () => {
  const row = (
    eventId: string,
    eventName: string,
    sessionId: string,
    props: Record<string, unknown>,
    env: "production" | "test" = "production",
  ) => buildProductEvent(event({ eventId, eventName, sessionId, props, environment: env }));
  const rows = [
    row("event_0001", "match_start", "session_01", {
      room_players: 3,
      round_count: 5,
      game_mode: "hive-mind",
    }),
    row("event_0002", "answer_submitted", "session_01", { round_index: 0, answer_length: 4 }),
    row("event_0003", "round_complete", "session_01", { round_index: 0, score: 2 }),
    row("event_0004", "match_complete", "session_01", { rounds_played: 5, total_score: 8 }),
    row("event_0005", "replay", "session_02", {
      previous_result: "completed",
      game_mode: "hive-mind",
    }),
    row("event_0006", "match_abandoned", "session_03", {
      rounds_completed: 2,
      reason: "everyone-away",
    }),
    row("event_0007", "round_adjudicated", "session_03", {
      round_index: 2,
      result: "failed",
    }),
    row("event_0001", "match_start", "session_01", {
      room_players: 3,
      round_count: 5,
      game_mode: "hive-mind",
    }),
    row("event_test1", "match_start", "session_test", {
      room_players: 2,
      round_count: 8,
      game_mode: "hive-mind",
    }, "test"),
  ];

  assert.deepEqual(summarizeKindredEvents(rows, "production"), {
    sessionsStarted: 1,
    sessionsEngaged: 1,
    roundsCompleted: 1,
    matchesCompleted: 1,
    replays: 1,
    abandonments: 1,
    evaluatorFailures: 1,
  });
});
