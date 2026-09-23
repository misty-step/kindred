export const PRODUCT_EVENT_SCHEMA_VERSION = 1 as const;

export const KINDRED_EVENT_NAMES = [
  "session_start",
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
] as const;

export type KindredEventName = (typeof KINDRED_EVENT_NAMES)[number];
export type ProductEnvironment = "production" | "staging" | "test";
export type ProductEventProps =
  | Readonly<{ mode: "match"; new_visitor: boolean }>
  | Readonly<{ room_players: number }>
  | Readonly<{
      room_players: number;
      round_count: number;
    }>
  | Readonly<{ round_index: number; prompt_id: string }>
  | Readonly<{ round_index: number; answer_length: number }>
  | Readonly<{
      round_index: number;
      result: "matched" | "unmatched" | "failed";
    }>
  | Readonly<{ round_index: number; score: number }>
  | Readonly<{ rounds_played: number; total_score: number }>
  | Readonly<{
      previous_result: "completed" | "abandoned";
    }>
  | Readonly<{
      rounds_completed: number;
      reason: "hard-deadline" | "everyone-away" | "host-ended";
    }>;

export type ProductEvent = Readonly<{
  eventId: string;
  eventName: KindredEventName;
  game: "kindred";
  environment: ProductEnvironment;
  occurredAt: string;
  sessionId: string;
  actorId: null;
  schemaVersion: typeof PRODUCT_EVENT_SCHEMA_VERSION;
  props: ProductEventProps;
}>;

/**
 * Exact session ids bound to both a named supervised-production run and
 * overlapping telemetry. See docs/production-analytics-fixture-exclusions.md.
 */
export const KNOWN_PRODUCTION_FIXTURE_SESSION_IDS = [
  "k57agtpm30kn5ktpawsvb00ba58exq3m",
  "jn71m1d8747khhn92vkyxtnf258ewv0n",
  "jn71tpe4grfe832g4hkza4a32n8ewa4e",
] as const;

const productionFixtureSessionIds = new Set<string>(
  KNOWN_PRODUCTION_FIXTURE_SESSION_IDS,
);

export function partitionProductEventsForAnalytics(
  rows: readonly ProductEvent[],
  environment: ProductEnvironment,
): Readonly<{
  fixtureEvents: readonly ProductEvent[];
  unclassifiedEvents: readonly ProductEvent[];
  /** @deprecated This is an alias for unclassifiedEvents, not verified-human traffic. */
  genuineEvents: readonly ProductEvent[];
}> {
  const fixtureEvents: ProductEvent[] = [];
  const unclassifiedEvents: ProductEvent[] = [];
  for (const row of rows) {
    if (row.environment !== environment) continue;
    if (
      environment === "production" &&
      productionFixtureSessionIds.has(row.sessionId)
    ) {
      fixtureEvents.push(row);
    } else {
      unclassifiedEvents.push(row);
    }
  }
  return {
    fixtureEvents,
    unclassifiedEvents,
    genuineEvents: unclassifiedEvents,
  };
}

type Validation =
  { ok: true; value: ProductEvent } | { ok: false; reason: string };
type PropRule = (value: unknown) => boolean;

type EventSpec = Readonly<Record<string, PropRule>>;

const integer =
  (minimum: number, maximum: number): PropRule =>
  (value) =>
    Number.isSafeInteger(value) &&
    Number(value) >= minimum &&
    Number(value) <= maximum;
const oneOf =
  (...values: readonly string[]): PropRule =>
  (value) =>
    typeof value === "string" && values.includes(value);
const identifier: PropRule = (value) =>
  typeof value === "string" &&
  /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value);
const bool: PropRule = (value) => typeof value === "boolean";

const EVENT_SPECS: Readonly<Record<KindredEventName, EventSpec>> = {
  session_start: { mode: oneOf("match"), new_visitor: bool },
  room_created: { room_players: integer(1, 12) },
  room_joined: { room_players: integer(1, 12) },
  match_start: {
    room_players: integer(2, 12),
    round_count: integer(6, 6),
  },
  round_start: { round_index: integer(0, 6), prompt_id: identifier },
  answer_submitted: {
    round_index: integer(0, 6),
    answer_length: integer(1, 64),
  },
  round_adjudicated: {
    round_index: integer(0, 6),
    result: oneOf("matched", "unmatched", "failed"),
  },
  round_complete: { round_index: integer(0, 6), score: integer(0, 6) },
  match_complete: { rounds_played: integer(6, 7), total_score: integer(0, 42) },
  replay: {
    previous_result: oneOf("completed", "abandoned"),
  },
  match_abandoned: {
    rounds_completed: integer(0, 7),
    reason: oneOf("hard-deadline", "everyone-away", "host-ended"),
  },
};

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function opaqueId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= 8 &&
    value.length <= 200 &&
    /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value)
  );
}

function isoTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const millis = Date.parse(value);
  return Number.isFinite(millis) && new Date(millis).toISOString() === value;
}

function validProps(
  name: KindredEventName,
  value: unknown,
): value is ProductEventProps {
  if (!record(value)) return false;
  const spec = EVENT_SPECS[name];
  const actual = Object.keys(value).sort();
  const expected = Object.keys(spec).sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    return false;
  }
  return expected.every((key) => spec[key]!(value[key]));
}

export function validateProductEvent(input: unknown): Validation {
  if (!record(input)) return { ok: false, reason: "event must be an object" };
  const eventName = input["eventName"];
  if (
    typeof eventName !== "string" ||
    !KINDRED_EVENT_NAMES.includes(eventName as KindredEventName)
  ) {
    return { ok: false, reason: "eventName is not in the Kindred contract" };
  }
  if (!opaqueId(input["eventId"]))
    return { ok: false, reason: "eventId is invalid" };
  if (input["game"] !== "kindred")
    return { ok: false, reason: "game must be kindred" };
  if (
    input["environment"] !== "production" &&
    input["environment"] !== "staging" &&
    input["environment"] !== "test"
  ) {
    return { ok: false, reason: "environment must be explicit" };
  }
  if (!isoTimestamp(input["occurredAt"])) {
    return {
      ok: false,
      reason: "occurredAt must be a canonical ISO timestamp",
    };
  }
  if (!opaqueId(input["sessionId"]))
    return { ok: false, reason: "sessionId is invalid" };
  // Kindred deliberately keeps retention anonymous until it has a rotating,
  // non-joinable actor design. A durable player id never enters analytics.
  if (input["actorId"] !== null)
    return { ok: false, reason: "actorId must be null" };
  if (input["schemaVersion"] !== PRODUCT_EVENT_SCHEMA_VERSION) {
    return { ok: false, reason: "schemaVersion is unsupported" };
  }
  if (!validProps(eventName as KindredEventName, input["props"])) {
    return { ok: false, reason: "props do not match the event contract" };
  }
  return { ok: true, value: input as ProductEvent };
}

export function buildProductEvent(input: unknown): ProductEvent {
  const result = validateProductEvent(input);
  if (!result.ok) throw new Error(`Invalid product event: ${result.reason}`);
  return result.value;
}

export type KindredEventSummary = Readonly<{
  sessionsStarted: number;
  sessionsEngaged: number;
  roundsCompleted: number;
  matchesCompleted: number;
  replays: number;
  abandonments: number;
  evaluatorFailures: number;
}>;

export function summarizeKindredEvents(
  rows: readonly ProductEvent[],
  environment: ProductEnvironment,
): KindredEventSummary {
  const seen = new Set<string>();
  const starts = new Set<string>();
  const engaged = new Set<string>();
  const completedMatches = new Set<string>();
  const abandonedMatches = new Set<string>();
  let roundsCompleted = 0;
  let replays = 0;
  let evaluatorFailures = 0;

  for (const row of rows) {
    if (row.environment !== environment || seen.has(row.eventId)) continue;
    seen.add(row.eventId);
    if (row.eventName === "match_start") starts.add(row.sessionId);
    if (row.eventName === "answer_submitted") engaged.add(row.sessionId);
    if (row.eventName === "round_complete") roundsCompleted += 1;
    if (row.eventName === "match_complete") completedMatches.add(row.sessionId);
    if (row.eventName === "replay") replays += 1;
    if (row.eventName === "match_abandoned")
      abandonedMatches.add(row.sessionId);
    if (
      row.eventName === "round_adjudicated" &&
      "result" in row.props &&
      row.props.result === "failed"
    ) {
      evaluatorFailures += 1;
    }
  }

  return {
    sessionsStarted: starts.size,
    sessionsEngaged: engaged.size,
    roundsCompleted,
    matchesCompleted: completedMatches.size,
    replays,
    abandonments: abandonedMatches.size,
    evaluatorFailures,
  };
}
