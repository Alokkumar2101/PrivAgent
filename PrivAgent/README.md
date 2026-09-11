# 🛡 PrivAgent — Privacy Protection Assistant

A Manifest V3 Chrome/Chromium extension that detects sensitive information
entered on websites, protects it without breaking site functionality, tracks
third-party request destinations, and offers strictly-allowlisted voice
control of the browser.

## Install (Developer Mode)

1. Go to `chrome://extensions`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked**
4. Select the `PrivAgent/` folder
5. Pin the PrivAgent icon for quick access

## Project structure

```
PrivAgent/
├── manifest.json
├── popup/            popup.html / popup.css / popup.js
├── dashboard/         dashboard.html / dashboard.css / dashboard.js
├── scripts/           content.js, detector.js, privacy-engine.js,
│                       network-monitor.js, storage.js
├── background/         background.js (service worker)
└── assets/            icon16/32/48/128.png
```

## Architecture

```
User → Real website input → Website client-side logic
     → PrivAgent observation/protection (read-only DOM classification)
     → Network request → Server
```

The live page is never touched beyond adding a floating, `pointer-events:
none` badge (for non-authentication fields, only when PII Masking is ON).
Password/OTP/PIN/CVV/API-key/auth-token/credit-card/government-ID fields are
never visually overlaid, never disabled, never made read-only, and never
have their value read or modified in any way beyond a presence check.

- **detector.js** — read-only DOM scanning. Classifies a field's *type*
  (weak signal) and separately validates its *current value* (email regex,
  Luhn-checked card numbers, Indian phone format, etc.) — a field is only
  ever counted when it has a real, validated value. Empty fields and field
  labels never count as PII.
- **privacy-engine.js** — deduplicates via stable IDs
  (`domain + path + field identity + type`), applies confidence thresholds,
  splits **Detected** vs **Protected**, and owns the only code path allowed
  to add a visual badge.
- **content.js** — orchestrates the above, debounces MutationObserver /
  input events, re-baselines on SPA navigation, and reports metadata-only
  state to the background worker. Raw field values never leave this file.
- **network-monitor.js** — non-blocking `webRequest` observation (background
  only). Counts third-party destinations per tab and flags a small allowlist
  of known tracker/analytics domains. It never blocks a request.
- **background.js** — per-tab state, domain-change resets (Current-Website
  Isolation), deterministic Privacy Score, persistent history logging, and
  the sole execution point for voice commands (strict allowlist — see
  below).
- **storage.js** — `chrome.storage.local` wrapper for settings + a capped
  (500-event) history log. History entries are metadata only
  (`{id, timestamp, domain, eventType, dataType, action, riskLevel}`) —
  raw sensitive values are never stored.

## Voice commands

Click the mic in the popup — it listens **once**, for a single command, and
never runs in the background. Supported:

- "Open Google / YouTube / Gmail / GitHub / Wikipedia / Amazon"
- "Open `<domain>`" (e.g. "open example.com")
- "Search YouTube for `<query>`" / "Search Google for `<query>`"
- "Go back" / "Go forward" / "Reload this page"
- "Open a new tab" / "Close this tab"

Anything else returns **"Command not supported."** Commands are parsed
against a fixed allowlist in `background.js` — there is no code path that
evaluates or executes a transcript as code, and no free-form URL is ever
opened from spoken input (URLs are built only from the fixed site map or a
sanitized search-query template). Only a safe command-type label is ever
stored in history — never the raw transcript.

## PII Masking

Off by default, persisted via `chrome.storage.local`. Toggling it never
touches password/OTP/PIN/CVV/card/token/government-ID fields — those are
always policy-protected (never displayed, stored, or sent) regardless of
the toggle. The toggle only controls whether a small floating badge appears
above lower-risk fields (email/phone/name/address).

## Demo Mode vs Live Mode

Live Mode (default) computes every number in the dashboard from real stored
history. Demo Mode swaps in a separate, clearly-labelled illustrative
dataset for presentations — it's never written to storage and never mixes
with real history.

## What's intentionally conservative

- Name/address detection uses stricter thresholds and excludes
  product/company/site-title fields.
- The tracker domain list is a small illustrative sample, not exhaustive.
- Network monitoring only *observes* — if PrivAgent can't confidently
  determine a request is safe to flag, it's recorded as
  "Protection skipped for compatibility" rather than risking a broken
  login/checkout flow.
