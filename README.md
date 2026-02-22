# OpenClaw Browser Relay (Human-Centered Fork)

This is a usability-focused fork of the OpenClaw Browser Relay Chrome extension. It keeps the core relay behavior, but fixes onboarding and day‑to‑day ergonomics so you can actually connect and use it without memorizing ports or tab IDs.

## What’s New (At a Glance)

- **Popup attach chooser**: Click the extension icon and pick **Attach to Coding (18789)** or **Attach to Research (19001)**.
- **Quick setup wizard**: Paste token once, connect, open both chat browsers, or fix connections.
- **Auto‑open chat browsers**: Opens both OpenClaw chat windows on Chrome startup.
- **Per‑page port overlay**: Shows `OpenClaw attached · port ####` on any attached page.
- **Diagnostics**: Built‑in debug log + last attach error for easy troubleshooting.
- **Retry & stability**: Safer attach flow, throttled CDP events, reduced crash risk.
- **Token helper**: Button to load token from local OpenClaw config using a native host bridge.

## Who This Is For

If you run multiple OpenClaw agents (e.g., coding + research) and need to attach specific tabs to the correct relay without wrestling with per‑tab overrides, this fork is for you.

## Features in Detail

### 1) Popup Attach (Recommended)
- Click the extension icon.
- Choose **Attach to Coding** or **Attach to Research**.
- Detach with one click.

### 2) Quick Setup (Options Page)
- Paste token once (or click **Load token**).
- **Connect** tests both relays.
- **Open both** opens the chat windows and attaches safely.
- **Fix connections** reopens and reattaches if the badge is stuck.

### 3) Auto‑Open Chat Browsers
By default, the extension opens:
- `http://127.0.0.1:18789/__openclaw__/canvas/`
- `http://127.0.0.1:19001/__openclaw__/canvas/`

Each opens in its own window.

### 4) Port Overlay on Any Page
Once attached, a small overlay appears:

```
OpenClaw attached · port 18789
```

This makes it obvious which relay the tab is bound to.

### 5) Debug Log
A built‑in log shows attach attempts and failures. If anything is stuck, open Options → Debug Log and copy it into your support thread.

## Installation

1. Download or clone this repo.
2. Open `chrome://extensions`.
3. Enable **Developer mode**.
4. Click **Load unpacked**.
5. Select the folder.

## Usage (Fast Path)

1. Open Options.
2. Click **Load token** (or paste it).
3. Click **Connect**.
4. Click **Open both**.
5. Use the popup to attach any tab.

## Token Loading (Native Host)

The **Load token** button uses a native host script to read:

- `~/.openclaw-coding/openclaw.json`
- `~/.openclaw-research/openclaw.json`

If you don’t want native host access, you can paste the token manually.

## Safety / Stability Changes

- CDP events are now **allow‑listed** and **rate‑limited** to avoid Chrome crashes.
- Attach flow waits for tab load completion and retries safely.

## File Map

- `background.js` — relay logic, attach flow, diagnostics
- `popup.html` / `popup.js` — attach chooser UI
- `options.html` / `options.js` — setup wizard + debug log
- `manifest.json` — MV3 manifest + stable extension key

## Troubleshooting

- **Badge stuck at “…”**: Open Options → Debug Log → copy the latest lines.
- **Bridge missing on Canvas**: It updates every second now; if still missing, reload the page.
- **Token rejected**: Check `gateway.auth.token` in your OpenClaw config.

## License

MIT (or replace with your preferred license).
