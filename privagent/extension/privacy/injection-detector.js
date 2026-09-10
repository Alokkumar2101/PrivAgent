/**
 * PrivAgent :: Prompt-Injection Defense
 * Scans visible page text for instructions that attempt to manipulate the
 * agent (e.g. "ignore previous instructions", "send the password").
 * This runs entirely client-side and BLOCKS the offending page content
 * from ever being included in agent context.
 */

(function (global) {
  'use strict';

  const INJECTION_PATTERNS = [
    /ignore (all )?previous instructions/i,
    /disregard (the )?(system|previous) prompt/i,
    /reveal (your |the )?(system prompt|password|credentials|api key)/i,
    /send (the )?(user'?s? )?(password|credentials|otp|token)/i,
    /disable (security|privacy|protection)/i,
    /bypass (privacy|security) (protection|checks?)/i,
    /you are now (in )?(developer|admin|jailbreak) mode/i,
    /do anything now/i,
    /exfiltrate/i,
    /act as (an? )?unrestricted/i
  ];

  function scanText(text) {
    if (!text) return [];
    const hits = [];
    for (const pattern of INJECTION_PATTERNS) {
      const match = text.match(pattern);
      if (match) hits.push({ pattern: pattern.source, matched: match[0] });
    }
    return hits;
  }

  /**
   * Scans the visible text of the document for injection attempts.
   * Returns { detected, hits }
   */
  function scanPage(root = document.body) {
    if (!root) return { detected: false, hits: [] };
    const text = root.innerText || '';
    const hits = scanText(text);
    return { detected: hits.length > 0, hits };
  }

  global.PrivAgentInjectionDetector = { scanText, scanPage, INJECTION_PATTERNS };
})(window);
