"use client";

import { normalizeDisplayName } from "@parlor/core";
import { normalizeRoomCode, useAudio, useGuestCredential } from "@parlor/react";
import { useMutation } from "convex/react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { errorMessage } from "./error-message";
import { issueGuest } from "./guest-issuer";
import { Mark } from "./mark";
import { RoomBoundary } from "./room-boundary";
import { RoomView } from "./room-view";

type Step = "home" | "name" | "join";

function subscribeToNavigation(notify: () => void) {
  window.addEventListener("popstate", notify);
  return () => window.removeEventListener("popstate", notify);
}

function getInviteCode() {
  return normalizeRoomCode(
    new URLSearchParams(window.location.search).get("room") ?? "",
  );
}

function getServerValue() {
  return "";
}

function rememberedName() {
  try {
    return sessionStorage.getItem("kindred:name") ?? "";
  } catch {
    return "";
  }
}

export default function Page() {
  const guest = useGuestCredential({
    issuer: issueGuest,
    autoAcquire: true,
    storage: null,
  });
  const inviteCode = useSyncExternalStore(
    subscribeToNavigation,
    getInviteCode,
    getServerValue,
  );
  const [step, setStep] = useState<Step>("home");
  const [roomId, setRoomId] = useState<Id<"rooms"> | null>(null);
  const [joinUrl, setJoinUrl] = useState("");
  const [name, setName] = useState("");
  const [code, setCode] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const inFlight = useRef(false);
  const createRoom = useMutation(api.rooms.createRoom);
  const joinRoom = useMutation(api.rooms.joinRoom);
  const audio = useAudio();
  const roomCode = normalizeRoomCode(code ?? inviteCode);
  const displayName = normalizeDisplayName(name);

  useEffect(() => {
    setName(rememberedName());
  }, []);

  // An invite link lands on the join form with the code filled in.
  useEffect(() => {
    if (inviteCode.length === 4 && roomId === null) setStep("join");
  }, [inviteCode, roomId]);

  async function enter(mode: "create" | "join") {
    if (inFlight.current || !guest.credential || !displayName.ok) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    try {
      const args = {
        displayName: displayName.value,
        guestToken: guest.credential,
      };
      const result =
        mode === "create"
          ? await createRoom(args)
          : await joinRoom({ ...args, code: roomCode });
      if (!("roomId" in result)) {
        throw new Error("code" in result ? result.code : "ROOM_NOT_OPEN");
      }
      const url = new URL(window.location.href);
      url.search = new URLSearchParams({ room: result.code }).toString();
      url.hash = "";
      window.history.replaceState(null, "", url);
      setJoinUrl(url.toString());
      setRoomId(result.roomId);
      try {
        sessionStorage.setItem("kindred:name", displayName.value);
      } catch {
        // Remembering a name is optional; entering the room is not.
      }
      audio.play("join");
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  function exit() {
    setRoomId(null);
    setJoinUrl("");
    setCode("");
    setError("");
    setStep("home");
    const url = new URL(window.location.href);
    url.search = "";
    url.hash = "";
    window.history.replaceState(null, "", url);
  }

  const connecting = !guest.credential;
  const connectLine = connecting ? (
    <p className={guest.error ? "error" : "hint"} role="status">
      {guest.loading || !guest.error
        ? "Connecting…"
        : `${errorMessage(guest.error)} `}
      {!guest.loading && guest.error ? (
        <button
          className="link"
          type="button"
          onClick={() => {
            const request =
              guest.expiresAt === null ? guest.acquire() : guest.refresh();
            void request.catch(() => {});
          }}
        >
          Try again
        </button>
      ) : null}
    </p>
  ) : null;

  if (roomId) {
    return guest.credential ? (
      <RoomBoundary credential={guest.credential} onExit={exit}>
        <RoomView
          roomId={roomId}
          guestToken={guest.credential}
          joinUrl={joinUrl}
          onExit={exit}
        />
      </RoomBoundary>
    ) : (
      <>
        <Bar />
        <main>
          <section className="screen" aria-busy={guest.loading}>
            <h1 className="headline big">Reconnecting</h1>
            <p className="sub">Your place in the room is kept.</p>
            {connectLine}
          </section>
        </main>
      </>
    );
  }

  return (
    <>
      <Bar />
      <main>
        {step === "home" && (
          <section className="screen" aria-labelledby="home-title">
            <Mark className="hero-mark" stroke={1.4} />
            <h1 className="wordmark" id="home-title">
              Kindred
            </h1>
            <p className="tagline">
              When exactly two of you say the same thing, you both score.
            </p>
            <HomeDemo />
            <div className="actions">
              <button
                className="btn"
                type="button"
                onClick={() => setStep("name")}
              >
                Start a game
              </button>
              <button
                className="btn secondary"
                type="button"
                onClick={() => setStep("join")}
              >
                Join a game
              </button>
              <p className="hint">2 to 12 players. About 5 minutes.</p>
            </div>
          </section>
        )}

        {step === "name" && (
          <form
            className="screen"
            aria-labelledby="name-title"
            aria-busy={busy}
            onSubmit={(event) => {
              event.preventDefault();
              void enter("create");
            }}
          >
            <h1 className="prompt" id="name-title">
              What should we call you?
            </h1>
            <label className="sr-only" htmlFor="display-name">
              Your name
            </label>
            <input
              className="input"
              id="display-name"
              autoComplete="nickname"
              maxLength={24}
              placeholder="Your name"
              value={name}
              autoFocus
              onChange={(event) => setName(event.currentTarget.value)}
            />
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            {connectLine}
            <div className="actions">
              <button
                className="btn"
                type="submit"
                disabled={busy || connecting || !displayName.ok}
              >
                {busy ? "Creating room…" : "Create room"}
              </button>
              <button
                className="link"
                type="button"
                onClick={() => {
                  setError("");
                  setStep("home");
                }}
              >
                Back
              </button>
            </div>
          </form>
        )}

        {step === "join" && (
          <form
            className="screen"
            aria-labelledby="join-title"
            aria-busy={busy}
            onSubmit={(event) => {
              event.preventDefault();
              void enter("join");
            }}
          >
            <h1 className="prompt" id="join-title">
              Join a game
            </h1>
            <label className="field-label" htmlFor="room-code">
              Room code
            </label>
            <input
              className="input code"
              id="room-code"
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              maxLength={4}
              placeholder="ABCD"
              value={roomCode}
              autoFocus={roomCode.length !== 4}
              onChange={(event) =>
                setCode(normalizeRoomCode(event.currentTarget.value))
              }
            />
            <label className="field-label" htmlFor="join-name">
              Your name
            </label>
            <input
              className="input"
              id="join-name"
              autoComplete="nickname"
              maxLength={24}
              placeholder="Your name"
              value={name}
              autoFocus={roomCode.length === 4}
              onChange={(event) => setName(event.currentTarget.value)}
            />
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            {connectLine}
            <div className="actions">
              <button
                className="btn"
                type="submit"
                disabled={
                  busy || connecting || !displayName.ok || roomCode.length !== 4
                }
              >
                {busy ? "Joining…" : "Join"}
              </button>
              <button
                className="link"
                type="button"
                onClick={() => {
                  setError("");
                  setStep("home");
                }}
              >
                Back
              </button>
            </div>
          </form>
        )}
      </main>
    </>
  );
}

function Bar() {
  return (
    <header className="bar">
      <a className="brand" href="/" aria-label="Kindred home">
        <Mark />
        <span>Kindred</span>
      </a>
    </header>
  );
}

/** Plays once: couch and sofa pair up, chair stays alone. Decorative. */
function HomeDemo() {
  const [formed, setFormed] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setFormed(true), 1300);
    return () => clearTimeout(timer);
  }, []);
  return (
    <div className="demo" aria-hidden="true">
      <div className="reveal">
        {formed ? (
          <>
            <div
              className="group formed"
              style={{ ["--g" as string]: "var(--g1)" }}
            >
              <DemoTile text="sofa" name="Jo" />
              <DemoTile text="couch" name="Priya" />
            </div>
            <div className="loners">
              <DemoTile text="chair" name="Sam" />
            </div>
          </>
        ) : (
          <div className="loners">
            <DemoTile text="sofa" name="Jo" />
            <DemoTile text="chair" name="Sam" />
            <DemoTile text="couch" name="Priya" />
          </div>
        )}
      </div>
      <p className={`hint fade${formed ? " in" : ""}`}>
        Sofa and couch count as the same answer.
      </p>
    </div>
  );
}

function DemoTile({ text, name }: { text: string; name: string }) {
  return (
    <div className="tile">
      <span className="t">{text}</span>
      <span className="n">{name}</span>
    </div>
  );
}
