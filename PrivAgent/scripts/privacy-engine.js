/**
 * PrivAgent :: Privacy Engine
 * Deterministic privacy score calculation. The SAME inputs always produce
 * the SAME score — never randomly generated.
 */

(function (root) {
  'use strict';

  /**
   * input: {
   *   detectedCount, protectedCount,   // current page PII counts
   *   thirdPartyCount, blockedCount,   // current page network counts
   *   protectionMode                   // 'SAFE' | 'BALANCED' | 'OFF'
   * }
   */
  function computePrivacyScore(input) {
    const {
      detectedCount = 0,
      protectedCount = 0,
      thirdPartyCount = 0,
      blockedCount = 0,
      protectionMode = 'BALANCED'
    } = input || {};

    let score = 100;

    const unprotected = Math.max(0, detectedCount - protectedCount);
    score -= Math.min(40, unprotected * 8);

    const unblockedThirdParty = Math.max(0, thirdPartyCount - blockedCount);
    score -= Math.min(30, unblockedThirdParty * 3);

    // Blocking trackers is a positive signal, small reward.
    score += Math.min(10, blockedCount * 2);

    if (protectionMode === 'OFF') score -= 15;
    else if (protectionMode === 'SAFE') score += 5;

    score = Math.max(0, Math.min(100, Math.round(score)));
    return score;
  }

  function riskLevelForType(type) {
    const HIGH = new Set(['password', 'otp', 'cvv', 'card', 'aadhaar', 'pan', 'auth_token', 'bank']);
    const MEDIUM = new Set(['email', 'phone', 'address', 'medical']);
    if (HIGH.has(type)) return 'HIGH';
    if (MEDIUM.has(type)) return 'MEDIUM';
    return 'LOW';
  }

  root.PrivAgentPrivacyEngine = { computePrivacyScore, riskLevelForType };
})(typeof self !== 'undefined' ? self : window);
