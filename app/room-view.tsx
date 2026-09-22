"use client";

import { avatarForSeat, classifyPresence, parseSeatIndex } from "@parlor/core";
import {
  AvatarBadge,
  ConnectionStatus,
  QRCodeDisplay,
  useAudio,
  useHeartbeat,
  useWakeLock,
} from "@parlor/react";
import { useConvexConnectionState, useMutation, useQuery } from "convex/react";
import { useEffect, useRef, useState } from "react";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { errorMessage } from "./error-message";
import { clusterLabel, revealHeadline } from "./reveal-copy";

type Mode = "hive-mind" | "soulmate";

type Props = {
  roomId: Id<"rooms">;
  guestToken: string;
  joinUrl: string;
  onExit: () => void;
};

export function RoomView({ roomId, guestToken, joinUrl, onExit }: Props) {
  const [busy, setBusy] = useState<
    | "start"
    | "answer"
    | "reveal"
    | "advance"
    | "override"
    | "retry"
    | "leave"
    | "close"
    | null
  >(null);
  const [error, setError] = useState("");
  const [confirmClose, setConfirmClose] = useState(false);
  const [shareStatus, setShareStatus] = useState("");
  const [draftAnswer, setDraftAnswer] = useState("");
  const [mode, setMode] = useState<Mode>("hive-mind");
  const [now, setNow] = useState(Date.now);
  const inFlight = useRef(false);
  const start = useMutation(api.game.start);
  const submitAnswer = useMutation(api.game.submitAnswer);
  const revealNames = useMutation(api.game.revealNames);
  const advance = useMutation(api.game.advance);
  const claimSharedMemory = useMutation(api.game.claimSharedMemory);
  const retryJudgment = useMutation(api.game.retryJudgment);
  const heartbeat = useMutation(api.rooms.heartbeat);
  const leaveRoom = useMutation(api.rooms.leaveRoom);
  const closeRoom = useMutation(api.rooms.closeRoom);
  const room = useQuery(
    api.game.view,
    busy === "leave" ? "skip" : { roomId, guestToken },
  );
  const roomOpen = room !== undefined && room.room.closedAt === null;
  const connection = useConvexConnectionState();
  const audio = useAudio();
  const presence = useHeartbeat({
    enabled: roomOpen && busy !== "leave",
    send: async () => {
      // Heartbeat's transport contract is Promise<void>, not the mutation result.
      await heartbeat({ roomId, guestToken });
    },
  });
  const playing =
    room?.match !== null &&
    room?.match !== undefined &&
    room.match.status === "active" &&
    !("spectator" in room.match);
  const wakeLock = useWakeLock({ enabled: roomOpen && playing === true });

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  async function run(
    operation: Exclude<typeof busy, null>,
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

  if (busy === "leave") {
    return (
      <section className="panel" aria-busy="true">
        <p role="status">Leaving the room…</p>
      </section>
    );
  }
  if (!room) {
    return (
      <section className="panel" aria-busy="true">
        <p role="status">Gathering the room…</p>
        <ConnectionStatus
          status={connection.isWebSocketConnected ? "connected" : "connecting"}
        />
      </section>
    );
  }

  const host = room.room.hostPlayerId === room.viewerPlayerId;
  const viewer = room.members.find(
    (member) => member.playerId === room.viewerPlayerId,
  );
  const presentCount = room.members.reduce(
    (count, member) =>
      count + Number(classifyPresence(member, now) === "present"),
    0,
  );
  const match = room.match;
  const active = match !== null && match.status === "active";
  const round = match && "round" in match ? match.round : null;
  const roundCount = match && "round" in match ? (match.roundCount ?? 0) : 0;
  const reveal = match && "reveal" in match ? match.reveal : null;

  return (
    <div className="room-stack">
      <section className="panel" aria-labelledby="room-heading">
        <header className="room-header">
          <h2 id="room-heading">
            Room <span className="room-code">{room.room.code}</span>
          </h2>
          <ConnectionStatus
            status={
              connection.isWebSocketConnected ? "connected" : "connecting"
            }
          />
        </header>
        {presence.status === "degraded" && (
          <p className="error" role="status">
            The connection is shaky. We will keep trying.
          </p>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}

        {!roomOpen ? (
          <section className="match-state" aria-labelledby="closed-heading">
            <h3 id="closed-heading">This room is closed</h3>
            <p role="status">This game has ended for everyone.</p>
            <button type="button" onClick={onExit}>
              Return to lobby
            </button>
          </section>
        ) : (
          <section
            className="match-state"
            aria-labelledby="match-heading"
            aria-busy={busy === "start" || busy === "answer"}
          >
            {match === null ? (
              <>
                <p className="match-number">Before the first spark</p>
                <h3 id="match-heading">Choose how to connect.</h3>
                {host ? (
                  <>
                    <div
                      className="mode-select"
                      role="group"
                      aria-label="Game mode"
                    >
                      <button
                        type="button"
                        aria-pressed={mode === "hive-mind"}
                        onClick={() => setMode("hive-mind")}
                      >
                        Hive Mind
                      </button>
                      <button
                        type="button"
                        aria-pressed={mode === "soulmate"}
                        onClick={() => setMode("soulmate")}
                      >
                        Soulmate
                      </button>
                    </div>
                    <p className="mode-help">
                      {mode === "hive-mind"
                        ? "Match anyone in the room. Two players get eight prompts together."
                        : "Match your partner. A match no one else shares scores double."}
                    </p>
                    <button
                      type="button"
                      disabled={
                        busy !== null ||
                        presentCount < 2 ||
                        !connection.isWebSocketConnected
                      }
                      onClick={() => {
                        void run("start", async () => {
                          await heartbeat({ roomId, guestToken });
                          await start({ roomId, guestToken, mode });
                          audio.play("start");
                        });
                      }}
                    >
                      {busy === "start" ? "Starting…" : "Start game"}
                    </button>
                    {presentCount < 2 && (
                      <p role="status">Waiting for one more player.</p>
                    )}
                  </>
                ) : (
                  <p role="status">Waiting for the host to begin.</p>
                )}
              </>
            ) : "spectator" in match ? (
              <>
                <h3 id="match-heading">You&apos;re watching this match</h3>
                <p role="status">
                  This round began before you arrived. You are in for the next
                  one.
                </p>
              </>
            ) : match.status === "abandoned" ? (
              <>
                <h3 id="match-heading">Match ended early</h3>
                <p role="status">
                  The room can begin again whenever everyone is ready.
                </p>
              </>
            ) : match.status === "completed" ? (
              <>
                <p className="match-number">Match finished</p>
                <h3 id="match-heading">The results</h3>
                {match.sessionRecord ? (
                  <p className="final-record" role="status">
                    {match.sessionRecord.record}
                  </p>
                ) : match.totals ? (
                  <ul className="score-list">
                    {match.totals.map((total) => (
                      <li key={total.playerId}>
                        <span className="player-name">
                          {total.name ?? "Player"}
                        </span>
                        <span className="score-points">{total.points} pts</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
                <p className="hint">
                  {match.sessionRecord
                    ? "A little record of what happened together."
                    : "Every shared thought added to the score."}
                </p>
                {host && (
                  <button
                    type="button"
                    disabled={busy !== null || !connection.isWebSocketConnected}
                    onClick={() => {
                      void run("start", async () => {
                        await heartbeat({ roomId, guestToken });
                        await start({ roomId, guestToken, mode });
                        audio.play("start");
                      });
                    }}
                  >
                    {busy === "start" ? "Starting…" : "Play again"}
                  </button>
                )}
              </>
            ) : round === null ? (
              <p role="status">Lighting the first prompt…</p>
            ) : (
              <>
                <p className="match-number">
                  Round {round.index + 1} of {match.roundCount} ·{" "}
                  {match.mode === "hive-mind" ? "Hive Mind" : "Soulmate"}
                </p>
                <div className="prompt-card">
                  <span className="category-chip">{round.category}</span>
                  <p className="prompt-text">{round.prompt}</p>
                </div>

                {round.status === "answering" && (
                  <>
                    {round.myAnswer === null ? (
                      <form
                        className="answer-form"
                        onSubmit={(event) => {
                          event.preventDefault();
                          void run("answer", async () => {
                            await submitAnswer({
                              roomId,
                              matchId: match.id,
                              roundId: round.id,
                              guestToken,
                              text: draftAnswer,
                            });
                            setDraftAnswer("");
                            audio.play("ready");
                          });
                        }}
                      >
                        <label htmlFor="secret-answer">
                          Your secret answer
                        </label>
                        <input
                          id="secret-answer"
                          name="answer"
                          value={draftAnswer}
                          maxLength={64}
                          required
                          autoComplete="off"
                          disabled={busy !== null}
                          aria-describedby="answer-help"
                          onChange={(event) =>
                            setDraftAnswer(event.currentTarget.value)
                          }
                        />
                        <p id="answer-help" className="hint">
                          Short and specific. You cannot change it after you
                          send it.
                        </p>
                        <button
                          type="submit"
                          disabled={
                            busy !== null || draftAnswer.trim().length === 0
                          }
                        >
                          {busy === "answer" ? "Locking in…" : "Lock it in"}
                        </button>
                      </form>
                    ) : (
                      <p className="my-answer" role="status">
                        Your answer: <strong>{round.myAnswer}</strong>
                      </p>
                    )}
                    <p className="waiting-count" role="status">
                      {round.answerCount} of {round.participantCount} answers
                      are in.
                    </p>
                  </>
                )}

                {round.status === "adjudicating" && (
                  <div className="pending-panel">
                    <p className="match-number">Everyone answered</p>
                    <h3>Finding the sparks…</h3>
                    <p role="status">
                      The reveal will begin when every thought has found its
                      place.
                    </p>
                    {host && (
                      <button
                        type="button"
                        className="secondary"
                        disabled={busy !== null}
                        onClick={() => {
                          void run("retry", async () => {
                            await retryJudgment({
                              roomId,
                              matchId: match.id,
                              roundId: round.id,
                              guestToken,
                            });
                          });
                        }}
                      >
                        {busy === "retry"
                          ? "Trying again…"
                          : "Try the reveal again"}
                      </button>
                    )}
                  </div>
                )}

                {round.status === "revealed" && reveal && (
                  <>
                    <p className="match-number">Answers first</p>
                    <h3 id="match-heading">See what found its way together.</h3>
                    <p className="reveal-count">
                      {reveal.clusters.length}{" "}
                      {reveal.clusters.length === 1 ? "path" : "paths"} through
                      the room
                    </p>
                    <div className="cluster-list">
                      {reveal.clusters.map((cluster, index) => (
                        <div
                          key={cluster.anchor}
                          className="cluster-card"
                          style={{ animationDelay: `${index * 0.12}s` }}
                        >
                          <p className="cluster-size">
                            {clusterLabel(cluster.answers.length, false)}
                          </p>
                          <ul className="cluster-answers">
                            {cluster.answers.map((answer) => (
                              <li key={answer.text} className="answer-chip">
                                {answer.text}
                              </li>
                            ))}
                          </ul>
                        </div>
                      ))}
                    </div>
                    <button
                      type="button"
                      disabled={busy !== null}
                      onClick={() => {
                        void run("reveal", async () => {
                          await revealNames({
                            roomId,
                            matchId: match.id,
                            roundId: round.id,
                            guestToken,
                          });
                          audio.play("win");
                        });
                      }}
                    >
                      {busy === "reveal"
                        ? "Lighting the names…"
                        : "See who thought it"}
                    </button>
                  </>
                )}

                {round.status === "names" && reveal && (
                  <>
                    <p className="match-number">The lights come on</p>
                    <h3 id="match-heading">
                      {revealHeadline(
                        reveal.clusters.map(
                          (cluster) => cluster.answers.length,
                        ),
                      )}
                    </h3>
                    <div className="cluster-list">
                      {reveal.clusters.map((cluster, index) => (
                        <div
                          key={cluster.anchor}
                          className="cluster-card"
                          style={{ animationDelay: `${index * 0.12}s` }}
                        >
                          <p className="cluster-size">
                            {clusterLabel(cluster.answers.length, true)}
                          </p>
                          <ul className="cluster-answers">
                            {cluster.answers.map((answer) => (
                              <li key={answer.text} className="answer-chip">
                                {answer.text}
                                {answer.name && (
                                  <span className="chip-name">
                                    {answer.name}
                                  </span>
                                )}
                              </li>
                            ))}
                          </ul>
                        </div>
                      ))}
                    </div>
                    {reveal.scores && (
                      <ul className="score-list">
                        {reveal.scores.map((score) => (
                          <li key={score.name}>
                            <span className="player-name">{score.name}</span>
                            <span className="score-points">
                              +{score.points}
                              {match.mode === "soulmate"
                                ? score.points === 4
                                  ? " · unique partner match"
                                  : score.points === 2
                                    ? " · partner match"
                                    : ""
                                : ""}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                    {round.houseAnswers && (
                      <div className="house-answers">
                        <h4>Other paths the prompt could have taken</h4>
                        <div className="house-chips">
                          {round.houseAnswers.map((house) => (
                            <span key={house} className="house-chip">
                              {house}
                            </span>
                          ))}
                        </div>
                        <p className="house-note">
                          These stayed outside this round.
                        </p>
                      </div>
                    )}
                    {match.pairs && (
                      <p className="hint">
                        Pairs:{" "}
                        {match.pairs
                          .map((pair) => `${pair.a} & ${pair.b}`)
                          .join(", ")}
                      </p>
                    )}
                    {round.participantCount === 2 && (
                      <div className="override-box">
                        <h4>Shared memory</h4>
                        <p className="hint">
                          If these answers meant the same thing to both of you,
                          say so together.
                        </p>
                        <button
                          type="button"
                          className="secondary"
                          disabled={busy !== null}
                          onClick={() => {
                            const other = room.members.find(
                              (member) =>
                                member.playerId !== room.viewerPlayerId,
                            );
                            if (!other) return;
                            void run("override", async () => {
                              await claimSharedMemory({
                                roomId,
                                matchId: match.id,
                                roundId: round.id,
                                guestToken,
                                withPlayerId: other.playerId,
                              });
                            });
                          }}
                        >
                          {busy === "override"
                            ? "Remembering…"
                            : "We meant the same thing"}
                        </button>
                        {reveal.overrides.length > 0 && (
                          <p role="status">
                            You both remembered it the same way.
                          </p>
                        )}
                      </div>
                    )}
                    {host ? (
                      <button
                        type="button"
                        disabled={busy !== null}
                        onClick={() => {
                          void run("advance", async () => {
                            await advance({
                              roomId,
                              matchId: match.id,
                              guestToken,
                            });
                            audio.play("start");
                          });
                        }}
                      >
                        {busy === "advance"
                          ? "Moving on…"
                          : round.index + 1 < roundCount
                            ? "Next round"
                            : "Finish and see the record"}
                      </button>
                    ) : (
                      <p role="status">
                        Waiting for the host to{" "}
                        {round.index + 1 < roundCount
                          ? "start the next round"
                          : "finish the game"}
                        .
                      </p>
                    )}
                  </>
                )}
              </>
            )}
            {playing && wakeLock.status === "unsupported" && (
              <p className="hint">Keep this screen awake while you play.</p>
            )}
          </section>
        )}

        <section className="roster" aria-labelledby="players-heading">
          <h3 id="players-heading">
            Players <span className="hint">{room.members.length}/12</span>
          </h3>
          <ul>
            {room.members.map((member) => {
              const seat = parseSeatIndex(member.seatIndex);
              const isYou = member.playerId === room.viewerPlayerId;
              return (
                <li key={member.playerId}>
                  {seat.ok && (
                    <AvatarBadge
                      descriptor={avatarForSeat(seat.value)}
                      name={member.displayName}
                      decorative
                      size="small"
                    />
                  )}
                  <span className="player-name">
                    {member.displayName}
                    {isYou ? " (you)" : ""}
                  </span>
                  <span className="player-role">
                    {member.isHost ? "Host" : `Seat ${member.seatIndex + 1}`}
                    {roomOpen &&
                      (active
                        ? playing
                          ? " · Playing"
                          : " · Watching"
                        : classifyPresence(member, now) !== "present"
                          ? " · Away"
                          : " · Present")}
                  </span>
                </li>
              );
            })}
          </ul>
          {viewer && (
            <p className="identity-details">
              You are in seat {viewer.seatIndex + 1}. Refresh to return to this
              room.
            </p>
          )}
        </section>

        {roomOpen && (
          <section className="room-controls" aria-label="Room controls">
            <div className="button-row">
              <button
                type="button"
                className="secondary"
                disabled={busy !== null}
                onClick={() => {
                  void run("leave", async () => {
                    await leaveRoom({ roomId, guestToken });
                    audio.play("leave");
                    onExit();
                  });
                }}
              >
                Leave room
              </button>
              {host && (
                <button
                  type="button"
                  className="danger secondary"
                  disabled={busy !== null}
                  onClick={() => setConfirmClose(true)}
                >
                  Close room
                </button>
              )}
            </div>
            {host && (
              <p className="hint">
                If you leave, another player becomes host. Closing ends the room
                for everyone.
              </p>
            )}
            {host && confirmClose && (
              <section
                className="close-confirmation"
                aria-labelledby="close-heading"
              >
                <h3 id="close-heading">Close this room for everyone?</h3>
                <p>
                  Any unfinished match will end without a result. This cannot be
                  undone.
                </p>
                <div className="button-row">
                  <button
                    type="button"
                    className="danger"
                    disabled={busy !== null}
                    onClick={() => {
                      void run("close", async () => {
                        await closeRoom({ roomId, guestToken });
                        setConfirmClose(false);
                      });
                    }}
                  >
                    {busy === "close" ? "Closing…" : "Close for everyone"}
                  </button>
                  <button
                    type="button"
                    className="secondary"
                    disabled={busy !== null}
                    onClick={() => setConfirmClose(false)}
                  >
                    Keep room open
                  </button>
                </div>
              </section>
            )}
          </section>
        )}
      </section>

      {roomOpen && joinUrl && (
        <details className="panel share-room">
          <summary>Invite another player</summary>
          <div className="share-content">
            <QRCodeDisplay
              value={joinUrl}
              label="Join this room"
              caption={`Room ${room.room.code}`}
            />
            <div>
              <label htmlFor="join-url">Room link</label>
              <input
                id="join-url"
                value={joinUrl}
                readOnly
                onFocus={(event) => event.currentTarget.select()}
              />
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  void (async () => {
                    try {
                      await navigator.clipboard.writeText(joinUrl);
                      setShareStatus("Room link copied.");
                      audio.play("copy");
                    } catch {
                      setShareStatus(
                        "Copy is unavailable. Select the room link and copy it manually.",
                      );
                    }
                  })();
                }}
              >
                Copy room link
              </button>
              {shareStatus && <p role="status">{shareStatus}</p>}
            </div>
          </div>
        </details>
      )}
    </div>
  );
}
