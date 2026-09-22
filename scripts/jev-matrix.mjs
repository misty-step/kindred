#!/usr/bin/env node
/**
 * Live Jev equivalence calibration matrix.
 *
 * Runs the EXACT rubric the game uses at runtime — it imports
 * convex/rubric.ts, the same module convex/jev.ts builds questions from —
 * against the real decisions endpoint. One decisions call per prompt group,
 * matching the adapter's one-call-per-round shape (state: { prompt }).
 * Prints raw noul values with expectations and exits non-zero on any miss.
 *
 * Usage (env, never flags — the key must not appear in ps output):
 *   OPENROUTER_API_KEY=... \
 *   JEV_MODEL=typesafe/jev-1.13 \
 *   JEV_DECISIONS_URL=https://openrouter.ai/api/alpha/decisions \
 *   node scripts/jev-matrix.mjs
 *
 * The API key is never printed.
 */
import { execSync } from "node:child_process";
import { hostname } from "node:os";
import { fileURLToPath } from "node:url";
import { promptById } from "../convex/prompts.ts";
import { EQUIVALENCE_RUBRIC_VERSION } from "../convex/rules.ts";
import { MATCH_THRESHOLD, equivalenceNoul } from "../convex/rubric.ts";

const REQUEST_TIMEOUT_MS = 15_000;

/**
 * Calibration matrix. The CoS-required pairs (car/automobile, goose/geese
 * positive; car/bus, goose/swan negative) plus generalization probes,
 * including booze/alcohol — the pair live play adjudicated distinct under
 * rubric v1. Expected outcomes are assertions, never inputs to the model.
 */
const MATRIX = [
  {
    promptId: "road-trip-vehicle",
    a: "car",
    b: "automobile",
    expected: "match",
  },
  {
    promptId: "road-trip-vehicle",
    a: "a car",
    b: "the car",
    expected: "match",
  },
  { promptId: "road-trip-vehicle", a: "car", b: "bus", expected: "distinct" },
  { promptId: "park-birds", a: "goose", b: "geese", expected: "match" },
  { promptId: "park-birds", a: "duck", b: "ducks", expected: "match" },
  { promptId: "park-birds", a: "goose", b: "swan", expected: "distinct" },
  { promptId: "party-bring", a: "booze", b: "alcohol", expected: "match" },
  { promptId: "party-bring", a: "chips", b: "crisps", expected: "match" },
  { promptId: "party-bring", a: "chips", b: "salsa", expected: "distinct" },
];

const apiKey = process.env.OPENROUTER_API_KEY;
const model = process.env.JEV_MODEL ?? "typesafe/jev-1.13";
const url =
  process.env.JEV_DECISIONS_URL ?? "https://openrouter.ai/api/alpha/decisions";

if (!apiKey) {
  console.error("OPENROUTER_API_KEY is required (never printed).");
  process.exit(2);
}

let commit = "unknown";
try {
  commit = execSync("git rev-parse HEAD", {
    cwd: fileURLToPath(new URL("..", import.meta.url)),
    encoding: "utf8",
  }).trim();
} catch {
  // Provenance is best-effort; the matrix itself still runs.
}

const promptIds = [...new Set(MATRIX.map((row) => row.promptId))];
const results = [];

console.log(`kindred jev calibration matrix`);
console.log(`host: ${hostname()}`);
console.log(`commit: ${commit}`);
console.log(`model (requested): ${model}`);
console.log(`rubric version: ${EQUIVALENCE_RUBRIC_VERSION}`);
console.log(`match threshold: ${MATCH_THRESHOLD}`);
console.log("");

for (const promptId of promptIds) {
  const prompt = promptById.get(promptId);
  if (!prompt) {
    console.error(`unknown prompt id: ${promptId}`);
    process.exit(2);
  }
  const rows = MATRIX.filter((row) => row.promptId === promptId);
  const questions = {};
  rows.forEach((row, index) => {
    questions[`q${index}`] = equivalenceNoul(prompt.text, row.a, row.b);
  });
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model, state: { prompt: prompt.text }, questions }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) {
    console.error(`HTTP ${response.status} for prompt ${promptId}`);
    process.exit(3);
  }
  const body = await response.json();
  const answers = body?.answers;
  if (typeof answers !== "object" || answers === null) {
    console.error(`invalid response for prompt ${promptId}`);
    process.exit(3);
  }
  if (typeof body?.model === "string" && results.model === undefined) {
    results.model = body.model;
  }
  console.log(`prompt: ${prompt.text}  [${promptId}]`);
  for (const [index, row] of rows.entries()) {
    const answer = answers[`q${index}`];
    const noul = answer?.noul;
    if (typeof noul !== "number" || !Number.isFinite(noul)) {
      console.error(`invalid noul for ${row.a} / ${row.b}`);
      process.exit(3);
    }
    const verdict = noul >= MATCH_THRESHOLD ? "match" : "distinct";
    const ok = verdict === row.expected;
    results.push({
      promptId,
      prompt: prompt.text,
      a: row.a,
      b: row.b,
      expected: row.expected,
      noul,
      verdict,
      ok,
    });
    console.log(
      `  ${ok ? "OK  " : "MISS"} ${row.a} ~ ${row.b}: noul=${noul.toFixed(4)} -> ${verdict} (expected ${row.expected})`,
    );
  }
  console.log("");
}

const misses = results.filter((row) => !row.ok);
console.log(
  `summary: ${results.length - misses.length}/${results.length} expectations met`,
);
if (misses.length > 0) {
  console.log(`misses: ${misses.map((row) => `${row.a}~${row.b}`).join(", ")}`);
}
console.log(
  JSON.stringify({
    host: hostname(),
    commit,
    model,
    rubricVersion: EQUIVALENCE_RUBRIC_VERSION,
    threshold: MATCH_THRESHOLD,
    results,
    passed: misses.length === 0,
  }),
);
process.exit(misses.length === 0 ? 0 : 1);
