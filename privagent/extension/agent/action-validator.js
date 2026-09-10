/**
 * PrivAgent :: Action Validator
 * Enforces a strict allowlist of executable action types. The extension
 * NEVER executes eval(), new Function(), or arbitrary JS returned by the
 * server — only these pre-defined, schema-checked action types.
 */

(function (global) {
  'use strict';

  const ALLOWED_ACTIONS = new Set([
    'navigate', 'search', 'scroll', 'go_back', 'go_forward', 'refresh',
    'open_new_tab', 'close_tab', 'read_page', 'summarize_page',
    'click', 'focus', 'type',
    // protected / higher-risk but still schema-validated, never raw code:
    'submit', 'login', 'send', 'payment', 'delete_account', 'change_password'
  ]);

  const HIGH_RISK_ACTIONS = new Set(['payment', 'delete_account', 'change_password']);
  const MEDIUM_RISK_ACTIONS = new Set(['click', 'type', 'submit', 'login', 'send']);

  function isAllowed(actionType) {
    return ALLOWED_ACTIONS.has(actionType);
  }

  /**
   * Validates a single action object. Returns { valid, reason? }
   */
  function validateAction(action) {
    if (!action || typeof action !== 'object') {
      return { valid: false, reason: 'Malformed action object' };
    }
    if (typeof action.type !== 'string' || !isAllowed(action.type)) {
      return { valid: false, reason: `Action type "${action.type}" is not in the allowlist` };
    }
    if (action.type === 'navigate' && (!action.payload || typeof action.payload.url !== 'string')) {
      return { valid: false, reason: 'navigate action missing a valid URL' };
    }
    if (action.type === 'navigate') {
      try {
        const u = new URL(action.payload.url);
        if (!['http:', 'https:'].includes(u.protocol)) {
          return { valid: false, reason: `Blocked unsafe protocol: ${u.protocol}` };
        }
      } catch (e) {
        return { valid: false, reason: 'Invalid URL format' };
      }
    }
    // Never allow inline code payloads under any circumstance.
    if (action.payload && (action.payload.script || action.payload.code || action.payload.eval)) {
      return { valid: false, reason: 'Payload contains executable code — rejected' };
    }
    return { valid: true };
  }

  function requiresApproval(action) {
    return HIGH_RISK_ACTIONS.has(action.type);
  }

  global.PrivAgentActionValidator = {
    ALLOWED_ACTIONS, HIGH_RISK_ACTIONS, MEDIUM_RISK_ACTIONS,
    isAllowed, validateAction, requiresApproval
  };
})(window);
