/**
 * PrivAgent :: Network Monitor
 * Observational third-party request tracking per tab (background service
 * worker context). Actual BLOCKING of known trackers is handled separately
 * and declaratively by rules.json (declarativeNetRequest) — this module
 * only classifies and records requests for the dashboard/popup UI. It never
 * inspects request bodies or attempts to break authentication requests.
 */

(function (root) {
  'use strict';

  // Mirrors rules.json — used only for UI labeling (Blocked vs Allowed).
  const TRACKER_DOMAINS = [
    'doubleclick.net', 'googlesyndication.com', 'google-analytics.com',
    'googletagmanager.com', 'adnxs.com', 'scorecardresearch.com',
    'criteo.com', 'outbrain.com', 'taboola.com', 'facebook.com'
  ];

  const tabState = new Map(); // tabId -> { firstPartyDomain, total, thirdParty, blocked, allowed, recent: [] }

  function rootDomain(hostname) {
    const parts = (hostname || '').split('.').filter(Boolean);
    if (parts.length <= 2) return parts.join('.');
    return parts.slice(-2).join('.');
  }

  function isTracker(hostname) {
    return TRACKER_DOMAINS.some((d) => hostname === d || hostname.endsWith('.' + d));
  }

  function ensureTab(tabId) {
    if (!tabState.has(tabId)) {
      tabState.set(tabId, { firstPartyDomain: null, total: 0, thirdParty: 0, blocked: 0, allowed: 0, recent: [] });
    }
    return tabState.get(tabId);
  }

  function resetTab(tabId, firstPartyDomain) {
    tabState.set(tabId, { firstPartyDomain: firstPartyDomain || null, total: 0, thirdParty: 0, blocked: 0, allowed: 0, recent: [] });
  }

  function removeTab(tabId) {
    tabState.delete(tabId);
  }

  function getSummary(tabId) {
    const s = tabState.get(tabId);
    if (!s) return { thirdParty: 0, blocked: 0, allowed: 0, recent: [] };
    return { thirdParty: s.thirdParty, blocked: s.blocked, allowed: s.allowed, recent: s.recent.slice(0, 10) };
  }

  function init() {
    // Track the first-party domain per tab from main-frame navigations.
    chrome.webNavigation.onCommitted.addListener((details) => {
      if (details.frameId !== 0) return; // main frame only
      try {
        const url = new URL(details.url);
        resetTab(details.tabId, url.hostname);
      } catch (e) { /* ignore invalid URLs (chrome://, etc.) */ }
    });

    chrome.tabs.onRemoved.addListener((tabId) => removeTab(tabId));

    // Observational only — no blocking option used here (blocking is done
    // declaratively via rules.json so we never risk breaking auth flows by
    // synchronously intercepting requests).
    chrome.webRequest.onBeforeRequest.addListener(
      (details) => {
        if (details.tabId < 0) return;
        let hostname;
        try { hostname = new URL(details.url).hostname; } catch (e) { return; }

        const state = ensureTab(details.tabId);
        state.total++;

        const firstParty = state.firstPartyDomain;
        const sameSite = firstParty && rootDomain(hostname) === rootDomain(firstParty);
        if (sameSite) return; // first-party request, not tracked as third-party

        state.thirdParty++;
        const tracker = isTracker(hostname);
        if (tracker) {
          state.blocked++;
        } else {
          state.allowed++;
        }
        state.recent.unshift({
          domain: hostname,
          action: tracker ? 'Blocked' : 'Allowed',
          resourceType: details.type,
          timestamp: new Date().toISOString()
        });
        state.recent = state.recent.slice(0, 20);
      },
      { urls: ['<all_urls>'] }
    );
  }

  root.PrivAgentNetworkMonitor = { init, getSummary, resetTab, removeTab, isTracker };
})(typeof self !== 'undefined' ? self : window);
