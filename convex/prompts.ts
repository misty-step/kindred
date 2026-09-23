import { v } from "convex/values";

/** Curated display prompts; Jev never generates question prose. */
export interface Prompt {
  id: string;
  text: string;
}

export const PROMPT_DECK: Prompt[] = [
  { id: "junk-drawer", text: "Something you’d find in a junk drawer" },
  { id: "famous-duo", text: "A famous duo" },
  { id: "pizza-topping", text: "The best pizza topping" },
  { id: "always-sticky", text: "Something that’s always sticky" },
  { id: "childhood-smell", text: "A smell from your childhood" },
  { id: "grab-in-fire", text: "The first thing you’d grab in a fire" },
  { id: "fun-fruit", text: "A fruit that’s fun to say" },
  { id: "beach-day", text: "Something you’d pack for a beach day" },
  { id: "board-game", text: "A board game everyone owns" },
  { id: "common-fear", text: "Something people are afraid of" },
  { id: "better-cold", text: "A food that’s better cold" },
  { id: "grandparent-word", text: "A word your grandparent says" },
  { id: "mittens", text: "Something you can’t do with mittens on" },
  { id: "trouble-sound", text: "A sound that means trouble" },
  { id: "terrible-job", text: "A job you’d be terrible at" },
  { id: "many-buttons", text: "Something with a lot of buttons" },
  { id: "late-reason", text: "A reason to be late" },
  { id: "breakfast-cereal", text: "A breakfast cereal" },
  { id: "wedding", text: "Something you’d find at a wedding" },
  { id: "named-animal", text: "An animal with a great name" },
  { id: "worst-to-step-on", text: "The worst thing to step on" },
  { id: "known-song", text: "A song everyone knows the words to" },
  { id: "always-cold", text: "Something that’s always cold" },
  { id: "haunted-house", text: "A place you’d hide in a haunted house" },
];

export const promptById = new Map(
  PROMPT_DECK.map((prompt) => [prompt.id, prompt]),
);
export const promptArgs = v.string();
