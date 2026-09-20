import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";
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

/**
 * Server-side Jev adapter. One decisions call per round carries one noul per
 * still-unadjudicated canonical pair, so an outage leaves the whole round
 * pending — never partially or falsely judged. Verdicts are retained per
 * (prompt, pair) with their probability and rubric version; duplicate
 * submissions hit that cache and never reroll a judgment.
 */

const MATCH_THRESHOLD = 0.5;
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
  const apiKey = process.env.OPENROUTER_API_KEY;
  const model = process.env.JEV_MODEL;
  const url = process.env.JEV_DECISIONS_URL;
  if (!apiKey || !model || !url) {
    throw new Error("JEV_UNCONFIGURED");
  }
  const questions: Record<string, unknown> = {};
  pairs.forEach((pair, index) => {
    questions[`pair${index}`] = {
      type: "noul",
      // Player text is untrusted DATA referenced by the question, never
      // instructions.
      instructions: {
        prompt: promptText,
        answer_a: pair.a,
        answer_b: pair.b,
        question:
          "Do `answer_a` and `answer_b` express the same specific thought or thing for `prompt`, ignoring spelling, casing, and phrasing?",
      },
      criteria: {
        true:
          "Exact contextual equivalence: the same referent — synonyms, plurals, abbreviations, or minor spelling variants (car/automobile, goose/geese).",
        false:
          "Different referents, even related ones or the same category (car/bus, goose/swan, dog/cat).",
      },
    };
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

export const adjudicateRound = internalAction({
  args: { roundId: v.id("rounds"), attempt: v.number() },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
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
    // Distinct canonical forms, first-appearance order.
    const canonicalOrder: string[] = [];
    for (const answer of answers) {
      if (!canonicalOrder.includes(answer.normalized)) {
        canonicalOrder.push(answer.normalized);
      }
    }

    // Retained adjudications for this prompt are the no-reroll cache.
    const retainedRows = await ctx.db
      .query("adjudications")
      .withIndex("by_prompt_pair", (q) => q.eq("promptId", round.promptId))
      .collect();
    const retained: Record<string, OracleOutcome> = {};
    for (const row of retainedRows) {
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
      await ctx.db.patch(round._id, { attempts: nextAttempt });
      if (nextAttempt <= MAX_AUTO_RETRIES) {
        await ctx.scheduler.runAfter(
          30_000 * nextAttempt,
          internal.jev.adjudicateRound,
          { roundId: round._id, attempt: nextAttempt },
        );
      }
    };

    if (pending.length > MAX_PAIRS_PER_CALL) {
      await scheduleRetry();
      return null;
    }

    if (pending.length > 0) {
      try {
        const decided = await jevDecisions(prompt.text, pending);
        for (const decision of decided) {
          const verdict: OracleOutcome =
            decision.probability >= MATCH_THRESHOLD ? "match" : "distinct";
          await ctx.db.insert("adjudications", {
            promptId: round.promptId,
            pairKey: decision.key,
            a: decision.a,
            b: decision.b,
            verdict,
            probability: decision.probability,
            model: process.env.JEV_MODEL ?? "unknown",
            rubricVersion: EQUIVALENCE_RUBRIC_VERSION,
          });
          if (retained[decision.key] === undefined) {
            retained[decision.key] = verdict;
          }
        }
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
    const clustered: ClusteredAnswer[] = answers.map((answer) => ({
      answerId: answer.playerId,
      playerId: answer.playerId,
      text: answer.text,
      normalized: answer.normalized,
    }));
    const oracle = (a: string, b: string): OracleOutcome =>
      retained[pairKey(a, b)] ?? "distinct";
    const result = await clusterAnswers(clustered, oracle, retained);

    const participants = await ctx.db
      .query("matchParticipants")
      .withIndex("by_match", (q) => q.eq("matchId", round.matchId))
      .collect();
    const playerIds = participants.map((participant) => participant.playerId);
    const scoreMap =
      game.mode === "soulmate" && game.pairs
        ? soulmateRoundScores(
            result.clusters,
            game.pairs.map((pair) => [pair.a, pair.b] as const),
          )
        : hiveMindRoundScores(result.clusters, playerIds);

    const existingResult = await ctx.db
      .query("roundResults")
      .withIndex("by_round", (q) => q.eq("roundId", round._id))
      .unique();
    if (existingResult === null) {
      await ctx.db.insert("roundResults", {
        roundId: round._id,
        clusters: result.clusters.map((cluster) => ({
          anchor: cluster.anchor,
          answers: cluster.answers.map((answer) => ({
            playerId: answer.playerId,
            text: answer.text,
            normalized: answer.normalized,
          })),
        })),
        scores: [...scoreMap].map(([playerId, points]) => ({
          playerId,
          points,
        })),
        overrides: [],
        pendingPairs: result.unresolvedPairs.length,
        rubricVersion: EQUIVALENCE_RUBRIC_VERSION,
        model: process.env.JEV_MODEL ?? "unknown",
      });
    }
    await ctx.db.patch(round._id, {
      status: "revealed",
      revealedAt: Date.now(),
    });
    return null;
  },
});

export const MAX_JEV_ATTEMPTS = MAX_ATTEMPTS;