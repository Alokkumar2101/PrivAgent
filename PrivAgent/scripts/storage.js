/**
 * PrivAgent :: Storage Module
 * Wraps chrome.storage.local for settings + a capped (500-event) history
 * log. Attached to `self` so the SAME file works unmodified in the
 * background service worker (via importScripts) and in regular extension
 * pages like popup.html / dashboard.html (where `self === window`).
 *
 * History NEVER contains raw sensitive values — only safe metadata.
 */

(function (root) {
  'use strict';

  const SETTINGS_KEY = 'privagent_settings';
  const HISTORY_KEY = 'privagent_history';
  const MAX_HISTORY = 500;

  const DEFAULT_SETTINGS = {
    protectionEnabled: true,
    protectionMode: 'BALANCED', // SAFE | BALANCED | OFF
    maskingEnabled: false,
    demoMode: false,
    thirdPartyMonitoring: true,
    detectionCategories: {
      email: true, phone: true, name: true, password: true, otp: true,
      cvv: true, address: true, aadhaar: true, pan: true, card: true,
      bank: true, auth_token: true, medical: true
    }
  };

  function deepMerge(base, override) {
    const out = { ...base };
    for (const key of Object.keys(override || {})) {
      if (override[key] && typeof override[key] === 'object' && !Array.isArray(override[key]) &&
          base[key] && typeof base[key] === 'object') {
        out[key] = deepMerge(base[key], override[key]);
      } else {
        out[key] = override[key];
      }
    }
    return out;
  }

  function getSettings() {
    return new Promise((resolve) => {
      chrome.storage.local.get(SETTINGS_KEY, (data) => {
        const stored = (data && data[SETTINGS_KEY]) || {};
        resolve(deepMerge(DEFAULT_SETTINGS, stored));
      });
    });
  }

  function setSettings(partial) {
    return getSettings().then((current) => {
      const merged = deepMerge(current, partial);
      return new Promise((resolve) => {
        chrome.storage.local.set({ [SETTINGS_KEY]: merged }, () => resolve(merged));
      });
    });
  }

  function resetSettings() {
    return new Promise((resolve) => {
      chrome.storage.local.set({ [SETTINGS_KEY]: DEFAULT_SETTINGS }, () => resolve(DEFAULT_SETTINGS));
    });
  }

  function getHistory() {
    return new Promise((resolve) => {
      chrome.storage.local.get(HISTORY_KEY, (data) => {
        resolve((data && data[HISTORY_KEY]) || []);
      });
    });
  }

  function genId() {
    if (root.crypto && root.crypto.randomUUID) return root.crypto.randomUUID();
    return `evt_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  }

  /**
   * event: { domain, eventType, dataType, action, riskLevel }
   * NEVER pass raw sensitive values in `event`.
   */
  function addHistoryEvent(event) {
    return getHistory().then((history) => {
      const entry = {
        id: genId(),
        timestamp: new Date().toISOString(),
        domain: event.domain || 'unknown',
        eventType: event.eventType || 'Activity',
        dataType: event.dataType || null,
        action: event.action || 'Logged',
        riskLevel: event.riskLevel || 'LOW'
      };
      const updated = [entry, ...history].slice(0, MAX_HISTORY);
      return new Promise((resolve) => {
        chrome.storage.local.set({ [HISTORY_KEY]: updated }, () => resolve(entry));
      });
    });
  }

  function clearHistory() {
    return new Promise((resolve) => {
      chrome.storage.local.set({ [HISTORY_KEY]: [] }, () => resolve(true));
    });
  }

  function clearAllData() {
    return new Promise((resolve) => {
      chrome.storage.local.set({ [SETTINGS_KEY]: DEFAULT_SETTINGS, [HISTORY_KEY]: [] }, () => resolve(true));
    });
  }

  root.PrivAgentStorage = {
    DEFAULT_SETTINGS,
    MAX_HISTORY,
    getSettings,
    setSettings,
    resetSettings,
    getHistory,
    addHistoryEvent,
    clearHistory,
    clearAllData
  };
})(typeof self !== 'undefined' ? self : window);
