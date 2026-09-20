/**
 * PrivAgent :: Network Monitor
 * Runs inside the background service worker only (webRequest is not
 * available to content scripts). Observes, never blocks — this is a
 * non-blocking webRequest listener, so it can never break a legitimate
 * request, including authentication requests. It only counts third-party
 * destinations per tab and flags a small set of well-known tracker/
 * analytics domains for the dashboard/history.
 */

(function (root) {
  'use strict';

  // Small illustrative allowlist of common tracker/analytics domains.
  // Not exhaustive by design — false negatives here just mean "not
  // flagged as a known tracker," never a broken request.
  const KNOWN_TRACKER_DOMAINS = [
    'google-analytics.com', 'analytics.google.com', 'googletagmanager.com',
    'doubleclick.net', 'facebook.com', 'connect.facebook.net',
    'hotjar.com', 'mixpanel.com', 'segment.io', 'amplitude.com',
    'fullstory.com', 'crazyegg.com', 'quantserve.com', 'scorecardresearch.com'
  ];

  const tabState = new Map(); // tabId -> { mainDomain, thirdPartyCount, trackerDomains:Set, requestsProtected, requestsBlocked, requestsAllowed }

  function registerTab(tabId, mainDomain) {
    tabState.set(tabId, {
      mainDomain, thirdPartyCount: 0, trackerDomains: new Set(),
      requestsProtected: 0, requestsBlocked: 0, requestsAllowed: 0
    });
  }

  function resetTab(tabId, mainDomain) { registerTab(tabId, mainDomain); }
  function getTabState(tabId) { return tabState.get(tabId) || null; }
  function removeTab(tabId) { tabState.delete(tabId); }

  function isThirdParty(reqHost, mainDomain) {
    if (!mainDomain || !reqHost) return false;
    return !(reqHost === mainDomain || reqHost.endsWith('.' + mainDomain));
  }
  function isKnownTracker(host) {
    return KNOWN_TRACKER_DOMAINS.some((d) => host === d || host.endsWith('.' + d));
  }

  /**
   * onTrackerEvent(evt): { tabId, domain, destination } — fired once per
   * unique tracker domain per tab (not once per request) to avoid
   * spamming history with duplicates.
   */
  function attach(onTrackerEvent) {
    chrome.webRequest.onBeforeRequest.addListener(
      (details) => {
        if (details.tabId < 0) return;
        const state = tabState.get(details.tabId);
        if (!state) return;
        let host;
        try { host = new URL(details.url).hostname; } catch (e) { return; }
        if (!isThirdParty(host, state.mainDomain)) return;

        state.thirdPartyCount++;
        if (isKnownTracker(host) && !state.trackerDomains.has(host)) {
          state.trackerDomains.add(host);
          state.requestsProtected++;
          if (onTrackerEvent) {
            try { onTrackerEvent({ tabId: details.tabId, domain: state.mainDomain, destination: host }); }
            catch (e) { /* ignore */ }
          }
        } else {
          state.requestsAllowed++;
        }
      },
      { urls: ['<all_urls>'] }
    );
  }

  root.PrivAgentNetworkMonitor = { registerTab, resetTab, getTabState, removeTab, attach, isThirdParty, isKnownTracker };
})(self);
