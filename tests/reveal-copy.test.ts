import assert from "node:assert/strict";
import test from "node:test";
import { clusterLabel, revealHeadline } from "../app/reveal-copy.ts";

test("reveal headline uses the largest actual group", () => {
  assert.equal(
    revealHeadline([1, 3, 2]),
    "Three of you found the same thought.",
  );
  assert.equal(revealHeadline([4, 1]), "Four of you found the same thought.");
  assert.equal(revealHeadline([2]), "Two of you found the same thought.");
});

test("reveal headline is honest when nobody matched", () => {
  assert.equal(revealHeadline([1, 1, 1]), "Every thought took its own path.");
  assert.equal(revealHeadline([]), "The room is still waiting for the reveal.");
});

test("cluster labels match visible state and count", () => {
  assert.equal(clusterLabel(1, false), "1 answer");
  assert.equal(clusterLabel(2, false), "2 answers");
  assert.equal(clusterLabel(1, true), "1 player");
  assert.equal(clusterLabel(3, true), "3 players");
});
