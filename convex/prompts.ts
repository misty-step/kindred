import { v } from "convex/values";

/**
 * Curated prompt deck. Authored by hand; Jev never generates prose.
 * Mix of ordinary and unusual prompts. House answers are authored display
 * decoys shown in two-player Soulmate as unavailable thoughts — they are
 * never scored and never presented as measured popularity.
 */
export interface Prompt {
  id: string;
  text: string;
  category: "ordinary" | "unusual";
  houseAnswers: [string, string, string];
}

export const PROMPT_DECK: Prompt[] = [
  {
    id: "party-bring",
    text: "The one thing you always bring to a party",
    category: "ordinary",
    houseAnswers: ["bottle opener", "an exit plan", "good gossip"],
  },
  {
    id: "dream-breakfast",
    text: "Your dream breakfast",
    category: "ordinary",
    houseAnswers: [
      "cold pizza",
      "anything someone else made",
      "coffee, technically",
    ],
  },
  {
    id: "childhood-smell",
    text: "A smell from your childhood",
    category: "unusual",
    houseAnswers: ["new sneakers", "chlorine", "grandma's purse"],
  },
  {
    id: "useless-superpower",
    text: "A completely useless superpower",
    category: "unusual",
    houseAnswers: [
      "talking to pigeons",
      "instant sock sorting",
      "perfect parking on Tuesdays",
    ],
  },
  {
    id: "sunday-sound",
    text: "The sound of a perfect Sunday",
    category: "ordinary",
    houseAnswers: ["rain on windows", "nothing at all", "frying onions"],
  },
  {
    id: "desert-island-snack",
    text: "One snack on a desert island",
    category: "ordinary",
    houseAnswers: ["chips", "chocolate", "something salty"],
  },
  {
    id: "awkward-elevator",
    text: "How to survive an awkward elevator ride",
    category: "unusual",
    houseAnswers: [
      "fake phone call",
      "stare at the numbers",
      "compliment shoes",
    ],
  },
  {
    id: "best-feeling",
    text: "The best feeling in the world",
    category: "ordinary",
    houseAnswers: [
      "clean sheets",
      "being early",
      "the last slice left for you",
    ],
  },
  {
    id: "ghost-roommate",
    text: "One rule for your ghost roommate",
    category: "unusual",
    houseAnswers: [
      "no humming at 3 a.m.",
      "dishes get done",
      "lights stay off",
    ],
  },
  {
    id: "karaoke-go-to",
    text: "Your secret karaoke go-to",
    category: "ordinary",
    houseAnswers: [
      "something by ABBA",
      "a power ballad",
      "whatever the room shouts",
    ],
  },
  {
    id: "time-travel-errand",
    text: "One quick errand in any decade",
    category: "unusual",
    houseAnswers: ["70s record store", "90s video rental", "future dentist"],
  },
  {
    id: "comfort-movie",
    text: "The movie you can always rewatch",
    category: "ordinary",
    houseAnswers: [
      "something dumb and fun",
      "the long one with wizards",
      "a documentary, honestly",
    ],
  },
  {
    id: "road-trip-vehicle",
    text: "Your ideal road trip vehicle",
    category: "ordinary",
    houseAnswers: [
      "whatever runs",
      "a van you can sleep in",
      "a bus, honestly",
    ],
  },
  {
    id: "park-birds",
    text: "Birds you'd feed at the park",
    category: "unusual",
    houseAnswers: [
      "the pigeons, obviously",
      "swans (risky)",
      "ducks, no negotiation",
    ],
  },
];

export const promptById = new Map(PROMPT_DECK.map((p) => [p.id, p]));

export const promptArgs = v.string();
