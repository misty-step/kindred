import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { promptById } from "./prompts";
import {
  EQUIVALENCE_RUBRIC_VERSION,
  clusterAnswers,
  hiveMindRoundScores,
  pairKey,
  soulmateRoundScores,
  type ClusteredAnswer,
  type OracleOutcome,
} from "./rules";
import { MATCH_THRESHOLD, equivalenceNoul } from "./rubric";

/**
 * Server-side Jev adapter. Convex actions have no ctx.db: reads go through
 * internal queries, writes through internal mutations. One decisions call per
 * round carries one noul per still-unadjudicated canonical pair, so an outage
 * leaves the whole round pending — never partially or falsely judged.
 * Verdicts are retained per (prompt, pair) with probability and rubric
 * version; duplicate submissions hit that cache and never reroll a judgment.
 */

declare const process: { env: Record<string, string | undefined> };

const MAX_AUTO_RETRIES = 3;
const MAX_ATTEMPTS = 8;
const REQUEST_TIMEOUT_MS = 15_000;
/** 12 players worst case C(12,2); refuse beyond rather than overpay. */
const MAX_PAIRS_PER_CALL = 66;

interface PendingPair {
  key: string;
  a: string;
  b: string;
}

interface Decision {
  key: string;
  a: string;
  b: string;
  probability: number;
}

async function jevDecisions(
  promptText: string,
  pairs: PendingPair[],
): Promise<Decision[]> {
  const apiKey = process.env["OPENROUTER_API_KEY"];
  const model = process.env["JEV_MODEL"];
  const url = process.env["JEV_DECISIONS_URL"];
  if (!apiKey || !model || !url) {
    throw new Error("JEV_UNCONFIGURED");
  }
  const questions: Record<string, unknown> = {};
  pairs.forEach((pair, index) => {
    questions[`pair${index}`] = equivalenceNoul(promptText, pair.a, pair.b);
  });
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model, state: { prompt: promptText }, questions }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`JEV_HTTP_${response.status}`);
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new Error("JEV_INVALID_RESPONSE");
  }
  const answers =
    typeof body === "object" && body !== null && "answers" in body
      ? (body as { answers: unknown }).answers
      : null;
  if (answers === null || typeof answers !== "object") {
    throw new Error("JEV_INVALID_RESPONSE");
  }
  const byId = answers as Record<string, unknown>;
  return pairs.map((pair, index) => {
    const answer = byId[`pair${index}`] as
      | { type?: unknown; noul?: unknown }
      | undefined;
    if (
      !answer ||
      answer.type !== "noul" ||
      typeof answer.noul !== "number" ||
      !Number.isFinite(answer.noul)
    ) {
      throw new Error("JEV_INVALID_RESPONSE");
    }
    return { key: pair.key, a: pair.a, b: pair.b, probability: answer.noul };
  });
}

export const loadRoundState = internalQuery({
  args: { roundId: v.id("rounds") },
  handler: async (ctx, args) => {
    const round = await ctx.db.get(args.roundId);
    if (!round || round.status !== "adjudicating") {
      return null;
    }
    const game = await ctx.db.get(round.gameId);
    if (!game) {
      return null;
    }
    const prompt = promptById.get(round.promptId);
    if (!prompt) {
      return null;
    }
    const answers = await ctx.db
      .query("answers")
      .withIndex("by_round", (q) => q.eq("roundId", round._id))
      .collect();
    const retainedRows = await ctx.db
      .query("adjudications")
      .withIndex("by_prompt_pair", (q) => q.eq("promptId", round.promptId))
      .collect();
    const participants = await ctx.db
      .query("matchParticipants")
      .withIndex("by_match", (q) => q.eq("matchId", round.matchId))
      .collect();
    return {
      promptId: round.promptId,
      promptText: prompt.text,
      mode: game.mode,
      pairs: game.pairs ?? null,
      answers: answers.map((answer) => ({
        playerId: answer.playerId,
        text: answer.text,
        normalized: answer.normalized,
      })),
      retained: retainedRows.map((row) => ({
        pairKey: row.pairKey,
        verdict: row.verdict,
      })),
      participantIds: participants.map((participant) => participant.playerId),
    };
  },
});

export const saveAdjudications = internalMutation({
  args: {
    rows: v.array(
      v.object({
        promptId: v.string(),
        pairKey: v.string(),
        a: v.string(),
        b: v.string(),
        verdict: v.union(v.literal("match"), v.literal("distinct")),
        probability: v.number(),
        model: v.string(),
        rubricVersion: v.number(),
      }),
    ),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    for (const row of args.rows) {
      await ctx.db.insert("adjudications", row);
    }
    return null;
  },
});

export const failAttempt = internalMutation({
  args: { roundId: v.id("rounds"), attempts: v.number() },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    await ctx.db.patch(args.roundId, { attempts: args.attempts });
    return null;
  },
});

export const saveRoundResult = internalMutation({
  args: {
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
    rubricVersion: v.number(),
    model: v.string(),
    revealedAt: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const existing = await ctx.db
      .query("roundResults")
      .withIndex("by_round", (q) => q.eq("roundId", args.roundId))
      .unique();
    if (!existing) {
      await ctx.db.insert("roundResults", {
        roundId: args.roundId,
        clusters: args.clusters,
        scores: args.scores,
        overrides: [],
        pendingPairs: 0,
        rubricVersion: args.rubricVersion,
        model: args.model,
      });
    }
    await ctx.db.patch(args.roundId, {
      status: "revealed",
      revealedAt: args.revealedAt,
    });
    return null;
  },
});

export const adjudicateRound = internalAction({
  args: { roundId: v.id("rounds"), attempt: v.number() },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const state = await ctx.runQuery(internal.jev.loadRoundState, {
      roundId: args.roundId,
    });
    if (!state) {
      return null;
    }

    // Distinct canonical forms, first-appearance order.
    const canonicalOrder: string[] = [];
    for (const answer of state.answers) {
      if (!canonicalOrder.includes(answer.normalized)) {
        canonicalOrder.push(answer.normalized);
      }
    }

    // Retained adjudications for this prompt are the no-reroll cache.
    const retained: Record<string, OracleOutcome> = {};
    for (const row of state.retained) {
      if (retained[row.pairKey] === undefined) {
        retained[row.pairKey] = row.verdict;
      }
    }

    const pending: PendingPair[] = [];
    for (let i = 0; i < canonicalOrder.length; i += 1) {
      for (let j = i + 1; j < canonicalOrder.length; j += 1) {
        const a = canonicalOrder[i]!;
        const b = canonicalOrder[j]!;
        const key = pairKey(a, b);
        if (retained[key] === undefined) {
          pending.push({ key, a, b });
        }
      }
    }

    const nextAttempt = args.attempt + 1;
    const scheduleRetry = async () => {
      await ctx.runMutation(internal.jev.failAttempt, {
        roundId: args.roundId,
        attempts: nextAttempt,
      });
      if (nextAttempt <= MAX_AUTO_RETRIES) {
        await ctx.scheduler.runAfter(
          30_000 * nextAttempt,
          internal.jev.adjudicateRound,
          { roundId: args.roundId, attempt: nextAttempt },
        );
      }
    };

    if (pending.length > MAX_PAIRS_PER_CALL) {
      await scheduleRetry();
      return null;
    }

    if (pending.length > 0) {
      try {
        const decided = await jevDecisions(state.promptText, pending);
        await ctx.runMutation(internal.jev.saveAdjudications, {
          rows: decided.map((decision) => ({
            promptId: state.promptId,
            pairKey: decision.key,
            a: decision.a,
            b: decision.b,
            verdict:
              decision.probability >= MATCH_THRESHOLD
                ? ("match" as const)
                : ("distinct" as const),
            probability: decision.probability,
            model: process.env["JEV_MODEL"] ?? "unknown",
            rubricVersion: EQUIVALENCE_RUBRIC_VERSION,
          })),
        });
      } catch (error) {
        // Honest outage state: keep the round pending, never fake a judgment,
        // do not consume a player attempt.
        console.error(
          "kindred: adjudication attempt failed:",
          error instanceof Error ? error.message : "unknown error",
        );
        await scheduleRetry();
        return null;
      }
    }

    // All pairs resolved: cluster deterministically with the full verdict map.
    const clustered: ClusteredAnswer[] = state.answers.map((answer) => ({
      answerId: answer.playerId,
      playerId: answer.playerId,
      text: answer.text,
      normalized: answer.normalized,
    }));
    const oracle = (a: string, b: string): OracleOutcome =>
      retained[pairKey(a, b)] ?? "distinct";
    const result = await clusterAnswers(clustered, oracle, retained);

    const scoreMap =
      state.mode === "soulmate" && state.pairs
        ? soulmateRoundScores(
            result.clusters,
            state.pairs.map((pair) => [pair.a, pair.b] as const),
          )
        : hiveMindRoundScores(result.clusters, state.participantIds);

    await ctx.runMutation(internal.jev.saveRoundResult, {
      roundId: args.roundId,
      clusters: result.clusters.map((cluster) => ({
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
      rubricVersion: EQUIVALENCE_RUBRIC_VERSION,
      model: process.env["JEV_MODEL"] ?? "unknown",
      revealedAt: Date.now(),
    });
    return null;
  },
});

export const MAX_JEV_ATTEMPTS = MAX_ATTEMPTS;