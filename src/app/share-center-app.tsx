"use client";

import {
  ArrowUpRight,
  Check,
  Clipboard,
  Copy,
  Eraser,
  History,
  Link,
  Plus,
  QrCode,
  RefreshCw,
  Sparkles,
  Trash2,
  Wifi,
} from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import Image from "next/image";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import type { ShareRoom } from "@/lib/share-store";

type SyncState = "idle" | "loading" | "saving" | "saved" | "error";

type RecentRoom = {
  roomId: string;
  lastOpenedAt: string;
};

const LOCAL_ROOM_KEY = "share-center-room";
const LOCAL_RECENT_ROOMS_KEY = "share-center-recent-rooms";
const MAX_RECENT_ROOMS = 5;

function createRoomCode() {
  const first = Math.random().toString(36).slice(2, 6);
  const second = Math.random().toString(36).slice(2, 6);

  return `${first}-${second}`;
}

function cleanRoomCode(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "")
    .slice(0, 48);
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function readRecentRooms() {
  try {
    const raw = localStorage.getItem(LOCAL_RECENT_ROOMS_KEY);
    return raw ? (JSON.parse(raw) as RecentRoom[]) : [];
  } catch {
    return [];
  }
}

function rememberRoom(roomId: string) {
  const recentRooms = readRecentRooms();
  const nextRecentRooms = [
    { roomId, lastOpenedAt: new Date().toISOString() },
    ...recentRooms.filter((room) => room.roomId !== roomId),
  ].slice(0, MAX_RECENT_ROOMS);

  localStorage.setItem(LOCAL_RECENT_ROOMS_KEY, JSON.stringify(nextRecentRooms));
  return nextRecentRooms;
}

export function ShareCenterApp() {
  const [roomId, setRoomId] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [draft, setDraft] = useState("");
  const [room, setRoom] = useState<ShareRoom | null>(null);
  const [syncState, setSyncState] = useState<SyncState>("idle");
  const [notice, setNotice] = useState("Ready for text.");
  const [copied, setCopied] = useState<string | null>(null);
  const [recentRooms, setRecentRooms] = useState<RecentRoom[]>([]);
  const [showQr, setShowQr] = useState(false);
  const hasUnsavedDraft = useRef(false);
  const didLoadRoom = useRef(false);

  const shareUrl = useMemo(() => {
    if (!roomId || typeof window === "undefined") {
      return "";
    }

    return `${window.location.origin}${window.location.pathname}?room=${roomId}`;
  }, [roomId]);

  const stats = useMemo(() => {
    const trimmedDraft = draft.trim();
    const wordCount = trimmedDraft ? trimmedDraft.split(/\s+/).length : 0;

    return {
      characters: draft.length,
      words: wordCount,
      lines: draft ? draft.split(/\r\n|\r|\n/).length : 0,
      clips: room?.clips.length ?? 0,
      updatedAt: room?.updatedAt ? formatDateTime(room.updatedAt) : "Not synced yet",
    };
  }, [draft, room]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const roomFromUrl = cleanRoomCode(params.get("room") ?? "");
    const storedRoom = cleanRoomCode(localStorage.getItem(LOCAL_ROOM_KEY) ?? "");
    const nextRoom = roomFromUrl || storedRoom || createRoomCode();

    localStorage.setItem(LOCAL_ROOM_KEY, nextRoom);

    if (!roomFromUrl) {
      window.history.replaceState(null, "", `?room=${nextRoom}`);
    }

    window.queueMicrotask(() => {
      setRoomId(nextRoom);
      setJoinCode(nextRoom);
      setRecentRooms(rememberRoom(nextRoom));
    });
  }, []);

  useEffect(() => {
    if (!roomId) {
      return;
    }

    let isActive = true;

    async function loadRoom(isPolling = false) {
      try {
        if (!isPolling) {
          setSyncState("loading");
        }

        const response = await fetch(`/api/rooms/${roomId}`, {
          cache: "no-store",
        });
        const data = (await response.json()) as {
          room?: ShareRoom;
          error?: string;
        };

        if (!response.ok || !data.room) {
          throw new Error(data.error ?? "Could not load this room.");
        }

        if (!isActive) {
          return;
        }

        setRoom(data.room);

        if (!hasUnsavedDraft.current) {
          setDraft(data.room.draft);
        }

        didLoadRoom.current = true;
        setSyncState("saved");
        setNotice("Room synced.");
      } catch (error) {
        if (!isActive) {
          return;
        }

        setSyncState("error");
        setNotice(error instanceof Error ? error.message : "Sync failed.");
      }
    }

    loadRoom();
    const interval = window.setInterval(() => loadRoom(true), 2500);

    return () => {
      isActive = false;
      window.clearInterval(interval);
    };
  }, [roomId]);

  useEffect(() => {
    if (!roomId || !didLoadRoom.current || !hasUnsavedDraft.current) {
      return;
    }

    const timeout = window.setTimeout(async () => {
      try {
        setSyncState("saving");
        const response = await fetch(`/api/rooms/${roomId}`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ draft }),
        });
        const data = (await response.json()) as {
          room?: ShareRoom;
          error?: string;
        };

        if (!response.ok || !data.room) {
          throw new Error(data.error ?? "Could not save text.");
        }

        hasUnsavedDraft.current = false;
        setRoom(data.room);
        setSyncState("saved");
      } catch (error) {
        setSyncState("error");
        setNotice(error instanceof Error ? error.message : "Autosave failed.");
      }
    }, 450);

    return () => window.clearTimeout(timeout);
  }, [draft, roomId]);

  async function copyText(value: string, label: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(label);
      window.setTimeout(() => setCopied(null), 1400);
    } catch {
      setNotice("Clipboard permission was blocked by the browser.");
    }
  }

  function switchRoom(nextRoom: string) {
    const normalizedRoom = cleanRoomCode(nextRoom);

    if (normalizedRoom.length < 4) {
      setNotice("Use at least 4 characters for a room code.");
      return;
    }

    didLoadRoom.current = false;
    hasUnsavedDraft.current = false;
    localStorage.setItem(LOCAL_ROOM_KEY, normalizedRoom);
    window.history.replaceState(null, "", `?room=${normalizedRoom}`);
    setRoomId(normalizedRoom);
    setJoinCode(normalizedRoom);
    setRecentRooms(rememberRoom(normalizedRoom));
    setRoom(null);
    setDraft("");
    setShowQr(false);
  }

  function handleJoin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    switchRoom(joinCode);
  }

  async function pasteFromClipboard() {
    try {
      const text = await navigator.clipboard.readText();

      if (!text) {
        setNotice("Clipboard is empty.");
        return;
      }

      hasUnsavedDraft.current = true;
      setDraft(text);
      setNotice("Clipboard pasted into the room.");
    } catch {
      setNotice("Browser blocked clipboard reading. Paste manually instead.");
    }
  }

  async function shareRoom() {
    if (!shareUrl) {
      return;
    }

    if (navigator.share) {
      await navigator.share({
        title: "Share Center room",
        text: `Join my Share Center room: ${roomId}`,
        url: shareUrl,
      });
      return;
    }

    await copyText(shareUrl, "room-link");
  }

  function clearDraft() {
    hasUnsavedDraft.current = true;
    setDraft("");
    setNotice("Draft cleared. Syncing the empty room now.");
  }

  async function saveClip() {
    if (!draft.trim()) {
      setNotice("Paste or type something before adding it to history.");
      return;
    }

    try {
      setSyncState("saving");
      const response = await fetch(`/api/rooms/${roomId}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ text: draft }),
      });
      const data = (await response.json()) as {
        room?: ShareRoom;
        error?: string;
      };

      if (!response.ok || !data.room) {
        throw new Error(data.error ?? "Could not add clip.");
      }

      setRoom(data.room);
      setSyncState("saved");
      setNotice("Saved to the room history.");
    } catch (error) {
      setSyncState("error");
      setNotice(error instanceof Error ? error.message : "Could not add clip.");
    }
  }

  async function deleteClip(clipId: string) {
    const response = await fetch(`/api/rooms/${roomId}`, {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ clipId }),
    });
    const data = (await response.json()) as { room?: ShareRoom };

    if (data.room) {
      setRoom(data.room);
    }
  }

  async function clearRoom() {
    const response = await fetch(`/api/rooms/${roomId}`, {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ clear: true }),
    });
    const data = (await response.json()) as { room?: ShareRoom };

    if (data.room) {
      hasUnsavedDraft.current = false;
      setRoom(data.room);
      setDraft("");
      setNotice("Room cleared.");
    }
  }

  const syncLabel = {
    idle: "Waiting",
    loading: "Loading",
    saving: "Saving",
    saved: "Synced",
    error: "Needs attention",
  }[syncState];

  const syncBadgeClass = {
    idle: "badge-ghost",
    loading: "badge-info",
    saving: "badge-warning",
    saved: "badge-neutral",
    error: "badge-error",
  }[syncState];

  return (
    <main className="app-shell min-h-screen overflow-hidden text-base-content">
      <section className="mx-auto flex min-h-screen w-full max-w-7xl flex-col px-4 py-5 sm:px-6 lg:px-8">
        <header className="navbar min-h-16 px-0">
          <div className="flex-1 gap-3">
            <Image
              alt="Share Center"
              className="h-11 w-11 rounded-lg shadow-sm"
              height={44}
              src="/logo.svg"
              width={44}
            />
            <div>
              <p className="font-pixel text-lg leading-5">Share Center</p>
              <p className="text-xs text-base-content/55">Text handoff for phone and desktop</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <a
              className="btn btn-ghost btn-sm hidden sm:inline-flex"
              href="https://emirdev.ir"
              rel="noreferrer"
              target="_blank"
            >
              <span className="font-pixel">Built by amirjld</span>
              <ArrowUpRight size={15} />
            </a>
            <span className={`badge gap-1 ${syncBadgeClass}`}>
              <Wifi size={13} />
              {syncLabel}
            </span>
          </div>
        </header>

        <section className="soft-panel mb-4 overflow-hidden rounded-lg border border-base-300 bg-base-100">
          <div className="grid gap-0 lg:grid-cols-[minmax(0,1fr)_390px]">
            <div className="p-5 sm:p-7">
              <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
                <div>
                  <h1 className="font-pixel max-w-3xl text-4xl leading-tight tracking-normal md:text-6xl">
                    Shared clipboard.
                  </h1>
                  <p className="mt-3 max-w-2xl text-base leading-7 text-base-content/60">
                    One room link. One live text surface. Keep the small things
                    that usually get trapped on the wrong device.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2 md:justify-end">
                  <button
                    className="btn btn-primary"
                    type="button"
                    onClick={() => setShowQr(true)}
                    disabled={!shareUrl}
                  >
                    <QrCode size={18} />
                    Show QR
                  </button>
                  <button className="btn btn-outline" type="button" onClick={shareRoom}>
                    <ArrowUpRight size={18} />
                    Share room
                  </button>
                </div>
              </div>
            </div>

            <aside className="border-t border-base-300 bg-base-200 p-5 lg:border-l lg:border-t-0">
              <p className="text-sm font-semibold text-base-content/70">Current room</p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <span className="badge badge-neutral text-base">{roomId || "starting"}</span>
                <button
                  className="btn btn-ghost btn-xs"
                  type="button"
                  onClick={() => copyText(roomId, "room-code")}
                  disabled={!roomId}
                >
                  {copied === "room-code" ? <Check size={15} /> : <Copy size={15} />}
                  Copy code
                </button>
              </div>
              <div className="mt-4 rounded-lg border border-base-300 bg-base-100 p-3">
                <p className="truncate text-sm text-base-content/70">{shareUrl}</p>
              </div>
              <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                <div className="rounded-lg border border-base-300 bg-base-100 p-3">
                  <p className="font-pixel text-2xl">{stats.words}</p>
                  <p className="text-xs text-base-content/55">words</p>
                </div>
                <div className="rounded-lg border border-base-300 bg-base-100 p-3">
                  <p className="font-pixel text-2xl">{stats.lines}</p>
                  <p className="text-xs text-base-content/55">lines</p>
                </div>
                <div className="rounded-lg border border-base-300 bg-base-100 p-3">
                  <p className="font-pixel text-2xl">{stats.clips}</p>
                  <p className="text-xs text-base-content/55">clips</p>
                </div>
              </div>
            </aside>
          </div>
        </section>

        <div className="grid flex-1 gap-4 pb-6 lg:grid-cols-[minmax(0,1fr)_380px]">
          <section className="soft-panel flex min-h-[680px] flex-col rounded-lg border border-base-300 bg-base-100">
            <div className="flex flex-col gap-4 border-b border-base-300 p-4 md:flex-row md:items-center md:justify-between">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="font-pixel text-2xl tracking-normal">Room text</h2>
                  <span className={`badge gap-1 ${syncBadgeClass}`}>
                    <Wifi size={13} />
                    {syncLabel}
                  </span>
                </div>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-base-content/65">
                  {notice}
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  className="btn btn-primary"
                  type="button"
                  onClick={() => copyText(shareUrl, "room-link")}
                  disabled={!shareUrl}
                >
                  {copied === "room-link" ? <Check size={18} /> : <Link size={18} />}
                  Copy link
                </button>
                <button
                  className="btn btn-ghost"
                  type="button"
                  onClick={() => switchRoom(createRoomCode())}
                >
                  <RefreshCw size={18} />
                  New room
                </button>
              </div>
            </div>

            <div className="grid flex-1 gap-4 p-4 xl:grid-cols-[minmax(0,1fr)_280px]">
              <div className="flex min-h-[460px] flex-col gap-3">
                <textarea
                  className="editor-surface textarea textarea-bordered min-h-[420px] w-full flex-1 resize-none bg-base-100 text-base leading-7 focus:outline-primary"
                  placeholder="Paste anything you want to move between devices..."
                  value={draft}
                  onChange={(event) => {
                    hasUnsavedDraft.current = true;
                    setDraft(event.target.value);
                  }}
                />
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-sm text-base-content/60">
                    Last sync: {stats.updatedAt}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <button
                      className="btn btn-outline"
                      type="button"
                      onClick={pasteFromClipboard}
                    >
                      <Clipboard size={18} />
                      Paste
                    </button>
                    <button
                      className="btn btn-outline"
                      type="button"
                      onClick={() => copyText(draft, "draft")}
                      disabled={!draft}
                    >
                      {copied === "draft" ? <Check size={18} /> : <Copy size={18} />}
                      Copy
                    </button>
                    <button
                      className="btn btn-ghost"
                      type="button"
                      onClick={clearDraft}
                      disabled={!draft}
                    >
                      <Eraser size={18} />
                      Clear
                    </button>
                    <button
                      className="btn btn-secondary"
                      type="button"
                      onClick={saveClip}
                      disabled={!draft.trim()}
                    >
                      <Plus size={18} />
                      Save clip
                    </button>
                  </div>
                </div>
              </div>

              <aside className="flex flex-col gap-4 rounded-lg border border-base-300 bg-base-200 p-4">
                <div>
                  <div className="flex items-center gap-2">
                    <Sparkles className="text-secondary" size={18} />
                    <h2 className="font-semibold">Handoff</h2>
                  </div>
                  <ol className="mt-4 space-y-3 text-sm leading-6 text-base-content/70">
                    <li>1. Scan the QR code with your phone.</li>
                    <li>2. Paste text here or use Paste.</li>
                    <li>3. Copy it from the other device when Synced appears.</li>
                  </ol>
                </div>

                <button
                  className="btn btn-outline w-full"
                  type="button"
                  onClick={() => setShowQr(true)}
                >
                  <QrCode size={18} />
                  Open QR join
                </button>

                <form className="space-y-2" onSubmit={handleJoin}>
                  <label className="text-sm font-medium" htmlFor="room-code">
                    Join room code
                  </label>
                  <div className="join w-full">
                    <input
                      id="room-code"
                      className="input join-item input-bordered min-w-0 flex-1"
                      value={joinCode}
                      onChange={(event) => setJoinCode(cleanRoomCode(event.target.value))}
                      placeholder="desk-phone"
                    />
                    <button className="btn join-item btn-neutral" type="submit">
                      Join
                    </button>
                  </div>
                </form>

                <div className="rounded-lg border border-base-300 bg-base-100 p-4">
                  <p className="text-sm font-semibold">Recent rooms</p>
                  <div className="mt-3 space-y-2">
                    {recentRooms.map((recentRoom) => (
                      <button
                        className="btn btn-ghost btn-sm w-full justify-between"
                        key={recentRoom.roomId}
                        type="button"
                        onClick={() => switchRoom(recentRoom.roomId)}
                      >
                        <span className="flex items-center gap-2">
                          <History size={15} />
                          {recentRoom.roomId}
                        </span>
                        <span className="text-xs font-normal text-base-content/55">
                          {formatTime(recentRoom.lastOpenedAt)}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              </aside>
            </div>
          </section>

          <aside className="soft-panel flex min-h-[680px] flex-col rounded-lg border border-base-300 bg-base-100">
            <div className="flex items-center justify-between border-b border-base-300 p-4">
              <div>
                <h2 className="font-bold">Room history</h2>
                <p className="text-sm text-base-content/60">Reusable clips from this room</p>
              </div>
              <button
                className="btn btn-ghost btn-sm"
                type="button"
                onClick={clearRoom}
                disabled={!room || (!room.draft && room.clips.length === 0)}
                title="Clear room"
              >
                <Trash2 size={17} />
              </button>
            </div>

            <div className="flex-1 space-y-3 overflow-y-auto p-4">
              {room?.clips.length ? (
                room.clips.map((clip) => (
                  <article
                    className="rounded-lg border border-base-300 bg-base-200 p-3"
                    key={clip.id}
                  >
                    <div className="mb-3 flex items-center justify-between gap-2">
                      <span className="badge badge-ghost">{formatTime(clip.createdAt)}</span>
                      <div className="flex gap-1">
                        <button
                          className="btn btn-ghost btn-xs"
                          type="button"
                          onClick={() => copyText(clip.text, clip.id)}
                          title="Copy clip"
                        >
                          {copied === clip.id ? <Check size={15} /> : <Clipboard size={15} />}
                        </button>
                        <button
                          className="btn btn-ghost btn-xs"
                          type="button"
                          onClick={() => deleteClip(clip.id)}
                          title="Delete clip"
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </div>
                    <p className="line-clamp-6 whitespace-pre-wrap break-words text-sm leading-6">
                      {clip.text}
                    </p>
                  </article>
                ))
              ) : (
                <div className="flex h-full min-h-80 flex-col items-center justify-center rounded-lg border border-dashed border-base-300 p-6 text-center">
                  <Clipboard className="mb-3 text-base-content/35" size={34} />
                  <p className="font-medium">No clips yet</p>
                  <p className="mt-2 text-sm leading-6 text-base-content/60">
                    Save useful text snippets here so every connected device can
                    copy them later.
                  </p>
                </div>
              )}
            </div>
          </aside>
        </div>

        <footer className="pb-5 pt-1 text-center text-sm text-base-content/55">
          Built by{" "}
          <a
            className="link font-medium text-base-content"
            href="https://emirdev.ir"
            rel="noreferrer"
            target="_blank"
          >
            <span className="font-pixel">amirjld</span>
          </a>
        </footer>
      </section>

      {showQr ? (
        <div className="modal modal-open">
          <div className="modal-box max-w-sm">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h3 className="text-xl font-bold">Scan to join</h3>
                <p className="mt-1 text-sm text-base-content/60">{roomId}</p>
              </div>
              <button className="btn btn-ghost btn-sm" type="button" onClick={() => setShowQr(false)}>
                Close
              </button>
            </div>
            <div className="mt-5 rounded-lg bg-white p-4">
              {shareUrl ? (
                <QRCodeSVG
                  className="h-auto w-full"
                  value={shareUrl}
                  size={280}
                  bgColor="#ffffff"
                  fgColor="#1f2937"
                  marginSize={2}
                />
              ) : null}
            </div>
            <p className="mt-4 break-all text-sm leading-6 text-base-content/65">
              {shareUrl}
            </p>
            <div className="modal-action">
              <button
                className="btn btn-outline"
                type="button"
                onClick={() => copyText(shareUrl, "qr-link")}
              >
                {copied === "qr-link" ? <Check size={18} /> : <Copy size={18} />}
                Copy link
              </button>
              <button className="btn btn-primary" type="button" onClick={() => setShowQr(false)}>
                Done
              </button>
            </div>
          </div>
          <button
            aria-label="Close QR dialog"
            className="modal-backdrop"
            type="button"
            onClick={() => setShowQr(false)}
          />
        </div>
      ) : null}
    </main>
  );
}
