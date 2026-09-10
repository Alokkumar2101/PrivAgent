/**
 * PrivAgent :: Content Script Controller
 * Runs on every page. Listens for messages from the popup/background and:
 *  - scans the DOM for PII
 *  - applies/removes visual masking
 *  - scans for prompt-injection attempts
 *  - executes validated DOM-level actions
 *  - builds sanitized context for transmission to the server
 *
 * FIXED VERSION: every case is now wrapped so an exception inside
 * PrivAgentPII/PrivAgentMasking/etc. (e.g. on a restricted page, or before
 * those scripts have finished initializing) always produces a clean
 * { ok:false, message } response instead of an uncaught error and a
 * message channel that never responds.
 */

(function () {
  'use strict';

  function safeSendResponse(sendResponse, payload) {
    try { sendResponse(payload); } catch (e) { /* channel closed */ }
  }

  function errorPayload(err) {
    console.error('PrivAgent content script error:', err);
    return { ok: false, message: 'PrivAgent could not complete this action on this page.' };
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    try {
      switch (message.type) {
        case 'PING': {
          safeSendResponse(sendResponse, { ok: true });
          return false;
        }

        case 'SCAN_PII': {
          const results = window.PrivAgentPII.scanDocument();
          const summary = results.map((r) => ({ type: r.type, confidence: r.confidence, source: r.source }));
          safeSendResponse(sendResponse, { ok: true, count: results.length, items: summary });
          return false;
        }

        case 'TOGGLE_MASKING': {
          const state = window.PrivAgentMasking.toggle();
          safeSendResponse(sendResponse, { ok: true, ...state });
          return false;
        }

        case 'SCAN_INJECTION': {
          const result = window.PrivAgentInjectionDetector.scanPage();
          safeSendResponse(sendResponse, { ok: true, ...result });
          return false;
        }

        case 'BUILD_SANITIZED_CONTEXT': {
          const results = window.PrivAgentPII.scanDocument();
          const context = window.PrivAgentSanitizer.buildSanitizedContext(results, {
            title: document.title,
            host: window.location.hostname,
            task: message.task || 'manual_send'
          });
          const verification = window.PrivAgentSanitizer.verifyNoRawPII(context);
          safeSendResponse(sendResponse, { ok: true, context, verification });
          return false;
        }

        case 'EXECUTE_DOM_ACTION': {
          // Defense in depth: validate again at point of execution.
          const validation = window.PrivAgentActionValidator.validateAction(message.action);
          if (!validation.valid) {
            safeSendResponse(sendResponse, { ok: false, message: validation.reason });
            return false;
          }
          const result = window.PrivAgentActionExecutor.executeDomAction(message.action);
          safeSendResponse(sendResponse, result);
          return false;
        }

        case 'VISUAL_PRIVACY_SCAN': {
          window.PrivAgentViT.detect(null)
            .then((res) => safeSendResponse(sendResponse, { ok: true, ...res }))
            .catch((err) => safeSendResponse(sendResponse, errorPayload(err)));
          return true; // async
        }

        case 'VLM_PAGE_ANALYZE': {
          window.PrivAgentVLM.analyze(null)
            .then((res) => safeSendResponse(sendResponse, { ok: true, ...res }))
            .catch((err) => safeSendResponse(sendResponse, errorPayload(err)));
          return true; // async
        }

        default:
          return false;
      }
    } catch (err) {
      safeSendResponse(sendResponse, errorPayload(err));
      return false;
    }
  });

  // Auto-scan on load for the "PROTECTION ACTIVE" ambient status (non-intrusive; no masking applied yet).
  window.addEventListener('load', () => {
    try {
      const results = window.PrivAgentPII.scanDocument();
      if (results.length > 0) {
        chrome.runtime.sendMessage({ type: 'PII_AMBIENT_DETECTED', count: results.length, host: window.location.hostname });
      }
      const injection = window.PrivAgentInjectionDetector.scanPage();
      if (injection.detected) {
        chrome.runtime.sendMessage({ type: 'INJECTION_AMBIENT_DETECTED', hits: injection.hits, host: window.location.hostname });
      }
    } catch (e) {
      console.error('PrivAgent ambient scan error:', e); // ignore on restricted pages, but log for debugging
    }
  });
})();
