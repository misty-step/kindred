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
import {
  HIVE_MIND_TWO_PLAYER_ROUNDS,
  applyMutualOverrides,
  hiveMindRoundScores,
  playersShareCluster,
  soulmatePairs,
  soulmateRoundScores,
  twoPlayerSessionRecord,
  validateAnswer,
} from "./rules";
import { MAX_JEV_ATTEMPTS } from "./jev";

const PARTY_ROUNDS = 5;
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
    mode: v.union(v.literal("hive-mind"), v.literal("soulmate")),
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
    participants.sort((a, b) => a.seatIndex - b.seatIndex);
    const twoPlayer = participants.length === 2;
    const roundCount =
      twoPlayer && args.mode === "hive-mind"
        ? HIVE_MIND_TWO_PLAYER_ROUNDS
        : PARTY_ROUNDS;
    const promptIds = shuffledPrompts(match.id, roundCount);
    const pairs =
      args.mode === "soulmate"
        ? soulmatePairs(participants.map((participant) => participant.playerId)).map(
            ([a, b]) => ({ a, b }),
          )
        : undefined;
    const gameId = await ctx.db.insert("games", {
      matchId: match.id,
      mode: args.mode,
      promptIds,
      ...(pairs !== undefined ? { pairs } : {}),
    });
    const roundId = await ctx.db.insert("rounds", {
      gameId,
      matchId: match.id,
      index: 0,
      promptId: promptIds[0]!,
      status: "answering",
      attempts: 0,
    });
    const eventTasks = [
      ctx.scheduler.runAfter(0, internal.productEvents.emit, {
        eventId: `${match.id}:start`,
        eventName: "match_start" as const,
        occurredAt: match.startedAt,
        sessionId: match.id,
        props: {
          room_players: participants.length,
          round_count: promptIds.length,
          game_mode: args.mode,
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
    if (previousMatch?.status === "completed" || previousMatch?.status === "abandoned") {
      eventTasks.push(
        ctx.scheduler.runAfter(0, internal.productEvents.emit, {
          eventId: `${match.id}:replay`,
          eventName: "replay" as const,
          occurredAt: match.startedAt,
          sessionId: match.id,
          props: { previous_result: previousMatch.status, game_mode: args.mode },
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
      props: { round_index: round.index, answer_length: validation.normalized.length },
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

/** Any participant can move an anonymous reveal to the names phase. */
export const revealNames = mutation({
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
    if (round.status !== "revealed") {
      throw new ConvexError({ code: "ROUND_NOT_REVEALED" });
    }
    await ctx.db.patch(round._id, { status: "names" });
    return null;
  },
});

/**
 * Mutual shared-memory override: both players must consent. When the second
 * consent lands, the stored clusters merge and scores recompute
 * deterministically. Consents are retained as versioned evidence.
 */
export const claimSharedMemory = mutation({
  args: {
    roomId: v.id("rooms"),
    matchId: v.id("matches"),
    roundId: v.id("rounds"),
    guestToken: v.string(),
    withPlayerId: v.id("players"),
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
    if (round.status !== "names") {
      throw new ConvexError({ code: "OVERRIDE_WINDOW_CLOSED" });
    }
    const result = await ctx.db
      .query("roundResults")
      .withIndex("by_round", (q) => q.eq("roundId", round._id))
      .unique();
    if (!result) {
      throw new ConvexError({ code: "GAME_NOT_FOUND" });
    }
    const sortedPair = [actor.playerId, args.withPlayerId].sort();
    const first = sortedPair[0]!;
    const second = sortedPair[1]!;
    if (first === second) {
      throw new ConvexError({ code: "OVERRIDE_INVALID_PAIR" });
    }
    // Convex document ids never contain spaces, so this pair key is
    // order-independent and collision-free.
    const pairKey = `${first} ${second}`;
    const priorConsent = await ctx.db
      .query("overrideConsents")
      .withIndex("by_round_player", (q) =>
        q.eq("roundId", round._id).eq("playerId", actor.playerId),
      )
      .unique();
    if (!priorConsent || priorConsent.pairKey !== pairKey) {
      if (!priorConsent) {
        await ctx.db.insert("overrideConsents", {
          roundId: round._id,
          pairKey,
          playerId: actor.playerId,
        });
      }
    }
    const consents = await ctx.db
      .query("overrideConsents")
      .withIndex("by_round_pair", (q) =>
        q.eq("roundId", round._id).eq("pairKey", pairKey),
      )
      .collect();
    const distinctPlayers = new Set(consents.map((consent) => consent.playerId));
    if (distinctPlayers.size < 2) {
      return null; // Waiting for the other player's consent.
    }
    const alreadyApplied = result.overrides.some(
      (override) =>
        (override.playerA === first && override.playerB === second) ||
        (override.playerA === second && override.playerB === first),
    );
    if (alreadyApplied) {
      return null;
    }
    const merged = applyMutualOverrides(
      { clusters: result.clusters, verdicts: {}, unresolvedPairs: [] },
      [{ playerA: first, playerB: second }],
    );
    const game = await ctx.db.get(round.gameId);
    if (!game) {
      throw new ConvexError({ code: "GAME_NOT_FOUND" });
    }
    const participants = await ctx.db
      .query("matchParticipants")
      .withIndex("by_match", (q) => q.eq("matchId", args.matchId))
      .collect();
    const scoreMap =
      game.mode === "soulmate" && game.pairs
        ? soulmateRoundScores(
            merged.clusters,
            game.pairs.map((pair) => [pair.a, pair.b] as const),
          )
        : hiveMindRoundScores(
            merged.clusters,
            participants.map((participant) => participant.playerId),
          );
    await ctx.db.patch(result._id, {
      clusters: merged.clusters.map((cluster) => ({
        anchor: cluster.anchor,
        answers: cluster.answers.map((answer) => ({
          playerId: answer.playerId as Id<"players">,
          text: answer.text,
          normalized: answer.normalized,
        })),
      })),
      scores: [...scoreMap].map(([playerId, points]) => ({
        playerId: playerId as Id<"players">,
        points,
      })),
      overrides: [...result.overrides, { playerA: first, playerB: second }],
    });
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
    if (!round || round.status !== "names") {
      throw new ConvexError({ code: "ROUND_NOT_READY_TO_ADVANCE" });
    }
    const nextIndex = round.index + 1;
    if (nextIndex < game.promptIds.length) {
      const nextRoundId = await ctx.db.insert("rounds", {
        gameId: game._id,
        matchId: args.matchId,
        index: nextIndex,
        promptId: game.promptIds[nextIndex]!,
        status: "answering",
        attempts: 0,
      });
      await ctx.scheduler.runAfter(0, internal.productEvents.emit, {
        eventId: `${nextRoundId}:start`,
        eventName: "round_start",
        occurredAt: Date.now(),
        sessionId: args.matchId,
        props: { round_index: nextIndex, prompt_id: game.promptIds[nextIndex]! },
      });
      return null;
    }
    // Final round: compute the final record, then complete the match.
    const rounds = await ctx.db
      .query("rounds")
      .withIndex("by_game_index", (q) => q.eq("gameId", game._id))
      .collect();
    rounds.sort((a, b) => a.index - b.index);
    const results = [];
    for (const row of rounds) {
      const result = await ctx.db
        .query("roundResults")
        .withIndex("by_round", (q) => q.eq("roundId", row._id))
        .unique();
      if (result) {
        results.push(result);
      }
    }
    const participants = await ctx.db
      .query("matchParticipants")
      .withIndex("by_match", (q) => q.eq("matchId", args.matchId))
      .collect();
    if (game.mode === "hive-mind" && participants.length === 2) {
      // Session record, not a compatibility score.
      const [a, b] = [
        participants[0]!.playerId,
        participants[1]!.playerId,
      ];
      const record = twoPlayerSessionRecord(
        results.map((result) => ({
          matched: playersShareCluster(result.clusters, a, b),
        })),
      );
      await ctx.db.patch(game._id, { sessionRecord: record });
    } else {
      const totals = new Map<Id<"players">, number>();
      for (const result of results) {
        for (const score of result.scores) {
          totals.set(score.playerId, (totals.get(score.playerId) ?? 0) + score.points);
        }
      }
      await ctx.db.patch(game._id, {
        totals: [...totals]
          .map(([playerId, points]) => ({ playerId, points }))
          .sort((x, y) => y.points - x.points),
      });
    }
    await completeMatch(ctx, { matchId: args.matchId, actor });
    const totalScore = results.reduce(
      (sum, result) =>
        sum + result.scores.reduce((roundSum, score) => roundSum + score.points, 0),
      0,
    );
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

/**
 * Viewer-safe projection. Before a reveal, no other player's answer text,
 * clusters, or scores are ever sent. Anonymous clusters carry texts only;
 * names attach only in the names phase.
 */
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
    const namesById = new Map(members.map((m) => [m.playerId, m.displayName]));
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
    const round = await ctx.db
      .query("rounds")
      .withIndex("by_game_index", (q) => q.eq("gameId", game._id))
      .order("desc")
      .first();
    if (!round) {
      return {
        ...base,
        match: { id: match._id, status: match.status, mode: game.mode },
      };
    }
    const prompt = promptById.get(round.promptId);
    const myAnswer = await ctx.db
      .query("answers")
      .withIndex("by_round_player", (q) =>
        q.eq("roundId", round._id).eq("playerId", actor.playerId),
      )
      .unique();
    const answerCount = (
      await ctx.db
        .query("answers")
        .withIndex("by_round", (q) => q.eq("roundId", round._id))
        .collect()
    ).length;
    const result =
      round.status === "revealed" || round.status === "names"
        ? await ctx.db
            .query("roundResults")
            .withIndex("by_round", (q) => q.eq("roundId", round._id))
            .unique()
        : null;
    const revealed = round.status === "revealed" || round.status === "names";
    const namesOut = round.status === "names";
    const projected = result
      ? {
          clusters: result.clusters.map((cluster) => ({
            anchor: cluster.anchor,
            answers: namesOut
              ? cluster.answers.map((answer) => ({
                  name: namesById.get(answer.playerId) ?? "Player",
                  text: answer.text,
                }))
              : cluster.answers.map((answer) => ({
                  name: null,
                  text: answer.text,
                })),
          })),
          scores: namesOut
            ? result.scores.map((score) => ({
                name: namesById.get(score.playerId) ?? "Player",
                points: score.points,
              }))
            : null,
          overrides: result.overrides.map((override) => ({
            playerA: override.playerA,
            playerB: override.playerB,
          })),
        }
      : null;
    return {
      ...base,
      match: {
        id: match._id,
        status: match.status,
        mode: game.mode,
        roundCount: game.promptIds.length,
        pairs:
          game.pairs && namesOut
            ? game.pairs.map((pair) => ({
                a: namesById.get(pair.a) ?? "Player",
                b: namesById.get(pair.b) ?? "Player",
              }))
            : null,
        round: {
          id: round._id,
          index: round.index,
          status: round.status,
          attempts: round.attempts,
          prompt: prompt?.text ?? "",
          category: prompt?.category ?? "ordinary",
          myAnswer: myAnswer ? myAnswer.text : null,
          answerCount,
          participantCount: participants.length,
          houseAnswers:
            game.mode === "soulmate" &&
            participants.length === 2 &&
            revealed
              ? prompt?.houseAnswers ?? []
              : null,
        },
        reveal: projected,
        sessionRecord: game.sessionRecord ?? null,
        totals: game.totals
          ? game.totals.map((total) => ({
              playerId: total.playerId,
              name: namesById.get(total.playerId) ?? "Player",
              points: total.points,
            }))
          : null,
      },
    };
  },
});