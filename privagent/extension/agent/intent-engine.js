/**
 * PrivAgent :: Intent Engine
 * Bridges parsed intents (from command-parser.js) to concrete, schema-
 * validated action objects the executor can safely run.
 * Loaded in the popup context alongside command-parser.js.
 */

(function (global) {
  'use strict';

  const RISK_BY_ACTION = {
    navigate: 'LOW',
    open_website: 'LOW',
    search: 'LOW',
    scroll: 'LOW',
    focus: 'LOW',
    go_back: 'LOW',
    go_forward: 'LOW',
    refresh: 'LOW',
    open_new_tab: 'LOW',
    close_tab: 'LOW',
    read_page: 'LOW',
    summarize_page: 'LOW',
    click: 'MEDIUM',
    type: 'MEDIUM',
    submit: 'MEDIUM',
    login: 'MEDIUM',
    payment: 'HIGH',
    delete_account: 'HIGH',
    change_password: 'HIGH'
  };

  function riskFor(actionType) {
    return RISK_BY_ACTION[actionType] || 'MEDIUM';
  }

  /**
   * Converts a parsed intent object { intent, params } into one or more
   * concrete action objects: { type, payload, risk }
   */
  function buildActions(parsed) {
    const { intent, params } = parsed;

    switch (intent) {
      case 'COMPOUND':
        return params.steps.flatMap((step) => buildActions(step));

      case 'OPEN_WEBSITE': {
        const url = params.url || (params.site ? `https://www.${params.site.replace(/\s+/g, '')}.com` : null);
        return [{ type: 'navigate', payload: { url }, risk: riskFor('navigate') }];
      }

      case 'NAVIGATE':
        return [{ type: 'navigate', payload: { url: params.url }, risk: riskFor('navigate') }];

      case 'SEARCH_WEB': {
        const url = `https://www.google.com/search?q=${encodeURIComponent(params.query)}`;
        return [{ type: 'navigate', payload: { url }, risk: riskFor('search') }];
      }

      case 'SCROLL':
        return [{ type: 'scroll', payload: { direction: params.direction }, risk: riskFor('scroll') }];

      case 'GO_BACK':
        return [{ type: 'go_back', payload: {}, risk: riskFor('go_back') }];

      case 'GO_FORWARD':
        return [{ type: 'go_forward', payload: {}, risk: riskFor('go_forward') }];

      case 'REFRESH':
        return [{ type: 'refresh', payload: {}, risk: riskFor('refresh') }];

      case 'OPEN_NEW_TAB':
        return [{ type: 'open_new_tab', payload: {}, risk: riskFor('open_new_tab') }];

      case 'CLOSE_TAB':
        return [{ type: 'close_tab', payload: {}, risk: riskFor('close_tab') }];

      case 'READ_PAGE':
        return [{ type: 'read_page', payload: {}, risk: riskFor('read_page') }];

      case 'SUMMARIZE_PAGE':
        return [{ type: 'summarize_page', payload: {}, risk: riskFor('summarize_page') }];

      case 'CLICK':
        return [{ type: 'click', payload: { target: params.target }, risk: riskFor('click') }];

      case 'FOCUS':
        return [{ type: 'focus', payload: { target: params.target }, risk: riskFor('focus') }];

      case 'TYPE':
        return [{ type: 'type', payload: { target: params.target, value: params.value }, risk: riskFor('type') }];

      case 'LOGIN':
        return [{ type: 'login', payload: {}, risk: riskFor('login') }];

      case 'FORM_ACTION': {
        const actionType = params.action === 'delete_account' ? 'delete_account'
          : params.action === 'change_password' ? 'change_password'
          : params.action === 'payment' ? 'payment'
          : 'submit';
        return [{ type: actionType, payload: { target: params.target }, risk: riskFor(actionType) }];
      }

      default:
        return [];
    }
  }

  global.PrivAgentIntentEngine = { buildActions, riskFor, RISK_BY_ACTION };
})(window);
