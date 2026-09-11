/**
 * PrivAgent :: Storage
 * Thin promise-based wrapper around chrome.storage.local. Loaded verbatim
 * in every context (service worker via importScripts, popup, dashboard,
 * content script) — attaches to `self`, which resolves correctly in all
 * four.
 *
 * Two buckets:
 *   - "settings"  — single object, key `privagent_settings`
 *   - "history"   — array of event METADATA only (never raw PII values),
 *                    key `privagent_history`, capped at settings.historyMax
 *                    (oldest evicted first)
 */

(function (root) {
  'use strict';

  const SETTINGS_KEY = 'privagent_settings';
  const HISTORY_KEY = 'privagent_history';

  const DEFAULT_SETTINGS = {
    protectionEnabled: true,
    protectionMode: 'BALANCED',     // SAFE | BALANCED | OFF
    maskingEnabled: false,          // PII Masking toggle — default OFF
    piiDetectionEnabled: true,
    thirdPartyDetectionEnabled: true,
    networkMonitoringEnabled: true,
    voiceCommandsEnabled: true,
    demoMode: false,                // Live Mode by default
    historyMax: 500
  };

  function getAll(keys) {
    return new Promise((resolve) => {
      chrome.storage.local.get(keys, (result) => resolve(result || {}));
    });
  }
  function setAll(obj) {
    return new Promise((resolve) => { chrome.storage.local.set(obj, () => resolve()); });
  }

  async function getSettings() {
    const result = await getAll([SETTINGS_KEY]);
    return { ...DEFAULT_SETTINGS, ...(result[SETTINGS_KEY] || {}) };
  }

  async function setSettings(partial) {
    const current = await getSettings();
    const merged = { ...current, ...partial };
    await setAll({ [SETTINGS_KEY]: merged });
    return merged;
  }

  async function resetSettings() {
    await setAll({ [SETTINGS_KEY]: DEFAULT_SETTINGS });
    return { ...DEFAULT_SETTINGS };
  }

  async function getHistory() {
    const result = await getAll([HISTORY_KEY]);
    return Array.isArray(result[HISTORY_KEY]) ? result[HISTORY_KEY] : [];
  }

  /**
   * event: { domain, eventType, dataType, action, riskLevel }
   * Only ever metadata — id/timestamp assigned here. Callers must never
   * pass raw sensitive values.
   */
  async function addHistoryEvent(event) {
    const settings = await getSettings();
    const history = await getHistory();
    const entry = {
      id: `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      timestamp: Date.now(),
      domain: event.domain || 'unknown',
      eventType: event.eventType || 'info',
      dataType: event.dataType || null,
      action: event.action || 'observed',
      riskLevel: event.riskLevel || 'LOW'
    };
    history.push(entry);
    const max = settings.historyMax || DEFAULT_SETTINGS.historyMax;
    while (history.length > max) history.shift();
    await setAll({ [HISTORY_KEY]: history });
    return entry;
  }

  async function clearHistory() {
    await setAll({ [HISTORY_KEY]: [] });
  }

  async function clearAllData() {
    await setAll({ [SETTINGS_KEY]: DEFAULT_SETTINGS, [HISTORY_KEY]: [] });
  }

  root.PrivAgentStorage = {
    DEFAULT_SETTINGS, getSettings, setSettings, resetSettings,
    getHistory, addHistoryEvent, clearHistory, clearAllData
  };
})(typeof self !== 'undefined' ? self : window);
