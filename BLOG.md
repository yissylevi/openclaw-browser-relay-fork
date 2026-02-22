# A Human‑Centered Rebuild of the OpenClaw Browser Relay Extension

This post explains **why** this fork exists, **what problems it solves**, and **how we fixed them**—including the Chrome crash issue. It also documents the exact feature changes, who should use it, and when you should stick with the original.

---

## The Problem We Were Solving

OpenClaw’s browser relay is powerful, but the original Chrome extension was built for a developer‑first workflow. In practice, that meant:

- You had to remember **ports** and **tokens**.
- You had to manually assign **tab IDs** to relays.
- The UI didn’t clearly tell you **what was connected to what**.
- Debugging was done through **service‑worker logs**, not the UI.
- Chrome would occasionally **crash** when attaching, especially on fast‑loading pages.

For a system that is supposed to feel agentic and seamless, the experience was too fragile.

---

## Why We Needed to Fix It

The browser relay is often the first “hands‑on” touchpoint in the OpenClaw workflow. If the relay feels brittle or confusing, users conclude that the system is unreliable—even if the backend is fine.

In short:

- **Reliability** creates trust.
- **Clarity** reduces support tickets.
- **Speed to attach** determines whether people actually use the agent in real workflows.

---

## What Was Breaking (Including Chrome Crashes)

### 1) Attachment Race Conditions
The extension would attach **too early**—before the tab finished loading—causing intermittent attach failures or Chrome instability.

### 2) Event Flooding
The extension forwarded **all CDP events**, which can be thousands of events per second on real websites. This can overwhelm Chrome’s debugger and **crash the browser**.

### 3) Unsafe Attach Targets
Attaching to restricted URLs (`chrome://`, `chrome-extension://`) or tabs already attached by DevTools could crash Chrome or hard‑fail without clear errors.

### 4) UX Confusion
The options page required **manual per‑tab overrides**, and the badge was the only indicator. Users couldn’t easily tell:

- Which port a page was using
- Whether attach was active or stuck
- Whether the token was accepted

### 5) Debugging Was Invisible
When things failed, there was no in‑UI trail. You had to open Chrome service‑worker logs and guess what happened.

---

## What We Did (Step‑by‑Step)

### Step 1 — Make Attach Safe
We added:

- A **wait‑for‑tab‑complete** check before attaching.
- A **retry loop** with backoff.
- A **guard against double‑attach** attempts.
- A **restricted‑URL guard** so we never attach to `chrome-extension://` or other blocked schemes.
- A **DevTools/other debugger guard** (if another debugger is attached, we block and show a clear error).

This eliminated timing‑related crashes and silent failures.

### Step 2 — Stop Event Flooding
We replaced “forward everything” with a strict **allow‑list** and rate limiting:

**Now we only forward:**
- `Page.frameNavigated`
- `Page.loadEventFired`
- `Runtime.exceptionThrown`
- `Runtime.consoleAPICalled`

Everything else is dropped, and events are capped at **20/sec**.

This preserves control without crashing Chrome.

### Step 3 — Make Relay Choice Obvious
We added a **popup** (the extension icon) with two buttons:

- Attach to **Coding** (18789)
- Attach to **Research** (19001)

No more tab ID juggling.

### Step 4 — Build a Human‑Centered Setup Flow
A new **Quick Setup** section now lets you:

- Load the token
- Connect to both relays
- Open both chat windows
- Fix connections if stuck

### Step 5 — Add Visibility
We injected a **small overlay** into attached pages:

```
OpenClaw attached · port 18789
```

This makes it obvious which relay a page is connected to.

### Step 6 — Add Diagnostics
We added an in‑app **Debug Log** panel showing the last 200 events so you can troubleshoot without DevTools.

---

## Code Changes (Summary)

Key changes include:

- `background.js`
  - Safe attach sequence (wait + retry + guard)
  - Restricted URL + “already attached” guards
  - CDP event allow‑list + rate limit
  - Overlay injection
  - Debug logging

- `popup.html` / `popup.js`
  - New popup UI to select relay

- `options.html` / `options.js`
  - Quick Setup UI
  - Token loader
  - Debug log
  - Clear explanations

- `manifest.json`
  - Stable key for consistent extension ID
  - Popup registration
  - `scripting` permission

---

## Final Feature Set (End State)

✅ **Popup relay chooser** (Coding/Research)
✅ **Quick setup wizard**
✅ **Auto‑open chat browsers**
✅ **Per‑page port overlay**
✅ **Safe attach with retries**
✅ **Restricted URL + DevTools guards**
✅ **Crash‑reducing event throttling**
✅ **Debug log built into UI**
✅ **Token auto‑loader** (via native host)

---

## Why This Is Better Than the Original

| Issue | Original | Fork |
|------|---------|------|
| Attach reliability | Unstable | Safe attach + retries |
| Chrome crashes | Frequent | Throttled + allow‑listed + guards |
| Relay selection | Manual tab overrides | One‑click popup |
| Visibility | Badge only | Badge + per‑page overlay |
| Debugging | Service worker logs | Built‑in debug log |
| Setup | Multi‑step manual | Guided Quick Setup |

---

## When You Should Use This Fork

**Use it if:**
- You run **multiple OpenClaw agents** (coding + research).
- You want a **clear UX** for non‑technical users.
- You need **stability** in Chrome (no crashes).
- You want to see **which port a page is attached to**.

---

## When You Should NOT Use This Fork

**Avoid it if:**
- You are testing experimental CDP events that require full event streams.
- You need raw CDP traffic for debugging low‑level DOM/CSS activity.
- You run a custom gateway stack that doesn’t match the default ports.

In those cases, the original extension may be more appropriate.

---

## Repo

https://github.com/yissylevi/openclaw-browser-relay-fork

---

## Final Note

The goal of this fork is not to change OpenClaw’s capabilities—only to make them **reliable, predictable, and human‑centered**. If you want tools that “just work,” this is that version.
