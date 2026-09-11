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

importScripts('../scripts/storage.js', '../scripts/network-monitor.js');

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

// ---------------- Voice command allowlist ----------------

const SITE_MAP = {
  youtube: 'https://www.youtube.com', google: 'https://www.google.com',
  gmail: 'https://mail.google.com', github: 'https://www.github.com',
  wikipedia: 'https://www.wikipedia.org', amazon: 'https://www.amazon.com'
};

function parseVoiceCommand(rawTranscript) {
  const t = (rawTranscript || '').trim().toLowerCase().replace(/[.?!]+$/, '');

  let m;
  if ((m = t.match(/^search\s+youtube\s+for\s+(.+)$/))) {
    return { commandType: 'search_youtube', action: 'OPEN_URL', url: `https://www.youtube.com/results?search_query=${encodeURIComponent(m[1])}` };
  }
  if ((m = t.match(/^search\s+google\s+for\s+(.+)$/))) {
    return { commandType: 'search_google', action: 'OPEN_URL', url: `https://www.google.com/search?q=${encodeURIComponent(m[1])}` };
  }
  if ((m = t.match(/^(?:open|go to)\s+([a-z]+)$/)) && SITE_MAP[m[1]]) {
    return { commandType: 'open_site', action: 'OPEN_URL', url: SITE_MAP[m[1]] };
  }
  if ((m = t.match(/^(?:open|go to)\s+([a-z0-9-]+\.[a-z]{2,}(?:\.[a-z]{2,})?)$/))) {
    return { commandType: 'open_site', action: 'OPEN_URL', url: `https://${m[1]}` };
  }
  if (/^open\s+(a\s+)?new\s+tab$/.test(t)) return { commandType: 'new_tab', action: 'NEW_TAB' };
  if (/^close\s+(this\s+)?tab$/.test(t)) return { commandType: 'close_tab', action: 'CLOSE_TAB' };
  if (/^go\s+back$/.test(t)) return { commandType: 'tab_back', action: 'TAB_BACK' };
  if (/^go\s+forward$/.test(t)) return { commandType: 'tab_forward', action: 'TAB_FORWARD' };
  if (/^reload(\s+this\s+page)?$/.test(t)) return { commandType: 'reload_tab', action: 'RELOAD_TAB' };

  return { commandType: 'not_supported', action: 'NOT_SUPPORTED' };
}

async function executeVoiceCommand(rawTranscript, tabId) {
  const parsed = parseVoiceCommand(rawTranscript);
  let ok = true, message = '';

  try {
    switch (parsed.action) {
      case 'OPEN_URL':
        await chrome.tabs.create({ url: parsed.url });
        message = `Opening ${parsed.url.replace(/^https?:\/\//, '')}`;
        break;
      case 'NEW_TAB':
        await chrome.tabs.create({});
        message = 'New tab opened';
        break;
      case 'CLOSE_TAB':
        if (tabId) await chrome.tabs.remove(tabId);
        message = 'Tab closed';
        break;
      case 'TAB_BACK':
        if (tabId) await chrome.tabs.goBack(tabId);
        message = 'Navigated back';
        break;
      case 'TAB_FORWARD':
        if (tabId) await chrome.tabs.goForward(tabId);
        message = 'Navigated forward';
        break;
      case 'RELOAD_TAB':
        if (tabId) await chrome.tabs.reload(tabId);
        message = 'Page reloaded';
        break;
      default:
        ok = false;
        message = 'Command not supported.';
    }
  } catch (e) {
    ok = false;
    message = 'Could not execute that command.';
  }

  const entry = tabId ? tabEntries.get(tabId) : null;
  await self.PrivAgentStorage.addHistoryEvent({
    domain: (entry && entry.domain) || 'browser',
    eventType: 'voice_command',
    dataType: parsed.commandType,   // safe enum only — raw transcript is never stored
    action: ok ? 'executed' : 'not_supported',
    riskLevel: 'LOW'
  });

  return { ok, commandType: parsed.commandType, message };
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
          const result = await executeVoiceCommand(message.transcript, message.tabId);
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
