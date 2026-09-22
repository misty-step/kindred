const NUMBER_WORDS = [
  "Zero",
  "One",
  "Two",
  "Three",
  "Four",
  "Five",
  "Six",
  "Seven",
  "Eight",
  "Nine",
  "Ten",
  "Eleven",
  "Twelve",
] as const;

export function revealHeadline(clusterSizes: readonly number[]): string {
  if (clusterSizes.length === 0)
    return "The room is still waiting for the reveal.";
  const largest = Math.max(...clusterSizes);
  if (largest < 2) return "Every thought took its own path.";
  const count = NUMBER_WORDS[largest] ?? String(largest);
  return `${count} of you found the same thought.`;
}

export function clusterLabel(count: number, namesVisible: boolean): string {
  const noun = namesVisible ? "player" : "answer";
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}
