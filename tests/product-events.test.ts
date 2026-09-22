import assert from "node:assert/strict";
import test from "node:test";
import {
  buildProductEvent,
  KINDRED_EVENT_NAMES,
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
