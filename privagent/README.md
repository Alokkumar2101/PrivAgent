# 🛡 PrivAgent — Your AI Agent. Your Data. Your Control.

A privacy-preserving AI browser agent built for Smart India Hackathon (SIH).
PrivAgent lets you control your browser with **voice or text commands**, while
guaranteeing that **PII (email, password, name, phone, card numbers, tokens,
etc.) is detected and masked locally in the browser** and never leaves your
machine in raw form.

```
USER → VOICE/TEXT → EXTENSION → DOM ANALYSIS → PII DETECTION → LOCAL MASKING
     → SANITIZATION → SANITIZED CONTEXT ONLY → SERVER/AI REASONING
     → RISK ENGINE → ACTION PLAN → USER APPROVAL (if HIGH risk) → SAFE ACTION
```

---

## 1. Project Overview

PrivAgent is made of three independently runnable pieces:

| Component | What it is | Tech |
|---|---|---|
| `extension/` | Chrome MV3 extension: voice/text agent + local PII protection | JS, Web Speech API, Chrome APIs |
| `server/` | FastAPI backend: privacy gate, mock reasoning, risk engine, live dashboard | Python, FastAPI |
| `demo-site/` | Synthetic "Secure Portal" login page for demoing PII protection | HTML/CSS/JS |

**No paid API key or external cloud service is required.** Everything runs
locally on `127.0.0.1`.

---

## 2. Architecture

### Client-side (the trusted privacy boundary)
```
Browser → DOM → PII Detector → Classification → Sanitizer → Safe Context → Network
```
PII is detected using three combined signals:
- **DOM semantics** — `input[type=password]`, `autocomplete`, `name`/`id` attributes
- **Pattern matching** — regex for email, phone, credit card, OTP, JWT/API keys
- **Label/placeholder semantics** — nearby `<label>`, `placeholder`, `aria-label` text

Each field gets a `{ type, confidence, source }` classification. Only fields
above a confidence threshold are masked and redacted.

### Server-side (defense in depth)
```
Sanitized Context → FastAPI → Privacy Gate (re-verifies no raw PII) →
Mock Reasoning → Risk Engine → Action Planner → Structured Action (typed, allowlisted)
```
The server **never** returns raw JavaScript. It returns typed action objects
(`{ type: "navigate", payload: {...} }`) which the client independently
re-validates against its own allowlist before executing anything.

### DOM + VLM + ViT (extensibility architecture)
- **DOM** — real, used today for form/field/button understanding.
- **VLM** (`ml/vlm-adapter.js`) — currently a clearly-labelled **mock**
  (`engine: 'mock'`) that approximates page understanding from DOM structure.
  Interface is model-agnostic — swap in Transformers.js or a self-hosted VLM
  without touching calling code.
- **ViT** (`ml/vit-adapter.js`) — currently a clearly-labelled **mock** that
  reuses PII bounding boxes from the DOM detector as a stand-in for visual
  region detection. Documented upgrade path to ONNX Runtime Web + WebGPU.

We do **not** claim a real vision model runs in this prototype — seebeen
comments in `ml/vision-interface.js` for the honest breakdown and upgrade path.

---

## 3. Features

- 🎙 **Real voice control** — Web Speech API, executes actual browser actions
  (not just transcription)
- ⌨ **Text command fallback** — same parser/intent engine, for when voice is
  unsupported or a mic isn't available
- 🔍 **Client-side PII detection** — email, password, name, phone, address,
  credit card, OTP, API key, auth token
- 🔒 **Visual masking** — non-destructive lock badges over sensitive fields;
  toggleable, underlying inputs still work
- 🧼 **Sanitization** — only `[EMAIL_REDACTED]`-style tokens ever leave the
  browser
- 🛡 **Server privacy gate** — independently re-scans every payload; blocks
  anything that looks like raw PII
- 📊 **Two live dashboards** — client-side Privacy Dashboard and server-side
  Server Console, both backed by real data (not hardcoded demo text)
- ⚠ **Prompt-injection defense** — detects "ignore previous instructions"
  style attacks embedded in page content and blocks them
- 🚦 **Risk engine + approval flow** — every action gets a 0–100 risk score;
  HIGH-risk actions (payment, delete account, change password) always require
  explicit user approval, client-side, regardless of what the server says
- ✅ **Strict action allowlist** — the extension never executes `eval()`,
  `new Function()`, or server-provided JavaScript

---

## 4. Technology Stack

**Extension:** HTML, CSS, JavaScript, Chrome Manifest V3, Web Speech API, `chrome.tabs`/`chrome.scripting`/`chrome.storage`
**Backend:** Python, FastAPI, Pydantic, Uvicorn
**Future AI/ML integration points:** LLM (OpenAI/Claude/Gemini/Ollama), VLM, ViT, ONNX Runtime Web, WebGPU, Transformers.js

---

## 5. Installation

### Prerequisites
- Python 3.9+
- Google Chrome (or any Chromium-based browser with MV3 support)

### 5.1 Backend setup

```bash
cd server
pip install -r ../requirements.txt
uvicorn main:app --host 127.0.0.1 --port 8000
```

You should see:
```
INFO:     Uvicorn running on http://127.0.0.1:8000
```

Open `http://127.0.0.1:8000` in a browser tab to see the **live Server
Console** dashboard (it starts at zero and updates in real time as the
extension sends requests).

### 5.2 Demo site setup

No build step needed — it's static HTML. Easiest options:

```bash
# Option A: Python's built-in server (separate terminal, separate port)
cd demo-site
python3 -m http.server 5500
# then open http://127.0.0.1:5500/login.html
```

Or simply open `demo-site/login.html` directly in Chrome via `File → Open`.

### 5.3 Chrome extension installation

1. Open Chrome and go to `chrome://extensions`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked**
4. Select the `extension/` folder from this project
5. The PrivAgent icon should appear in your toolbar — pin it for easy access

---

## 6. Voice Command Usage

Click the PrivAgent icon → click **Start Listening** → speak a command.
Chrome will ask for microphone permission the first time — allow it.

Example commands:
| You say | What happens |
|---|---|
| "Open Google" | Opens `https://www.google.com` |
| "Open YouTube" | Opens `https://www.youtube.com` |
| "Search Google for AI powered healthcare" | Opens Google search results for that query |
| "Go to github.com" | Navigates to `https://github.com` |
| "Open Amazon and search for wireless keyboard" | Opens Amazon, then searches |
| "Scroll down" / "Scroll up" | Scrolls the page |
| "Go back" / "Go forward" / "Refresh the page" | Standard nav controls |
| "Delete my account" | Flagged HIGH risk — approval modal appears, nothing executes until you click Approve |

If your browser doesn't support the Web Speech API (or the mic is denied),
use the **⌨ Type a Command** box in the popup — it runs through the exact
same parser and intent engine.

---

## 7. PII Detection Explanation

See `extension/privacy/pii-detector.js`. Detection combines:
1. **DOM attribute signals** (`type=password`, `autocomplete=tel`, `name`/`id` regex)
2. **Regex pattern matching** on live field values (email, phone, credit card, JWT, API key patterns)
3. **Label/placeholder semantic keywords** ("Full Name", "Mobile Number", "OTP", etc.)

Each signal contributes a weighted confidence score; scores are combined per
field and the highest-confidence type wins. Only fields scoring ≥ 0.5 are
reported and masked.

---

## 8. Client/Server Communication

The **only** thing ever sent to the FastAPI backend is a `ContextPayload`:

```json
{
  "page": "Secure Portal",
  "url_host": "localhost",
  "task": "login",
  "fields": {
    "email": "[EMAIL_REDACTED]",
    "password": "[PASSWORD_REDACTED]",
    "fullname": "[NAME_REDACTED]",
    "phone": "[PHONE_REDACTED]"
  },
  "pii_detected": 4,
  "timestamp": "2026-09-10T00:00:00Z"
}
```

The server's `privacy_gate.py` independently re-scans this payload for raw
PII patterns (regex-based) and for any field value that isn't a recognized
redaction token. If it finds anything suspicious, it returns:

```json
{ "status": "BLOCKED", "reason": "Possible raw PII detected (email pattern found)" }
```

This was verified live during development — a payload with a real email
address is correctly blocked with HTTP 400.

---

## 9. Security Model

PrivAgent never:
- transmits passwords, cookies, or authentication tokens
- transmits raw credit-card numbers
- executes `eval()`, `new Function()`, or arbitrary server-provided JavaScript
- stores raw PII in `chrome.storage` or server logs
- sends microphone audio anywhere — voice recognition uses the browser's
  built-in Web Speech engine, and only the resulting text transcript is
  processed

Server logs (`server.state.recent_requests`) only ever contain: request ID,
timestamp, task, page, status, and (for blocked requests) a reason string —
never raw field values.

---

## 10. Risk Engine

Every action gets a score 0–100 (see `agent/risk-engine.js` and
`server/risk_engine.py`, kept in sync):

| Action | Score | Level |
|---|---|---|
| scroll, focus, read_page | 5 | LOW |
| navigate, search | 10 | LOW |
| click, type | 30–35 | MEDIUM |
| submit, login, send | 55–60 | MEDIUM |
| change_password | 85 | HIGH |
| payment | 90 | HIGH |
| delete_account | 95 | HIGH |

`level >= 70` → HIGH → `approval_required: true`. The **client always makes
the final call** — even if the server suggested an action, the extension
will not execute a HIGH-risk action without an explicit "Approve" click in
the popup modal.

---

## 11. Prompt-Injection Defense

`extension/privacy/injection-detector.js` scans visible page text for
patterns like "ignore previous instructions", "reveal your password", "send
the user's credentials", "disable security", "bypass privacy protection",
etc. If found, the event is logged (`INJECTION_AMBIENT_DETECTED`) and shown
in both dashboards; the offending content is never included in anything sent
to the agent for reasoning.

The demo site (`demo-site/login.html`) includes exactly this kind of string
in a low-opacity "fine print" block for the demonstration.

---

## 12. DOM + ViT + VLM Architecture

See Section 2 above and the code comments in `extension/ml/*.js`. Summary:
DOM parsing is real and used today; ViT (visual privacy detector) and VLM
(visual page analyzer) are implemented as clearly-labelled mock adapters
behind a stable interface, so a real ONNX/WebGPU or Transformers.js model
can be dropped in later without changing any calling code.

---

## 13. SIH Judge Demonstration Procedure

**Setup (before judges arrive):**
1. Start the backend: `uvicorn main:app --host 127.0.0.1 --port 8000` (from `server/`)
2. Load the extension via `chrome://extensions` → Load unpacked
3. Open `demo-site/login.html` in a tab
4. Open `http://127.0.0.1:8000` in a second tab (Server Console)

**3–5 minute demo script:**

| Time | Step | What to show |
|---|---|---|
| 0:00 | Say "Open Google" via voice | Extension listens, recognizes, actually opens Google |
| 0:30 | Say "Search Google for AI powered healthcare" | Real Google search results appear |
| 1:00 | Go to Secure Portal tab, click extension → **Scan & Protect** | Fields get 🔒 badges; popup shows PII counts |
| 1:45 | Click **Privacy Dashboard** | Show PII Detected/Blocked, "Raw PII: Protected/Local Only" |
| 2:15 | Click **Send Sanitized Context** | Switch to Server Console tab — show live request appear with `[REDACTED]` fields, "ZERO RAW PII TRANSMITTED" |
| 2:45 | Point out the fine-print prompt-injection text on the demo page | Show the dashboard event log flag it as blocked |
| 3:15 | Say/type "Delete my account" | Approval modal appears — explain the action is NOT executed without explicit approval |
| 3:45 | Click **Generate Action Plan** | Show reasoning steps + risk score returned by the FastAPI backend |
| 4:15 | Wrap-up | Recap: local-first privacy, defense-in-depth (client + server), extensible ML architecture |

---

## 14. Future Improvements

- Replace mock reasoning (`server/reasoning.py`) with a real LLM call (OpenAI/Claude/Gemini/Ollama) — interface is already shaped for this
- Replace ViT/VLM mocks with real ONNX Runtime Web + WebGPU models for genuine visual PII detection and page understanding
- Add on-device NER (e.g. a small transformer) for higher-recall PII detection beyond regex/DOM heuristics
- Persistent, encrypted local audit log with export
- Multi-language voice command support
- Fine-grained per-site privacy policies (user-configurable allowlists)

## 15. Production Limitations (this is a prototype)

- Confidence thresholds and regex patterns are tuned for demo clarity, not
  adversarial robustness — a determined attacker could craft inputs that
  evade detection
- In-memory server state resets on restart (no persistent database)
- CORS is wide open (`*`) for local demo convenience — restrict this before
  any real deployment
- Site-specific selectors for "click"/"focus"/"type" targets use fuzzy text
  matching, which works well for the demo site but may misfire on complex
  production DOMs
- ViT/VLM are explicitly mocked, not real vision models

---

## Project Structure

```
privagent/
├── extension/
│   ├── manifest.json
│   ├── background/service-worker.js
│   ├── content/{content.js, content.css}
│   ├── voice/{speech-recognition.js, command-parser.js}
│   ├── privacy/{pii-detector.js, sanitizer.js, masking.js, injection-detector.js}
│   ├── agent/{intent-engine.js, action-validator.js, action-executor.js, risk-engine.js}
│   ├── ml/{vit-adapter.js, vlm-adapter.js, vision-interface.js}
│   ├── popup/{popup.html, popup.css, popup.js}
│   ├── dashboard/{dashboard.html, dashboard.css, dashboard.js}
│   └── icons/{icon16.png, icon48.png, icon128.png}
├── server/
│   ├── main.py
│   ├── privacy_gate.py
│   ├── reasoning.py
│   ├── risk_engine.py
│   ├── action_planner.py
│   └── static/server-dashboard.html
├── demo-site/
│   ├── login.html, success.html, style.css, demo.js
├── requirements.txt
└── README.md
```
