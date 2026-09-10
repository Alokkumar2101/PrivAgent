/**
 * PrivAgent :: Client Risk Engine
 * Assigns a numeric risk score to an action before execution. High-risk
 * actions ALWAYS require explicit user approval, regardless of what any
 * server response says (defense in depth — the client is the final gate).
 */

(function (global) {
  'use strict';

  const RISK_SCORES = {
    scroll: 5, focus: 5, navigate: 10, search: 10, go_back: 5, go_forward: 5,
    refresh: 8, open_new_tab: 5, close_tab: 15, read_page: 5, summarize_page: 5,
    click: 35, type: 30, submit: 55, login: 60, send: 55,
    payment: 90, delete_account: 95, change_password: 85
  };

  function levelFor(score) {
    if (score >= 70) return 'HIGH';
    if (score >= 30) return 'MEDIUM';
    return 'LOW';
  }

  function evaluate(action) {
    const score = RISK_SCORES[action.type] ?? 50;
    const level = levelFor(score);
    return {
      score,
      level,
      approval_required: level === 'HIGH',
      reason: reasonFor(action.type, level)
    };
  }

  function reasonFor(type, level) {
    if (level === 'HIGH') return `"${type}" may create an external effect (financial, security, or irreversible data change).`;
    if (level === 'MEDIUM') return `"${type}" modifies page state or submits data.`;
    return `"${type}" is a passive/read-only browser action.`;
  }

  global.PrivAgentRiskEngine = { RISK_SCORES, levelFor, evaluate };
})(window);
