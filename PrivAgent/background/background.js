/**
 * PrivAgent :: Background Service Worker (MV3)
 * Owns per-tab live PII/network state (in-memory, resets on navigation),
 * routes messages between popup/dashboard/content scripts, and writes
 * safe metadata-only events to persistent history via storage.js.
 */

importScripts('../scripts/storage.js', '../scripts/privacy-engine.js', '../scripts/network-monitor.js');

const tabCache = new Map(); // tabId -> { domain, path, detected, protectedCounts, lastScan }
let lastActiveTabId = null;

function emptyTabState(domain) {
  return { domain: domain || null, path: null, detected: {}, protectedCounts: {}, lastScan: null };
}

function resetTab(tabId, domain) {
  tabCache.set(tabId, emptyTabState(domain));
  self.PrivAgentNetworkMonitor.resetTab(tabId, domain);
}

chrome.runtime.onInstalled.addListener(() => {
  self.PrivAgentStorage.getSettings(); // ensures defaults are written on first read
});

self.PrivAgentNetworkMonitor.init();

// Reset state whenever a tab starts loading a new top-level document, so the
// popup never shows PII counts left over from a previous website.
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'loading' && tab.url) {
    try {
      const domain = new URL(tab.url).hostname;
      resetTab(tabId, domain);
    } catch (e) { /* chrome://, about:blank, etc. */ }
  }
});

chrome.tabs.onActivated.addListener(({ tabId }) => {
  chrome.tabs.get(tabId, (tab) => {
    if (chrome.runtime.lastError || !tab || !tab.url) return;
    if (tab.url.startsWith('chrome-extension://') || tab.url.startsWith('chrome://')) return;
    lastActiveTabId = tabId;
  });
});

chrome.tabs.onRemoved.addListener((tabId) => {
  tabCache.delete(tabId);
  self.PrivAgentNetworkMonitor.removeTab(tabId);
});

function riskLevelForType(type) {
  return self.PrivAgentPrivacyEngine.riskLevelForType(type);
}

function getActiveTab() {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => resolve(tabs && tabs[0]));
  });
}

function buildPopupState(tabId, domain) {
  const cache = tabCache.get(tabId) || emptyTabState(domain);
  const network = self.PrivAgentNetworkMonitor.getSummary(tabId);
  return self.PrivAgentStorage.getSettings().then((settings) => {
    const detectedTotal = Object.values(cache.detected).reduce((a, b) => a + b, 0);
    const protectedTotal = Object.values(cache.protectedCounts).reduce((a, b) => a + b, 0);
    const score = self.PrivAgentPrivacyEngine.computePrivacyScore({
      detectedCount: detectedTotal,
      protectedCount: protectedTotal,
      thirdPartyCount: network.thirdParty,
      blockedCount: network.blocked,
      protectionMode: settings.protectionMode
    });
    return {
      domain: cache.domain || domain || 'unknown',
      detected: cache.detected,
      protectedCounts: cache.protectedCounts,
      thirdParty: network,
      privacyScore: (detectedTotal === 0 && protectedTotal === 0 && network.thirdParty === 0) ? null : score,
      settings,
      lastScan: cache.lastScan
    };
  });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    try {
      switch (message.type) {
        case 'PII_SCAN_UPDATE': {
          const tabId = sender.tab && sender.tab.id;
          if (tabId == null) { sendResponse({ ok: false }); return; }
          const existing = tabCache.get(tabId) || emptyTabState(message.domain);
          existing.domain = message.domain;
          existing.path = message.path;
          existing.detected = message.detected || {};
          existing.protectedCounts = message.protectedCounts || {};
          existing.lastScan = message.timestamp;
          tabCache.set(tabId, existing);

          if (Array.isArray(message.newDetections) && message.newDetections.length) {
            for (const d of message.newDetections) {
              await self.PrivAgentStorage.addHistoryEvent({
                domain: message.domain,
                eventType: 'Sensitive Data Detected',
                dataType: d.type,
                action: d.protected ? 'Protected' : 'Detected',
                riskLevel: riskLevelForType(d.type)
              });
            }
          }
          sendResponse({ ok: true });
          break;
        }

        case 'PAGE_CHANGED': {
          const tabId = sender.tab && sender.tab.id;
          if (tabId != null) resetTab(tabId, message.domain);
          sendResponse({ ok: true });
          break;
        }

        case 'GET_POPUP_STATE': {
          const tab = await getActiveTab();
          if (!tab) { sendResponse({ ok: false, message: 'No active tab' }); return; }
          const state = await buildPopupState(tab.id, safeHostname(tab.url));
          sendResponse({ ok: true, state });
          break;
        }

        case 'GET_LAST_TAB_STATE': {
          if (lastActiveTabId == null || !tabCache.has(lastActiveTabId)) {
            const settings = await self.PrivAgentStorage.getSettings();
            sendResponse({ ok: true, state: { domain: null, detected: {}, protectedCounts: {}, thirdParty: { thirdParty: 0, blocked: 0, allowed: 0 }, privacyScore: null, settings, lastScan: null } });
            return;
          }
          const cache = tabCache.get(lastActiveTabId);
          const state = await buildPopupState(lastActiveTabId, cache.domain);
          sendResponse({ ok: true, state });
          break;
        }

        case 'GET_SETTINGS': {
          const settings = await self.PrivAgentStorage.getSettings();
          sendResponse({ ok: true, settings });
          break;
        }

        case 'SET_SETTINGS': {
          const settings = await self.PrivAgentStorage.setSettings(message.partial || {});
          if (Object.prototype.hasOwnProperty.call(message.partial || {}, 'maskingEnabled')) {
            const tab = await getActiveTab();
            await self.PrivAgentStorage.addHistoryEvent({
              domain: tab && tab.url ? safeHostname(tab.url) : 'global',
              eventType: 'Setting Changed',
              dataType: null,
              action: message.partial.maskingEnabled ? 'PII masking enabled' : 'PII masking disabled',
              riskLevel: 'LOW'
            });
          }
          sendResponse({ ok: true, settings });
          break;
        }

        case 'RESET_SETTINGS': {
          const settings = await self.PrivAgentStorage.resetSettings();
          sendResponse({ ok: true, settings });
          break;
        }

        case 'GET_HISTORY': {
          const history = await self.PrivAgentStorage.getHistory();
          sendResponse({ ok: true, history });
          break;
        }

        case 'CLEAR_HISTORY': {
          await self.PrivAgentStorage.clearHistory();
          sendResponse({ ok: true });
          break;
        }

        case 'CLEAR_ALL_DATA': {
          await self.PrivAgentStorage.clearAllData();
          tabCache.clear();
          sendResponse({ ok: true });
          break;
        }

        default:
          sendResponse({ ok: false, message: 'Unknown message type' });
      }
    } catch (err) {
      console.error('[PrivAgent background] error handling message', message && message.type, err);
      sendResponse({ ok: false, message: 'Internal error' });
    }
  })();
  return true; // keep the message channel open for the async response
});

function safeHostname(url) {
  try { return new URL(url).hostname; } catch (e) { return 'unknown'; }
}
