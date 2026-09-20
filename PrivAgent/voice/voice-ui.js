/**
 * PrivAgent :: Voice UI
 * Small DOM rendering helper for the popup's voice agent card. Tightly
 * coupled to popup.html's element IDs by design (it's a popup-only view
 * helper, not a shared module).
 */

(function (root) {
  'use strict';

  const STATE_COPY = {
    idle: { title: 'Tap to speak', detail: 'Try: "Open YouTube"' },
    listening: { title: "I'm listening", detail: '' },
    processing: { title: 'Understanding command', detail: '' },
    success: { title: 'Command executed', detail: '' },
    error: { title: 'Command not understood', detail: 'Try saying: "Open YouTube"' },
    unsupported: { title: 'Not available', detail: 'Voice commands are not supported in this browser.' },
    permission: { title: 'Microphone access required', detail: 'Allow microphone access to use voice commands.' }
  };

  function el(id) { return document.getElementById(id); }

  function render(state, detail) {
    const copy = STATE_COPY[state] || STATE_COPY.idle;
    el('voiceTitle').textContent = copy.title;
    el('voiceDetail').textContent = detail !== undefined && detail !== '' ? detail : copy.detail;
    el('voiceCard').setAttribute('data-state', state);
    el('micButton').setAttribute('aria-pressed', String(state === 'listening'));
    el('waveform').classList.toggle('active', state === 'listening');
  }

  root.PrivAgentVoiceUI = { render };
})(window);
