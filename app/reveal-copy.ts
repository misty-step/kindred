/**
 * Player copy for the pair rule (US-004, US-005, US-006). Pure: names in, sentences out.
 * "You" always comes first and becomes "you" after the first position.
 */

export const YOU = "You";

export function listNames(names: readonly string[]): string {
  const ordered = [...names].sort((a, b) =>
    a === YOU ? -1 : b === YOU ? 1 : 0,
  );
  const words = ordered.map((name, i) =>
    name === YOU && i > 0 ? "you" : name,
  );
  if (words.length <= 1) return words[0] ?? "";
  if (words.length === 2) return `${words[0]} and ${words[1]}`;
  return `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

export type MyGroup =
  | { kind: "pair"; partner: string; scored: boolean }
  | { kind: "crowd"; names: readonly string[]; text: string }
  | { kind: "single"; text: string };

/** The verdict for the viewer after a reveal. */
export function outcome(mine: MyGroup): { head: string; sub: string } {
  if (mine.kind === "pair") {
    return {
      head: `${listNames([YOU, mine.partner])}.`,
      sub: mine.scored
        ? "Nobody else said it. +1 for you both."
        : "Nobody else said it, but only the tied pairs can score now.",
    };
  }
  if (mine.kind === "crowd") {
    return {
      head: "Too many.",
      sub: `${listNames(mine.names)} all said ${mine.text}. Nobody scores.`,
    };
  }
  return { head: "Just you.", sub: `Nobody else said ${mine.text}.` };
}

/** One line about everyone else's round, or an empty string. */
export function othersLine(
  otherScoredPairs: readonly (readonly string[])[],
  otherCrowds: readonly (readonly string[])[],
): string {
  const parts: string[] = [];
  if (otherScoredPairs.length) {
    parts.push(
      `${otherScoredPairs.map((pair) => listNames(pair)).join("; ")} ${
        otherScoredPairs.length === 1 ? "paired" : "paired too"
      }.`,
    );
  }
  if (otherCrowds.length) {
    parts.push(
      `${otherCrowds.map((crowd) => listNames(crowd)).join("; ")} crowded ${
        otherCrowds.length === 1 ? "one answer" : "answers"
      }.`,
    );
  }
  return parts.join(" ");
}

export function endCopy(input: {
  winners: readonly (readonly [string, string])[];
  shared: boolean;
  decidedBy: "questions" | "extra";
  total: number;
}): { head: string; sub: string } {
  if (input.winners.length === 0) {
    return {
      head: "No pair scored.",
      sub: "Every match was a crowd, or nobody matched.",
    };
  }
  const names = input.winners.map((pair) => listNames(pair));
  if (input.shared) {
    return {
      head: "A shared win.",
      sub: `${names.join("; ")}. Still tied after one more question.`,
    };
  }
  return {
    head: `${names[0]} win.`,
    sub:
      input.decidedBy === "extra"
        ? "Won on the extra question."
        : `Matched ${input.total === 1 ? "once" : `${input.total} times`}, and nobody else said it.`,
  };
}

export function duoEndCopy(
  total: number,
  rounds: number,
): { head: string; sub: string } {
  return {
    head: `You matched ${total} of ${rounds}.`,
    sub:
      total === rounds
        ? "Every single one."
        : total === 0
          ? "Not one. Try again?"
          : "Play again to beat it.",
  };
}
