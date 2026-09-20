/**
 * PrivAgent :: Content Script Controller
 * Runs on every page. Orchestrates PrivAgentDetector + PrivAgentEngine,
 * reports metadata-only state to the background service worker, and
 * responds to popup/dashboard queries relayed through it.
 *
 * This script is passive toward the live page: it only READS the DOM to
 * classify fields, and the only thing it ever WRITES is a floating badge
 * appended to document.body (never touching, wrapping, or restyling the
 * real input) — see privacy-engine.js. It never disables, intercepts, or
 * modifies any input, and never blocks a keystroke or form submission.
 */

(function () {
  'use strict';

  let currentSettings = null;
  let lastState = null;
  let debounceTimer = null;
  let observer = null;

  function safeSendResponse(sendResponse, payload) {
    try { sendResponse(payload); } catch (e) { /* channel closed */ }
  }

  function errorPayload(err) {
    console.error('PrivAgent content script error:', err);
    return { ok: false, message: 'PrivAgent could not complete this action on this page.' };
  }

  async function rescan(reason) {
    try {
      if (!currentSettings) currentSettings = await self.PrivAgentStorage.getSettings();
      if (!currentSettings.piiDetectionEnabled || currentSettings.protectionMode === 'OFF') {
        self.PrivAgentEngine.clearBadges();
        lastState = { counts: {}, protectedCounts: {}, items: [], totalDetected: 0, totalProtected: 0 };
      } else {
        lastState = self.PrivAgentEngine.computeState(currentSettings.maskingEnabled);
        self.PrivAgentEngine.applyMasking(lastState, currentSettings.maskingEnabled);
      }
      chrome.runtime.sendMessage({
        type: 'PII_STATE_UPDATE',
        host: window.location.hostname,
        path: window.location.pathname,
        reason,
        state: self.PrivAgentEngine.toMessageSafe(lastState)
      }).catch(() => { /* background worker may be waking up — safe to ignore */ });
    } catch (e) {
      console.error('PrivAgent rescan error:', e);
    }
  }

  function scheduleRescan(reason) {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => rescan(reason), 400);
  }

  function setupObservers() {
    // Debounced MutationObserver — targeted, not a continuous full-DOM poll.
    observer = new MutationObserver(() => scheduleRescan('dom_mutation'));
    observer.observe(document.documentElement, { childList: true, subtree: true, attributes: false });

    // Field value changes (typing, autofill, programmatic React/Vue updates).
    document.addEventListener('input', () => scheduleRescan('input'), true);
    document.addEventListener('change', () => scheduleRescan('change'), true);

    // SPA route changes (pushState/replaceState/popstate) — re-baseline.
    let lastPath = window.location.pathname;
    const checkPath = () => {
      if (window.location.pathname !== lastPath) {
        lastPath = window.location.pathname;
        scheduleRescan('spa_navigation');
      }
    };
    window.addEventListener('popstate', checkPath);
    const origPushState = history.pushState;
    history.pushState = function (...args) { origPushState.apply(this, args); checkPath(); };
    const origReplaceState = history.replaceState;
    history.replaceState = function (...args) { origReplaceState.apply(this, args); checkPath(); };
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    try {
      switch (message.type) {
        case 'PING':
          safeSendResponse(sendResponse, { ok: true });
          return false;

        case 'GET_CONTEXT_STATE':
          safeSendResponse(sendResponse, {
            ok: true,
            host: window.location.hostname,
            state: lastState ? self.PrivAgentEngine.toMessageSafe(lastState) : null
          });
          return false;

        case 'SETTINGS_UPDATED':
          currentSettings = message.settings;
          rescan('settings_updated').then(() => safeSendResponse(sendResponse, { ok: true }));
          return true; // async

        case 'FORCE_RESCAN':
          rescan('manual').then(() => safeSendResponse(sendResponse, { ok: true }));
          return true; // async

        default:
          return false;
      }
    } catch (err) {
      safeSendResponse(sendResponse, errorPayload(err));
      return false;
    }
  });

  (async function init() {
    try {
      currentSettings = await self.PrivAgentStorage.getSettings();
      setupObservers();
      await rescan('initial_load');
    } catch (e) {
      console.error('PrivAgent init error (likely a restricted page):', e);
    }
  })();
})();
