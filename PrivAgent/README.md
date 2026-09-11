# 🛡 PrivAgent — Privacy Protection

A Chrome/Chromium Manifest V3 extension that detects sensitive information
(PII) on websites, offers optional non-destructive visual masking, monitors
third-party requests, and keeps a local, persistent privacy activity log —
**without ever breaking login, autofill, or normal website functionality.**

---

## 1. Install (Load Unpacked)

1. Open `chrome://extensions`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked**
4. Select this project's root folder (the one containing `manifest.json`)
5. Pin the PrivAgent icon to your toolbar

No build step, no dependencies, no server — everything runs locally in the browser.

---

## 2. Project Structure

```
PrivAgent/
├── manifest.json
├── rules.json                  # declarativeNetRequest tracker-blocking rules
├── popup/
│   ├── popup.html
│   ├── popup.css
│   └── popup.js
├── dashboard/
│   ├── dashboard.html
│   ├── dashboard.css
│   └── dashboard.js
├── scripts/
│   ├── content.js              # runs in every page: scan orchestration + masking
│   ├── detector.js             # evidence-based PII detection engine
│   ├── privacy-engine.js       # deterministic privacy score
│   ├── network-monitor.js      # third-party request tracking (background)
│   └── storage.js              # chrome.storage.local wrapper (settings + history)
├── background/
│   └── background.js           # service worker: per-tab state, messaging, history
├── assets/
│   └── icon16/32/48/128.png
└── README.md
```

---

## 3. Why Login/Password Fields Are Never Broken

The content script (`scripts/content.js`) and detector (`scripts/detector.js`)
are **strictly read-only** with respect to every input element:

- Detection only ever *reads* `el.value`, `el.type`, `el.name`, `el.id`,
  `autocomplete`, and nearby label text. It never writes to any of these.
- No `preventDefault()` / `stopPropagation()` is ever called — all listeners
  are passive (`input`, `change`, `blur`, used only to trigger a rescan).
- Masking (when the **PII Masking** toggle is ON) draws a small floating
  badge positioned with `position: fixed` in a single overlay layer
  (`#privagent-overlay-layer`) appended to `<html>`. The real input element
  is never wrapped, cloned, replaced, disabled, or styled.
- **Password, OTP, and CVV fields are structurally excluded from masking**
  (`PrivAgentDetector.NEVER_TOUCH_TYPES`) — PrivAgent never draws anything
  near them, on top of them, or touches them in any way. The browser's own
  native password masking is the only "masking" that ever applies to them.

Conceptually:
```
User → Real Input Element → Website Client Logic → PrivAgent Observation → Network
```
never:
```
User → Fake/Masked Input → Website
```

---

## 4. PII Detection Engine (`scripts/detector.js`)

Detection is **evidence-based**: a field's `type`/`name`/label only produces
a *signal* (e.g. "this looks like an email field"); the actual field
**value** must then pass a real validator before anything is counted.

| Type | Signal (context) | Value validation |
|---|---|---|
| Email | `type=email`, `autocomplete=email`, label/name contains "email" | RFC-ish regex requiring a real `user@domain.tld` shape |
| Phone | `type=tel`, name/label contains phone/mobile/contact | Normalized against Indian mobile pattern (`+91`, 10-digit starting 6-9) |
| Password | `type=password`, `autocomplete=current-password/new-password` | Non-empty (value itself is never inspected, stored, or logged) |
| OTP / CVV | label/name contains otp/verification code / cvv/cvc | Non-empty only |
| Name | `autocomplete=name`, name/label contains full-name/first-name/etc. | Regex for plausible human-name shape + stopword list (rejects "Submit", "Continue", etc.) + length bounds |
| PAN-like ID | name/label contains "pan" | `[A-Z]{5}[0-9]{4}[A-Z]` shape |
| Aadhaar-like ID | name/label contains aadhaar | 12-digit grouped shape |
| Card number | `autocomplete=cc-number`, name/label contains card number | 13–19 digit shape, confidence boosted by a Luhn checksum pass |
| Bank info | name/label contains account number/IFSC/bank | Length heuristic |
| Auth token / API key | name/label contains token/api key/secret | JWT shape, `sk-`/`pk-`/`key-`-style shape, or length ≥ 16 |
| Medical info | name/label contains diagnosis/prescription/blood group | Length heuristic |

Every detection also carries a **confidence score**, and only detections at
or above a per-type threshold (0.75–0.95, stricter for ambiguous types like
Name) are counted. An **empty field is never counted**, and a field whose
name/label merely *says* "Email" or "Password" but holds no valid value (or
no value at all) produces **zero** count — verified by automated tests (see
§8).

### Deduplication
Each detection gets a **stable ID**: `domain + pathname + field selector +
type`. Every scan rebuilds the detection set from scratch keyed by this ID,
so repeated `input`/`change`/mutation events, React/Vue/Angular re-renders,
and autofill events all converge on the same ID and never inflate the count.

---

## 5. Detected vs Protected

- **PII Detected** = any field where `detector.js` found an actual validated
  value (regardless of settings).
- **PII Protected**:
  - Password / OTP / CVV → counted as protected whenever **Protection** is
    enabled (their native browser masking + PrivAgent's total avoidance of
    ever exposing the value is the protection).
  - Every other type (email, phone, name, card, etc.) → counted as
    protected **only when PII Masking is ON** and the overlay was applied.

If Masking is OFF, you'll see `Detected: 1 / Protected: 0` for non-password
types — exactly matching the required behavior.

---

## 6. Per-Website Isolation

`background/background.js` keeps an in-memory `Map<tabId, state>`. Whenever
a tab **starts loading a new URL** (`chrome.tabs.onUpdated`, `status ===
'loading'`), that tab's cached counts are wiped immediately — so switching
from `example.com` (Email:1, Phone:1) to `google.com` shows `Email:0,
Phone:0` right away, never stale data. Client-side SPA route changes (no
full reload) are also caught in `content.js` via a `history.pushState` /
`replaceState` patch + `popstate` listener, which resets the page-local
"seen" set and triggers a fresh scan.

---

## 7. Third-Party Request Monitoring

`scripts/network-monitor.js` (loaded into the background service worker)
observes `chrome.webRequest.onBeforeRequest` **without blocking** — it only
classifies each request's domain as first-party or third-party relative to
the tab's main-frame domain, and labels it `Blocked` if it matches a known
tracker/ad domain or `Allowed` otherwise.

Actual **blocking** of that same known-tracker list is done separately and
declaratively via `rules.json` (`declarativeNetRequest`), which is safer
than synchronous `webRequest` blocking and cannot interfere with
authentication requests, since only a small, explicit list of known
ad/analytics domains is blocked (`doubleclick.net`, `google-analytics.com`,
`googletagmanager.com`, `googlesyndication.com`, `adnxs.com`,
`scorecardresearch.com`, `criteo.com`, `outbrain.com`, `taboola.com`,
`facebook.com/tr*`). Everything else is left alone — if PrivAgent can't
confidently classify a request as a known tracker, it is **allowed**, never
guessed-blocked, to avoid breaking legitimate site functionality.

---

## 8. Testing

Because this runs inside a real browser DOM, the detection engine was
exercised with `jsdom` against realistic HTML fixtures, including:

- Empty email + password fields → **zero** counted (not "field exists = 1")
- Filled email + password → `Email: 1, Password: 1`
- A field labeled "Email Address" holding garbage text → **not** counted
- Indian phone number with spaces/`+91` → normalized and counted once
- A field named `fullname` holding "Submit" → rejected by the name
  stopword/shape filter
- A field named `fullname` holding "Alok Kumar" → counted as Name
- The same field scanned twice (simulating duplicate DOM/input events) →
  still counts as **1**, not 2, via the stable-ID Map merge
- `pan_number` (underscore-separated field name) → correctly recognized as
  a PAN-like ID (a real bug caught during testing: `\bpan\b` doesn't match
  across an underscore boundary, since `_` is a word character in regex;
  fixed by normalizing underscores/hyphens to spaces before keyword
  matching)
- Credit card number (Luhn-valid test number) → detected with high
  confidence
- Disabling a detection category in Settings → that category is excluded
  from the scan entirely

All of the above passed after the underscore-normalization fix.

---

## 9. Persistent History

`scripts/storage.js` wraps `chrome.storage.local` with:
- `privagent_settings` — protection/masking/mode/detection-category
  preferences (survives browser restarts)
- `privagent_history` — capped at **500** events, oldest-first eviction

Every history entry is metadata only:
```json
{
  "id": "…", "timestamp": "…", "domain": "example.com",
  "eventType": "Sensitive Data Detected", "dataType": "email",
  "action": "Protected", "riskLevel": "MEDIUM"
}
```
**Never** a raw password, OTP, token, or card number.

History is visible **only** in Dashboard → History (search + filters by
domain/event type/PII type/risk/action), with a confirming **Clear
History** action that does not touch settings.

---

## 10. Dashboard

Sidebar navigation: **Overview · Protection · History · Analytics ·
Settings** — all sourced from real `chrome.storage.local` data (plus the
most-recently-scanned tab's live snapshot for Overview). Analytics renders
simple bar visualizations (PII by type, risk distribution, 7-day activity)
computed directly from the history log; empty states say "No activity yet"
rather than fabricating numbers.

---

## 11. Popup

Deliberately minimal — status + quick controls only, per spec:
Current Website, Privacy Score (or "Not enough activity"), PII Protected
counts, PII Masking toggle (default **OFF**, persisted), Third-Party
Requests count, Protection Mode selector, and an **Open Dashboard** button.
No command box, no history, no charts.

---

## 12. Privacy Score

Deterministic formula in `scripts/privacy-engine.js`:
```
score = 100
      − min(40, 8 × unprotectedDetections)
      − min(30, 3 × unblockedThirdPartyRequests)
      + min(10, 2 × blockedTrackers)
      + (mode === 'SAFE' ? +5 : mode === 'OFF' ? −15 : 0)
clamped to [0, 100]
```
Same inputs always produce the same score — never randomized.

---

## 13. What PrivAgent Never Does

- Never stores, logs, or transmits raw passwords, OTPs, CVVs, tokens, API
  keys, or full card numbers.
- Never sends any detected PII to an external server — everything is
  processed and stored locally in `chrome.storage.local`.
- Never disables, replaces, or clones a password/OTP/CVV input.
- Never uses `eval()` or executes remote code.
- Never blocks a request it can't confidently classify — it allows and
  records "Protection skipped for compatibility" style behavior implicitly
  by defaulting to `Allowed`.

---

## 14. Known Limitations (prototype scope)

- The Indian-phone validator is tuned for demo clarity, not exhaustive
  international numbering plans.
- Name detection is heuristic (regex + stopword list); it will still miss
  or misfire on unusual names — by design it errs toward **under**-counting
  rather than falsely flagging ordinary text.
- `declarativeNetRequest` blocks a small, explicit tracker list; it is not
  a full ad-blocker.
- Per-tab live state is in-memory in the service worker and is cleared if
  the browser evicts the worker; persistent history is unaffected.
