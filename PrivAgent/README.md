# PrivAgent — Your AI Agent. Your Data. Your Control.

A Manifest V3 Chrome/Chromium extension. Premium dark/gold UI, real-time
PII detection and protection that never breaks login/password fields, and
a fast, strictly-allowlisted voice command agent.

## Install

1. Open `chrome://extensions`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked**
4. Select the `PrivAgent/` folder
5. Pin the PrivAgent icon

The Voice Agent will ask for microphone permission the first time you tap
the mic — Chrome/Chromium handles this natively; PrivAgent never requests
it repeatedly on its own.

## Project structure

```
PrivAgent/
├── manifest.json
├── popup/               popup.html / popup.css / popup.js
├── dashboard/            dashboard.html / dashboard.css / dashboard.js
├── scripts/              content.js, detector.js, privacy-engine.js,
│                          network-monitor.js, storage.js
├── voice/                voice-engine.js, command-parser.js,
│                          command-executor.js, voice-ui.js
├── background/            background.js (service worker)
└── assets/               icon16/32/48/128.png
```

## Design system

Near-black surfaces (`#050505` / `#0d0d0d` / `#121212`) with a single gold
accent (`#ffd21f`) reserved for active states, key numbers, and the
protection/voice indicators — the rest of the UI stays neutral grey/white
text on dark surfaces. No emoji as primary icons; all icons are inline SVG
with consistent stroke weight. Respects `prefers-reduced-motion`.

## Data flow / password safety (unchanged, load-bearing)

```
User → Real website input → Website client-side logic
     → PrivAgent observation (read-only DOM classification)
     → Network request → Server
```

`detector.js` only ever reads DOM/value properties. `privacy-engine.js` is
the only code allowed to touch the page visually, and it only appends a
floating, `pointer-events:none` badge to `document.body` — the real input
is never moved, wrapped, disabled, or restyled. Password/OTP/PIN/CVV/
API-key/token/card/government-ID fields never get a badge at all, in any
toggle state, and are always treated as policy-protected once detected.

## Voice Agent — what's actually new here

**Pipeline:** microphone → SpeechRecognition (interim results on) →
normalization → intent match + confidence → duplicate-execution lock →
executor → UI feedback.

- **Fast:** `recognition.interimResults = true`. Every interim transcript
  is checked against `command-parser.js`; the instant one crosses the
  confidence threshold, recognition stops and the command fires —
  PrivAgent doesn't wait for you to go silent once it's already sure.
- **Fuzzy, not brittle:** "open youtube", "go to youtube", "launch
  youtube", "take me to youtube" all resolve to the same intent. Filler
  words ("please", "can you", "just"...) are stripped before matching.
- **Confidence-gated:** every match returns an intent + confidence score.
  Anything under the threshold (0.75) is `UNKNOWN` — PrivAgent says
  "Command not understood" rather than guessing at an uncertain command.
- **No duplicate execution:** a local lock in `voice-engine.js` and an
  independent lock in `background.js` both discard a repeat of the same
  normalized command within 1.5s, so interim/final double-fires or a
  recognition restart can never fire twice.
- **Strict allowlist, always:** `command-parser.js` is pure pattern
  matching with zero `eval`/`Function`/code execution. It never accepts a
  raw URL from speech — `OPEN_WEBSITE` only resolves through a fixed
  `SITE_MAP` or a `domain.tld`-shaped match rebuilt as `https://domain.tld`;
  searches are built from a fixed template with the query
  `encodeURIComponent`-escaped. `command-executor.js` — the only file that
  ever calls `chrome.tabs.*` / `chrome.scripting.*` — runs exclusively in
  the background service worker, never in the popup or a content script.
  History stores only the safe intent enum (e.g. `OPEN_WEBSITE`), never
  the raw transcript.

Supported commands (fuzzy variants included): open `<site>`/`<domain>`,
search Google/YouTube for `<query>`, go back/forward, reload, open/close
tab, scroll up/down/top/bottom, open dashboard/settings, show activity,
enable/disable protection.

## Dashboard

Overview · Protection · Activity · Voice Agent · Analytics · Settings —
hash-routable (`dashboard.html#activity`, etc.) so the popup's footer nav
and voice commands like "open settings" can deep-link straight to a tab.
Every number is computed from `chrome.storage.local` history — Demo Mode
swaps in a separate, clearly-labelled illustrative dataset for
presentations and never touches real history.

## What's intentionally conservative

- Name/address detection uses stricter thresholds and excludes
  product/company/site-title fields.
- The tracker domain list is a small illustrative sample, not exhaustive.
- Network monitoring only *observes* — nothing is silently blocked; an
  uncertain case is recorded as protected/flagged rather than risking a
  broken login or checkout flow.
