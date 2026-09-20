/**
 * PrivAgent :: Voice Engine
 * Wraps the browser's native SpeechRecognition. Never listens until the
 * user explicitly taps the mic, and never runs continuously — each tap is
 * exactly one recognition pass.
 *
 * Speed: interimResults is on, and every interim transcript is checked
 * against command-parser.js. As soon as a transcript crosses the
 * confidence threshold, recognition is stopped and the command fires —
 * PrivAgent does not wait for silence/isFinal once it's already sure.
 *
 * Safety: a local (transcript, timestamp) lock discards a repeat of the
 * same normalized command within 1.5s, so interim/final double-fires or a
 * recognition restart can never execute the same command twice. The
 * background service worker applies its own independent lock as well.
 */

(function (root) {
  'use strict';

  const DUPLICATE_WINDOW_MS = 1500;
  const SpeechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition;

  function friendlyError(code) {
    switch (code) {
      case 'no-speech': return 'No speech detected. Try again.';
      case 'audio-capture': return 'No microphone was found.';
      case 'not-allowed':
      case 'service-not-allowed':
        return 'Microphone access is unavailable. Check your browser microphone permission.';
      case 'network': return 'Network error during speech recognition.';
      default: return 'Something went wrong with voice recognition.';
    }
  }

  /**
   * handlers: {
   *   onStateChange(state, detail) — state in idle|listening|processing|success|error|unsupported|permission
   *   onCommand(parsed, transcript) — fired once, only for a confident, non-duplicate command
   * }
   */
  function createVoiceEngine(handlers) {
    if (!SpeechRecognitionCtor) {
      handlers.onStateChange('unsupported');
      return { supported: false, start() {}, stop() {} };
    }

    const recognition = new SpeechRecognitionCtor();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    recognition.lang = navigator.language || 'en-US';

    let settled = false;
    let lastNorm = null;
    let lastAt = 0;

    function settle(parsed, transcript) {
      if (settled) return;
      settled = true;
      try { recognition.stop(); } catch (e) { /* already stopped */ }

      const now = Date.now();
      const isDuplicate = parsed.norm && parsed.norm === lastNorm && (now - lastAt) < DUPLICATE_WINDOW_MS;
      if (isDuplicate) { handlers.onStateChange('idle'); return; }
      lastNorm = parsed.norm;
      lastAt = now;

      handlers.onStateChange('processing');
      handlers.onCommand(parsed, transcript);
    }

    recognition.addEventListener('start', () => { settled = false; handlers.onStateChange('listening'); });

    recognition.addEventListener('result', (event) => {
      const res = event.results[event.results.length - 1];
      const transcript = res[0].transcript;
      const isFinal = res.isFinal;
      handlers.onStateChange('listening', transcript);

      const parsed = root.PrivAgentCommandParser.parseCommand(transcript);
      if (root.PrivAgentCommandParser.isConfident(parsed) || isFinal) {
        settle(parsed, transcript);
      }
    });

    recognition.addEventListener('error', (event) => {
      settled = true;
      if (event.error === 'aborted') { handlers.onStateChange('idle'); return; }
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        handlers.onStateChange('permission');
        return;
      }
      handlers.onStateChange('error', friendlyError(event.error));
    });

    recognition.addEventListener('end', () => {
      if (!settled) handlers.onStateChange('idle');
    });

    return {
      supported: true,
      start() {
        settled = false;
        try { recognition.start(); }
        catch (e) { handlers.onStateChange('error', 'Could not start voice recognition.'); }
      },
      stop() { try { recognition.stop(); } catch (e) { /* ignore */ } }
    };
  }

  root.PrivAgentVoiceEngine = { createVoiceEngine };
})(window);
