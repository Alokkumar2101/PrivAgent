/**
 * PrivAgent :: Detector
 * Read-only DOM/value inspection. This module NEVER sets a value,
 * attribute, or style on any page element — it only reads.
 *
 * Raw field values are used ONLY in-memory, in this content-script
 * context, to validate whether a field's current value actually looks
 * like the type it claims to be (field TYPE vs actual VALUE — see
 * validateValue). Nothing here is ever sent anywhere; privacy-engine.js
 * (same context) turns this into metadata-only, deduplicated state
 * before anything crosses a message boundary to the background worker.
 */

(function (root) {
  'use strict';

  const PATTERNS = {
    email: /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/,       // full-match validation
    emailLoose: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/,    // scanning free text
    phoneIN: /^(?:\+?91[-\s]?)?[6-9]\d{9}$/,                        // Indian mobile formats
    creditCard: /^\d{13,16}$/,
    jwt: /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/,
    apiKey: /^(sk|pk|api|key)[-_][A-Za-z0-9]{10,}$/i,
    aadhaarLike: /^\d{4}\s?\d{4}\s?\d{4}$/,
    panLike: /^[A-Z]{5}\d{4}[A-Z]$/
  };

  // Field-TYPE signals only (weak on their own — a real value is still required).
  const ATTR_SIGNALS = [
    { test: (el) => el.type === 'password', type: 'password', weight: 0.99 },
    { test: (el) => el.type === 'email', type: 'email', weight: 0.6 },
    { test: (el) => el.autocomplete === 'current-password' || el.autocomplete === 'new-password', type: 'password', weight: 0.95 },
    { test: (el) => el.autocomplete && el.autocomplete.includes('tel'), type: 'phone', weight: 0.6 },
    { test: (el) => el.autocomplete && el.autocomplete.includes('cc-number'), type: 'credit_card', weight: 0.6 },
    { test: (el) => el.autocomplete && el.autocomplete.includes('cc-csc'), type: 'cvv', weight: 0.6 },
    { test: (el) => el.autocomplete && el.autocomplete.includes('one-time-code'), type: 'otp', weight: 0.6 },
    { test: (el) => el.autocomplete && el.autocomplete.includes('name'), type: 'name', weight: 0.55 },
    { test: (el) => /email/i.test((el.name || '') + (el.id || '')), type: 'email', weight: 0.5 },
    { test: (el) => /pass(word)?|passwd/i.test((el.name || '') + (el.id || '')), type: 'password', weight: 0.6 },
    { test: (el) => /phone|mobile|tel/i.test((el.name || '') + (el.id || '')), type: 'phone', weight: 0.5 },
    { test: (el) => /^(full)?[-_]?name$|given-?name|family-?name|first-?name|last-?name/i.test((el.name || '') + (el.id || '')), type: 'name', weight: 0.5 },
    { test: (el) => /card|cc[-_]?num/i.test((el.name || '') + (el.id || '')), type: 'credit_card', weight: 0.55 },
    { test: (el) => /^pin$|pin[-_]?code/i.test((el.name || '') + (el.id || '')), type: 'pin', weight: 0.55 },
    { test: (el) => /cvv|cvc|security[-_]?code/i.test((el.name || '') + (el.id || '')), type: 'cvv', weight: 0.6 },
    { test: (el) => /otp|verification[-_]?code/i.test((el.name || '') + (el.id || '')), type: 'otp', weight: 0.55 },
    { test: (el) => /address/i.test((el.name || '') + (el.id || '')), type: 'address', weight: 0.45 },
    { test: (el) => /aadhaar|aadhar/i.test((el.name || '') + (el.id || '')), type: 'gov_id', weight: 0.6 },
    { test: (el) => /\bpan\b/i.test((el.name || '') + (el.id || '')), type: 'gov_id', weight: 0.55 },
    { test: (el) => /session[-_]?token|jwt/i.test((el.name || '') + (el.id || '')), type: 'auth_token', weight: 0.6 },
    { test: (el) => /api[-_]?key|access[-_]?token|secret[-_]?key/i.test((el.name || '') + (el.id || '')), type: 'api_key', weight: 0.6 }
  ];

  const LABEL_KEYWORDS = {
    email: ['email', 'e-mail'],
    password: ['password', 'passcode', 'passwd'],
    name: ['full name', 'your name', 'first name', 'last name', 'given name', 'family name'],
    phone: ['mobile', 'phone number', 'contact number', 'whatsapp number'],
    credit_card: ['card number', 'credit card', 'debit card'],
    cvv: ['cvv', 'cvc', 'security code'],
    pin: ['pin', 'pin code'],
    otp: ['otp', 'verification code', 'one time password'],
    address: ['address', 'street address', 'city', 'pincode', 'zip code'],
    gov_id: ['aadhaar', 'aadhar', 'pan number', 'passport number', 'government id'],
    auth_token: ['session token', 'authentication token', 'bearer'],
    api_key: ['api key', 'access token', 'secret key']
  };

  // Guards against "Product Name"/"Company Name"/site-title fields being misread as a person's name.
  const NAME_FIELD_EXCLUDE = /product|company|brand|business|website|site|file|project|event|team|domain/i;

  function getAssociatedText(el) {
    let text = '';
    if (el.id) {
      const lbl = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (lbl) text += ' ' + lbl.textContent;
    }
    if (el.placeholder) text += ' ' + el.placeholder;
    if (el.getAttribute('aria-label')) text += ' ' + el.getAttribute('aria-label');
    const parentLabel = el.closest('label');
    if (parentLabel) text += ' ' + parentLabel.textContent;
    let prev = el.previousElementSibling;
    if (prev && /label|span|div|p/i.test(prev.tagName)) text += ' ' + prev.textContent;
    return text.toLowerCase().trim();
  }

  function classifyByLabel(text) {
    const matches = [];
    for (const [type, keywords] of Object.entries(LABEL_KEYWORDS)) {
      for (const kw of keywords) { if (text.includes(kw)) { matches.push({ type, weight: 0.4 }); break; } }
    }
    return matches;
  }

  function classifyFieldType(el) {
    const candidates = [];
    for (const signal of ATTR_SIGNALS) {
      try { if (signal.test(el)) candidates.push({ type: signal.type, weight: signal.weight }); } catch (e) { /* ignore */ }
    }
    const labelText = getAssociatedText(el);
    for (const m of classifyByLabel(labelText)) candidates.push(m);
    if (candidates.length === 0) return null;
    if (candidates.some((c) => c.type === 'name') && NAME_FIELD_EXCLUDE.test((el.name || '') + (el.id || '') + labelText)) {
      return null;
    }
    const scoreByType = {};
    for (const c of candidates) {
      scoreByType[c.type] = scoreByType[c.type] || 0;
      scoreByType[c.type] = Math.min(0.99, scoreByType[c.type] + c.weight * (1 - scoreByType[c.type]));
    }
    let best = null;
    for (const [type, score] of Object.entries(scoreByType)) {
      if (!best || score > best.confidence) best = { type, confidence: Number(score.toFixed(2)) };
    }
    return best;
  }

  function luhnCheck(digits) {
    let sum = 0, alt = false;
    for (let i = digits.length - 1; i >= 0; i--) {
      let n = parseInt(digits[i], 10);
      if (alt) { n *= 2; if (n > 9) n -= 9; }
      sum += n; alt = !alt;
    }
    return sum % 10 === 0;
  }

  /** Distinguishes "field exists" from "field has a real value" — the core anti-false-positive rule. */
  function validateValue(type, value) {
    if (value == null) return { valid: false, confidence: 0 };
    const v = String(value).trim();
    if (v.length === 0) return { valid: false, confidence: 0 };

    switch (type) {
      case 'password':
        // Never inspect password *content* — any non-empty value in a
        // confirmed password-type field is sufficient on its own.
        return { valid: true, confidence: 1.0 };
      case 'otp': case 'pin': {
        const ok = /^\d{4,8}$/.test(v);
        return { valid: ok, confidence: ok ? 0.9 : 0 };
      }
      case 'cvv': {
        const ok = /^\d{3,4}$/.test(v);
        return { valid: ok, confidence: ok ? 0.9 : 0 };
      }
      case 'email': {
        const ok = PATTERNS.email.test(v);
        return { valid: ok, confidence: ok ? 0.98 : 0 };
      }
      case 'phone': {
        const ok = PATTERNS.phoneIN.test(v.replace(/[\s-]/g, ''));
        return { valid: ok, confidence: ok ? 0.95 : 0 };
      }
      case 'credit_card': {
        const digits = v.replace(/[\s-]/g, '');
        const ok = PATTERNS.creditCard.test(digits) && luhnCheck(digits);
        return { valid: ok, confidence: ok ? 0.95 : 0 };
      }
      case 'api_key': {
        const ok = PATTERNS.apiKey.test(v);
        return { valid: ok, confidence: ok ? 0.9 : 0 };
      }
      case 'auth_token': {
        const jwtOk = PATTERNS.jwt.test(v);
        return { valid: jwtOk || v.length >= 20, confidence: jwtOk ? 0.95 : (v.length >= 20 ? 0.6 : 0) };
      }
      case 'gov_id': {
        const ok = PATTERNS.aadhaarLike.test(v) || PATTERNS.panLike.test(v.toUpperCase());
        return { valid: ok, confidence: ok ? 0.9 : 0 };
      }
      case 'name': {
        const ok = /^[A-Za-z]+(\s[A-Za-z]+){1,3}$/.test(v) && v.length <= 60;
        return { valid: ok, confidence: ok ? 0.75 : 0 };
      }
      case 'address':
        return { valid: v.length >= 8, confidence: v.length >= 8 ? 0.6 : 0 };
      default:
        return { valid: v.length > 0, confidence: 0.5 };
    }
  }

  /**
   * Scans every input/textarea, classifies field type, then validates the
   * CURRENT value against that type. Only returns entries with a
   * non-empty, validated value — empty fields never appear here.
   */
  function scanDocument(root = document) {
    const out = [];
    const fields = root.querySelectorAll('input, textarea');
    fields.forEach((el, idx) => {
      if (el.type === 'hidden' || el.type === 'submit' || el.type === 'button' || el.disabled) return;
      const fieldType = classifyFieldType(el);
      if (!fieldType || fieldType.confidence < 0.4) return;
      const validation = validateValue(fieldType.type, el.value);
      if (!validation.valid) return;
      out.push({
        element: el, index: idx, type: fieldType.type,
        confidence: Number(Math.min(0.99, fieldType.confidence * 0.4 + validation.confidence * 0.6).toFixed(2)),
        value: el.value // in-memory only in this context; never transmitted
      });
    });
    return out;
  }

  function scanText(text) {
    const found = [];
    if (!text) return found;
    const m = text.match(PATTERNS.emailLoose);
    if (m) found.push({ type: 'email', value: m[0] });
    return found;
  }

  root.PrivAgentDetector = { PATTERNS, classifyFieldType, validateValue, scanDocument, scanText };
})(typeof self !== 'undefined' ? self : window);
