import test from "node:test";
import assert from "node:assert/strict";
import {
  ANSWER_MAX_CHARS,
  applyMutualOverrides,
  clusterAnswers,
  hiveMindRoundScores,
  normalizeAnswer,
  pairKey,
  playersShareCluster,
  retainedVerdictsForRetry,
  revealReady,
  soulmatePairs,
  soulmateRoundScores,
  twoPlayerSessionRecord,
  validateAnswer,
  type AnswerSubmission,
  type OracleOutcome,
} from "../convex/rules.ts";

function scripted(
  script: Record<string, string>,
  fallback: OracleOutcome = "distinct",
) {
  const asked: string[] = [];
  const oracle = (a: string, b: string): OracleOutcome => {
    const key = pairKey(a, b);
    asked.push(key);
    const supplied = script[key];
    if (supplied === "match" || supplied === "distinct" || supplied === "pending") {
      return supplied;
    }
    return fallback;
  };
  return { oracle, asked };
}

function sub(playerId: string, text: string): AnswerSubmission {
  return { answerId: `${playerId}-a1`, playerId, text };
}

test("normalizeAnswer canonicalizes case, spacing, punctuation, unicode", () => {
  assert.equal(normalizeAnswer("  CAR!  "), "car");
  assert.equal(normalizeAnswer("New   York"), "new york");
  assert.equal(normalizeAnswer("\tThe\tMoon\n"), "moon");
  assert.equal(normalizeAnswer("A car"), "car");
  assert.equal(normalizeAnswer("an owl"), "owl");
  assert.equal(normalizeAnswer("the beatles"), "beatles");
  assert.equal(normalizeAnswer("a"), "a");
  assert.equal(normalizeAnswer("The A-Team"), "a-team");
  assert.equal(normalizeAnswer("caf\u00e9"), normalizeAnswer("cafe\u0301"));
  assert.equal(normalizeAnswer("'quoted'"), "quoted");
  assert.equal(normalizeAnswer("...maybe..."), "maybe");
  assert.equal(normalizeAnswer("A-B-C"), "a-b-c");
  assert.equal(normalizeAnswer("  "), "");
});

test("pairKey is order-independent and collision-free", () => {
  assert.equal(pairKey("a b", "c"), pairKey("c", "a b"));
  assert.notEqual(pairKey("a b", "c"), pairKey("a", "b c"));
  assert.notEqual(pairKey("ab", "c"), pairKey("a", "bc"));
});

test("validateAnswer enforces non-empty bounded answers", () => {
  assert.deepEqual(validateAnswer(""), { ok: false, code: "ANSWER_EMPTY" });
  assert.deepEqual(validateAnswer("   "), { ok: false, code: "ANSWER_EMPTY" });
  assert.deepEqual(validateAnswer("???"), { ok: false, code: "ANSWER_EMPTY" });
  assert.deepEqual(validateAnswer("x".repeat(ANSWER_MAX_CHARS + 1)), {
    ok: false,
    code: "ANSWER_TOO_LONG",
  });
  const ok = validateAnswer("Car.");
  assert.equal(ok.ok, true);
  if (ok.ok) {
    assert.equal(ok.normalized, "car");
  }
});

test("canonical duplicates collapse without any oracle call", async () => {
  const { oracle, asked } = scripted({});
  const result = await clusterAnswers(
    [
      sub("p1", "Car"),
      sub("p2", "car"),
      sub("p3", " CAR "),
      sub("p4", "Car."),
    ],
    oracle,
  );
  assert.equal(asked.length, 0);
  assert.equal(result.clusters.length, 1);
  assert.equal(result.clusters[0]?.anchor, "car");
  assert.equal(result.clusters[0]?.answers.length, 4);
  assert.equal(result.unresolvedPairs.length, 0);
  assert.equal(revealReady(result), true);
});

test("car matches automobile not bus; goose matches geese not swan", async () => {
  const { oracle, asked } = scripted({
    [pairKey("car", "automobile")]: "match",
    [pairKey("goose", "geese")]: "match",
  });
  const result = await clusterAnswers(
    [
      sub("p1", "Car."),
      sub("p2", "automobile"),
      sub("p3", "bus"),
      sub("p4", "goose"),
      sub("p5", "GEESE"),
      sub("p6", "swan"),
    ],
    oracle,
  );
  const byAnchor = new Map(
    result.clusters.map((c) => [c.anchor, c.answers.map((a) => a.playerId)]),
  );
  assert.deepEqual([...byAnchor.keys()].sort(), ["bus", "car", "goose", "swan"]);
  assert.deepEqual(byAnchor.get("car"), ["p1", "p2"]);
  assert.deepEqual(byAnchor.get("bus"), ["p3"]);
  assert.deepEqual(byAnchor.get("goose"), ["p4", "p5"]);
  assert.deepEqual(byAnchor.get("swan"), ["p6"]);
  // Deterministic anchor-only comparison order.
  assert.deepEqual(asked, [
    pairKey("car", "automobile"),
    pairKey("car", "bus"),
    pairKey("car", "goose"),
    pairKey("bus", "goose"),
    pairKey("car", "geese"),
    pairKey("bus", "geese"),
    pairKey("goose", "geese"),
    pairKey("car", "swan"),
    pairKey("bus", "swan"),
    pairKey("goose", "swan"),
  ]);
  // Anti-single-link: members are never compared against anything.
  assert.ok(!asked.includes(pairKey("automobile", "swan")));
  assert.ok(!asked.includes(pairKey("geese", "swan")));
  assert.ok(!asked.includes(pairKey("automobile", "bus")));
  assert.ok(!asked.includes(pairKey("automobile", "geese")));
});

test("pending adjudication never merges, blocks reveal, retries fairly", async () => {
  const { oracle } = scripted(
    { [pairKey("pizza", "flatbread")]: "pending" },
    "distinct",
  );
  const submissions = [sub("p1", "Pizza"), sub("p2", "flatbread")];
  const first = await clusterAnswers(submissions, oracle);
  assert.equal(first.clusters.length, 2); // no fabricated merge
  assert.equal(first.unresolvedPairs.length, 1);
  assert.equal(first.unresolvedPairs[0], pairKey("pizza", "flatbread"));
  assert.equal(revealReady(first), false);

  const retained = retainedVerdictsForRetry(first);
  assert.deepEqual(retained, {}); // pending is not retained as a final verdict

  const { oracle: retryOracle } = scripted(
    { [pairKey("pizza", "flatbread")]: "match" },
    "distinct",
  );
  const second = await clusterAnswers(submissions, retryOracle, retained);
  assert.equal(second.clusters.length, 1);
  assert.equal(revealReady(second), true);
});

test("retained verdicts are reused; duplicate submissions never reroll", async () => {
  const { oracle, asked } = scripted({
    [pairKey("car", "automobile")]: "match",
  });
  const submissions = [sub("p1", "Car"), sub("p2", "automobile")];
  const first = await clusterAnswers(submissions, oracle);
  assert.equal(asked.length, 1);

  // A different live oracle would now disagree; the retained cache must win.
  const { oracle: rerollOracle, asked: rerollAsked } = scripted({
    [pairKey("car", "automobile")]: "distinct",
  });
  const second = await clusterAnswers(submissions, rerollOracle, first.verdicts);
  assert.equal(rerollAsked.length, 0); // no reroll
  assert.deepEqual(second.clusters, first.clusters);
});

test("clustering is deterministic for identical inputs", async () => {
  const script = {
    [pairKey("car", "automobile")]: "match",
    [pairKey("dog", "puppy")]: "match",
  };
  const submissions = [
    sub("p1", "dog"),
    sub("p2", "car"),
    sub("p3", "puppy"),
    sub("p4", "automobile"),
    sub("p5", "kettle"),
  ];
  const runA = await clusterAnswers(submissions, scripted(script).oracle);
  const runB = await clusterAnswers(submissions, scripted(script).oracle);
  assert.deepEqual(runA, runB);
});

test("mutual two-player override merges shared-memory answers", async () => {
  const { oracle } = scripted({});
  const result = await clusterAnswers(
    [sub("p1", "the lake summer"), sub("p2", "grandpa's boat")],
    oracle,
  );
  assert.equal(result.clusters.length, 2);
  assert.equal(playersShareCluster(result.clusters, "p1", "p2"), false);

  const merged = applyMutualOverrides(result, [
    { playerA: "p1", playerB: "p2" },
  ]);
  assert.equal(merged.clusters.length, 1);
  assert.equal(playersShareCluster(merged.clusters, "p1", "p2"), true);

  // Idempotent: re-applying does not duplicate or split.
  const again = applyMutualOverrides(merged, [
    { playerA: "p1", playerB: "p2" },
  ]);
  assert.equal(again.clusters.length, 1);
  assert.equal(again.clusters[0]?.answers.length, 2);
});

test("Hive Mind party scoring: one point per other player in the group", async () => {
  const { oracle } = scripted({ [pairKey("dog", "puppy")]: "match" });
  const result = await clusterAnswers(
    [
      sub("p1", "dog"),
      sub("p2", "puppy"),
      sub("p3", "cat"),
      sub("p5", "dog"),
    ],
    oracle,
  );
  const scores = hiveMindRoundScores(result.clusters, [
    "p1",
    "p2",
    "p3",
    "p4",
    "p5",
  ]);
  assert.equal(scores.get("p1"), 2);
  assert.equal(scores.get("p2"), 2);
  assert.equal(scores.get("p5"), 2);
  assert.equal(scores.get("p3"), 0);
  assert.equal(scores.get("p4"), 0); // no answer this round
});

test("Hive Mind n-1 ceiling: all players sharing one group score n-1", async () => {
  const { oracle, asked } = scripted({});
  const submissions = ["p1", "p2", "p3", "p4"].map((p) => sub(p, "Coffee"));
  const result = await clusterAnswers(submissions, oracle);
  assert.equal(asked.length, 0); // canonical duplicates, no oracle
  const scores = hiveMindRoundScores(result.clusters, ["p1", "p2", "p3", "p4"]);
  for (const points of scores.values()) {
    assert.equal(points, 3);
  }
});

test("Soulmate: 2 for partner match, 4 when no outsider matches, else 0", async () => {
  const { oracle, asked } = scripted({
    [pairKey("sunset", "dusk")]: "match",
  });
  const result = await clusterAnswers(
    [
      sub("p1", "Our Song"),
      sub("p2", "our song"), // canonical duplicate -> unique pair group
      sub("p3", "sunset"),
      sub("p4", "dusk"),
      sub("p5", "sunset"), // outsider in p3/p4's group
      sub("p6", "kettle"),
    ],
    oracle,
  );
  assert.deepEqual(asked, [
    pairKey("our song", "sunset"),
    pairKey("our song", "dusk"),
    pairKey("sunset", "dusk"),
    pairKey("our song", "kettle"),
    pairKey("sunset", "kettle"),
  ]);
  const scores = soulmateRoundScores(result.clusters, [
    ["p1", "p2"],
    ["p3", "p4"],
    ["p5", "p6"],
  ]);
  assert.equal(scores.get("p1"), 4); // unique partner match
  assert.equal(scores.get("p2"), 4);
  assert.equal(scores.get("p3"), 2); // matched but outsider present
  assert.equal(scores.get("p4"), 2);
  assert.equal(scores.get("p5"), 0); // matched group but not with partner
  assert.equal(scores.get("p6"), 0);
});

test("Soulmate honors a mutual override as a partner match", async () => {
  const { oracle } = scripted({});
  const result = await clusterAnswers(
    [sub("p1", "that dusty arcade"), sub("p2", "the pinball place")],
    oracle,
  );
  assert.equal(playersShareCluster(result.clusters, "p1", "p2"), false);
  const merged = applyMutualOverrides(result, [
    { playerA: "p1", playerB: "p2" },
  ]);
  const scores = soulmateRoundScores(merged.clusters, [["p1", "p2"]]);
  assert.equal(scores.get("p1"), 4); // unique after override, no outsider
  assert.equal(scores.get("p2"), 4);
});

test("two-player session record counts shared thoughts, not compatibility", () => {
  const rounds = [
    { matched: true },
    { matched: true },
    { matched: false },
    { matched: true },
    { matched: true },
    { matched: false },
    { matched: true },
    { matched: false },
  ];
  const record = twoPlayerSessionRecord(rounds);
  assert.equal(record.roundsPlayed, 8);
  assert.equal(record.sharedThoughts, 5);
  assert.equal(record.record, "shared 5 of 8 thoughts");
  assert.ok(!record.record.includes("%"));
  assert.ok(!record.record.toLowerCase().includes("compat"));
});

test("soulmatePairs pairs seats in order; odd tail stays unpaired", () => {
  // Regression: the pre-fix game.ts construction indexed participants past
  // the end for any count and crashed Soulmate starts with a TypeError.
  assert.deepEqual(soulmatePairs(["a", "b"]), [["a", "b"]]);
  assert.deepEqual(soulmatePairs(["a", "b", "c"]), [["a", "b"]]);
  assert.deepEqual(soulmatePairs(["a", "b", "c", "d"]), [["a", "b"], ["c", "d"]]);
  assert.deepEqual(soulmatePairs(["a", "b", "c", "d", "e"]), [["a", "b"], ["c", "d"]]);
  assert.deepEqual(soulmatePairs(["a"]), []);
  assert.deepEqual(soulmatePairs([]), []);
});

test("clusterAnswers tolerates empty input", async () => {
  const { oracle, asked } = scripted({});
  const result = await clusterAnswers([], oracle);
  assert.equal(asked.length, 0);
  assert.deepEqual(result.clusters, []);
  assert.equal(revealReady(result), true);
});