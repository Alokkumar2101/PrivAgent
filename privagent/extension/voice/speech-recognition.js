/**
 * PrivAgent :: Speech Recognition Wrapper
 * Thin wrapper around the browser's native Web Speech API.
 * Runs inside the extension popup. Audio never leaves the device —
 * recognition happens using the browser's built-in engine and only the
 * resulting TEXT transcript is handled by PrivAgent (never raw audio to
 * our own server).
 */

(function (global) {
  'use strict';

  function isSupported() {
    return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
  }

  class VoiceListener {
    constructor({ onResult, onError, onStart, onEnd, lang = 'en-US' } = {}) {
      this.onResult = onResult || (() => {});
      this.onError = onError || (() => {});
      this.onStart = onStart || (() => {});
      this.onEnd = onEnd || (() => {});
      this.recognition = null;
      this.lang = lang;
      this.listening = false;
    }

    start() {
      if (!isSupported()) {
        this.onError({ code: 'UNSUPPORTED', message: 'Speech recognition is not supported in this browser.' });
        return;
      }
      const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
      this.recognition = new SR();
      this.recognition.lang = this.lang;
      this.recognition.continuous = false;
      this.recognition.interimResults = false;
      this.recognition.maxAlternatives = 1;

      this.recognition.onstart = () => {
        this.listening = true;
        this.onStart();
      };

      this.recognition.onresult = (event) => {
        const transcript = event.results[0][0].transcript;
        const confidence = event.results[0][0].confidence;
        this.onResult({ transcript, confidence });
      };

      this.recognition.onerror = (event) => {
        let message = 'Speech recognition error.';
        if (event.error === 'not-allowed' || event.error === 'permission-denied') {
          message = 'Microphone permission denied. Please allow microphone access for PrivAgent.';
        } else if (event.error === 'no-speech') {
          message = 'No speech detected. Please try again.';
        } else if (event.error === 'network') {
          message = 'Speech recognition network error.';
        }
        this.onError({ code: event.error, message });
      };

      this.recognition.onend = () => {
        this.listening = false;
        this.onEnd();
      };

      try {
        this.recognition.start();
      } catch (e) {
        this.onError({ code: 'START_FAILED', message: e.message });
      }
    }

    stop() {
      if (this.recognition && this.listening) {
        this.recognition.stop();
      }
    }
  }

  global.PrivAgentVoice = { isSupported, VoiceListener };
})(window);
