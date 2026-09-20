/**
 * PrivAgent :: Popup
 * Renders live, current-tab-only status. The Privacy Protection toggle
 * controls settings.protectionEnabled (the master detect+protect switch);
 * finer-grained controls (mode, masking, detection categories) live in
 * the dashboard's Protection page.
 */

(function () {
  'use strict';

  let activeTab = null;
  let currentSettings = null;
  let voiceResetTimer = null;

  const el = (id) => document.getElementById(id);
  const setText = (id, text) => { el(id).textContent = text; };

  function hostFromUrl(url) {
    try { return new URL(url).hostname; } catch (e) { return null; }
  }

  function openDashboard(hash) {
    chrome.tabs.create({ url: chrome.runtime.getURL(`dashboard/dashboard.html#${hash}`) });
  }

  function renderSummary(summary) {
    setText('siteValue', summary.domain || 'Not available on this page');

    const pc = summary.piiState.protectedCounts || {};
    setText('piiEmail', String(pc.email || 0));
    setText('piiPassword', String(pc.password || 0));
    setText('piiPhone', String(pc.phone || 0));
    setText('piiName', String(pc.name || 0));
    setText('totalProtected', String(summary.piiState.totalProtected || 0));
    const anyPii = (summary.piiState.totalDetected || 0) > 0;
    el('piiEmptyState').hidden = anyPii;
    el('statGrid').hidden = !anyPii;

    setText('thirdPartyValue', `${summary.network.thirdPartyCount} detected`);
    setText('modeValue', summary.settings.protectionMode);

    currentSettings = summary.settings;
    const active = currentSettings.protectionEnabled && currentSettings.protectionMode !== 'OFF';
    setText('statusText', active ? 'ACTIVE' : 'OFF');
    el('statusPill').classList.toggle('off', !active);
    setText('heroTitle', active ? 'PROTECTION ACTIVE' : 'PROTECTION OFF');
    setText('heroSub', active
      ? 'Your session is being monitored and protected.'
      : 'PrivAgent is currently not protecting this session.');

    el('protectionToggle').setAttribute('aria-checked', String(!!currentSettings.protectionEnabled));
  }

  async function refreshSummary() {
    if (!activeTab) return;
    const host = hostFromUrl(activeTab.url);
    try {
      const summary = await chrome.runtime.sendMessage({ type: 'GET_SUMMARY', tabId: activeTab.id, host });
      if (summary && summary.ok) renderSummary(summary);
    } catch (e) {
      console.error('PrivAgent popup summary error:', e);
    }
  }

  async function init() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    activeTab = tab || null;
    await refreshSummary();
  }

  // ---------------- Privacy Protection toggle ----------------

  el('protectionToggle').addEventListener('click', async () => {
    if (!currentSettings) return;
    const next = !currentSettings.protectionEnabled;
    currentSettings = await self.PrivAgentStorage.setSettings({ protectionEnabled: next });
    el('protectionToggle').setAttribute('aria-checked', String(next));

    if (activeTab) {
      try { await chrome.tabs.sendMessage(activeTab.id, { type: 'SETTINGS_UPDATED', settings: currentSettings }); }
      catch (e) { /* no content script on this page */ }
    }
    chrome.tabs.query({}, (tabs) => {
      tabs.forEach((t) => {
        if (activeTab && t.id === activeTab.id) return;
        chrome.tabs.sendMessage(t.id, { type: 'SETTINGS_UPDATED', settings: currentSettings }).catch(() => {});
      });
    });

    chrome.runtime.sendMessage({
      type: 'LOG_EVENT',
      event: {
        domain: activeTab ? hostFromUrl(activeTab.url) : 'unknown',
        eventType: 'setting_changed', dataType: 'protection',
        action: next ? 'enabled' : 'disabled', riskLevel: 'LOW'
      }
    }).catch(() => {});

    await refreshSummary();
  });

  // ---------------- Navigation ----------------

  el('navDashboard').addEventListener('click', () => openDashboard('overview'));
  el('navActivity').addEventListener('click', () => openDashboard('activity'));
  el('navSettings').addEventListener('click', () => openDashboard('settings'));
  el('settingsBtn').addEventListener('click', () => openDashboard('settings'));

  // ---------------- Voice Agent ----------------

  function scheduleReturnToIdle(delay) {
    clearTimeout(voiceResetTimer);
    voiceResetTimer = setTimeout(() => self.PrivAgentVoiceUI.render('idle'), delay);
  }

  const engine = self.PrivAgentVoiceEngine.createVoiceEngine({
    onStateChange(state, detail) {
      clearTimeout(voiceResetTimer);
      self.PrivAgentVoiceUI.render(state, detail);
      if (state === 'error' || state === 'permission' || state === 'unsupported') scheduleReturnToIdle(3200);
    },
    async onCommand(parsed, transcript) {
      try {
        const result = await chrome.runtime.sendMessage({
          type: 'VOICE_COMMAND', transcript, tabId: activeTab ? activeTab.id : null
        });
        if (result && result.ok) {
          self.PrivAgentVoiceUI.render('success', result.message);
          await refreshSummary();
        } else {
          self.PrivAgentVoiceUI.render('error', (result && result.message) || 'Command not understood.');
        }
      } catch (e) {
        self.PrivAgentVoiceUI.render('error', 'Could not reach PrivAgent.');
      }
      scheduleReturnToIdle(2200);
    }
  });

  self.PrivAgentVoiceUI.render('idle');
  if (!engine.supported) el('micButton').disabled = true;

  el('micButton').addEventListener('click', () => {
    const state = el('voiceCard').getAttribute('data-state');
    if (state === 'listening') { engine.stop(); return; }
    engine.start();
  });

  init();
})();
