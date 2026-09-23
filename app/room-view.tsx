"use client";

import { classifyPresence } from "@parlor/core";
import {
  QRCodeDisplay,
  useAudio,
  useHeartbeat,
  useWakeLock,
} from "@parlor/react";
import { useConvexConnectionState, useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { errorMessage } from "./error-message";
import { Mark } from "./mark";
import {
  YOU,
  duoEndCopy,
  endCopy,
  listNames,
  othersLine,
  outcome,
  type MyGroup,
} from "./reveal-copy";

type Props = {
  roomId: Id<"rooms">;
  guestToken: string;
  joinUrl: string;
  onExit: () => void;
};

type View = FunctionReturnType<typeof api.game.view>;
type Match = NonNullable<View["match"]>;
type GameView = Extract<Match, { roundCount: 6 }>;
type Round = NonNullable<GameView["round"]>;
type Reveal = NonNullable<GameView["reveal"]>;
type Group = Reveal["groups"][number];
type Busy = "start" | "answer" | "advance" | "retry" | "leave" | "close" | null;

const GROUP_COLORS = ["--g1", "--g2", "--g3", "--g4", "--g5", "--g6"];
const SLOW_JUDGE_MS = 8_000;

function reducedMotion() {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/** The projection shape a participant receives once the game row exists. */
function isGameView(match: Match): match is GameView {
  return match.roundCount !== undefined;
}

/** A pair's names in seat order, so everyone sees the same pair the same way. */
function seatOrdered(
  game: GameView,
  nameOf: (id: string) => string,
  a: string,
  b: string,
): readonly [string, string] {
  const seat = (id: string) =>
    game.participantIds.findIndex((participant) => participant === id);
  return seat(a) <= seat(b) ? [nameOf(a), nameOf(b)] : [nameOf(b), nameOf(a)];
}

function pairLabel(
  game: GameView,
  nameOf: (id: string) => string,
  a: string,
  b: string,
): string {
  return listNames(seatOrdered(game, nameOf, a, b));
}

export function RoomView({ roomId, guestToken, joinUrl, onExit }: Props) {
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState("");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [toast, setToast] = useState("");
  const [now, setNow] = useState(Date.now);
  const inFlight = useRef(false);
  const start = useMutation(api.game.start);
  const submitAnswer = useMutation(api.game.submitAnswer);
  const advance = useMutation(api.game.advance);
  const retryJudgment = useMutation(api.game.retryJudgment);
  const heartbeat = useMutation(api.rooms.heartbeat);
  const leaveRoom = useMutation(api.rooms.leaveRoom);
  const closeRoom = useMutation(api.rooms.closeRoom);
  const view = useQuery(
    api.game.view,
    busy === "leave" ? "skip" : { roomId, guestToken },
  );
  const connection = useConvexConnectionState();
  const audio = useAudio();
  const roomOpen = view !== undefined && view.room.closedAt === null;
  const match = view?.match ?? null;
  const game = match && isGameView(match) ? match : null;
  const playing = game !== null && game.status === "active";
  useHeartbeat({
    enabled: roomOpen && busy !== "leave",
    send: async () => {
      await heartbeat({ roomId, guestToken });
    },
  });
  useWakeLock({ enabled: roomOpen && playing });

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 1800);
    return () => clearTimeout(timer);
  }, [toast]);

  // A new question clears the previous draft and error.
  const roundId = game?.round?.id ?? null;
  useEffect(() => {
    setDraft("");
    setError("");
  }, [roundId]);

  async function run(
    operation: Exclude<Busy, null>,
    action: () => Promise<unknown>,
  ) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(operation);
    setError("");
    try {
      await action();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      inFlight.current = false;
      setBusy(null);
    }
  }

  async function copyInvite() {
    try {
      await navigator.clipboard.writeText(joinUrl);
      setToast("Invite link copied");
      audio.play("copy");
    } catch {
      setToast("Copy is unavailable here");
    }
  }

  if (busy === "leave") {
    return (
      <Frame>
        <p className="sub" role="status" style={{ marginTop: "9vh" }}>
          Leaving the room…
        </p>
      </Frame>
    );
  }
  if (!view) {
    return (
      <Frame>
        <p className="sub" role="status" style={{ marginTop: "9vh" }}>
          <span className="spinner" aria-hidden="true" />
          Opening the room…
        </p>
      </Frame>
    );
  }

  const viewerId = view.viewerPlayerId;
  const host = view.room.hostPlayerId === viewerId;
  const hostName =
    view.members.find((member) => member.isHost)?.displayName ?? "The host";
  const displayNameOf = (playerId: string) =>
    view.members.find((member) => member.playerId === playerId)?.displayName ??
    "Someone";
  const nameOf = (playerId: string) =>
    playerId === viewerId ? YOU : displayNameOf(playerId);
  const presentCount = view.members.filter(
    (member) => classifyPresence(member, now) === "present",
  ).length;
  const round = game?.round ?? null;
  const offline = !connection.isWebSocketConnected;

  const startGame = () =>
    void run("start", async () => {
      await heartbeat({ roomId, guestToken });
      await start({ roomId, guestToken });
      audio.play("start");
    });

  const bar = (
    <header className={`bar${round && playing ? " playing" : ""}`}>
      <a className="brand" href="/" aria-label="Kindred home">
        <Mark />
        <span>Kindred</span>
      </a>
      {round && playing && game ? (
        <Progress
          index={round.index}
          total={game.roundCount}
          tiebreak={round.tiebreak}
        />
      ) : null}
      <button
        className="bar-button"
        type="button"
        aria-haspopup="dialog"
        onClick={() => setSheetOpen(true)}
      >
        Room
      </button>
    </header>
  );

  let body: React.ReactNode;
  if (!roomOpen) {
    body = (
      <section className="screen" aria-labelledby="closed">
        <h1 className="headline big" id="closed">
          This room is closed.
        </h1>
        <p className="sub">The game has ended for everyone.</p>
        <div className="actions">
          <button className="btn" type="button" onClick={onExit}>
            Back to start
          </button>
        </div>
      </section>
    );
  } else if (
    match === null ||
    // A finished match without its game record (none survives from before the
    // pair rule) leaves the room ready for a new game.
    (!game && !("spectator" in match) && match.status !== "active")
  ) {
    body = (
      <Lobby
        code={view.room.code}
        members={view.members}
        viewerId={viewerId}
        now={now}
        host={host}
        hostName={hostName}
        canStart={presentCount >= 2 && !offline && busy === null}
        starting={busy === "start"}
        onStart={startGame}
        onCopy={() => void copyInvite()}
      />
    );
  } else if ("spectator" in match) {
    body = (
      <section className="screen" aria-labelledby="watching">
        <h1 className="headline big" id="watching">
          A game is in progress.
        </h1>
        <p className="sub">You’re in for the next one.</p>
      </section>
    );
  } else if (!game) {
    body = (
      <p className="sub" role="status" style={{ marginTop: "9vh" }}>
        <span className="spinner" aria-hidden="true" />
        Getting the first question…
      </p>
    );
  } else if (game.status === "abandoned") {
    body = (
      <section className="screen" aria-labelledby="ended">
        <h1 className="headline big" id="ended">
          That game ended early.
        </h1>
        <p className="sub">The room can start again whenever you’re ready.</p>
        <div className="actions">
          {host ? (
            <button
              className="btn"
              type="button"
              disabled={busy !== null || offline}
              onClick={startGame}
            >
              Start a new game
            </button>
          ) : (
            <p className="hint ink">{hostName} can start a new game.</p>
          )}
        </div>
      </section>
    );
  } else if (game.status === "completed") {
    body = (
      <End
        game={game}
        viewerId={viewerId}
        nameOf={nameOf}
        displayNameOf={displayNameOf}
        host={host}
        hostName={hostName}
        busy={busy !== null || offline}
        onAgain={startGame}
        onCopied={setToast}
      />
    );
  } else if (!round) {
    body = (
      <p className="sub" role="status" style={{ marginTop: "9vh" }}>
        <span className="spinner" aria-hidden="true" />
        Getting the first question…
      </p>
    );
  } else if (round.status === "answering" && round.myAnswer === null) {
    body = (
      <form
        className="screen"
        aria-labelledby="prompt"
        aria-busy={busy === "answer"}
        onSubmit={(event) => {
          event.preventDefault();
          const text = draft.trim();
          if (!text) return;
          void run("answer", async () => {
            await submitAnswer({
              roomId,
              matchId: game.id,
              roundId: round.id,
              guestToken,
              text,
            });
            audio.play("ready");
          });
        }}
      >
        {round.tiebreak && game.tiedPairs ? (
          <p className="notice">
            One more question. Only the tied pairs can score:{" "}
            {game.tiedPairs
              .map((pair) => pairLabel(game, nameOf, pair.a, pair.b))
              .join("; ")}
            .
          </p>
        ) : null}
        <h1
          className="prompt"
          id="prompt"
          style={round.tiebreak ? { marginTop: "3vh" } : undefined}
        >
          {round.prompt}
        </h1>
        <label className="sr-only" htmlFor="answer">
          Your answer
        </label>
        <input
          className="input"
          id="answer"
          autoComplete="off"
          maxLength={64}
          placeholder="Your answer"
          value={draft}
          autoFocus
          onChange={(event) => setDraft(event.currentTarget.value)}
        />
        <p className="hint">
          A word or a few. Nobody sees it until everyone answers.
        </p>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="actions">
          <button
            className="btn"
            type="submit"
            disabled={busy !== null || offline || draft.trim().length === 0}
          >
            {busy === "answer" ? "Sending…" : "Send"}
          </button>
          <p className="hint" role="status">
            {answeredLine(round, viewerId, nameOf)}
          </p>
        </div>
      </form>
    );
  } else {
    body = (
      <RoundBoard
        key={round.id}
        game={game}
        round={round}
        viewerId={viewerId}
        nameOf={nameOf}
        host={host}
        hostName={hostName}
        busy={busy}
        offline={offline}
        error={error}
        onAdvance={() =>
          void run("advance", async () => {
            await advance({ roomId, matchId: game.id, guestToken });
            audio.play("start");
          })
        }
        onRetry={() =>
          void run("retry", () =>
            retryJudgment({
              roomId,
              matchId: game.id,
              roundId: round.id,
              guestToken,
            }),
          )
        }
        onRevealed={() => audio.play("win")}
      />
    );
  }

  return (
    <>
      {offline ? (
        <div className="banner" role="status">
          Reconnecting. Your answer is safe.
        </div>
      ) : null}
      {bar}
      <main>{body}</main>
      <RoomSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        code={view.room.code}
        joinUrl={joinUrl}
        members={view.members}
        viewerId={viewerId}
        now={now}
        host={host}
        roomOpen={roomOpen}
        busy={busy}
        error={error}
        onCopy={() => void copyInvite()}
        onLeave={() =>
          void run("leave", async () => {
            await leaveRoom({ roomId, guestToken });
            audio.play("leave");
            onExit();
          })
        }
        onCloseRoom={() =>
          void run("close", async () => {
            await closeRoom({ roomId, guestToken });
            setSheetOpen(false);
          })
        }
      />
      <div
        className={`toast${toast ? " show" : ""}`}
        role="status"
        aria-live="polite"
      >
        {toast}
      </div>
    </>
  );
}

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <>
      <header className="bar">
        <a className="brand" href="/" aria-label="Kindred home">
          <Mark />
          <span>Kindred</span>
        </a>
      </header>
      <main>
        <section className="screen">{children}</section>
      </main>
    </>
  );
}

function Progress({
  index,
  total,
  tiebreak,
}: {
  index: number;
  total: number;
  tiebreak: boolean;
}) {
  return (
    <div
      className="progress"
      role="img"
      aria-label={
        tiebreak ? "Extra question" : `Question ${index + 1} of ${total}`
      }
    >
      {Array.from({ length: total }, (_, i) => (
        <i
          key={i}
          className={tiebreak || i < index ? "done" : i === index ? "now" : ""}
        />
      ))}
    </div>
  );
}

function answeredLine(
  round: Round,
  viewerId: string,
  nameOf: (id: string) => string,
) {
  const others = round.answeredPlayerIds
    .filter((id) => id !== viewerId)
    .map(nameOf);
  if (others.length === 0) return "";
  return `${listNames(others)} ${others.length === 1 ? "has" : "have"} answered.`;
}

type Member = View["members"][number];

function Lobby(props: {
  code: string;
  members: readonly Member[];
  viewerId: string;
  now: number;
  host: boolean;
  hostName: string;
  canStart: boolean;
  starting: boolean;
  onStart: () => void;
  onCopy: () => void;
}) {
  const duo = props.members.length === 2;
  return (
    <section className="screen" aria-labelledby="lobby-title">
      <h1 className="headline" id="lobby-title" style={{ marginTop: "4vh" }}>
        Room code
      </h1>
      <div
        className="code-tiles"
        role="img"
        aria-label={props.code.split("").join(" ")}
      >
        {props.code.split("").map((letter, i) => (
          <span key={i} aria-hidden="true">
            {letter}
          </span>
        ))}
      </div>
      <p className="center">
        <button className="link" type="button" onClick={props.onCopy}>
          Copy invite link
        </button>
      </p>
      <p className="rule-line">
        {duo
          ? "Say the same thing as each other. Six questions."
          : "When exactly two of you say the same thing, you both score. Three or more, nobody does."}
      </p>
      {duo ? null : <p className="hint">The pair with the most points wins.</p>}
      <p className="section-title">
        {props.members.length}{" "}
        {props.members.length === 1 ? "person" : "people"} here
      </p>
      <ul className="people">
        {props.members.map((member) => {
          const away = classifyPresence(member, props.now) !== "present";
          return (
            <li key={member.playerId} className={away ? "away" : undefined}>
              <span className="av" aria-hidden="true">
                {member.displayName.slice(0, 1).toUpperCase()}
              </span>
              <span className="who">
                {member.displayName}
                {member.playerId === props.viewerId ? " (you)" : ""}
              </span>
              <span className="role">
                {[member.isHost ? "Host" : "", away ? "Away" : ""]
                  .filter(Boolean)
                  .join(", ")}
              </span>
            </li>
          );
        })}
      </ul>
      <div className="actions">
        {props.host ? (
          <>
            <button
              className="btn"
              type="button"
              disabled={!props.canStart}
              onClick={props.onStart}
            >
              {props.starting ? "Starting…" : "Start game"}
            </button>
            <p className="hint">
              {props.members.length < 2
                ? "Waiting for one more person."
                : "Anyone who joins later plays the next game."}
            </p>
          </>
        ) : (
          <p className="hint ink">
            You’re in. Waiting for {props.hostName} to start.
          </p>
        )}
      </div>
    </section>
  );
}

type Stage = "board" | "flat" | "grouped" | "done";

function RoundBoard(props: {
  game: GameView;
  round: Round;
  viewerId: string;
  nameOf: (id: string) => string;
  host: boolean;
  hostName: string;
  busy: Busy;
  offline: boolean;
  error: string;
  onAdvance: () => void;
  onRetry: () => void;
  onRevealed: () => void;
}) {
  const { game, round, viewerId, nameOf } = props;
  const revealed = round.status === "revealed" && game.reveal !== null;
  // A reveal seen live animates; a reveal loaded directly (refresh) lands grouped.
  const [stage, setStage] = useState<Stage>(revealed ? "done" : "board");
  const [flipped, setFlipped] = useState(0);
  const [formed, setFormed] = useState(revealed);
  const [judgingSince, setJudgingSince] = useState<number | null>(null);
  const [, tick] = useState(0);
  const boardRef = useRef<HTMLDivElement>(null);
  const rects = useRef(new Map<string, DOMRect>());
  const onRevealed = useRef(props.onRevealed);
  onRevealed.current = props.onRevealed;

  const answers = revealed
    ? game.participantIds.map((playerId) => {
        const answer = game
          .reveal!.groups.flatMap((group) => group.answers)
          .find((a) => a.playerId === playerId);
        return { playerId, text: answer?.text ?? "" };
      })
    : [];

  // Runs once when the reveal arrives. Stage changes must not re-run it: the
  // cleanup would cancel the pending flips and freeze the board face down.
  const othersCount = game.participantIds.length - 1;
  const animating = useRef(revealed);
  useEffect(() => {
    if (!revealed || animating.current) return;
    animating.current = true;
    if (reducedMotion()) {
      setStage("done");
      setFormed(true);
      onRevealed.current();
      return;
    }
    setStage("flat");
    const others = othersCount;
    const timers: ReturnType<typeof setTimeout>[] = [];
    for (let i = 1; i <= others; i += 1) {
      timers.push(setTimeout(() => setFlipped(i), i * 130));
    }
    timers.push(
      setTimeout(
        () => {
          rects.current.clear();
          boardRef.current
            ?.querySelectorAll<HTMLElement>("[data-player]")
            .forEach((tile) => {
              rects.current.set(
                tile.dataset["player"]!,
                tile.getBoundingClientRect(),
              );
            });
          setStage("grouped");
        },
        others * 130 + 520 + 650,
      ),
    );
    return () => {
      timers.forEach(clearTimeout);
      animating.current = false;
    };
  }, [revealed, othersCount]);

  // FLIP: tiles glide from their flat positions into their groups.
  useLayoutEffect(() => {
    if (stage !== "grouped" || !boardRef.current) return;
    const tiles = [
      ...boardRef.current.querySelectorAll<HTMLElement>("[data-player]"),
    ];
    for (const tile of tiles) {
      const first = rects.current.get(tile.dataset["player"]!);
      if (!first) continue;
      const last = tile.getBoundingClientRect();
      tile.style.transition = "none";
      tile.style.transform = `translate(${first.left - last.left}px, ${first.top - last.top}px)`;
    }
    boardRef.current.getBoundingClientRect();
    const frame = requestAnimationFrame(() => {
      for (const tile of tiles) {
        tile.style.transition =
          "transform 600ms var(--ease), background-color 320ms var(--ease), border-color 320ms var(--ease)";
        tile.style.transform = "";
      }
    });
    const formTimer = setTimeout(() => setFormed(true), 380);
    const doneTimer = setTimeout(() => {
      setStage("done");
      onRevealed.current();
    }, 940);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(formTimer);
      clearTimeout(doneTimer);
    };
  }, [stage]);

  // The slow-judge message counts from when judging started, not from this
  // player's own answer; tick once a second while judging so it can appear.
  useEffect(() => {
    if (round.status !== "adjudicating") return;
    setJudgingSince(Date.now());
    const timer = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(timer);
  }, [round.status]);

  const tile = (playerId: string, text: string, cls = "") => {
    const me = playerId === viewerId;
    return (
      <div
        key={playerId}
        className={`tile${me ? " me" : ""}${cls}`}
        data-player={playerId}
      >
        <span className="t">{text}</span>
        <span className="n">{me ? YOU : nameOf(playerId)}</span>
      </div>
    );
  };

  let board: React.ReactNode;
  if (stage === "board" || stage === "flat") {
    let otherIndex = 0;
    board = (
      <div className="loners">
        {game.participantIds.map((playerId) => {
          if (playerId === viewerId) {
            return tile(playerId, round.myAnswer ?? "", " mine");
          }
          if (stage === "flat") {
            otherIndex += 1;
            const text =
              answers.find((a) => a.playerId === playerId)?.text ?? "";
            const isFlipped = otherIndex <= flipped;
            return tile(playerId, text, isFlipped ? " flipping" : " down");
          }
          const answered = round.answeredPlayerIds.includes(playerId);
          return tile(
            playerId,
            answered ? "" : "Thinking",
            answered ? " down" : " pending",
          );
        })}
      </div>
    );
  } else {
    let color = 0;
    const groups = game.reveal!.groups;
    const colored = groups.filter((g) => g.kind !== "single");
    const singles = groups.filter((g) => g.kind === "single");
    board = (
      <>
        {colored.map((group, i) => {
          const style = {
            "--g": group.scored
              ? `var(${GROUP_COLORS[color++ % GROUP_COLORS.length]})`
              : "var(--down)",
          } as CSSProperties;
          return (
            <div
              key={i}
              className={`group${formed ? " formed" : ""}`}
              style={style}
              aria-label={
                group.kind === "crowd"
                  ? `${group.answers.length} people, nobody scores`
                  : group.scored
                    ? "A pair, scores"
                    : "A pair, does not score"
              }
            >
              {group.answers.map((a) =>
                tile(
                  a.playerId,
                  a.text,
                  formed && stage === "grouped" ? " landed" : "",
                ),
              )}
            </div>
          );
        })}
        {singles.length ? (
          <div className="loners">
            {singles.map((group) =>
              group.answers.map((a) =>
                tile(
                  a.playerId,
                  a.text,
                  a.playerId === viewerId ? " mine" : "",
                ),
              ),
            )}
          </div>
        ) : null}
      </>
    );
  }

  const done = stage === "done" && revealed;
  const waitingOn = game.participantIds.filter(
    (id) => id !== viewerId && !round.answeredPlayerIds.includes(id),
  );
  const slow =
    round.status === "adjudicating" &&
    (round.attempts > 0 ||
      (judgingSince !== null && Date.now() - judgingSince > SLOW_JUDGE_MS));

  return (
    <section className="screen" aria-labelledby="prompt">
      <h1 className="prompt small" id="prompt">
        {round.prompt}
      </h1>
      <div className="reveal" ref={boardRef}>
        {board}
      </div>
      {!revealed ? (
        <p className="sub" role="status" style={{ marginTop: 22 }}>
          {round.status === "answering" ? (
            `Waiting for ${listNames(waitingOn.map(nameOf))}.`
          ) : slow ? (
            "Still checking answers. This is taking longer than usual."
          ) : (
            <>
              <span className="spinner" aria-hidden="true" />
              Everyone’s in.
            </>
          )}
        </p>
      ) : null}
      {done ? (
        <Outcome
          game={game}
          round={round}
          viewerId={viewerId}
          nameOf={nameOf}
        />
      ) : null}
      {props.error ? (
        <p className="error" role="alert">
          {props.error}
        </p>
      ) : null}
      <div className="actions">
        {!revealed && slow && props.host ? (
          <button
            className="btn secondary"
            type="button"
            disabled={props.busy !== null}
            onClick={props.onRetry}
          >
            {props.busy === "retry" ? "Checking…" : "Check again"}
          </button>
        ) : null}
        {done ? (
          props.host ? (
            <button
              className="btn"
              type="button"
              disabled={props.busy !== null || props.offline}
              onClick={props.onAdvance}
            >
              {props.busy === "advance"
                ? "One moment…"
                : nextLabel(game, round)}
            </button>
          ) : (
            <p className="hint ink">
              {props.hostName} will start the next question.
            </p>
          )
        ) : null}
      </div>
    </section>
  );
}

function isDuo(game: GameView) {
  return game.participantIds.length === 2;
}

function topTied(game: GameView) {
  const top = game.standings[0]?.total ?? 0;
  return (
    top > 0 && game.standings.filter((row) => row.total === top).length > 1
  );
}

function nextLabel(game: GameView, round: Round) {
  if (round.tiebreak) return "See who won";
  if (round.index + 1 < game.roundCount) return "Next question";
  if (isDuo(game)) return "See results";
  return topTied(game) ? "One more question" : "See who won";
}

function Outcome(props: {
  game: GameView;
  round: Round;
  viewerId: string;
  nameOf: (id: string) => string;
}) {
  const { game, round, viewerId, nameOf } = props;
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(frame);
  }, []);
  const groups = game.reveal!.groups;
  const mineGroup = groups.find((g) =>
    g.answers.some((a) => a.playerId === viewerId),
  );
  const myText =
    mineGroup?.answers.find((a) => a.playerId === viewerId)?.text ?? "";
  const names = (group: Group) => group.answers.map((a) => nameOf(a.playerId));

  let head: string;
  let sub: string;
  let extra = "";
  if (isDuo(game)) {
    const other = game.participantIds.find((id) => id !== viewerId)!;
    const otherText =
      groups.flatMap((g) => g.answers).find((a) => a.playerId === other)
        ?.text ?? "";
    const matched = mineGroup?.kind === "pair";
    head = matched ? "Same thing." : "Different things.";
    sub = matched
      ? `You and ${nameOf(other)} both said ${otherText}.`
      : `${nameOf(other)} said ${otherText}.`;
  } else {
    const mine: MyGroup =
      mineGroup?.kind === "pair"
        ? {
            kind: "pair",
            partner: nameOf(
              mineGroup.answers.find((a) => a.playerId !== viewerId)!.playerId,
            ),
            scored: mineGroup.scored,
          }
        : mineGroup?.kind === "crowd"
          ? { kind: "crowd", names: names(mineGroup), text: myText }
          : { kind: "single", text: myText };
    ({ head, sub } = outcome(mine));
    extra = othersLine(
      groups
        .filter((g) => g !== mineGroup && g.kind === "pair" && g.scored)
        .map(names),
      groups.filter((g) => g !== mineGroup && g.kind === "crowd").map(names),
    );
  }
  const tieLine =
    !isDuo(game) &&
    !round.tiebreak &&
    round.index + 1 === game.roundCount &&
    topTied(game)
      ? `Tied: ${game.standings
          .filter((row) => row.total === game.standings[0]!.total)
          .map((row) => pairLabel(game, nameOf, row.a, row.b))
          .join("; ")}. One more question decides it.`
      : "";

  return (
    <div className={`fade${shown ? " in" : ""}`} aria-live="polite">
      <h2 className="headline">{head}</h2>
      <p className="sub">{sub}</p>
      {extra ? <p className="sub">{extra}</p> : null}
      <Standings game={game} viewerId={viewerId} nameOf={nameOf} withDelta />
      {tieLine ? (
        <p className="sub strong" style={{ marginTop: 10 }}>
          {tieLine}
        </p>
      ) : null}
    </div>
  );
}

function Standings(props: {
  game: GameView;
  viewerId: string;
  nameOf: (id: string) => string;
  withDelta: boolean;
}) {
  const { game, viewerId, nameOf } = props;
  const played = game.round
    ? Math.min(game.round.index + 1, game.roundCount)
    : game.roundCount;
  if (isDuo(game)) {
    const total = game.standings[0]?.total ?? 0;
    return (
      <p className="sub" style={{ marginTop: 14 }}>
        Matched{" "}
        <strong>
          {total} of {played}
        </strong>{" "}
        so far.
      </p>
    );
  }
  if (game.standings.length === 0) {
    return (
      <p className="sub" style={{ marginTop: 14 }}>
        No pair has scored yet.
      </p>
    );
  }
  const top = game.standings[0]!.total;
  return (
    <ol className="standings" aria-label="Pairs">
      {game.standings.map((row, i) => {
        const tiedAbove = i > 0 && game.standings[i - 1]!.total === row.total;
        const you = row.a === viewerId || row.b === viewerId;
        return (
          <li
            key={`${row.a}|${row.b}`}
            className={[row.total === top ? "lead" : "", you ? "you" : ""].join(
              " ",
            )}
          >
            <span className="rank">{tiedAbove ? "" : i + 1}</span>
            <span className="who">{pairLabel(game, nameOf, row.a, row.b)}</span>
            {props.withDelta && row.delta > 0 ? (
              <span className="delta">+{row.delta}</span>
            ) : (
              <span className="delta none" aria-hidden="true" />
            )}
            <span className="total">{row.total}</span>
          </li>
        );
      })}
    </ol>
  );
}

function End(props: {
  game: GameView;
  viewerId: string;
  nameOf: (id: string) => string;
  displayNameOf: (id: string) => string;
  host: boolean;
  hostName: string;
  busy: boolean;
  onAgain: () => void;
  onCopied: (text: string) => void;
}) {
  const { game, nameOf } = props;
  const duo = isDuo(game);
  const result = game.result;
  const copy = duo
    ? duoEndCopy(game.standings[0]?.total ?? 0, game.roundCount)
    : endCopy({
        winners: (result?.winners ?? []).map((pair) =>
          seatOrdered(game, nameOf, pair.a, pair.b),
        ),
        shared: result?.shared ?? false,
        decidedBy: result?.decidedBy ?? "questions",
        total: result?.total ?? 0,
      });

  async function share() {
    // Shared text leaves the room, so it names everyone, the sharer included.
    const pairs = game.standings.map((row) =>
      seatOrdered(game, props.displayNameOf, row.a, row.b),
    );
    const head = duo
      ? `${game.participantIds.map(props.displayNameOf).join(" and ")} matched ${game.standings[0]?.total ?? 0} of ${game.roundCount}.`
      : endCopy({
          winners: (result?.winners ?? []).map((pair) =>
            seatOrdered(game, props.displayNameOf, pair.a, pair.b),
          ),
          shared: result?.shared ?? false,
          decidedBy: result?.decidedBy ?? "questions",
          total: result?.total ?? 0,
        }).head;
    const lines = [
      "Kindred",
      head,
      ...(duo
        ? []
        : game.standings.map(
            (row, i) => `${listNames(pairs[i]!)} ${row.total}`,
          )),
    ];
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      props.onCopied("Results copied");
    } catch {
      props.onCopied("Copy is unavailable here");
    }
  }

  return (
    <section className="screen" aria-labelledby="end-title">
      <h1 className="headline big" id="end-title">
        {copy.head}
      </h1>
      <p className="sub">{copy.sub}</p>
      {duo || game.standings.length === 0 ? null : (
        <>
          <p className="section-title">Pairs</p>
          <Standings
            game={game}
            viewerId={props.viewerId}
            nameOf={nameOf}
            withDelta={false}
          />
        </>
      )}
      <div className="actions row">
        <button
          className="btn secondary"
          type="button"
          onClick={() => void share()}
        >
          Share results
        </button>
        {props.host ? (
          <button
            className="btn"
            type="button"
            disabled={props.busy}
            onClick={props.onAgain}
          >
            Play again
          </button>
        ) : (
          <p className="hint ink">{props.hostName} can start a new game.</p>
        )}
      </div>
    </section>
  );
}

function RoomSheet(props: {
  open: boolean;
  onClose: () => void;
  code: string;
  joinUrl: string;
  members: readonly Member[];
  viewerId: string;
  now: number;
  host: boolean;
  roomOpen: boolean;
  busy: Busy;
  error: string;
  onCopy: () => void;
  onLeave: () => void;
  onCloseRoom: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [confirmEnd, setConfirmEnd] = useState(false);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (props.open && !dialog.open) dialog.showModal();
    if (!props.open && dialog.open) dialog.close();
    if (!props.open) setConfirmEnd(false);
  }, [props.open]);

  return (
    <dialog ref={ref} aria-labelledby="sheet-title" onClose={props.onClose}>
      <div className="sheet">
        <div className="sheet-head">
          <h2 id="sheet-title">Room {props.code}</h2>
          <button
            className="close-x"
            type="button"
            aria-label="Close"
            onClick={props.onClose}
          >
            ×
          </button>
        </div>
        {props.roomOpen && props.joinUrl ? (
          <>
            <div className="qr">
              <QRCodeDisplay
                value={props.joinUrl}
                label={`Join room ${props.code}`}
                size={148}
                fgColor="#141414"
              />
            </div>
            <button
              className="btn secondary"
              type="button"
              onClick={props.onCopy}
            >
              Copy invite link
            </button>
          </>
        ) : null}
        <p className="section-title">People</p>
        <ul className="sheet-list">
          {props.members.map((member) => {
            const away = classifyPresence(member, props.now) !== "present";
            return (
              <li key={member.playerId}>
                <span>
                  {member.displayName}
                  {member.playerId === props.viewerId ? " (you)" : ""}
                </span>
                <span className="count">
                  {[member.isHost ? "Host" : "", away ? "Away" : ""]
                    .filter(Boolean)
                    .join(", ")}
                </span>
              </li>
            );
          })}
        </ul>
        {props.error && props.open ? (
          <p className="error" role="alert">
            {props.error}
          </p>
        ) : null}
        {props.roomOpen ? (
          <>
            <button
              className="btn secondary"
              type="button"
              disabled={props.busy !== null}
              onClick={props.onLeave}
            >
              Leave room
            </button>
            {props.host ? (
              <p className="center">
                <button
                  className="link"
                  type="button"
                  disabled={props.busy !== null}
                  onClick={() =>
                    confirmEnd ? props.onCloseRoom() : setConfirmEnd(true)
                  }
                >
                  {confirmEnd
                    ? "Tap again to close the room for everyone"
                    : "Close the room for everyone"}
                </button>
              </p>
            ) : null}
            {props.host ? (
              <p className="hint">If you leave, someone else becomes host.</p>
            ) : null}
          </>
        ) : null}
      </div>
    </dialog>
  );
}
