# Share Center

Share Center is a no-login text handoff app for moving copied text between your
phone, PC, tablet, or any browser.

Open the same room link on two devices, paste text into the shared editor, and
the other device receives it automatically. Useful clips can be saved into room
history for later copying.

## Features

- No account, login, or registration
- Private-by-link room codes
- QR code room joining
- Autosaving shared text editor
- Room history for reusable clips
- Recent rooms saved locally in the browser
- Clipboard paste, copy room link, copy text, create room, join room, delete clips, clear room
- Live room stats for words, lines, characters, and saved clips
- Responsive DaisyUI interface
- Bun-first Next.js setup

## How syncing works

Rooms are identified by a short code in the URL:

```txt
http://localhost:3000?room=desk-phone
```

The app stores room data on the server in `storage/rooms.json`. This keeps the
starter project simple and easy to self-host. The `storage/` folder is ignored
by Git because it contains local runtime data.

Room links should be treated as secrets. Anyone with a room link can read and
edit that room.

## Getting Started

Install dependencies:

```bash
bun install
```

Run the development server:

```bash
bun run dev
```

Open [http://localhost:3000](http://localhost:3000).

Build for production:

```bash
bun run build
```

Start the production server:

```bash
bun run start
```

## Tech Stack

- Next.js App Router
- React
- TypeScript
- Tailwind CSS v4
- DaisyUI
- Bun

## Roadmap Ideas

- Optional end-to-end encrypted rooms
- Expiring rooms and clips
- File and image sharing
- PWA install support
- Redis/Postgres storage adapter for hosted deployments

## License

MIT
