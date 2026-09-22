"use client";

import { normalizeDisplayName } from "@parlor/core";
import { RoomCodeInput, normalizeRoomCode, useAudio, useGuestCredential } from "@parlor/react";
import { useMutation } from "convex/react";
import { useRef, useState, useSyncExternalStore } from "react";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { errorMessage } from "./error-message";
import { issueGuest } from "./guest-issuer";
import { RoomBoundary } from "./room-boundary";
import { RoomView } from "./room-view";

function subscribeToNavigation(notify: () => void) {
  window.addEventListener("popstate", notify);
  return () => window.removeEventListener("popstate", notify);
}

function subscribeToStorage(notify: () => void) {
  window.addEventListener("storage", notify);
  return () => window.removeEventListener("storage", notify);
}

function getInviteCode() {
  return normalizeRoomCode(new URLSearchParams(window.location.search).get("room") ?? "");
}

function getRememberedName() {
  try {
    return sessionStorage.getItem("kindred:name") ?? "";
  } catch {
    return "";
  }
}

function getServerValue() {
  return "";
}

export default function Page() {
  const guest = useGuestCredential({ issuer: issueGuest, autoAcquire: true, storage: null });
  const [roomId, setRoomId] = useState<Id<"rooms"> | null>(null);
  const rememberedName = useSyncExternalStore(
    subscribeToStorage,
    getRememberedName,
    getServerValue,
  );
  const inviteCode = useSyncExternalStore(subscribeToNavigation, getInviteCode, getServerValue);
  const [editedName, setDisplayName] = useState<string>();
  const [editedCode, setCode] = useState<string>();
  const displayName = editedName ?? rememberedName;
  const code = editedCode ?? inviteCode;
  const [joinUrl, setJoinUrl] = useState("");
  const [busy, setBusy] = useState<"create" | "join" | null>(null);
  const [error, setError] = useState("");
  const inFlight = useRef(false);
  const createRoom = useMutation(api.rooms.createRoom);
  const joinRoom = useMutation(api.rooms.joinRoom);
  const audio = useAudio();
  const name = normalizeDisplayName(displayName);
  const entryDisabled = !guest.credential || busy !== null || !name.ok;

  async function enter(mode: "create" | "join") {
    if (inFlight.current || !guest.credential || !name.ok) return;
    inFlight.current = true;
    setBusy(mode);
    setError("");
    try {
      const args = { displayName: name.value, guestToken: guest.credential };
      const result = mode === "create" ? await createRoom(args) : await joinRoom({ ...args, code });
      if (!("roomId" in result)) {
        throw new Error("code" in result ? result.code : "ROOM_UNAVAILABLE");
      }
      setRoomId(result.roomId);
      setCode(result.code);
      const url = new URL(window.location.href);
      url.search = new URLSearchParams({ room: result.code }).toString();
      url.hash = "";
      window.history.replaceState(null, "", url);
      setJoinUrl(url.toString());
      try {
        sessionStorage.setItem("kindred:name", name.value);
      } catch {
        // Remembering a display name is optional; entering the room is not.
      }
      audio.play("join");
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      inFlight.current = false;
      setBusy(null);
    }
  }

  function retryGuest() {
    const request = guest.expiresAt === null ? guest.acquire() : guest.refresh();
    void request.catch(() => {});
  }

  function exit() {
    setRoomId(null);
    setJoinUrl("");
    setCode("");
    setError("");
    const url = new URL(window.location.href);
    url.search = "";
    url.hash = "";
    window.history.replaceState(null, "", url);
  }

  return (
    <main className="shell">
      <div className="ambient-light ambient-light--amber" aria-hidden="true" />
      <div className="ambient-light ambient-light--teal" aria-hidden="true" />
      <header className="app-header">
        <a className="brand-lockup" href="/" aria-label="Kindred home">
          <img src="/brand/kindred-mark.svg" width="64" height="64" alt="" />
          <span>
            <span className="eyebrow">A game of shared sparks</span>
            <span className="wordmark">Kindred</span>
          </span>
        </a>
        <button
          type="button"
          className="sound-toggle secondary"
          aria-pressed={audio.enabled}
          aria-label={audio.enabled ? "Turn sound off" : "Turn sound on"}
          onClick={() => {
            if (audio.toggleMuted()) audio.play("ready");
          }}
        >
          <span aria-hidden="true">{audio.enabled ? "♪" : "♪̸"}</span>
          <span className="sound-label">{audio.enabled ? "Sound on" : "Sound off"}</span>
        </button>
      </header>

      {roomId ? (
        guest.credential ? (
          <RoomBoundary credential={guest.credential} onExit={exit}>
            <RoomView
              roomId={roomId}
              guestToken={guest.credential}
              joinUrl={joinUrl}
              onExit={exit}
            />
          </RoomBoundary>
        ) : (
          <section className="panel status-panel" aria-busy={guest.loading}>
            <span className="status-orbit" aria-hidden="true" />
            <p className="eyebrow">Hold that thought</p>
            <h2>Your place is still here.</h2>
            <p role="status">
              {guest.loading ? "Reconnecting you…" : "Reconnect to return to the room."}
            </p>
            {!guest.loading && (
              <button type="button" onClick={retryGuest}>
                Reconnect
              </button>
            )}
          </section>
        )
      ) : (
        <section className="panel lobby" aria-labelledby="lobby-heading">
          <div className="lobby-intro">
            <p className="eyebrow">Same room. Secret answers.</p>
            <h1 id="lobby-heading">Find the same thought.</h1>
            <p>Answer in secret, then discover who lit up with the same idea.</p>
          </div>

          {!guest.credential && (
            <div className="inline-notice" role={guest.error ? "alert" : "status"}>
              <span className="status-orbit" aria-hidden="true" />
              <div>
                <strong>{guest.loading ? "Making space for you…" : "We lost the connection."}</strong>
                {guest.error && <p>{errorMessage(guest.error)}</p>}
              </div>
              {!guest.loading && (
                <button type="button" className="secondary" onClick={retryGuest}>
                  Try again
                </button>
              )}
            </div>
          )}

          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (code.length === 4) void enter("join");
            }}
            aria-busy={busy !== null}
          >
            <label htmlFor="display-name">What should we call you?</label>
            <input
              id="display-name"
              name="displayName"
              autoComplete="nickname"
              value={displayName}
              maxLength={48}
              required
              disabled={busy !== null}
              aria-describedby="name-help"
              placeholder="Your name"
              onChange={(event) => setDisplayName(event.currentTarget.value)}
            />
            <p id="name-help" className="hint">
              Keep it to 24 characters.
            </p>
            {displayName.trim() && !name.ok && (
              <p className="field-error" role="status">
                Use 1 to 24 characters.
              </p>
            )}
            <button
              type="button"
              className="primary-action"
              disabled={entryDisabled}
              onClick={() => {
                void enter("create");
              }}
            >
              {busy === "create" ? "Starting a room…" : "Start a room"}
            </button>

            <div className="join-divider" aria-hidden="true">
              <span>or join your people</span>
            </div>
            <div className="join-form">
              <RoomCodeInput
                value={code}
                onChange={setCode}
                label="Room code"
                description="Four characters from your host."
                disabled={busy !== null}
                sound={audio.enabled}
              />
              <button
                type="submit"
                className="secondary"
                disabled={entryDisabled || code.length !== 4}
              >
                {busy === "join" ? "Joining…" : "Join room"}
              </button>
            </div>
          </form>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
        </section>
      )}

      <footer className="app-footer">
        <span className="footer-spark" aria-hidden="true" />
        <p>Your answer stays hidden until everyone is ready.</p>
      </footer>
    </main>
  );
}
