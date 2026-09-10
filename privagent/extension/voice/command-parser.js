/**
 * PrivAgent :: Command Parser / Intent Engine
 * Local, rule-based NLU that classifies free text (from voice or typed
 * input) into a structured intent + parameters. Designed so a real
 * LLM/NLU model could later replace `parseCommand` while keeping the same
 * output shape: { intent, params, raw }.
 */

(function (global) {
  'use strict';

  const KNOWN_SITES = {
    google: 'https://www.google.com',
    youtube: 'https://www.youtube.com',
    github: 'https://github.com',
    amazon: 'https://www.amazon.com',
    gmail: 'https://mail.google.com',
    facebook: 'https://www.facebook.com',
    twitter: 'https://twitter.com',
    x: 'https://x.com',
    wikipedia: 'https://www.wikipedia.org',
    linkedin: 'https://www.linkedin.com',
    reddit: 'https://www.reddit.com'
  };

  const URL_REGEX = /\b((?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s]*)?)\b/i;

  function extractUrl(text) {
    const m = text.match(URL_REGEX);
    if (!m) return null;
    let url = m[1];
    if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
    return url;
  }

  function extractSiteName(text) {
    for (const site of Object.keys(KNOWN_SITES)) {
      const re = new RegExp(`\\b${site}\\b`, 'i');
      if (re.test(text)) return site;
    }
    return null;
  }

  function normalize(text) {
    return text.trim().toLowerCase().replace(/\s+/g, ' ');
  }

  /**
   * Core intent classifier. Order matters — most specific patterns first.
   */
  function parseCommand(rawText) {
    const text = normalize(rawText);
    const raw = rawText;

    // "open X and search for Y" — compound command
    const compound = text.match(/open ([a-z0-9. ]+?) and search (?:for )?(.+)/i);
    if (compound) {
      const site = extractSiteName(compound[1]) || compound[1].trim();
      return {
        intent: 'COMPOUND',
        params: { steps: [
          { intent: 'OPEN_WEBSITE', params: { site, url: KNOWN_SITES[site] || extractUrl(compound[1]) } },
          { intent: 'SEARCH_WEB', params: { query: compound[2].trim(), engine: site } }
        ] },
        raw
      };
    }

    // "search google for X" / "search for X on google" / "google X"
    let m = text.match(/search (?:google|the web|on google)? ?(?:for )?(.+)/i);
    if (m) {
      return { intent: 'SEARCH_WEB', params: { query: m[1].trim(), engine: 'google' }, raw };
    }

    // "open <site>" / "go to <site>" / "launch <site>"
    m = text.match(/(?:open|launch|go to|visit)\s+(.+)/i);
    if (m) {
      const target = m[1].trim();
      const site = extractSiteName(target);
      const url = extractUrl(target);
      if (site) return { intent: 'OPEN_WEBSITE', params: { site, url: KNOWN_SITES[site] }, raw };
      if (url) return { intent: 'NAVIGATE', params: { url }, raw };
      return { intent: 'OPEN_WEBSITE', params: { site: target, url: null }, raw };
    }

    // Navigation controls
    if (/^scroll down/.test(text)) return { intent: 'SCROLL', params: { direction: 'down' }, raw };
    if (/^scroll up/.test(text)) return { intent: 'SCROLL', params: { direction: 'up' }, raw };
    if (/^(go back|back)$/.test(text)) return { intent: 'GO_BACK', params: {}, raw };
    if (/^(go forward|forward)$/.test(text)) return { intent: 'GO_FORWARD', params: {}, raw };
    if (/^(refresh|reload)( the page)?$/.test(text)) return { intent: 'REFRESH', params: {}, raw };
    if (/^(open a new tab|new tab)$/.test(text)) return { intent: 'OPEN_NEW_TAB', params: {}, raw };
    if (/^close (this )?tab$/.test(text)) return { intent: 'CLOSE_TAB', params: {}, raw };

    // Reading / summarizing
    if (/^(read|read the page|read this page)$/.test(text)) return { intent: 'READ_PAGE', params: {}, raw };
    if (/^summarize( the page| this page)?$/.test(text)) return { intent: 'SUMMARIZE_PAGE', params: {}, raw };

    // Form interactions
    m = text.match(/^(?:type|enter|fill in)\s+(.+?)\s+(?:in|into)\s+(.+)$/i);
    if (m) return { intent: 'TYPE', params: { value: m[1].trim(), target: m[2].trim() }, raw };

    m = text.match(/^click (?:on )?(.+)$/i);
    if (m) return { intent: 'CLICK', params: { target: m[1].trim() }, raw };

    m = text.match(/^focus (?:on )?(.+)$/i);
    if (m) return { intent: 'FOCUS', params: { target: m[1].trim() }, raw };

    if (/^(login|log in|sign in)/.test(text)) return { intent: 'LOGIN', params: {}, raw };

    m = text.match(/^(submit|send)\s*(.*)$/i);
    if (m) return { intent: 'FORM_ACTION', params: { action: m[1], target: m[2].trim() }, raw };

    if (/delete (my )?account/.test(text)) return { intent: 'FORM_ACTION', params: { action: 'delete_account', target: '' }, raw };
    if (/change (my )?password/.test(text)) return { intent: 'FORM_ACTION', params: { action: 'change_password', target: '' }, raw };
    if (/(make|send) (a )?payment|checkout|pay now/.test(text)) return { intent: 'FORM_ACTION', params: { action: 'payment', target: '' }, raw };

    return { intent: 'UNKNOWN', params: { text }, raw };
  }

  global.PrivAgentCommandParser = { parseCommand, KNOWN_SITES, extractUrl, extractSiteName };
})(window);
