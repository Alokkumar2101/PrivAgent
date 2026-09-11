/**
 * PrivAgent :: Content Script
 * Orchestrates PII scanning using detector.js, reports results to the
 * background service worker, and (only when the user has enabled PII
 * Masking) draws a purely-visual, non-destructive overlay near eligible
 * fields. Password/OTP/CVV fields are NEVER touched in any way — no
 * listeners, no overlays, no style/attribute/value changes.
 */

(function () {
  'use strict';

  let settings = null;
  let currentDetections = new Map(); // id -> { type, confidence }
  let seenIds = new Set();           // ids already reported once this "page session"
  let scanTimer = null;
  let lastHref = location.href;
  const overlays = new Map(); // id -> overlay element

  function safeRuntimeSendMessage(message) {
    try {
      chrome.runtime.sendMessage(message, () => {
        if (chrome.runtime.lastError) { /* receiving end may not be ready; ignore */ }
      });
    } catch (e) { /* extension context invalidated on reload; ignore */ }
  }

  function loadSettings() {
    return new Promise((resolve) => {
      chrome.storage.local.get('privagent_settings', (data) => {
        const stored = (data && data.privagent_settings) || {};
        settings = Object.assign({
          protectionEnabled: true,
          protectionMode: 'BALANCED',
          maskingEnabled: false,
          detectionCategories: {}
        }, stored);
        resolve(settings);
      });
    });
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes.privagent_settings) return;
    settings = changes.privagent_settings.newValue;
    scheduleScan(0);
  });

  // ---------- Masking overlay (purely visual, never touches the real field) ----------
  function ensureOverlayLayer() {
    let layer = document.getElementById('privagent-overlay-layer');
    if (!layer) {
      layer = document.createElement('div');
      layer.id = 'privagent-overlay-layer';
      Object.assign(layer.style, {
        position: 'fixed', top: '0', left: '0', width: '0', height: '0',
        zIndex: '2147483647', pointerEvents: 'none'
      });
      document.documentElement.appendChild(layer);
    }
    return layer;
  }

  function maskPreview(type, el) {
    // Purely cosmetic label text — never derived from the actual raw value
    // in a way that could be reconstructed, and never written back to el.
    const labels = {
      email: 'Email • masked', phone: 'Phone • masked', name: 'Name • masked',
      address: 'Address • masked', card: 'Card • masked', bank: 'Bank info • masked',
      aadhaar: 'Aadhaar-like ID • masked', pan: 'PAN-like ID • masked',
      auth_token: 'Token • masked', medical: 'Medical info • masked'
    };
    return labels[type] || 'Sensitive info • masked';
  }

  function positionOverlay(overlay, el) {
    const rect = el.getBoundingClientRect();
    overlay.style.top = `${Math.round(rect.top - 20)}px`;
    overlay.style.left = `${Math.round(rect.left)}px`;
  }

  function addOverlay(id, type, el) {
    if (overlays.has(id)) return;
    const layer = ensureOverlayLayer();
    const badge = document.createElement('div');
    badge.className = 'privagent-badge';
    badge.textContent = `🔒 ${maskPreview(type, el)}`;
    Object.assign(badge.style, {
      position: 'absolute',
      fontSize: '10px',
      fontFamily: 'Segoe UI, Arial, sans-serif',
      fontWeight: '700',
      color: '#00E5FF',
      background: 'rgba(6, 20, 30, 0.92)',
      border: '1px solid rgba(0, 229, 255, 0.5)',
      borderRadius: '4px',
      padding: '2px 6px',
      whiteSpace: 'nowrap',
      boxShadow: '0 0 6px rgba(0,229,255,0.35)'
    });
    positionOverlay(badge, el);
    layer.appendChild(badge);
    overlays.set(id, { badge, el });
  }

  function removeOverlay(id) {
    const entry = overlays.get(id);
    if (entry && entry.badge.parentNode) entry.badge.parentNode.removeChild(entry.badge);
    overlays.delete(id);
  }

  function repositionOverlays() {
    overlays.forEach(({ badge, el }) => positionOverlay(badge, el));
  }

  window.addEventListener('scroll', throttle(repositionOverlays, 100), true);
  window.addEventListener('resize', throttle(repositionOverlays, 150));

  function throttle(fn, wait) {
    let last = 0, timer = null;
    return (...args) => {
      const now = Date.now();
      if (now - last >= wait) {
        last = now;
        fn(...args);
      } else {
        clearTimeout(timer);
        timer = setTimeout(() => { last = Date.now(); fn(...args); }, wait - (now - last));
      }
    };
  }

  function applyMasking(detections) {
    const maskingOn = settings && settings.maskingEnabled;
    const NEVER_TOUCH = window.PrivAgentDetector.NEVER_TOUCH_TYPES;

    // Remove overlays for ids no longer present or when masking is off.
    for (const id of Array.from(overlays.keys())) {
      if (!maskingOn || !detections.has(id)) removeOverlay(id);
    }
    if (!maskingOn) return;

    detections.forEach((info, id) => {
      if (NEVER_TOUCH.has(info.type)) return; // password/otp/cvv: never touched
      addOverlay(id, info.type, info.el);
    });
  }

  // ---------- Scan orchestration ----------
  function computeCounts(detections) {
    const NEVER_TOUCH = window.PrivAgentDetector.NEVER_TOUCH_TYPES;
    const detected = {};
    const protectedCounts = {};
    detections.forEach((info) => {
      detected[info.type] = (detected[info.type] || 0) + 1;
      const isProtected = NEVER_TOUCH.has(info.type) // native browser masking
        ? !!(settings && settings.protectionEnabled)
        : !!(settings && settings.maskingEnabled);
      if (isProtected) protectedCounts[info.type] = (protectedCounts[info.type] || 0) + 1;
    });
    return { detected, protectedCounts };
  }

  function runScan() {
    if (!settings) return;
    // Detection itself always runs (it's read-only and never modifies the
    // page) even if Protection or Masking is off — only the *masking
    // overlay* and *protected* accounting are gated on those settings.
    let fresh;
    try {
      fresh = window.PrivAgentDetector.scanDocument(document, settings.detectionCategories);
    } catch (e) {
      console.error('[PrivAgent] scan failed', e);
      return;
    }

    currentDetections = fresh;
    applyMasking(fresh);

    const { detected, protectedCounts } = computeCounts(fresh);

    const newDetections = [];
    fresh.forEach((info, id) => {
      if (!seenIds.has(id)) {
        newDetections.push({
          type: info.type,
          protected: window.PrivAgentDetector.NEVER_TOUCH_TYPES.has(info.type)
            ? !!(settings && settings.protectionEnabled)
            : !!(settings && settings.maskingEnabled)
        });
      }
    });
    seenIds = new Set(fresh.keys());

    safeRuntimeSendMessage({
      type: 'PII_SCAN_UPDATE',
      domain: location.hostname,
      path: location.pathname,
      detected,
      protectedCounts,
      newDetections,
      timestamp: new Date().toISOString()
    });
  }

  function scheduleScan(delay) {
    clearTimeout(scanTimer);
    scanTimer = setTimeout(runScan, delay === undefined ? 350 : delay);
  }

  // ---------- Passive listeners (read-only; never preventDefault/stopPropagation) ----------
  document.addEventListener('input', () => scheduleScan(), true);
  document.addEventListener('change', () => scheduleScan(), true);
  document.addEventListener('blur', () => scheduleScan(), true);

  const observer = new MutationObserver(() => scheduleScan(500));
  observer.observe(document.documentElement, { childList: true, subtree: true });

  // ---------- SPA route-change detection ----------
  function handleRouteChange() {
    if (location.href === lastHref) return;
    lastHref = location.href;
    seenIds = new Set();
    overlays.forEach((_, id) => removeOverlay(id));
    safeRuntimeSendMessage({ type: 'PAGE_CHANGED', domain: location.hostname, path: location.pathname });
    scheduleScan(300);
  }

  const origPushState = history.pushState;
  const origReplaceState = history.replaceState;
  history.pushState = function (...args) { origPushState.apply(this, args); handleRouteChange(); };
  history.replaceState = function (...args) { origReplaceState.apply(this, args); handleRouteChange(); };
  window.addEventListener('popstate', handleRouteChange);

  // ---------- Message handlers (from background/popup) ----------
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'REQUEST_SCAN') {
      scheduleScan(0);
      sendResponse({ ok: true });
      return false;
    }
    if (message.type === 'PING') {
      sendResponse({ ok: true });
      return false;
    }
    return false;
  });

  // ---------- Init ----------
  loadSettings().then(() => scheduleScan(200));
})();
