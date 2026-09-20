/**
 * PrivAgent :: Background Service Worker
 *
 * Responsibilities:
 *  - Tracks per-tab PII state (pushed from content.js — metadata only,
 *    never raw values) and third-party/tracker counts (from
 *    network-monitor.js).
 *  - Resets per-tab state on navigation to a new domain (Current-Website
 *    Isolation requirement).
 *  - Logs new detections / voice commands / toggle changes to persistent
 *    history as metadata only.
 *  - Computes a deterministic Privacy Score from real signals — never
 *    random.
 *  - Is the ONLY place voice-command transcripts are parsed and executed,
 *    against a strict allowlist. It can never run arbitrary code, a raw
 *    URL string from the transcript, or an unrecognized command.
 */

importScripts(
  '../scripts/storage.js',
  '../scripts/network-monitor.js',
  '../voice/command-parser.js',
  '../voice/command-executor.js'
);

const tabEntries = new Map(); // tabId -> { domain, piiState, knownIds:Set }

function hostnameOf(url) {
  try { return new URL(url).hostname; } catch (e) { return null; }
}

function resetTab(tabId, domain) {
  tabEntries.set(tabId, { domain, piiState: emptyPiiState(), knownIds: new Set() });
  self.PrivAgentNetworkMonitor.resetTab(tabId, domain);
}

function emptyPiiState() {
  return { counts: {}, protectedCounts: {}, totalDetected: 0, totalProtected: 0, ids: [] };
}

function getOrCreateTab(tabId, domain) {
  if (!tabEntries.has(tabId)) resetTab(tabId, domain);
  return tabEntries.get(tabId);
}

const RISK_LEVEL = {
  password: 'HIGH', otp: 'HIGH', pin: 'HIGH', cvv: 'HIGH', credit_card: 'HIGH',
  gov_id: 'HIGH', api_key: 'HIGH', auth_token: 'HIGH',
  email: 'MEDIUM', phone: 'MEDIUM',
  name: 'LOW', address: 'LOW'
};

function labelFor(type) {
  const map = {
    email: 'Email', password: 'Password', phone: 'Phone number', name: 'Name',
    address: 'Address', credit_card: 'Credit/debit card', otp: 'OTP', pin: 'PIN',
    cvv: 'CVV', api_key: 'API key', auth_token: 'Authentication token', gov_id: 'Government ID'
  };
  return map[type] || type;
}

// ---------------- Navigation tracking (Current-Website Isolation) ----------------

chrome.webNavigation.onBeforeNavigate.addListener((details) => {
  if (details.frameId !== 0) return; // top frame only
  const domain = hostnameOf(details.url);
  resetTab(details.tabId, domain);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  tabEntries.delete(tabId);
  self.PrivAgentNetworkMonitor.removeTab(tabId);
});

self.PrivAgentNetworkMonitor.attach(async (evt) => {
  const entry = tabEntries.get(evt.tabId);
  const domain = (entry && entry.domain) || evt.domain;
  await self.PrivAgentStorage.addHistoryEvent({
    domain, eventType: 'tracker_detected', dataType: evt.destination,
    action: 'protected', riskLevel: 'MEDIUM'
  });
});

// ---------------- Privacy score ----------------

function computePrivacyScore({ totalDetected, totalProtected, thirdPartyCount, trackerCount, protectionMode }) {
  let score = 100;
  const unprotected = Math.max(0, totalDetected - totalProtected);
  score -= Math.min(40, unprotected * 8);           // unprotected sensitive fields hurt most
  score -= Math.min(20, trackerCount * 5);           // known trackers
  score -= Math.min(10, Math.max(0, thirdPartyCount - 5)); // excess third-party chatter
  if (protectionMode === 'OFF') score -= 20;
  if (protectionMode === 'SAFE') score += 5;
  return Math.max(0, Math.min(100, Math.round(score)));
}

// ---------------- Voice command execution (authoritative) ----------------
// Parsing lives in voice/command-parser.js (shared with the popup, which
// uses it only for fast optimistic UI — this re-parse is what actually
// authorizes execution). Execution lives in voice/command-executor.js.
// This is the ONLY place a voice command results in a browser action.

let lastVoiceNorm = null;
let lastVoiceAt = 0;
const VOICE_DUPLICATE_WINDOW_MS = 1500;

async function handleVoiceCommand(rawTranscript, tabId) {
  const parsed = self.PrivAgentCommandParser.parseCommand(rawTranscript);
  const confident = self.PrivAgentCommandParser.isConfident(parsed);

  const now = Date.now();
  const isDuplicate = confident && parsed.norm === lastVoiceNorm && (now - lastVoiceAt) < VOICE_DUPLICATE_WINDOW_MS;
  if (isDuplicate) {
    return { ok: false, commandType: 'duplicate_ignored', message: '' };
  }

  let ok = false, message = 'Command not supported.';
  if (confident) {
    lastVoiceNorm = parsed.norm;
    lastVoiceAt = now;
    const result = await self.PrivAgentCommandExecutor.execute(parsed, { tabId });
    ok = result.ok;
    message = result.message;
  }

  const entry = tabId ? tabEntries.get(tabId) : null;
  await self.PrivAgentStorage.addHistoryEvent({
    domain: (entry && entry.domain) || 'browser',
    eventType: 'voice_command',
    dataType: confident ? parsed.intent : 'not_supported', // safe enum only — raw transcript is never stored
    action: ok ? 'executed' : 'not_supported',
    riskLevel: 'LOW'
  });

  return { ok, commandType: confident ? parsed.intent : 'not_supported', message };
}

// ---------------- Message router ----------------

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    try {
      switch (message.type) {
        case 'PII_STATE_UPDATE': {
          const tabId = sender.tab && sender.tab.id;
          if (tabId == null) return sendResponse({ ok: false });
          const entry = getOrCreateTab(tabId, message.host);
          entry.domain = message.host;
          entry.piiState = message.state;

          const settings = await self.PrivAgentStorage.getSettings();
          if (settings.piiDetectionEnabled) {
            for (const item of message.state.ids || []) {
              if (entry.knownIds.has(item.id)) continue;
              entry.knownIds.add(item.id);
              await self.PrivAgentStorage.addHistoryEvent({
                domain: message.host,
                eventType: 'pii_detected',
                dataType: labelFor(item.type),
                action: item.protected ? 'protected' : 'detected',
                riskLevel: RISK_LEVEL[item.type] || 'LOW'
              });
            }
          }
          sendResponse({ ok: true });
          return;
        }

        case 'GET_SUMMARY': {
          const { tabId, host } = message;
          // Ask the content script for the freshest state; fall back to cache.
          if (tabId != null) {
            try {
              const live = await chrome.tabs.sendMessage(tabId, { type: 'GET_CONTEXT_STATE' });
              if (live && live.ok && live.state) {
                const entry = getOrCreateTab(tabId, host);
                entry.piiState = live.state;
                entry.domain = host;
              }
            } catch (e) { /* no content script on this page (e.g. chrome:// URL) — use cache */ }
          }
          const entry = tabId != null ? getOrCreateTab(tabId, host) : { domain: host, piiState: emptyPiiState() };
          const net = self.PrivAgentNetworkMonitor.getTabState(tabId) || { thirdPartyCount: 0, trackerDomains: new Set() };
          const settings = await self.PrivAgentStorage.getSettings();
          const privacyScore = computePrivacyScore({
            totalDetected: entry.piiState.totalDetected,
            totalProtected: entry.piiState.totalProtected,
            thirdPartyCount: net.thirdPartyCount,
            trackerCount: net.trackerDomains ? net.trackerDomains.size : 0,
            protectionMode: settings.protectionMode
          });
          sendResponse({
            ok: true, domain: entry.domain, piiState: entry.piiState,
            network: { thirdPartyCount: net.thirdPartyCount, trackerCount: net.trackerDomains ? net.trackerDomains.size : 0 },
            settings, privacyScore
          });
          return;
        }

        case 'VOICE_COMMAND': {
          const result = await handleVoiceCommand(message.transcript, message.tabId);
          sendResponse(result);
          return;
        }

        case 'LOG_EVENT': {
          // Generic pass-through for popup/dashboard-originated metadata events
          // (e.g. masking toggled) so all history writes stay centralized.
          const entry = await self.PrivAgentStorage.addHistoryEvent(message.event);
          sendResponse({ ok: true, entry });
          return;
        }

        default:
          sendResponse({ ok: false, message: 'Unknown message type' });
      }
    } catch (err) {
      console.error('PrivAgent background error:', err);
      sendResponse({ ok: false, message: 'Internal error' });
    }
  })();
  return true; // all branches respond asynchronously
});

chrome.runtime.onInstalled.addListener(() => {
  self.PrivAgentStorage.getSettings(); // ensures defaults are persisted on first install
});
