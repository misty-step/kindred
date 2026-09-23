/// <reference types="vite/client" />

import { issueGuestToken } from "@parlor/auth/server";
import { convexTest } from "convex-test";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import schema from "../../convex/schema";

const modules = import.meta.glob("../../convex/**/*.ts");
const secret = new Uint8Array(32).fill(0x4b);
const keyId = "qa-v1";

async function token(guestId: string): Promise<string> {
  const issued = await Effect.runPromise(
    issueGuestToken({
      keyId,
      secret,
      audience: "kindred",
      guestId,
      sessionId: `${guestId}-session`,
      lifetimeMs: 60 * 60_000,
      now: () => Date.now(),
    }),
  );
  return issued.token;
}

async function flush(t: ReturnType<typeof convexTest>) {
  await t.finishAllScheduledFunctions(vi.runAllTimers);
}

async function fixture() {
  const t = convexTest(schema, modules);
  const hostToken = await token("host-player");
  const guestToken = await token("guest-player");
  const room = await t.mutation(api.rooms.createRoom, {
    displayName: "Host",
    guestToken: hostToken,
  });
  const joined = await t.mutation(api.rooms.joinRoom, {
    code: room.code,
    displayName: "Guest",
    guestToken,
  });
  if (!("roomId" in joined)) throw new Error(joined.code);
  await flush(t);
  return { t, room, hostToken, guestToken };
}

async function playRound(
  t: ReturnType<typeof convexTest>,
  roomId: Id<"rooms">,
  hostToken: string,
  guestToken: string,
) {
  const state = await t.query(api.game.view, { roomId, guestToken: hostToken });
  if (!state.match || !("round" in state.match) || !state.match.round) {
    throw new Error("round missing");
  }
  const matchId = state.match.id;
  const roundId = state.match.round.id;
  await t.mutation(api.game.submitAnswer, {
    roomId,
    matchId,
    roundId,
    guestToken: hostToken,
    text: "Moon",
  });
  await t.mutation(api.game.submitAnswer, {
    roomId,
    matchId,
    roundId,
    guestToken,
    text: "moon",
  });
  await flush(t);
  await t.mutation(api.game.advance, {
    roomId,
    matchId,
    guestToken: hostToken,
  });
  await flush(t);
}

describe("Kindred lifecycle product events", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-22T06:00:00.000Z"));
    vi.stubEnv("PRODUCT_ENVIRONMENT", "test");
    vi.stubEnv(
      "PARLOR_GUEST_TOKEN_KEYS",
      JSON.stringify({ [keyId]: Buffer.from(secret).toString("base64url") }),
    );
    vi.stubEnv("PARLOR_GUEST_TOKEN_AUDIENCE", "kindred");
    vi.stubEnv("JEV_DECISIONS_URL", "https://judge.test/decisions");
    vi.stubEnv("JEV_MODEL", "fixture/identical-answer-judge");
    vi.stubEnv("OPENROUTER_API_KEY", "fixture-key-not-real");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body)) as {
          questions: Record<string, unknown>;
        };
        return Response.json({
          answers: Object.fromEntries(
            Object.keys(body.questions).map((name) => [
              name,
              { type: "noul", noul: 0.99 },
            ]),
          ),
        });
      }),
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("records create, join, complete, replay, and abandonment without player content", async () => {
    const { t, room, hostToken, guestToken } = await fixture();
    await t.mutation(api.game.start, {
      roomId: room.roomId,
      guestToken: hostToken,
    });
    await flush(t);
    for (let round = 0; round < 6; round += 1) {
      await playRound(t, room.roomId, hostToken, guestToken);
    }

    await t.mutation(api.game.start, {
      roomId: room.roomId,
      guestToken: hostToken,
    });
    await flush(t);
    await t.mutation(api.rooms.closeRoom, {
      roomId: room.roomId,
      guestToken: hostToken,
    });
    await flush(t);

    const events = await t.run((ctx) =>
      ctx.db.query("productEvents").withIndex("by_environment_time").collect(),
    );
    const names = events.map((event) => event.eventName);
    expect(names).toContain("room_created");
    expect(names).toContain("room_joined");
    expect(names.filter((name) => name === "session_start")).toHaveLength(2);
    expect(names.filter((name) => name === "match_start")).toHaveLength(2);
    expect(names.filter((name) => name === "round_complete")).toHaveLength(6);
    expect(
      events.find((event) => event.eventName === "match_complete")?.props,
    ).toEqual({ rounds_played: 6, total_score: 6 });
    expect(names).toContain("match_complete");
    expect(names).toContain("replay");
    expect(names).toContain("match_abandoned");
    expect(new Set(events.map((event) => event.eventId)).size).toBe(
      events.length,
    );
    expect(
      events.every(
        (event) => event.environment === "test" && event.actorId === null,
      ),
    ).toBe(true);
    expect(JSON.stringify(events)).not.toMatch(
      /Moon|Host|Guest|host-player|guest-player/,
    );
  });

  it("records evaluator failure as a content-free adjudication outcome", async () => {
    const { t, room, hostToken } = await fixture();
    await t.mutation(api.game.start, {
      roomId: room.roomId,
      guestToken: hostToken,
    });
    const state = await t.query(api.game.view, {
      roomId: room.roomId,
      guestToken: hostToken,
    });
    if (!state.match || !("round" in state.match) || !state.match.round) {
      throw new Error("round missing");
    }
    await t.mutation(internal.jev.failAttempt, {
      roundId: state.match.round.id,
      attempts: 1,
    });
    await flush(t);
    const events = await t.run((ctx) =>
      ctx.db.query("productEvents").collect(),
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        eventName: "round_adjudicated",
        props: { round_index: 0, result: "failed" },
      }),
    );
  });

  it("summarizes only receipt-bound production fixtures without writing rows", async () => {
    const t = convexTest(schema, modules);
    const receiptBoundSessionIds = [
      "k57agtpm30kn5ktpawsvb00ba58exq3m",
      "jn71m1d8747khhn92vkyxtnf258ewv0n",
      "jn71tpe4grfe832g4hkza4a32n8ewa4e",
    ] as const;
    const uncertainSessionIds = [
      "k57dq3shp968a2pa38xkzva6bh8ewep0",
      "jn76ytbj7bhnsctyhs265dg5gx8ewtse",
    ] as const;
    const productionSessionIds = [
      ...receiptBoundSessionIds,
      ...uncertainSessionIds,
      `${receiptBoundSessionIds.at(-1)}-near-match`,
      "summary-unclassified-session",
    ];

    vi.stubEnv("PRODUCT_ENVIRONMENT", "production");
    for (const [index, sessionId] of productionSessionIds.entries()) {
      await t.mutation(internal.productEvents.emit, {
        eventId: `summary-production-event-${index}`,
        eventName: "match_start",
        occurredAt: Date.parse("2026-09-22T15:10:53.661Z") + index,
        sessionId,
        props: {
          room_players: 2,
          round_count: 6,
        },
      });
    }
    vi.stubEnv("PRODUCT_ENVIRONMENT", "staging");
    await t.mutation(internal.productEvents.emit, {
      eventId: "summary-staging-event",
      eventName: "match_start",
      occurredAt: Date.parse("2026-09-22T15:10:53.700Z"),
      sessionId: receiptBoundSessionIds[0],
      props: {
        room_players: 2,
        round_count: 6,
      },
    });
    const rowsBefore = await t.run((ctx) =>
      ctx.db.query("productEvents").collect(),
    );

    const summary = await t.query(api.productEvents.summary, {
      environment: "production",
    });
    const rowsAfter = await t.run((ctx) =>
      ctx.db.query("productEvents").collect(),
    );

    expect(summary).toMatchObject({
      sampledEvents: 7,
      fixtureEventsExcluded: 3,
      unclassifiedEventsRetained: 4,
      genuineEventsRetained: 4,
      sessionsStarted: 4,
    });
    expect(rowsBefore).toHaveLength(8);
    expect(rowsAfter).toEqual(rowsBefore);
  });
  it("scores a three-player exact pair and limits one extra round to tied leaders", async () => {
    // The fixture judge finds distinct canonical texts different.
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body)) as {
          questions: Record<string, unknown>;
        };
        return Response.json({
          answers: Object.fromEntries(
            Object.keys(body.questions).map((name) => [
              name,
              { type: "noul", noul: 0.01 },
            ]),
          ),
        });
      }),
    );
    const three = await fixture();
    const thirdToken = await token("third-player");
    const joined = await three.t.mutation(api.rooms.joinRoom, {
      code: three.room.code,
      displayName: "Third",
      guestToken: thirdToken,
    });
    if (!("roomId" in joined)) throw new Error(joined.code);
    const threeMatch = await three.t.mutation(api.game.start, {
      roomId: three.room.roomId,
      guestToken: three.hostToken,
    });
    const first = await three.t.query(api.game.view, {
      roomId: three.room.roomId,
      guestToken: three.hostToken,
    });
    if (!first.match || !("round" in first.match) || !first.match.round)
      throw new Error("round missing");
    expect(first.match.round.answeredPlayerIds).toEqual([]);
    const firstRoundId = first.match.round.id;
    for (const [guestToken, text] of [
      [three.hostToken, "moon"],
      [three.guestToken, "moon"],
      [thirdToken, "sun"],
    ]) {
      await three.t.mutation(api.game.submitAnswer, {
        roomId: three.room.roomId,
        matchId: threeMatch,
        roundId: firstRoundId,
        guestToken: guestToken!,
        text: text!,
      });
      const waiting = await three.t.query(api.game.view, {
        roomId: three.room.roomId,
        guestToken: three.hostToken,
      });
      if (!waiting.match || !("round" in waiting.match))
        throw new Error("round missing");
      if (waiting.match.round?.status !== "revealed")
        expect(waiting.match.reveal).toBeNull();
    }
    await flush(three.t);
    const revealed = await three.t.query(api.game.view, {
      roomId: three.room.roomId,
      guestToken: thirdToken,
    });
    if (!revealed.match || !("standings" in revealed.match))
      throw new Error("standings missing");
    expect(revealed.match.standings).toMatchObject([{ total: 1, delta: 1 }]);
    expect(
      revealed.match.reveal?.groups.map(({ kind, scored }) => ({
        kind,
        scored,
      })),
    ).toEqual([
      { kind: "pair", scored: true },
      { kind: "single", scored: false },
    ]);

    const four = await fixture();
    const extraTokens = [await token("third-tie"), await token("fourth-tie")];
    for (const [index, guestToken] of extraTokens.entries()) {
      const member = await four.t.mutation(api.rooms.joinRoom, {
        code: four.room.code,
        displayName: `Extra ${index}`,
        guestToken,
      });
      if (!("roomId" in member)) throw new Error(member.code);
    }
    const players = [four.hostToken, four.guestToken, ...extraTokens];
    const matchId = await four.t.mutation(api.game.start, {
      roomId: four.room.roomId,
      guestToken: four.hostToken,
    });
    for (let index = 0; index <= 6; index += 1) {
      const before = await four.t.query(api.game.view, {
        roomId: four.room.roomId,
        guestToken: four.hostToken,
      });
      if (!before.match || !("round" in before.match) || !before.match.round)
        throw new Error("round missing");
      expect(before.match.round.index).toBe(index);
      expect(before.match.round.tiebreak).toBe(index === 6);
      const currentRoundId = before.match.round.id;
      if (index === 6) expect(before.match.tiedPairs).toHaveLength(2);
      const texts =
        index === 0
          ? ["moon", "moon", "sun", "sun"]
          : index === 6
            ? ["star", "other", "star", "third"]
            : players.map((_, seat) => `unique ${index} ${seat}`);
      for (const [seat, guestToken] of players.entries()) {
        await four.t.mutation(api.game.submitAnswer, {
          roomId: four.room.roomId,
          matchId,
          roundId: currentRoundId,
          guestToken,
          text: texts[seat]!,
        });
      }
      await flush(four.t);
      const after = await four.t.query(api.game.view, {
        roomId: four.room.roomId,
        guestToken: four.hostToken,
      });
      if (!after.match || !("standings" in after.match))
        throw new Error("standings missing");
      if (index === 6) {
        expect(
          after.match.reveal?.groups.find((group) => group.kind === "pair"),
        ).toMatchObject({ scored: false });
        const saved = await four.t.run((ctx) =>
          ctx.db
            .query("roundResults")
            .withIndex("by_round", (q) => q.eq("roundId", currentRoundId))
            .unique(),
        );
        expect(saved?.pairs).toMatchObject([{ scored: false }]);
      }
      await four.t.mutation(api.game.advance, {
        roomId: four.room.roomId,
        matchId,
        guestToken: four.hostToken,
      });
    }
    const final = await four.t.query(api.game.view, {
      roomId: four.room.roomId,
      guestToken: four.hostToken,
    });
    if (!final.match || !("result" in final.match))
      throw new Error("result missing");
    expect(final.match.result).toMatchObject({
      shared: true,
      decidedBy: "extra",
      total: 1,
    });
    expect(final.match.result?.winners).toHaveLength(2);
    expect(
      await four.t.run((ctx) =>
        ctx.db.query("rounds").withIndex("by_game_index").collect(),
      ),
    ).toHaveLength(7);
  });
});
