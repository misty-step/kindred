import assert from "node:assert/strict";
import test from "node:test";
import { endCopy, listNames, othersLine, outcome } from "../app/reveal-copy.ts";

test("names list puts the viewer first and lowercases later mentions", () => {
  assert.equal(listNames(["Sam", "You"]), "You and Sam");
  assert.equal(listNames(["Sam", "Priya", "You"]), "You, Sam and Priya");
  assert.equal(listNames(["Jo"]), "Jo");
});

test("the viewer's verdict distinguishes a scoring pair, a crowd and a single", () => {
  assert.deepEqual(outcome({ kind: "pair", partner: "Theo", scored: true }), {
    head: "You and Theo.",
    sub: "Nobody else said it. +1 for you both.",
  });
  assert.match(
    outcome({ kind: "pair", partner: "Theo", scored: false }).sub,
    /only the tied pairs can score/,
  );
  assert.deepEqual(
    outcome({ kind: "crowd", names: ["Sam", "You", "Priya"], text: "my dog" }),
    {
      head: "Too many.",
      sub: "You, Sam and Priya all said my dog. Nobody scores.",
    },
  );
  assert.equal(outcome({ kind: "single", text: "syrup" }).head, "Just you.");
});

test("others line is empty when nothing else happened", () => {
  assert.equal(othersLine([], []), "");
  assert.equal(othersLine([["Jo", "Theo"]], []), "Jo and Theo paired.");
});

test("end copy names the winner, a shared win, or no pair at all", () => {
  assert.equal(
    endCopy({
      winners: [["Theo", "You"]],
      shared: false,
      decidedBy: "questions",
      total: 3,
    }).head,
    "You and Theo win.",
  );
  assert.equal(
    endCopy({
      winners: [["Theo", "You"]],
      shared: false,
      decidedBy: "extra",
      total: 3,
    }).sub,
    "Won on the extra question.",
  );
  assert.deepEqual(
    endCopy({
      winners: [
        ["Jo", "Theo"],
        ["Sam", "Priya"],
      ],
      shared: true,
      decidedBy: "extra",
      total: 2,
    }),
    {
      head: "A shared win.",
      sub: "Jo and Theo; Sam and Priya. Still tied after one more question.",
    },
  );
  assert.equal(
    endCopy({ winners: [], shared: false, decidedBy: "questions", total: 0 })
      .head,
    "No pair scored.",
  );
});
