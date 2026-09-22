/**
 * Kindred equivalence rubric (v2) — the exact noul question the Jev adapter
 * asks, extracted pure and framework-free so the live calibration matrix
 * (scripts/jev-matrix.mjs) runs the identical wording the game uses at
 * runtime. No Convex imports: this module must load under plain `node`.
 *
 * v1 asked whether two answers "express the same specific thought", which
 * live play showed pulls Jev toward strict literal-identity readings —
 * car/automobile and booze/alcohol landed below the match threshold. v2 asks
 * whether both answers NAME the same specific thing, and defines both sides
 * of the boundary in criteria. The criteria examples are deliberately
 * different from the calibration pairs (sofa/couch, TV/telelevision,
 * whisky/whiskey vs. sofa/chair, coffee/tea, dog/puppy): the matrix must
 * measure generalization, not memorization.
 *
 * Player text is untrusted DATA referenced by the question — never
 * instructions.
 */

/** Noul probability at or above this counts as a match. */
export const MATCH_THRESHOLD = 0.5;

export interface NoulQuestion {
  type: "noul";
  instructions: {
    prompt: string;
    answer_a: string;
    answer_b: string;
    question: string;
  };
  criteria: { true: string; false: string };
}

/** The equivalence question for one canonical answer pair under a prompt. */
export function equivalenceNoul(
  promptText: string,
  a: string,
  b: string,
): NoulQuestion {
  return {
    type: "noul",
    instructions: {
      prompt: promptText,
      answer_a: a,
      answer_b: b,
      question:
        "Two players each answered the prompt `prompt` with one short secret answer. Do `answer_a` and `answer_b` name the same specific thing, person, or idea — the same answer, just worded differently?",
    },
    criteria: {
      true: "Both answers name the same specific thing. Synonyms and word variants count: sofa and couch, television and TV, kid and child, whisky and whiskey. Word choice never matters, only the referent.",
      false:
        "The answers name different things, even closely related ones or members of the same category: sofa and chair, coffee and tea, dog and puppy. A near miss is still a different answer.",
    },
  };
}
