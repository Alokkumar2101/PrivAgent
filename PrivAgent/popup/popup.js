/**
 * PrivAgent :: Popup
 * - Renders live, current-tab-only status (never stale data from another site).
 * - PII Masking toggle: persists via chrome.storage.local, broadcasts to tabs.
 * - Voice Command: mic activates ONLY on explicit click, never listens in the
 *   background. Transcript is sent to the background service worker, which
 *   is the only place a command is parsed/executed (strict allowlist).
 */

(function () {
  'use strict';

  let activeTab = null;
  let currentSettings = null;

  const el = (id) => document.getElementById(id);

  function setText(id, text) { el(id).textContent = text; }

  function renderSummary(summary) {
    setText('siteValue', summary.domain || 'Not available on this page');
    setText('scoreValue', String(summary.privacyScore));
    el('scoreFill').style.width = `${summary.privacyScore}%`;
    el('scoreBar').setAttribute('aria-valuenow', String(summary.privacyScore));

    const pc = summary.piiState.protectedCounts || {};
    setText('piiEmail', String(pc.email || 0));
    setText('piiPassword', String(pc.password || 0));
    setText('piiPhone', String(pc.phone || 0));
    setText('piiName', String(pc.name || 0));
    const anyPii = (summary.piiState.totalDetected || 0) > 0;
    el('piiEmptyState').hidden = anyPii;
    el('piiList').hidden = !anyPii;

    setText('thirdPartyValue', `${summary.network.thirdPartyCount} detected`);
    setText('modeValue', summary.settings.protectionMode);

    const active = summary.settings.protectionEnabled && summary.settings.protectionMode !== 'OFF';
    setText('statusText', active ? 'Protection Active' : 'Protection Off');
    el('statusDot').classList.toggle('off', !active);

    currentSettings = summary.settings;
    const toggle = el('maskingToggle');
    toggle.setAttribute('aria-checked', String(!!currentSettings.maskingEnabled));
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

  function hostFromUrl(url) {
    try { return new URL(url).hostname; } catch (e) { return null; }
  }

  async function init() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    activeTab = tab || null;
    await refreshSummary();
  }

  // ---------------- PII Masking toggle ----------------

  el('maskingToggle').addEventListener('click', async () => {
    if (!currentSettings) return;
    const next = !currentSettings.maskingEnabled;
    currentSettings = await self.PrivAgentStorage.setSettings({ maskingEnabled: next });
    el('maskingToggle').setAttribute('aria-checked', String(next));

    // Push to the active tab first (so the popup's own numbers refresh fast)...
    if (activeTab) {
      try { await chrome.tabs.sendMessage(activeTab.id, { type: 'SETTINGS_UPDATED', settings: currentSettings }); }
      catch (e) { /* no content script on this page */ }
    }
    // ...then fan out to every other tab, best-effort.
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
        eventType: 'setting_changed', dataType: 'masking',
        action: next ? 'enabled' : 'disabled', riskLevel: 'LOW'
      }
    }).catch(() => {});

    await refreshSummary();
  });

  // ---------------- Open Dashboard ----------------

  el('openDashboard').addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('dashboard/dashboard.html') });
  });

  // ---------------- Voice Command ----------------

  const SpeechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition;
  let recognition = null;
  let listening = false;

  function setVoiceState(state, detail) {
    setText('voiceState', state);
    setText('voiceDetail', detail || '');
  }

  function setListeningUI(on) {
    listening = on;
    el('micButton').classList.toggle('listening', on);
    el('micButton').setAttribute('aria-pressed', String(on));
    el('micButton').setAttribute('aria-label', on ? 'Stop voice command' : 'Start voice command');
  }

  if (!SpeechRecognitionCtor) {
    setVoiceState('Unavailable', 'Voice commands are not supported in this browser.');
    el('micButton').disabled = true;
  } else {
    recognition = new SpeechRecognitionCtor();
    recognition.continuous = false;   // never continuously listens
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.lang = 'en-US';

    recognition.addEventListener('start', () => {
      setListeningUI(true);
      setVoiceState('Listening...', '');
    });

    recognition.addEventListener('result', async (event) => {
      const transcript = event.results[0][0].transcript;
      setVoiceState('Processing...', `Heard: "${transcript}"`);
      try {
        const tabId = activeTab ? activeTab.id : null;
        const result = await chrome.runtime.sendMessage({ type: 'VOICE_COMMAND', transcript, tabId });
        if (result && result.ok) {
          setVoiceState('✓ Done', result.message);
        } else {
          setVoiceState('Command not recognized', (result && result.message) || 'Command not supported.');
        }
        await refreshSummary();
      } catch (e) {
        setVoiceState('Error', 'Could not execute that command.');
      }
    });

    recognition.addEventListener('error', (event) => {
      if (event.error === 'not-allowed' || event.error === 'permission-denied') {
        setVoiceState('Microphone permission denied', 'Allow microphone access to use voice commands.');
      } else if (event.error === 'no-speech') {
        setVoiceState('No speech detected', 'Tap the mic and try again.');
      } else {
        setVoiceState('Recognition error', event.error);
      }
    });

    recognition.addEventListener('end', () => {
      setListeningUI(false);
    });

    el('micButton').addEventListener('click', () => {
      if (listening) { recognition.stop(); return; }
      setVoiceState('Ready', '');
      try { recognition.start(); }
      catch (e) { setVoiceState('Error', 'Could not start voice recognition.'); }
    });
  }

  init();
})();
