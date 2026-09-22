import {
  closeRoomForPlayer,
  createRoomForPlayer,
  joinRoomForPlayer,
  leaveRoomForPlayer,
  resolvePlayer,
} from "@parlor/convex";
import { ensurePlayer } from "@parlor/convex/identity";
export { getRoomState, heartbeat } from "@parlor/convex/rooms";
import { v } from "convex/values";
import { mutation } from "./_generated/server";
import { scheduleMatchAbandoned, scheduleRoomEntry } from "./productEvents";

const guestTokenArg = v.optional(v.string());
const roomResultValidator = v.object({
  roomId: v.id("rooms"),
  playerId: v.id("players"),
  code: v.string(),
  seatIndex: v.number(),
  eligibleFromCycle: v.number(),
});
const joinRoomResultValidator = v.union(
  v.object({
    ok: v.literal(true),
    roomId: v.id("rooms"),
    playerId: v.id("players"),
    code: v.string(),
    seatIndex: v.number(),
    eligibleFromCycle: v.number(),
  }),
  v.object({
    ok: v.literal(false),
    code: v.union(
      v.literal("INVALID_DISPLAY_NAME"),
      v.literal("INVALID_ROOM_CODE"),
      v.literal("ROOM_JOIN_RATE_LIMIT"),
      v.literal("ROOM_NOT_OPEN"),
      v.literal("ROOM_DATA_INVALID"),
      v.literal("ROOM_FULL"),
    ),
  }),
);

export const createRoom = mutation({
  args: { displayName: v.string(), guestToken: guestTokenArg },
  returns: roomResultValidator,
  handler: async (ctx, args) => {
    const actor = await ensurePlayer(ctx, args.guestToken);
    const result = await createRoomForPlayer(ctx, {
      actor,
      displayName: args.displayName,
    });
    await scheduleRoomEntry(ctx, {
      roomId: result.roomId,
      playerId: actor.playerId,
      eventName: "room_created",
    });
    return result;
  },
});

export const joinRoom = mutation({
  args: {
    code: v.string(),
    displayName: v.string(),
    guestToken: guestTokenArg,
  },
  returns: joinRoomResultValidator,
  handler: async (ctx, args) => {
    const actor = await ensurePlayer(ctx, args.guestToken);
    const result = await joinRoomForPlayer(ctx, {
      actor,
      code: args.code,
      displayName: args.displayName,
    });
    if (result.ok) {
      await scheduleRoomEntry(ctx, {
        roomId: result.roomId,
        playerId: actor.playerId,
        eventName: "room_joined",
      });
    }
    return result;
  },
});

export const leaveRoom = mutation({
  args: { roomId: v.id("rooms"), guestToken: guestTokenArg },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const actor = await resolvePlayer(ctx, args.guestToken);
    return leaveRoomForPlayer(ctx, {
      actor,
      roomId: args.roomId,
      onAbandoned: async (match) => {
        if (match.status !== "abandoned") return;
        await scheduleMatchAbandoned(ctx, {
          matchId: match.id,
          reason: match.reason,
          occurredAt: match.abandonedAt,
        });
      },
    });
  },
});

export const closeRoom = mutation({
  args: { roomId: v.id("rooms"), guestToken: guestTokenArg },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const actor = await resolvePlayer(ctx, args.guestToken);
    return closeRoomForPlayer(ctx, {
      actor,
      roomId: args.roomId,
      onAbandoned: async (match) => {
        if (match.status !== "abandoned") return;
        await scheduleMatchAbandoned(ctx, {
          matchId: match.id,
          reason: match.reason,
          occurredAt: match.abandonedAt,
        });
      },
    });
  },
});
