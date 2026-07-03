import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

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

async function mutateStore<T>(mutation: (store: StoreShape) => T | Promise<T>) {
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

export async function getRoom(roomId: string) {
  return mutateStore((store) => ensureRoom(store, roomId));
}

export async function updateDraft(roomId: string, text: unknown) {
  return mutateStore((store) => {
    const room = ensureRoom(store, roomId);
    room.draft = normalizeText(text);
    room.updatedAt = now();
    return room;
  });
}

export async function addClip(roomId: string, text: unknown) {
  return mutateStore((store) => {
    const room = ensureRoom(store, roomId);
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

  return mutateStore((store) => {
    const room = ensureRoom(store, roomId);
    room.clips = room.clips.filter((clip) => clip.id !== clipId);
    room.updatedAt = now();
    return room;
  });
}

export async function clearRoom(roomId: string) {
  return mutateStore((store) => {
    const room = ensureRoom(store, roomId);
    room.draft = "";
    room.clips = [];
    room.updatedAt = now();
    return room;
  });
}
