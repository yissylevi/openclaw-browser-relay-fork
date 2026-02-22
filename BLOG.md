# A Human‑Centered Fork of the OpenClaw Browser Relay Extension

If you’ve ever used the OpenClaw Browser Relay extension with multiple agents, you’ve probably felt the friction: tab IDs, per‑tab overrides, manual attach steps, and that dreaded red “!” badge. This fork exists to make the relay **feel obvious** and **work the way humans expect**.

This post walks through what changed, why it matters, and how to install it.

---

## The Problem

The original extension is powerful, but the workflow is not obvious for non‑technical users:

- You need to know ports and tokens.
- You have to remember which tab is attached to which relay.
- Attaching a tab too early can crash Chrome.
- Troubleshooting requires digging into service‑worker logs.

That makes the tool feel brittle, even when it’s working correctly.

---

## The Goal

Make the extension usable **without a manual checklist**:

- Connect once
- Pick Coding vs Research
- See immediately which relay a page is using
- Recover instantly if something breaks

---

## What’s New

### 1) Popup Attach Chooser
Click the extension icon and choose:

- **Attach to Coding (18789)**
- **Attach to Research (19001)**

No per‑tab overrides, no options‑page detours. The popup is now the primary control surface.

---

### 2) Quick Setup Wizard
The options page now starts with a Quick Setup block:

- **Load token** (automatic)
- **Connect** (tests both relays)
- **Open both** (chat windows open automatically)
- **Fix connections** (re‑opens and re‑attaches)

It’s built for a one‑time setup flow, not a “read the docs” flow.

---

### 3) Auto‑Open Chat Browsers
On Chrome startup, the extension opens:

- `http://127.0.0.1:18789/__openclaw__/canvas/`
- `http://127.0.0.1:19001/__openclaw__/canvas/`

Each in its own window. No more hunting for the right chat tab.

---

### 4) Port Overlay on Every Page
When a tab is attached, a small overlay appears:

> **OpenClaw attached · port 18789**

Now you can see immediately which relay the tab belongs to.

---

### 5) Built‑in Debug Log
Instead of “open service worker logs and hunt,” the options page shows the last 200 debug lines. If something breaks, you can copy/paste the log instantly.

---

### 6) Stability Fixes
To prevent Chrome crashes:

- CDP events are **allow‑listed** and **rate‑limited**.
- Attach waits for tab load completion.
- Attach retries are safe and bounded.

---

## Installation

1. Download or clone the repo.
2. Open `chrome://extensions`.
3. Enable **Developer mode**.
4. Click **Load unpacked**.
5. Select the extension folder.

---

## Usage (Fast Path)

1. Open Options.
2. Click **Load token**.
3. Click **Connect**.
4. Click **Open both**.
5. Use the popup to attach any tab.

---

## Why This Matters

A tool like OpenClaw is only as powerful as its **everyday usability**. This fork focuses on the most human‑centered question:

> “What would make this feel obvious for someone who isn’t thinking about ports, tokens, and relays?”

That’s the bar. This fork moves closer to it.

---

## Repo & Download

Clone the repo and load it as an unpacked extension:

```
https://github.com/yissylevi/openclaw-browser-relay-fork
```

(Replace with your GitHub username.)

---

If you want to use this in a team, or integrate automatic token loading through a native host, it’s already supported.

If you want improvements or contributions, open an issue in the repo.
