/**
 * PrivAgent :: PII Detector
 * Runs entirely inside the browser (content script context).
 * Combines DOM semantics + regex pattern matching + label/context heuristics
 * to classify page fields as containing PII, WITHOUT ever leaving the browser.
 *
 * This file was already correctly read-only (it only ever reads DOM/attr
 * values via property access — it never sets a value, style, or attribute
 * on a page element). No behavioral fix was needed here for the
 * password-interference bug; that bug lived in masking.js.
 *
 * Changes in this version: broadened detection coverage to match the
 * required minimum field list (PIN, CVV/CVC, session token, access token,
 * "passwd" spelling) so those fields get classified as sensitive and are
 * routed through the redaction pipeline / no-overlay list in masking.js.
 */

(function (global) {
  'use strict';

  // ---------- Regex pattern bank ----------
  const PATTERNS = {
    email: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/,
    phone: /\b(?:\+?\d{1,3}[-.\s]?)?(?:\d{10}|\d{3}[-.\s]\d{3}[-.\s]\d{4})\b/,
    creditCard: /\b(?:\d[ -]*?){13,16}\b/,
    otp: /\b\d{4,8}\b/,
    apiKey: /\b(sk|pk|api|key)[-_][A-Za-z0-9]{10,}\b/i,
    jwt: /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/,
    aadhaar: /\b\d{4}\s?\d{4}\s?\d{4}\b/,
    ipAddress: /\b(?:\d{1,3}\.){3}\d{1,3}\b/
  };

  // ---------- DOM attribute signal map ----------
  const ATTR_SIGNALS = [
    { test: (el) => el.type === 'password', type: 'password', weight: 0.99 },
    { test: (el) => el.type === 'email', type: 'email', weight: 0.95 },
    { test: (el) => el.autocomplete && el.autocomplete.includes('tel'), type: 'phone', weight: 0.9 },
    { test: (el) => el.autocomplete && el.autocomplete.includes('cc-number'), type: 'credit_card', weight: 0.95 },
    { test: (el) => el.autocomplete && el.autocomplete.includes('cc-csc'), type: 'cvv', weight: 0.95 },
    { test: (el) => el.autocomplete && el.autocomplete.includes('one-time-code'), type: 'otp', weight: 0.95 },
    { test: (el) => el.autocomplete && el.autocomplete.includes('name'), type: 'name', weight: 0.85 },
    { test: (el) => /email/i.test(el.name || '' + el.id || ''), type: 'email', weight: 0.8 },
    { test: (el) => /pass(word)?|passwd/i.test(el.name || '' + el.id || ''), type: 'password', weight: 0.9 },
    { test: (el) => /phone|mobile|tel/i.test(el.name || '' + el.id || ''), type: 'phone', weight: 0.8 },
    { test: (el) => /(full)?name/i.test(el.name || '' + el.id || ''), type: 'name', weight: 0.7 },
    { test: (el) => /card|cc[-_]?num/i.test(el.name || '' + el.id || ''), type: 'credit_card', weight: 0.85 },
    { test: (el) => /^pin$|pin[-_]?code/i.test(el.name || '' + el.id || ''), type: 'pin', weight: 0.85 },
    { test: (el) => /cvv|cvc|security[-_]?code/i.test(el.name || '' + el.id || ''), type: 'cvv', weight: 0.9 },
    { test: (el) => /otp|verification[-_]?code/i.test(el.name || '' + el.id || ''), type: 'otp', weight: 0.85 },
    { test: (el) => /address/i.test(el.name || '' + el.id || ''), type: 'address', weight: 0.7 },
    { test: (el) => /session[-_]?token|auth|jwt/i.test(el.name || '' + el.id || ''), type: 'auth_token', weight: 0.85 },
    { test: (el) => /api[-_]?key|access[-_]?token|secret[-_]?key/i.test(el.name || '' + el.id || ''), type: 'api_key', weight: 0.9 }
  ];

  // ---------- Label / placeholder semantic keyword map ----------
  const LABEL_KEYWORDS = {
    email: ['email', 'e-mail'],
    password: ['password', 'passcode', 'passwd'],
    name: ['full name', 'your name', 'first name', 'last name', 'name'],
    phone: ['mobile', 'phone', 'contact number', 'whatsapp'],
    credit_card: ['card number', 'credit card', 'debit card'],
    cvv: ['cvv', 'cvc', 'security code'],
    pin: ['pin', 'pin code'],
    otp: ['otp', 'verification code', 'one time password'],
    address: ['address', 'street', 'city', 'pincode', 'zip'],
    auth_token: ['token', 'bearer', 'session token', 'authentication token'],
    api_key: ['api key', 'access token', 'secret key']
  };

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
    // Look at preceding sibling text nodes / prior element for label-like text
    let prev = el.previousElementSibling;
    if (prev && /label|span|div|p/i.test(prev.tagName)) text += ' ' + prev.textContent;
    return text.toLowerCase().trim();
  }

  function classifyByLabel(text) {
    const matches = [];
    for (const [type, keywords] of Object.entries(LABEL_KEYWORDS)) {
      for (const kw of keywords) {
        if (text.includes(kw)) {
          matches.push({ type, weight: 0.6 });
          break;
        }
      }
    }
    return matches;
  }

  function classifyByPattern(value) {
    const matches = [];
    if (!value) return matches;
    if (PATTERNS.email.test(value)) matches.push({ type: 'email', weight: 0.9 });
    if (PATTERNS.creditCard.test(value.replace(/\s/g, ''))) matches.push({ type: 'credit_card', weight: 0.75 });
    if (PATTERNS.jwt.test(value)) matches.push({ type: 'auth_token', weight: 0.95 });
    if (PATTERNS.apiKey.test(value)) matches.push({ type: 'api_key', weight: 0.9 });
    else if (PATTERNS.phone.test(value)) matches.push({ type: 'phone', weight: 0.7 });
    return matches;
  }

  /**
   * Scans an input/textarea element and returns the best PII classification.
   * READ-ONLY: only ever reads properties/attributes off `el`. Never sets
   * a value, attribute, or style — that boundary must stay this way, since
   * downstream code (masking.js) relies on this module never touching the
   * live element.
   */
  function classifyElement(el) {
    const candidates = [];

    for (const signal of ATTR_SIGNALS) {
      try {
        if (signal.test(el)) candidates.push({ type: signal.type, weight: signal.weight, source: 'dom' });
      } catch (e) { /* ignore */ }
    }

    const labelText = getAssociatedText(el);
    for (const m of classifyByLabel(labelText)) {
      candidates.push({ ...m, source: 'label' });
    }

    if (el.value) {
      for (const m of classifyByPattern(el.value)) {
        candidates.push({ ...m, source: 'pattern' });
      }
    }

    if (candidates.length === 0) return null;

    // Merge: pick the type with the highest combined confidence
    const scoreByType = {};
    for (const c of candidates) {
      scoreByType[c.type] = scoreByType[c.type] || { total: 0, sources: new Set() };
      scoreByType[c.type].total = Math.min(0.99, scoreByType[c.type].total + c.weight * (1 - scoreByType[c.type].total));
      scoreByType[c.type].sources.add(c.source);
    }

    let best = null;
    for (const [type, info] of Object.entries(scoreByType)) {
      if (!best || info.total > best.confidence) {
        best = { type, confidence: Number(info.total.toFixed(2)), source: [...info.sources].join('+') };
      }
    }
    return best;
  }

  /**
   * Scans plain text content (not inside a form field) for PII patterns.
   * Used for reading arbitrary page text (e.g. static "profile" pages) and
   * for sanitizing free-text metadata (page title, voice transcript, etc.)
   */
  function classifyText(text) {
    const found = [];
    let m;
    if ((m = text.match(PATTERNS.email))) found.push({ type: 'email', value: m[0], confidence: 0.95, source: 'pattern' });
    if ((m = text.match(PATTERNS.jwt))) found.push({ type: 'auth_token', value: m[0], confidence: 0.97, source: 'pattern' });
    if ((m = text.match(PATTERNS.apiKey))) found.push({ type: 'api_key', value: m[0], confidence: 0.9, source: 'pattern' });
    if ((m = text.match(PATTERNS.creditCard))) found.push({ type: 'credit_card', value: m[0], confidence: 0.75, source: 'pattern' });
    if ((m = text.match(PATTERNS.phone))) found.push({ type: 'phone', value: m[0], confidence: 0.7, source: 'pattern' });
    return found;
  }

  /**
   * Scans the full document for PII-bearing form fields.
   * Returns an array of { element, type, confidence, source }
   * READ-ONLY: does not mutate any scanned element.
   */
  function scanDocument(root = document) {
    const results = [];
    const fields = root.querySelectorAll('input, textarea');
    fields.forEach((el) => {
      if (el.type === 'hidden' || el.type === 'submit' || el.type === 'button') return;
      const classification = classifyElement(el);
      if (classification && classification.confidence >= 0.5) {
        results.push({ element: el, ...classification });
      }
    });
    return results;
  }

  global.PrivAgentPII = {
    PATTERNS,
    classifyElement,
    classifyText,
    scanDocument
  };
})(window);
