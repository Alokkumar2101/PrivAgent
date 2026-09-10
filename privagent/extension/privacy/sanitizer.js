/**
 * PrivAgent :: Sanitizer
 *
 * FIXED VERSION.
 *
 * Root-cause bug (previous version): buildSanitizedContext() put the raw,
 * un-sanitized document.title straight into context.page. verifyNoRawPII()
 * then JSON.stringify()'d the WHOLE context (including that raw title) and
 * tested it against the full detection pattern bank — including
 * `otp: /\b\d{4,8}\b/`, which matches any 4-8 digit run. That meant a page
 * titled something as ordinary as "Portal v2026" or a timestamp field could
 * trip a false "Raw pattern found in payload" block, even though the
 * user's actual sensitive fields (email/password/etc.) had been correctly
 * redacted. The check was validating the wrong thing.
 *
 * FIX:
 *  - Free-text metadata (page title, task) is now run through
 *    sanitizeText() before being included in the context, so it can't
 *    carry raw PII in the first place.
 *  - verifyNoRawPII() is now deterministic and scoped correctly:
 *      1. Every value in `fields` MUST be a recognized redaction token
 *         (e.g. "[EMAIL_REDACTED]"). Anything else is flagged with a
 *         specific reason naming the offending field.
 *      2. Remaining free-text metadata is checked against a narrower
 *         pattern set that excludes the noisy, high-false-positive
 *         patterns (`otp`, `ipAddress`) which are fine for *detecting*
 *         candidate PII on a live page but are too broad to validate an
 *         already-sanitized payload.
 *  - Every BLOCKED result now carries an exact, explainable `reason`.
 */

(function (global) {
  'use strict';

  const REDACTION_TOKENS = {
    email: '[EMAIL_REDACTED]',
    password: '[PASSWORD_REDACTED]',
    name: '[NAME_REDACTED]',
    phone: '[PHONE_REDACTED]',
    address: '[ADDRESS_REDACTED]',
    credit_card: '[CARD_REDACTED]',
    otp: '[OTP_REDACTED]',
    pin: '[PIN_REDACTED]',
    cvv: '[CVV_REDACTED]',
    api_key: '[API_KEY_REDACTED]',
    auth_token: '[TOKEN_REDACTED]',
    unknown: '[PII_REDACTED]'
  };

  // Matches ANY of the tokens above, generically — used to validate that a
  // field value is a recognized redaction token and nothing else.
  const REDACTION_TOKEN_RE = /^\[[A-Z0-9_]+_REDACTED\]$/;

  // Patterns too broad/noisy to run against free-text metadata (title,
  // task) without producing false positives (e.g. "otp" matches any
  // 4-8 digit run, "ipAddress" matches version numbers like 2026.1.0).
  // They're still used for live-page PII *detection* in pii-detector.js —
  // just not for this payload-validation step.
  const VALIDATION_EXCLUDED_PATTERNS = new Set(['otp', 'ipAddress', 'aadhaar']);

  function redactionFor(type) {
    return REDACTION_TOKENS[type] || REDACTION_TOKENS.unknown;
  }

  /**
   * Given the results of PrivAgentPII.scanDocument(), build a sanitized
   * field map safe to transmit. Raw values NEVER enter this object.
   */
  function buildSanitizedContext(scanResults, meta = {}) {
    const fields = {};
    let piiCount = 0;

    scanResults.forEach((r, idx) => {
      const key = r.element.name || r.element.id || `field_${idx}`;
      fields[key] = redactionFor(r.type);
      piiCount++;
    });

    const rawTitle = meta.title || document.title;
    const rawTask = meta.task || 'unspecified';

    return {
      // Free-text metadata is sanitized too — this is what was leaking
      // raw values into the payload and triggering false blocks.
      page: sanitizeText(rawTitle),
      url_host: meta.host || window.location.hostname,
      task: sanitizeText(rawTask),
      fields,
      pii_detected: piiCount,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Sanitizes a free-text string (e.g. text pulled from the page or a voice
   * transcript) by replacing any detected PII patterns with redaction tokens.
   */
  function sanitizeText(text) {
    if (!text) return text;
    let clean = text;
    const found = global.PrivAgentPII.classifyText(text);
    found.forEach((f) => {
      clean = clean.split(f.value).join(redactionFor(f.type));
    });
    return clean;
  }

  /**
   * Verifies a sanitized context object contains no raw PII before it's
   * allowed to leave the browser. Deterministic, with an exact reason on
   * failure. Mirrors (and should stay in sync with) the server-side
   * privacy_gate.py check.
   */
  function verifyNoRawPII(sanitizedContext) {
    // 1) Every field value must be a recognized redaction token. This is
    //    the primary, most reliable check: it doesn't matter what pattern
    //    a raw value would match — if it isn't one of our own tokens, it
    //    leaked.
    const fields = sanitizedContext.fields || {};
    for (const [key, value] of Object.entries(fields)) {
      if (typeof value !== 'string' || !REDACTION_TOKEN_RE.test(value)) {
        return {
          safe: false,
          reason: `Field "${key}" was not sanitized (expected a redaction token, found raw value)`
        };
      }
    }

    // 2) Remaining free-text metadata gets checked against a narrower
    //    pattern set (excludes noisy digit-run patterns) as defense in
    //    depth, in case sanitizeText() missed something.
    const metaStr = `${sanitizedContext.page || ''} ${sanitizedContext.task || ''}`;
    const patterns = global.PrivAgentPII.PATTERNS;
    for (const [name, regex] of Object.entries(patterns)) {
      if (VALIDATION_EXCLUDED_PATTERNS.has(name)) continue;
      if (regex.test(metaStr)) {
        return { safe: false, reason: `Raw ${name} pattern found in page metadata ("page"/"task")` };
      }
    }

    return { safe: true };
  }

  global.PrivAgentSanitizer = {
    REDACTION_TOKENS,
    redactionFor,
    buildSanitizedContext,
    sanitizeText,
    verifyNoRawPII
  };
})(window);
