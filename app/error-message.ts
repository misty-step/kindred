import { ConvexError } from "convex/values";

const messages: Record<string, string> = {
  INVALID_DISPLAY_NAME: "Use a name between 1 and 24 characters.",
  INVALID_ROOM_CODE: "Enter the four-character code from your host.",
  ROOM_NOT_OPEN: "That room is not open. Check the code or ask for a new one.",
  ROOM_NOT_FOUND: "This room is gone. Return to the lobby to find another.",
  ROOM_CLOSED: "This room is closed. Return to the lobby to play again.",
  ROOM_FULL: "This room already has 12 players.",
  ROOM_JOIN_RATE_LIMIT:
    "That was a lot of joins. Wait a minute, then try again.",
  ROOM_CREATION_RATE_LIMIT:
    "You have too many open rooms. Leave one before starting another.",
  ROOM_CODE_EXHAUSTED: "We could not make a room just now. Try again.",
  ROOM_DATA_INVALID:
    "This room hit a snag. Return to the lobby and start another.",
  MATCH_DATA_INVALID:
    "This game hit a snag. Return to the lobby and start another.",
  NOT_A_ROOM_MEMBER:
    "You are no longer in this room. Return to the lobby and join again.",
  HOST_REQUIRED: "Only the current host can do that.",
  MATCH_ALREADY_ACTIVE:
    "A game is already running. Finish it before starting another.",
  MATCH_NOT_ACTIVE: "That game has already ended.",
  MATCH_PARTICIPANT_REQUIRED:
    "You are watching this one. You will join the next game.",
  NOT_ENOUGH_PRESENT_PLAYERS: "At least two players need to be here.",
  TOO_MANY_PRESENT_PLAYERS: "Only 12 players can play at once.",
  UNAUTHENTICATED: "We could not reconnect you. Try again.",
  PLAYER_NOT_FOUND:
    "We could not find your place. Return to the lobby and join again.",
  GAME_NOT_FOUND: "This game is unavailable. Close the room and start another.",
  ANSWER_EMPTY: "Write an answer first.",
  ANSWER_TOO_LONG: "Keep your answer to 64 characters.",
  ANSWER_ALREADY_SUBMITTED: "Your answer is already in. Wait for the reveal.",
  ROUND_NOT_FOUND: "This round is no longer available.",
  ROUND_NOT_ANSWERING: "This round is not taking answers now.",
  ROUND_NOT_REVEALED: "The first reveal is not ready yet.",
  ROUND_NOT_PENDING: "The reveal is not waiting for another try.",
  ROUND_NOT_READY_TO_ADVANCE:
    "Reveal the names before starting the next round.",
  OVERRIDE_WINDOW_CLOSED: "Shared memory is available after the names appear.",
  OVERRIDE_INVALID_PAIR: "Choose the other player in this round.",
  JUDGE_EXHAUSTED: "The reveal needs a moment. Try again soon.",
  JEV_UNCONFIGURED: "The reveal is unavailable right now. Try again soon.",
  GUEST_ISSUER_UNCONFIGURED: "Rooms are unavailable right now. Try again soon.",
  GUEST_ISSUER_UNAVAILABLE:
    "We could not connect you. Check your connection and try again.",
  INVALID_GUEST_RESPONSE: "We could not connect you. Try again.",
  SAME_ORIGIN_REQUIRED: "Open Kindred from its main address and try again.",
  GUEST_CONTINUITY_REQUIRED:
    "We could not recover your place. Return to the lobby and join again.",
  GUEST_CONTINUITY_INVALID:
    "Your saved place has expired. Return to the lobby and join again.",
};

export function errorMessage(error: unknown): string {
  const data: unknown = error instanceof ConvexError ? error.data : null;
  const code =
    typeof data === "object" &&
    data !== null &&
    "code" in data &&
    typeof data.code === "string"
      ? data.code
      : error instanceof Error
        ? error.message
        : "";
  return (
    messages[code] ?? "That did not work. Check your connection and try again."
  );
}
