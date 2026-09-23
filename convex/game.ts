import {
  beginMatch,
  completeMatch,
  requireActiveMatch,
  resolvePlayer,
} from "@parlor/convex";
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import { PROMPT_DECK, promptById } from "./prompts";
import { pairStandings, topPairs, validateAnswer } from "./rules";
import { MAX_JEV_ATTEMPTS } from "./jev";

const PARTY_ROUNDS = 6;
const MAX_PLAYERS = 12;
/**
 * Deterministic server-owned shuffle seeded by the match id.
 */
function shuffledPrompts(seed: string, count: number): string[] {
  const ids = PROMPT_DECK.map((prompt) => prompt.id);
  let state = 0x811c9dc5;
  for (let i = 0; i < seed.length; i += 1) {
    state ^= seed.charCodeAt(i);
    state = Math.imul(state, 0x01000193);
  }
  const rand = () => {
    state = Math.imul(state ^ (state >>> 15), 0x2545f491);
    state = (state + 0x9e3779b9) >>> 0;
    return state / 0x100000000;
  };
  for (let i = ids.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    const held = ids[i]!;
    ids[i] = ids[j]!;
    ids[j] = held;
  }
  return ids.slice(0, Math.min(count, ids.length));
}

export const start = mutation({
  args: {
    roomId: v.id("rooms"),
    guestToken: v.string(),
  },
  returns: v.id("matches"),
  handler: async (ctx, args) => {
    const actor = await resolvePlayer(ctx, args.guestToken);
    const previousMatch = await ctx.db
      .query("matches")
      .withIndex("by_room_cycle", (q) => q.eq("roomId", args.roomId))
      .order("desc")
      .first();
    const match = await beginMatch(ctx, {
      roomId: args.roomId,
      actor,
      minPlayers: 2,
      maxPlayers: MAX_PLAYERS,
    });
    const participants = await ctx.db
      .query("matchParticipants")
      .withIndex("by_match", (q) => q.eq("matchId", match.id))
      .collect();
    const promptIds = shuffledPrompts(match.id, PARTY_ROUNDS + 1);
    const gameId = await ctx.db.insert("games", {
      matchId: match.id,
      promptIds,
    });
    const roundId = await ctx.db.insert("rounds", {
      gameId,
      matchId: match.id,
      index: 0,
      promptId: promptIds[0]!,
      status: "answering",
      attempts: 0,
      tiebreak: false,
    });
    const eventTasks = [
      ctx.scheduler.runAfter(0, internal.productEvents.emit, {
        eventId: `${match.id}:start`,
        eventName: "match_start" as const,
        occurredAt: match.startedAt,
        sessionId: match.id,
        props: {
          room_players: participants.length,
          round_count: PARTY_ROUNDS,
        },
      }),
      ctx.scheduler.runAfter(0, internal.productEvents.emit, {
        eventId: `${roundId}:start`,
        eventName: "round_start" as const,
        occurredAt: match.startedAt,
        sessionId: match.id,
        props: { round_index: 0, prompt_id: promptIds[0]! },
      }),
    ];
    if (
      previousMatch?.status === "completed" ||
      previousMatch?.status === "abandoned"
    ) {
      eventTasks.push(
        ctx.scheduler.runAfter(0, internal.productEvents.emit, {
          eventId: `${match.id}:replay`,
          eventName: "replay" as const,
          occurredAt: match.startedAt,
          sessionId: match.id,
          props: {
            previous_result: previousMatch.status,
          },
        }),
      );
    }
    await Promise.all(eventTasks);
    return match.id;
  },
});

export const submitAnswer = mutation({
  args: {
    roomId: v.id("rooms"),
    matchId: v.id("matches"),
    roundId: v.id("rounds"),
    guestToken: v.string(),
    text: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const actor = await resolvePlayer(ctx, args.guestToken);
    await requireActiveMatch(ctx, args.matchId, args.roomId);
    const participant = await ctx.db
      .query("matchParticipants")
      .withIndex("by_match_player", (q) =>
        q.eq("matchId", args.matchId).eq("playerId", actor.playerId),
      )
      .unique();
    if (!participant) {
      throw new ConvexError({ code: "MATCH_PARTICIPANT_REQUIRED" });
    }
    const round = await ctx.db.get(args.roundId);
    if (!round || round.matchId !== args.matchId) {
      throw new ConvexError({ code: "ROUND_NOT_FOUND" });
    }
    if (round.status !== "answering") {
      throw new ConvexError({ code: "ROUND_NOT_ANSWERING" });
    }
    const existing = await ctx.db
      .query("answers")
      .withIndex("by_round_player", (q) =>
        q.eq("roundId", round._id).eq("playerId", actor.playerId),
      )
      .unique();
    if (existing) {
      throw new ConvexError({ code: "ANSWER_ALREADY_SUBMITTED" });
    }
    const validation = validateAnswer(args.text);
    if (!validation.ok) {
      throw new ConvexError({ code: validation.code });
    }
    const answerId = await ctx.db.insert("answers", {
      roundId: round._id,
      playerId: actor.playerId,
      text: args.text.trim(),
      normalized: validation.normalized,
    });
    const answers = await ctx.db
      .query("answers")
      .withIndex("by_round", (q) => q.eq("roundId", round._id))
      .collect();
    const participants = await ctx.db
      .query("matchParticipants")
      .withIndex("by_match", (q) => q.eq("matchId", args.matchId))
      .collect();
    await ctx.scheduler.runAfter(0, internal.productEvents.emit, {
      eventId: `${answerId}:submitted`,
      eventName: "answer_submitted",
      occurredAt: Date.now(),
      sessionId: args.matchId,
      props: {
        round_index: round.index,
        answer_length: validation.normalized.length,
      },
    });
    if (answers.length >= participants.length) {
      await ctx.db.patch(round._id, { status: "adjudicating" });
      await ctx.scheduler.runAfter(0, internal.jev.adjudicateRound, {
        roundId: round._id,
        attempt: 0,
      });
    }
    return null;
  },
});

/** Host advances to the next round, or finalizes and completes the match. */
export const advance = mutation({
  args: {
    roomId: v.id("rooms"),
    matchId: v.id("matches"),
    guestToken: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const actor = await resolvePlayer(ctx, args.guestToken);
    await requireActiveMatch(ctx, args.matchId, args.roomId);
    const room = await ctx.db.get(args.roomId);
    if (!room || room.hostPlayerId !== actor.playerId) {
      throw new ConvexError({ code: "HOST_REQUIRED" });
    }
    const game = await ctx.db
      .query("games")
      .withIndex("by_match", (q) => q.eq("matchId", args.matchId))
      .unique();
    if (!game) {
      throw new ConvexError({ code: "GAME_NOT_FOUND" });
    }
    const round = await ctx.db
      .query("rounds")
      .withIndex("by_game_index", (q) => q.eq("gameId", game._id))
      .order("desc")
      .first();
    if (!round || round.status !== "revealed") {
      throw new ConvexError({ code: "ROUND_NOT_READY_TO_ADVANCE" });
    }
    const nextIndex = round.index + 1;
    if (nextIndex < PARTY_ROUNDS) {
      const nextRoundId = await ctx.db.insert("rounds", {
        gameId: game._id,
        matchId: args.matchId,
        index: nextIndex,
        promptId: game.promptIds[nextIndex]!,
        status: "answering",
        tiebreak: false,
        attempts: 0,
      });
      await ctx.scheduler.runAfter(0, internal.productEvents.emit, {
        eventId: `${nextRoundId}:start`,
        eventName: "round_start",
        occurredAt: Date.now(),
        sessionId: args.matchId,
        props: {
          round_index: nextIndex,
          prompt_id: game.promptIds[nextIndex]!,
        },
      });
      return null;
    }
    const rounds = await ctx.db
      .query("rounds")
      .withIndex("by_game_index", (q) => q.eq("gameId", game._id))
      .collect();
    rounds.sort((a, b) => a.index - b.index);
    const results = await Promise.all(
      rounds.map((row) =>
        ctx.db
          .query("roundResults")
          .withIndex("by_round", (q) => q.eq("roundId", row._id))
          .unique(),
      ),
    );
    const revealed = results.filter((result) => result !== null);
    const standings = pairStandings(revealed);
    const leaders = topPairs(standings).map((pair) => ({
      a: pair.a as Id<"players">,
      b: pair.b as Id<"players">,
    }));
    if (nextIndex === PARTY_ROUNDS && leaders.length > 1) {
      // US-006: exactly one extra question, restricted to the tied leaders.
      await ctx.db.patch(game._id, { tiedPairs: leaders });
      const promptId = game.promptIds[PARTY_ROUNDS]!;
      const nextRoundId = await ctx.db.insert("rounds", {
        gameId: game._id,
        matchId: args.matchId,
        index: PARTY_ROUNDS,
        promptId,
        tiebreak: true,
        status: "answering",
        attempts: 0,
      });
      await ctx.scheduler.runAfter(0, internal.productEvents.emit, {
        eventId: `${nextRoundId}:start`,
        eventName: "round_start",
        occurredAt: Date.now(),
        sessionId: args.matchId,
        props: { round_index: PARTY_ROUNDS, prompt_id: promptId },
      });
      return null;
    }
    const winners = leaders;
    const result = {
      winners,
      shared: winners.length > 1,
      decidedBy: (round.tiebreak ? "extra" : "questions") as
        "extra" | "questions",
      total: standings[0]?.total ?? 0,
    };
    await ctx.db.patch(game._id, { result });
    await completeMatch(ctx, { matchId: args.matchId, actor });
    const totalScore = standings.reduce((sum, pair) => sum + pair.total, 0);
    await ctx.scheduler.runAfter(0, internal.productEvents.emit, {
      eventId: `${args.matchId}:complete`,
      eventName: "match_complete",
      occurredAt: Date.now(),
      sessionId: args.matchId,
      props: { rounds_played: rounds.length, total_score: totalScore },
    });
    return null;
  },
});

/** Host-triggered fair retry while a round is honestly pending. */
export const retryJudgment = mutation({
  args: {
    roomId: v.id("rooms"),
    matchId: v.id("matches"),
    roundId: v.id("rounds"),
    guestToken: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const actor = await resolvePlayer(ctx, args.guestToken);
    await requireActiveMatch(ctx, args.matchId, args.roomId);
    const room = await ctx.db.get(args.roomId);
    if (!room || room.hostPlayerId !== actor.playerId) {
      throw new ConvexError({ code: "HOST_REQUIRED" });
    }
    const round = await ctx.db.get(args.roundId);
    if (!round || round.matchId !== args.matchId) {
      throw new ConvexError({ code: "ROUND_NOT_FOUND" });
    }
    if (round.status !== "adjudicating") {
      throw new ConvexError({ code: "ROUND_NOT_PENDING" });
    }
    if (round.attempts >= MAX_JEV_ATTEMPTS) {
      throw new ConvexError({ code: "JUDGE_EXHAUSTED" });
    }
    await ctx.scheduler.runAfter(0, internal.jev.adjudicateRound, {
      roundId: round._id,
      attempt: round.attempts,
    });
    return null;
  },
});

/** US-003: before reveal, only the viewer's text crosses this boundary. */
export const view = query({
  args: { roomId: v.id("rooms"), guestToken: v.string() },
  handler: async (ctx, args) => {
    const actor = await resolvePlayer(ctx, args.guestToken);
    const room = await ctx.db.get(args.roomId);
    if (!room) {
      throw new ConvexError({ code: "ROOM_NOT_FOUND" });
    }
    const member = await ctx.db
      .query("roomMembers")
      .withIndex("by_room_player", (q) =>
        q.eq("roomId", args.roomId).eq("playerId", actor.playerId),
      )
      .unique();
    if (!member) {
      throw new ConvexError({ code: "NOT_A_ROOM_MEMBER" });
    }
    const members = await ctx.db
      .query("roomMembers")
      .withIndex("by_room_player", (q) => q.eq("roomId", args.roomId))
      .collect();
    const base = {
      viewerPlayerId: actor.playerId,
      room: {
        id: room._id,
        code: room.code,
        hostPlayerId: room.hostPlayerId,
        closedAt: room.closedAt ?? null,
      },
      members: members
        .filter((m) => m.closedAt === undefined)
        .sort((a, b) => a.seatIndex - b.seatIndex)
        .map((m) => ({
          playerId: m.playerId,
          displayName: m.displayName,
          seatIndex: m.seatIndex,
          isHost: m.playerId === room.hostPlayerId,
          joinedAt: m.joinedAt,
          lastSeenAt: m.lastSeenAt ?? 0,
        })),
    };
    if (member.closedAt !== undefined) {
      return { ...base, match: null };
    }
    const match = await ctx.db
      .query("matches")
      .withIndex("by_room_cycle", (q) => q.eq("roomId", args.roomId))
      .order("desc")
      .first();
    if (!match) {
      return { ...base, match: null };
    }
    const game = await ctx.db
      .query("games")
      .withIndex("by_match", (q) => q.eq("matchId", match._id))
      .unique();
    if (!game) {
      return { ...base, match: { id: match._id, status: match.status } };
    }
    const participants = await ctx.db
      .query("matchParticipants")
      .withIndex("by_match", (q) => q.eq("matchId", match._id))
      .collect();
    const playing = participants.some((p) => p.playerId === actor.playerId);
    if (!playing) {
      return {
        ...base,
        match: { id: match._id, status: match.status, spectator: true },
      };
    }
    participants.sort((a, b) => a.seatIndex - b.seatIndex);
    const rounds = await ctx.db
      .query("rounds")
      .withIndex("by_game_index", (q) => q.eq("gameId", game._id))
      .collect();
    rounds.sort((a, b) => a.index - b.index);
    const round = rounds.at(-1) ?? null;
    const revealedResults = await Promise.all(
      rounds
        .filter((row) => row.status === "revealed")
        .map((row) =>
          ctx.db
            .query("roundResults")
            .withIndex("by_round", (q) => q.eq("roundId", row._id))
            .unique(),
        ),
    );
    const scoredRounds = revealedResults.filter((result) => result !== null);
    const standings = pairStandings(scoredRounds).map((standing) => ({
      a: standing.a as Id<"players">,
      b: standing.b as Id<"players">,
      total: standing.total,
      delta: standing.delta,
    }));
    const answers = round
      ? await ctx.db
          .query("answers")
          .withIndex("by_round", (q) => q.eq("roundId", round._id))
          .collect()
      : [];
    const latestResult =
      round?.status === "revealed" && scoredRounds.at(-1)?.roundId === round._id
        ? scoredRounds.at(-1)
        : null;
    const scoring = new Set(
      latestResult?.pairs
        .filter((pair) => pair.scored)
        .map((pair) => `${pair.a}\u0000${pair.b}`) ?? [],
    );
    const groups =
      latestResult?.clusters
        .map((cluster) => {
          const kind =
            cluster.answers.length === 1
              ? ("single" as const)
              : cluster.answers.length === 2
                ? ("pair" as const)
                : ("crowd" as const);
          const [first, second] = cluster.answers;
          const key =
            kind === "pair"
              ? [first!.playerId, second!.playerId].sort().join("\u0000")
              : "";
          return {
            kind,
            scored: kind === "pair" && scoring.has(key),
            answers: cluster.answers.map((answer) => ({
              playerId: answer.playerId,
              text: answer.text,
            })),
          };
        })
        .sort((a, b) => {
          const rank = (group: {
            kind: "single" | "pair" | "crowd";
            scored: boolean;
          }) =>
            group.kind === "pair"
              ? group.scored
                ? 0
                : 1
              : group.kind === "crowd"
                ? 2
                : 3;
          return (
            rank(a) - rank(b) ||
            (a.kind === "crowd" ? b.answers.length - a.answers.length : 0)
          );
        }) ?? null;
    return {
      ...base,
      match: {
        id: match._id,
        status: match.status,
        roundCount: PARTY_ROUNDS as 6,
        participantIds: participants.map((participant) => participant.playerId),
        round: round
          ? {
              id: round._id,
              index: round.index,
              tiebreak: round.tiebreak,
              status: round.status,
              attempts: round.attempts,
              prompt: promptById.get(round.promptId)?.text ?? "",
              myAnswer:
                answers.find((answer) => answer.playerId === actor.playerId)
                  ?.text ?? null,
              answeredPlayerIds: answers.map((answer) => answer.playerId),
            }
          : null,
        reveal: groups === null ? null : { groups },
        standings,
        tiedPairs: game.tiedPairs ?? null,
        result: game.result ?? null,
      },
    };
  },
});
