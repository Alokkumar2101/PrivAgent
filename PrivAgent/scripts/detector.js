/**
 * PrivAgent :: Detector Engine
 * Evidence-based PII detection. A field TYPE (input[type=email]) is never
 * enough on its own — an actual, valid-looking VALUE must be present for
 * anything to be counted. This module is strictly READ-ONLY: it never
 * modifies any element it inspects (no value writes, no attribute changes,
 * no listeners attached to the element itself).
 *
 * Every detection carries a stable ID (domain + pathname + field selector
 * + type) so repeated scans (MutationObserver / input events / SPA
 * re-renders) deduplicate naturally instead of inflating counts.
 */

(function (global) {
  'use strict';

  // ---------- Confidence thresholds (stricter for ambiguous types) ----------
  const THRESHOLDS = {
    email: 0.9,
    phone: 0.85,
    password: 0.9,
    otp: 0.9,
    cvv: 0.9,
    name: 0.8,
    address: 0.75,
    aadhaar: 0.9,
    pan: 0.9,
    card: 0.85,
    bank: 0.8,
    auth_token: 0.85,
    medical: 0.8
  };

  const CATEGORY_LABELS = {
    email: 'Email', phone: 'Phone', password: 'Password', otp: 'OTP', cvv: 'CVV',
    name: 'Name', address: 'Address', aadhaar: 'Aadhaar-like ID', pan: 'PAN-like ID',
    card: 'Card Number', bank: 'Bank Info', auth_token: 'Auth Token', medical: 'Medical Info'
  };

  // ---------- Value validators ----------
  const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/;
  const PHONE_IN_RE = /^(?:\+?91[\s-]?)?[6-9]\d{9}$/;
  const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
  const AADHAAR_RE = /^\d{4}\s?\d{4}\s?\d{4}$/;
  const CARD_SHAPE_RE = /^(?:\d[ -]*?){13,16}$/;
  const JWT_RE = /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
  const API_KEY_RE = /^(sk|pk|api|key)[-_][A-Za-z0-9]{10,}$/i;
  const NAME_RE = /^[A-Za-z]{2,}(?:[\s'-][A-Za-z]{2,}){0,3}$/;
  const NAME_STOPWORDS = new Set([
    'submit', 'login', 'signup', 'sign up', 'home', 'search', 'button',
    'click here', 'learn more', 'add to cart', 'buy now', 'continue',
    'next', 'back', 'cancel', 'save', 'close', 'menu', 'settings', 'guest'
  ]);

  function normalizePhone(v) {
    return v.replace(/[\s()-]/g, '');
  }

  function luhnValid(numStr) {
    const digits = numStr.replace(/\D/g, '');
    if (digits.length < 13 || digits.length > 19) return false;
    let sum = 0, alt = false;
    for (let i = digits.length - 1; i >= 0; i--) {
      let d = parseInt(digits[i], 10);
      if (alt) { d *= 2; if (d > 9) d -= 9; }
      sum += d;
      alt = !alt;
    }
    return sum % 10 === 0;
  }

  // ---------- Field-type signal detection (context only — not proof of value) ----------
  function getAssociatedLabelText(el) {
    let text = '';
    if (el.id) {
      const lbl = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (lbl) text += ' ' + lbl.textContent;
    }
    if (el.placeholder) text += ' ' + el.placeholder;
    if (el.getAttribute('aria-label')) text += ' ' + el.getAttribute('aria-label');
    const parentLabel = el.closest('label');
    if (parentLabel) text += ' ' + parentLabel.textContent;
    const prev = el.previousElementSibling;
    if (prev && /label|span|div|p/i.test(prev.tagName)) text += ' ' + prev.textContent;
    return text.trim();
  }

  function fieldSignal(el) {
    const name = ((el.name || '') + ' ' + (el.id || '')).toLowerCase();
    const autocomplete = (el.autocomplete || '').toLowerCase();
    const type = (el.type || '').toLowerCase();
    const label = getAssociatedLabelText(el).toLowerCase();
    // Normalize underscores/hyphens to spaces so word-boundary regexes match
    // identifiers like "pan_number" or "card-number" the same as "pan number".
    const hay = `${name} ${autocomplete} ${label}`.replace(/[_-]+/g, ' ');

    if (type === 'password' || /current-password|new-password/.test(autocomplete) ||
        /\b(password|passwd|passcode)\b/.test(hay)) return 'password';
    if (/\botp\b|one-?time password|verification code/.test(hay)) return 'otp';
    if (/\bcvv\b|\bcvc\b|security code/.test(hay)) return 'cvv';
    if (type === 'email' || /\bemail\b/.test(autocomplete) || /\bemail\b/.test(hay)) return 'email';
    if (type === 'tel' || /\btel\b/.test(autocomplete) || /\b(phone|mobile|contact)\b/.test(hay)) return 'phone';
    if (/cc number|card number|credit card|debit card/.test(hay)) return 'card';
    if (/account number|ifsc|bank/.test(hay)) return 'bank';
    if (/\bname\b/.test(autocomplete) || /\b(full[-\s]?name|first[-\s]?name|last[-\s]?name|given[-\s]?name|family[-\s]?name)\b/.test(hay)) return 'name';
    if (/address|street|city|pincode|zip/.test(hay)) return 'address';
    if (/aadhaar|aadhar/.test(hay)) return 'aadhaar';
    if (/\bpan\b/.test(hay)) return 'pan';
    if (/api[-_\s]?key|access token|auth(entication)?[-_\s]?token|session token|secret key/.test(hay)) return 'auth_token';
    if (/diagnosis|prescription|medical condition|blood group/.test(hay)) return 'medical';
    return null;
  }

  // ---------- Value validators per signal ----------
  function validateValue(signal, rawValue) {
    const value = (rawValue || '').trim();
    if (!value) return null; // empty field is never counted

    switch (signal) {
      case 'password':
      case 'otp':
      case 'cvv':
        // We never inspect, validate, store, or log the actual secret value.
        // Its mere non-empty presence in a correctly-signalled field is the
        // only evidence used.
        return { type: signal, confidence: 0.95 };

      case 'email':
        return EMAIL_RE.test(value) ? { type: 'email', confidence: 0.97 } : null;

      case 'phone': {
        const n = normalizePhone(value);
        return PHONE_IN_RE.test(n) ? { type: 'phone', confidence: 0.93 } : null;
      }

      case 'name': {
        const lower = value.toLowerCase();
        if (NAME_STOPWORDS.has(lower)) return null;
        if (NAME_RE.test(value) && value.length >= 3 && value.length <= 60) {
          return { type: 'name', confidence: 0.82 };
        }
        return null;
      }

      case 'address':
        return value.length >= 8 ? { type: 'address', confidence: 0.76 } : null;

      case 'card': {
        const digits = value.replace(/\D/g, '');
        if (CARD_SHAPE_RE.test(value) && digits.length >= 13 && digits.length <= 19) {
          return { type: 'card', confidence: luhnValid(digits) ? 0.95 : 0.8 };
        }
        return null;
      }

      case 'bank':
        return value.length >= 6 ? { type: 'bank', confidence: 0.78 } : null;

      case 'aadhaar':
        return AADHAAR_RE.test(value) ? { type: 'aadhaar', confidence: 0.92 } : null;

      case 'pan':
        return PAN_RE.test(value.toUpperCase()) ? { type: 'pan', confidence: 0.95 } : null;

      case 'auth_token':
        if (JWT_RE.test(value) || API_KEY_RE.test(value)) return { type: 'auth_token', confidence: 0.95 };
        return value.length >= 16 ? { type: 'auth_token', confidence: 0.82 } : null;

      case 'medical':
        return value.length >= 4 ? { type: 'medical', confidence: 0.8 } : null;

      default:
        return null;
    }
  }

  // ---------- Stable ID generation for dedup ----------
  function buildSelector(el, index) {
    if (el.id) return `#${el.id}`;
    if (el.name) return `[name="${el.name}"]`;
    const form = el.closest('form');
    const scope = form ? Array.from(form.elements) : Array.from(document.querySelectorAll('input,textarea'));
    const pos = scope.indexOf(el);
    return `${el.tagName.toLowerCase()}:${pos >= 0 ? pos : index}`;
  }

  function stableId(el, type, index) {
    const domain = window.location.hostname;
    const path = window.location.pathname;
    const selector = buildSelector(el, index);
    return `${domain}${path}::${selector}::${type}`;
  }

  /**
   * Scans the live document for fields with an ACTUAL, validated PII value.
   * `enabledCategories` (optional) restricts which types are considered,
   * so users can disable detection categories in Settings.
   * Returns Map<id, { type, confidence, el }>. Strictly read-only.
   */
  function scanDocument(root, enabledCategories) {
    root = root || document;
    const results = new Map();
    const fields = root.querySelectorAll('input, textarea');
    fields.forEach((el, index) => {
      const t = (el.type || '').toLowerCase();
      if (['hidden', 'submit', 'button', 'checkbox', 'radio', 'file', 'image', 'reset'].includes(t)) return;
      const signal = fieldSignal(el);
      if (!signal) return;
      if (enabledCategories && enabledCategories[signal] === false) return;
      const detection = validateValue(signal, el.value);
      if (!detection) return;
      if (detection.confidence < (THRESHOLDS[detection.type] ?? 0.85)) return;
      const id = stableId(el, detection.type, index);
      results.set(id, { type: detection.type, confidence: detection.confidence, el });
    });
    return results;
  }

  /** Field types that must NEVER be visually masked/overlaid or touched in any way. */
  const NEVER_TOUCH_TYPES = new Set(['password', 'otp', 'cvv']);

  global.PrivAgentDetector = {
    THRESHOLDS,
    CATEGORY_LABELS,
    scanDocument,
    fieldSignal,
    validateValue,
    NEVER_TOUCH_TYPES
  };
})(window);
