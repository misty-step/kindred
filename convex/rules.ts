/**
 * Kindred ("Same Brain") — pure rules.
 *
 * Deterministic answer normalization, equivalence clustering, and scoring.
 * No I/O, no framework imports, no clock, no randomness: identical inputs
 * always produce identical outputs. Convex actions inject the Jev oracle;
 * model outages surface as explicit "pending" states, never fabricated
 * verdicts, so a reveal can wait and retry fairly without consuming attempts.
 *
 * Equivalence semantics (product mandate, 2026-09-20):
 * - Contextual answer equivalence, not relatedness: car ~ automobile, not bus.
 * - No single-link transitive clusters: a candidate joins a cluster only when
 *   it is equivalent to that cluster's anchor. Members are never compared
 *   against each other to chain similarity.
 * - Canonical duplicates (same normalized text) collapse without an oracle
 *   call and never reroll an adjudication.
 */

export const ANSWER_MAX_CHARS = 64;
export const HIVE_MIND_TWO_PLAYER_ROUNDS = 8;
export const SOULMATE_PARTNER_POINTS = 2;
export const SOULMATE_UNIQUE_PARTNER_POINTS = 4;
export const TWO_PLAYER_HOUSE_ANSWER_COUNT = 3;

/** Curated equivalence rubric version. Retained adjudications record it. */
export const EQUIVALENCE_RUBRIC_VERSION = 1;
/** Bump when clustering or scoring semantics change. */
export const RULES_VERSION = "kindred-rules/1";

export interface AnswerSubmission {
  answerId?: string;
  playerId: string;
  /** Raw player text. Untrusted data, never instructions. */
  text: string;
}

export interface ClusteredAnswer {
  /** Optional caller metadata; the algorithm never reads it. */
  answerId?: string;
  playerId: string;
  /** Original submitted text, for display only. */
  text: string;
  /** Canonical form used for equality and oracle keys. */
  normalized: string;
}

export type OracleOutcome = "match" | "distinct" | "pending";

/**
 * Semantic-equivalence oracle (server-side Jev adapter).
 * Contract:
 * - answers only "do A and B express the same thought" — contextual
 *   equivalence, not relatedness;
 * - returns "pending" on timeout or outage instead of guessing;
 * - deterministic per (pair, rubric version) or backed by retained
 *   adjudications, so the same pair never produces two different verdicts.
 */
export type EquivalenceOracle = (
  a: string,
  b: string,
) => Promise<OracleOutcome> | OracleOutcome;

export interface Cluster {
  /** Canonical anchor. New candidates compare against the anchor only. */
  anchor: string;
  answers: ClusteredAnswer[];
}

export interface ClusterResult {
  clusters: Cluster[];
  /**
   * pairKey -> outcome for every pair adjudicated in this run, including
   * pairs retained from previous runs. Persist these as versioned
   * adjudications; they are the no-reroll cache.
   */
  verdicts: Record<string, OracleOutcome>;
  /** Pairs still awaiting adjudication. The reveal must wait for these. */
  unresolvedPairs: string[];
}

/** Authored display-only decoy answers for two-player Soulmate. */
export interface HouseAnswer {
  text: string;
}

/**
 * Canonicalize player text for equality and oracle keys:
 * NFKC, lowercase, control characters become spaces, edge punctuation
 * stripped, whitespace collapsed. Total function: never throws.
 */
export function normalizeAnswer(raw: string): string {
  let text = raw.normalize("NFKC").toLowerCase();
  text = text.replace(/[\u0000-\u001f\u007f]/g, " ");
  const edgePunctuation = new Set([
    ".", "!", "?", ";", ":", ",", "'", '"', "`",
    "\u2019", "\u2018", "\u201c", "\u201d", "(", ")", "~", "*",
  ]);
  const chars = [...text];
  let start = 0;
  let end = chars.length;
  while (start < end && (edgePunctuation.has(chars[start]!) || chars[start] === " ")) {
    start += 1;
  }
  while (end > start && (edgePunctuation.has(chars[end - 1]!) || chars[end - 1] === " ")) {
    end -= 1;
  }
  return chars.slice(start, end).join("").replace(/\s+/g, " ").trim();
}

/** Deterministic, order-independent, collision-free key for an answer pair. */
export function pairKey(a: string, b: string): string {
  // Normalized text never contains NUL (control characters became spaces),
  // so this separator cannot appear inside either operand.
  return a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`;
}

export type AnswerValidation =
  | { ok: true; normalized: string }
  | { ok: false; code: "ANSWER_EMPTY" | "ANSWER_TOO_LONG" };

/** Bounded, deterministic submission validation. */
export function validateAnswer(raw: string): AnswerValidation {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return { ok: false, code: "ANSWER_EMPTY" };
  }
  if ([...trimmed].length > ANSWER_MAX_CHARS) {
    return { ok: false, code: "ANSWER_TOO_LONG" };
  }
  const normalized = normalizeAnswer(raw);
  if (normalized.length === 0) {
    return { ok: false, code: "ANSWER_EMPTY" };
  }
  return { ok: true, normalized };
}

/**
 * Cluster answers by exact contextual equivalence.
 *
 * Algorithm (deterministic, anchor-based):
 * 1. Collapse canonical duplicates: identical normalized texts share a
 *    cluster by definition. The oracle is never asked about them.
 * 2. Walk distinct canonical forms in first-appearance order. Each form is
 *    compared against existing cluster anchors, in creation order, until a
 *    definitive "match" joins that cluster. Comparisons against non-anchor
 *    members never happen, so pairwise similarity cannot chain into a
 *    transitive cluster.
 * 3. "pending" outcomes are recorded and skipped — never treated as match
 *    or distinct. The run reports them; the reveal waits and retries with
 *    retained verdicts.
 */
export async function clusterAnswers(
  submissions: readonly AnswerSubmission[],
  oracle: EquivalenceOracle,
  retainedVerdicts: Record<string, OracleOutcome> = {},
): Promise<ClusterResult> {
  const answers: ClusteredAnswer[] = submissions.map((s) => ({
    answerId: s.answerId,
    playerId: s.playerId,
    text: s.text,
    normalized: normalizeAnswer(s.text),
  }));

  const verdicts: Record<string, OracleOutcome> = { ...retainedVerdicts };
  const unresolved = new Set<string>();
  const clusters: Cluster[] = [];

  const canonicalOrder: string[] = [];
  const byCanonical = new Map<string, ClusteredAnswer[]>();
  for (const answer of answers) {
    const bucket = byCanonical.get(answer.normalized);
    if (bucket) {
      bucket.push(answer);
    } else {
      byCanonical.set(answer.normalized, [answer]);
      canonicalOrder.push(answer.normalized);
    }
  }

  for (const canonical of canonicalOrder) {
    const members = byCanonical.get(canonical) ?? [];
    let joined: Cluster | null = null;
    for (const cluster of clusters) {
      const key = pairKey(cluster.anchor, canonical);
      let outcome = verdicts[key];
      if (outcome === undefined) {
        outcome = await oracle(cluster.anchor, canonical);
        verdicts[key] = outcome;
      }
      if (outcome === "pending") {
        unresolved.add(key);
        continue;
      }
      if (outcome === "match") {
        joined = cluster;
        break;
      }
    }
    if (joined) {
      joined.answers.push(...members);
    } else {
      clusters.push({ anchor: canonical, answers: [...members] });
    }
  }

  return {
    clusters,
    verdicts,
    unresolvedPairs: [...unresolved].sort(),
  };
}

/** True when every adjudication in the run is definitive. */
export function revealReady(result: ClusterResult): boolean {
  return result.unresolvedPairs.length === 0;
}

/** Verdicts safe to retain across a retry: pending entries are dropped. */
export function retainedVerdictsForRetry(
  result: ClusterResult,
): Record<string, OracleOutcome> {
  const retained: Record<string, OracleOutcome> = {};
  for (const [key, outcome] of Object.entries(result.verdicts)) {
    if (outcome !== "pending") {
      retained[key] = outcome;
    }
  }
  return retained;
}

/**
 * A mutual two-player override for shared memories. The server records both
 * consent events before storing an override; rules only apply it. Overrides
 * merge clusters; they never split them.
 */
export interface MutualOverride {
  playerA: string;
  playerB: string;
}

export function applyMutualOverrides(
  result: ClusterResult,
  overrides: readonly MutualOverride[],
): ClusterResult {
  const clusters: Cluster[] = result.clusters.map((c) => ({
    anchor: c.anchor,
    answers: [...c.answers],
  }));
  for (const override of overrides) {
    const indexA = clusters.findIndex((c) =>
      c.answers.some((a) => a.playerId === override.playerA),
    );
    const indexB = clusters.findIndex((c) =>
      c.answers.some((a) => a.playerId === override.playerB),
    );
    if (indexA === -1 || indexB === -1 || indexA === indexB) {
      continue;
    }
    // Deterministic merge: the earlier cluster absorbs the later one.
    const [lo, hi] = indexA < indexB ? [indexA, indexB] : [indexB, indexA];
    clusters[lo]!.answers.push(...clusters[hi]!.answers);
    clusters.splice(hi, 1);
  }
  return { ...result, clusters };
}

/** The cluster containing this player's answer, or null. */
export function clusterOfPlayer(
  clusters: readonly Cluster[],
  playerId: string,
): Cluster | null {
  for (const cluster of clusters) {
    if (cluster.answers.some((a) => a.playerId === playerId)) {
      return cluster;
    }
  }
  return null;
}

/** True when both players' answers ended in the same equivalent cluster. */
export function playersShareCluster(
  clusters: readonly Cluster[],
  a: string,
  b: string,
): boolean {
  const clusterA = clusterOfPlayer(clusters, a);
  return clusterA !== null && clusterA.answers.some((x) => x.playerId === b);
}

/**
 * Hive Mind party scoring: one point for each OTHER player in the player's
 * equivalent group. Ceiling is n-1 when all n players share one group.
 * Players with no answer this round score zero.
 */
export function hiveMindRoundScores(
  clusters: readonly Cluster[],
  playerIds: readonly string[],
): Map<string, number> {
  const scores = new Map<string, number>(playerIds.map((p) => [p, 0]));
  for (const playerId of playerIds) {
    const cluster = clusterOfPlayer(clusters, playerId);
    if (!cluster) {
      continue;
    }
    const others = new Set(
      cluster.answers
        .map((a) => a.playerId)
        .filter((p) => p !== playerId),
    );
    scores.set(playerId, others.size);
  }
  return scores;
}

/** A Soulmate pairing. Both members score from the same match. */
export type Pairing = readonly [string, string];

/**
 * Soulmate party scoring per round:
 * - partner answers in the same equivalent group: SOULMATE_PARTNER_POINTS;
 * - that group contains no player outside the pair:
 *   SOULMATE_UNIQUE_PARTNER_POINTS instead;
 * - no partner match: zero.
 */
export function soulmateRoundScores(
  clusters: readonly Cluster[],
  pairs: readonly Pairing[],
): Map<string, number> {
  const scores = new Map<string, number>();
  for (const [a, b] of pairs) {
    scores.set(a, 0);
    scores.set(b, 0);
  }
  for (const [a, b] of pairs) {
    if (!playersShareCluster(clusters, a, b)) {
      continue;
    }
    const cluster = clusterOfPlayer(clusters, a)!;
    const outsiders = cluster.answers
      .map((x) => x.playerId)
      .filter((p) => p !== a && p !== b);
    const points =
      outsiders.length === 0
        ? SOULMATE_UNIQUE_PARTNER_POINTS
        : SOULMATE_PARTNER_POINTS;
    scores.set(a, points);
    scores.set(b, points);
  }
  return scores;
}

export interface TwoPlayerRound {
  matched: boolean;
}

export interface SessionRecord {
  roundsPlayed: number;
  sharedThoughts: number;
  /**
   * Human-readable session record, e.g. "shared 6 of 8 thoughts".
   * A record of what happened, never a compatibility score or percentage.
   */
  record: string;
}

/**
 * Two-player Hive Mind is cooperation over eight prompts. The outcome is a
 * session record: how many of the eight thoughts the pair shared.
 */
export function twoPlayerSessionRecord(
  rounds: readonly TwoPlayerRound[],
): SessionRecord {
  const shared = rounds.filter((r) => r.matched).length;
  return {
    roundsPlayed: rounds.length,
    sharedThoughts: shared,
    record: `shared ${shared} of ${rounds.length} thoughts`,
  };
}