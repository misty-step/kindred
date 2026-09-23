import test from "node:test";
import assert from "node:assert/strict";
import {
  ANSWER_MAX_CHARS,
  clusterAnswers,
  exactPairs,
  normalizeAnswer,
  pairKey,
  pairStandings,
  retainedVerdictsForRetry,
  revealReady,
  topPairs,
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
    if (
      supplied === "match" ||
      supplied === "distinct" ||
      supplied === "pending"
    ) {
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
    [sub("p1", "Car"), sub("p2", "car"), sub("p3", " CAR "), sub("p4", "Car.")],
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
  assert.deepEqual([...byAnchor.keys()].sort(), [
    "bus",
    "car",
    "goose",
    "swan",
  ]);
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
  const second = await clusterAnswers(
    submissions,
    rerollOracle,
    first.verdicts,
  );
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

test("exact pairs score, crowds and singles do not", async () => {
  const { oracle } = scripted({ [pairKey("car", "automobile")]: "match" });
  const result = await clusterAnswers(
    [
      sub("p2", "car"),
      sub("p1", "automobile"),
      sub("p3", "moon"),
      sub("p4", "moon"),
      sub("p5", "moon"),
      sub("p6", "alone"),
    ],
    oracle,
  );
  assert.deepEqual(exactPairs(result.clusters), [{ a: "p1", b: "p2" }]);
  assert.deepEqual(
    exactPairs([
      {
        anchor: "same",
        answers: [
          { playerId: "p1", text: "same", normalized: "same" },
          { playerId: "p1", text: "same", normalized: "same" },
        ],
      },
    ]),
    [],
  );
});

test("standings count scored pairs, update latest delta and resolve top ties", () => {
  const standings = pairStandings([
    {
      pairs: [
        { a: "a", b: "b", scored: true },
        { a: "c", b: "d", scored: true },
      ],
    },
    {
      pairs: [
        { a: "c", b: "d", scored: false },
        { a: "a", b: "b", scored: true },
      ],
    },
    {
      pairs: [
        { a: "c", b: "d", scored: true },
        { a: "e", b: "f", scored: false },
      ],
    },
  ]);
  assert.deepEqual(standings, [
    { a: "a", b: "b", total: 2, delta: 0 },
    { a: "c", b: "d", total: 2, delta: 1 },
  ]);
  assert.deepEqual(topPairs(standings), [
    { a: "a", b: "b" },
    { a: "c", b: "d" },
  ]);
  assert.deepEqual(
    topPairs(pairStandings([{ pairs: [{ a: "a", b: "b", scored: false }] }])),
    [],
  );
  assert.deepEqual(topPairs([]), []);
});

test("clusterAnswers tolerates empty input", async () => {
  const { oracle, asked } = scripted({});
  const result = await clusterAnswers([], oracle);
  assert.equal(asked.length, 0);
  assert.deepEqual(result.clusters, []);
  assert.equal(revealReady(result), true);
});
