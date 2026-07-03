import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { Redis } from "@upstash/redis";

export type ShareClip = {
	id: string;
	text: string;
	createdAt: string;
	updatedAt: string;
};

export type ShareDevice = {
	id: string;
	name: string;
	pairedAt: string;
	lastSeenAt: string;
};

export type ShareRoom = {
	roomId: string;
	draft: string;
	updatedAt: string;
	clips: ShareClip[];
	devices: ShareDevice[];
};

type StoreShape = {
	rooms: Record<string, ShareRoom>;
};

const MAX_TEXT_LENGTH = 12_000;
const MAX_CLIPS_PER_ROOM = 30;
const MAX_DEVICES_PER_ROOM = 12;
const STORE_DIR = path.join(process.cwd(), "storage");
const STORE_PATH = path.join(STORE_DIR, "rooms.json");
const ROOM_KEY_PREFIX = "share-center:room:";

const redisUrl =
	process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
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
		throw new Error(
			"Room codes can only contain letters, numbers, and dashes.",
		);
	}
}

function normalizeText(text: unknown) {
	if (typeof text !== "string") {
		throw new Error("Text must be a string.");
	}

	return text.slice(0, MAX_TEXT_LENGTH);
}

function normalizeDeviceId(deviceId: unknown) {
	if (typeof deviceId !== "string") {
		throw new Error("Device id is required.");
	}

	const normalizedDeviceId = deviceId.trim().toLowerCase();

	if (!/^[a-z0-9-]{8,80}$/.test(normalizedDeviceId)) {
		throw new Error("Device id is invalid.");
	}

	return normalizedDeviceId;
}

function normalizeDeviceName(deviceName: unknown) {
	if (typeof deviceName !== "string") {
		throw new Error("Device name is required.");
	}

	return deviceName.trim().slice(0, 48) || "Linked device";
}

function withRoomDefaults(room: ShareRoom): ShareRoom {
	room.clips ??= [];
	room.devices ??= [];
	return room;
}

function isRoom(value: unknown): value is ShareRoom {
	return (
		typeof value === "object" &&
		value !== null &&
		"roomId" in value &&
		typeof (value as ShareRoom).roomId === "string"
	);
}

function normalizeStore(value: unknown): StoreShape {
	if (typeof value !== "object" || value === null) {
		return { rooms: {} };
	}

	if (
		"rooms" in value &&
		typeof (value as StoreShape).rooms === "object" &&
		(value as StoreShape).rooms !== null
	) {
		const rooms = Object.fromEntries(
			Object.entries((value as StoreShape).rooms)
				.filter(([, room]) => isRoom(room))
				.map(([roomId, room]) => [roomId, withRoomDefaults(room)]),
		);

		return { rooms };
	}

	const rooms = Object.fromEntries(
		Object.entries(value)
			.filter(([, room]) => isRoom(room))
			.map(([roomId, room]) => [roomId, withRoomDefaults(room)]),
	);

	return { rooms };
}

async function readStore(): Promise<StoreShape> {
	try {
		const raw = await fs.readFile(STORE_PATH, "utf8");
		return normalizeStore(JSON.parse(raw));
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
		devices: [],
	};

	return withRoomDefaults(store.rooms[normalizedRoomId]);
}

function createRoom(roomId: string): ShareRoom {
	return {
		roomId,
		draft: "",
		updatedAt: now(),
		clips: [],
		devices: [],
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
	const room = existingRoom
		? withRoomDefaults(existingRoom)
		: createRoom(normalizedRoomId);
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

export async function registerDevice(
	roomId: string,
	device: {
		id?: unknown;
		name?: unknown;
	},
) {
	const deviceId = normalizeDeviceId(device.id);
	const deviceName = normalizeDeviceName(device.name);

	return mutateRoom(roomId, (room) => {
		const timestamp = now();
		const existingDevice = room.devices.find(
			(roomDevice) => roomDevice.id === deviceId,
		);

		if (existingDevice) {
			existingDevice.name = deviceName;
			existingDevice.lastSeenAt = timestamp;
		} else {
			room.devices = [
				{
					id: deviceId,
					name: deviceName,
					pairedAt: timestamp,
					lastSeenAt: timestamp,
				},
				...room.devices,
			].slice(0, MAX_DEVICES_PER_ROOM);
		}

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
