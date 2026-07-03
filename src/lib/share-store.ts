import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Redis } from "@upstash/redis";

export type ShareClip = {
  id: string;
  text: string;
  createdAt: string;
  updatedAt: string;
};

export type ShareRoom = {
  roomId: string;
  draft: string;
  updatedAt: string;
  clips: ShareClip[];
};

type StoreShape = {
  rooms: Record<string, ShareRoom>;
};

const MAX_TEXT_LENGTH = 12_000;
const MAX_CLIPS_PER_ROOM = 30;
const STORE_DIR = path.join(process.cwd(), "storage");
const STORE_PATH = path.join(STORE_DIR, "rooms.json");
const ROOM_KEY_PREFIX = "share-center:room:";

const redisUrl = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
const redisToken =
  process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;
const isVercel = process.env.VERCEL === "1";
const redis =
  redisUrl && redisToken
    ? new Redis({
        url: redisUrl,
        token: redisToken,
      })
    : null;

let writeQueue = Promise.resolve();

function now() {
  return new Date().toISOString();
}

function normalizeRoomId(roomId: string) {
  return roomId.trim().toLowerCase();
}

function assertRoomId(roomId: string) {
  if (!/^[a-z0-9-]{4,48}$/.test(roomId)) {
    throw new Error("Room codes can only contain letters, numbers, and dashes.");
  }
}

function normalizeText(text: unknown) {
  if (typeof text !== "string") {
    throw new Error("Text must be a string.");
  }

  return text.slice(0, MAX_TEXT_LENGTH);
}

async function readStore(): Promise<StoreShape> {
  try {
    const raw = await fs.readFile(STORE_PATH, "utf8");
    return JSON.parse(raw) as StoreShape;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { rooms: {} };
    }

    throw error;
  }
}

async function writeStore(store: StoreShape) {
  await fs.mkdir(path.dirname(STORE_PATH), { recursive: true });
  await fs.writeFile(STORE_PATH, JSON.stringify(store, null, 2), "utf8");
}

function ensureRoom(store: StoreShape, roomId: string) {
  const normalizedRoomId = normalizeRoomId(roomId);
  assertRoomId(normalizedRoomId);

  store.rooms[normalizedRoomId] ??= {
    roomId: normalizedRoomId,
    draft: "",
    updatedAt: now(),
    clips: [],
  };

  return store.rooms[normalizedRoomId];
}

function createRoom(roomId: string): ShareRoom {
  return {
    roomId,
    draft: "",
    updatedAt: now(),
    clips: [],
  };
}

function getRoomKey(roomId: string) {
  const normalizedRoomId = normalizeRoomId(roomId);
  assertRoomId(normalizedRoomId);
  return {
    key: `${ROOM_KEY_PREFIX}${normalizedRoomId}`,
    roomId: normalizedRoomId,
  };
}

function assertStorageConfigured() {
  if (redis || !isVercel) {
    return;
  }

  throw new Error(
    "Persistent storage is not configured. Add Vercel KV or Upstash Redis environment variables.",
  );
}

async function mutateStore<T>(mutation: (store: StoreShape) => T | Promise<T>) {
  assertStorageConfigured();

  const run = writeQueue.then(async () => {
    const store = await readStore();
    const result = await mutation(store);
    await writeStore(store);
    return result;
  });

  writeQueue = run.then(
    () => undefined,
    () => undefined,
  );

  return run;
}

async function mutateRoom(
  roomId: string,
  mutation: (room: ShareRoom) => ShareRoom | Promise<ShareRoom>,
) {
  assertStorageConfigured();

  if (!redis) {
    return mutateStore(async (store) => {
      const room = ensureRoom(store, roomId);
      const nextRoom = await mutation(room);
      store.rooms[nextRoom.roomId] = nextRoom;
      return nextRoom;
    });
  }

  const { key, roomId: normalizedRoomId } = getRoomKey(roomId);
  const existingRoom = await redis.get<ShareRoom>(key);
  const room = existingRoom ?? createRoom(normalizedRoomId);
  const nextRoom = await mutation(room);

  await redis.set(key, nextRoom);

  return nextRoom;
}

export async function getRoom(roomId: string) {
  return mutateRoom(roomId, (room) => room);
}

export async function updateDraft(roomId: string, text: unknown) {
  return mutateRoom(roomId, (room) => {
    room.draft = normalizeText(text);
    room.updatedAt = now();
    return room;
  });
}

export async function addClip(roomId: string, text: unknown) {
  return mutateRoom(roomId, (room) => {
    const timestamp = now();
    const clip: ShareClip = {
      id: randomUUID(),
      text: normalizeText(text).trim(),
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    if (!clip.text) {
      throw new Error("Clip text cannot be empty.");
    }

    room.clips = [clip, ...room.clips].slice(0, MAX_CLIPS_PER_ROOM);
    room.updatedAt = timestamp;
    return room;
  });
}

export async function deleteClip(roomId: string, clipId: unknown) {
  if (typeof clipId !== "string") {
    throw new Error("Clip id is required.");
  }

  return mutateRoom(roomId, (room) => {
    room.clips = room.clips.filter((clip) => clip.id !== clipId);
    room.updatedAt = now();
    return room;
  });
}

export async function clearRoom(roomId: string) {
  return mutateRoom(roomId, (room) => {
    room.draft = "";
    room.clips = [];
    room.updatedAt = now();
    return room;
  });
}
