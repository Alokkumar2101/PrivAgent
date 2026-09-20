/**
 * PrivAgent :: Voice Command Parser
 * Pure JS, no chrome.* calls — loadable in the popup (for fast, on-device
 * intent detection off interim speech results) and in the background
 * service worker (for the authoritative re-check before executing).
 *
 * Recognizes a fixed set of intents via normalized, fuzzy phrase matching
 * (not brittle exact-string matching) and returns a confidence score.
 * Anything under CONFIDENCE_THRESHOLD is UNKNOWN — the executor never
 * acts on a low-confidence guess.
 */

(function (root) {
  'use strict';

  const CONFIDENCE_THRESHOLD = 0.75;

  const FILLER_WORDS = ['please', 'can you', 'could you', 'kindly', 'just', 'hey', 'um', 'uh', 'now'];

  const SITE_MAP = {
    youtube: 'https://www.youtube.com',
    google: 'https://www.google.com',
    gmail: 'https://mail.google.com',
    github: 'https://www.github.com',
    instagram: 'https://www.instagram.com',
    linkedin: 'https://www.linkedin.com',
    chatgpt: 'https://chat.openai.com',
    wikipedia: 'https://www.wikipedia.org',
    amazon: 'https://www.amazon.com'
  };

  function normalize(text) {
    let t = (text || '').toLowerCase().trim();
    t = t.replace(/[.?!]+$/, '');
    FILLER_WORDS.forEach((f) => { t = t.replace(new RegExp(`\\b${f}\\b`, 'g'), ''); });
    t = t.replace(/\s+/g, ' ').trim();
    return t;
  }

  // Each matcher returns null or { intent, confidence, entities }.
  const MATCHERS = [
    // --- Open a known site: "open youtube" / "go to youtube" / "launch youtube" / "take me to youtube" / "visit youtube"
    (t) => {
      const m = t.match(/^(?:open|go to|launch|take me to|visit)\s+([a-z]+)$/);
      if (!m) return null;
      const site = m[1];
      if (!SITE_MAP[site]) return null; // unrecognized site name — don't guess
      return { intent: 'OPEN_WEBSITE', confidence: 0.96, entities: { site, url: SITE_MAP[site] } };
    },
    // --- Open a bare domain: "open youtube.com" / "visit github.com"
    (t) => {
      const m = t.match(/^(?:open|go to|launch|visit)\s+([a-z0-9-]+\.[a-z]{2,}(?:\.[a-z]{2,})?)$/);
      if (!m) return null;
      return { intent: 'OPEN_WEBSITE', confidence: 0.92, entities: { domain: m[1], url: `https://${m[1]}` } };
    },
    // --- YouTube search: "search youtube for react tutorials"
    (t) => {
      const m = t.match(/^search\s+youtube\s+for\s+(.+)$/);
      if (!m) return null;
      return { intent: 'SEARCH_YOUTUBE', confidence: 0.94, entities: { query: m[1].trim() } };
    },
    // --- Google search: several common phrasings
    (t) => {
      let m = t.match(/^search\s+google\s+for\s+(.+)$/) ||
              t.match(/^google\s+search\s+(.+)$/) ||
              t.match(/^search\s+for\s+(.+)$/) ||
              t.match(/^find\s+(.+?)(?:\s+on\s+google)?$/);
      if (!m) return null;
      return { intent: 'SEARCH_GOOGLE', confidence: 0.88, entities: { query: m[1].trim() } };
    },
    // --- Navigation
    (t) => (/^(?:go\s+)?back$/.test(t) ? { intent: 'TAB_BACK', confidence: 0.95, entities: {} } : null),
    (t) => (/^(?:go\s+)?forward$/.test(t) ? { intent: 'TAB_FORWARD', confidence: 0.95, entities: {} } : null),
    (t) => (/^(?:reload|refresh)(?:\s+(?:this\s+)?page)?$/.test(t) ? { intent: 'RELOAD', confidence: 0.95, entities: {} } : null),
    // --- Tabs
    (t) => (/^(?:open\s+)?(?:a\s+)?new\s+tab$/.test(t) ? { intent: 'NEW_TAB', confidence: 0.95, entities: {} } : null),
    (t) => (/^close\s+(?:this\s+)?tab$/.test(t) ? { intent: 'CLOSE_TAB', confidence: 0.95, entities: {} } : null),
    // --- Scrolling
    (t) => (/^scroll\s+down$/.test(t) ? { intent: 'SCROLL_DOWN', confidence: 0.9, entities: {} } : null),
    (t) => (/^scroll\s+up$/.test(t) ? { intent: 'SCROLL_UP', confidence: 0.9, entities: {} } : null),
    (t) => (/^go\s+to\s+bottom$/.test(t) ? { intent: 'SCROLL_BOTTOM', confidence: 0.85, entities: {} } : null),
    (t) => (/^go\s+to\s+top$/.test(t) ? { intent: 'SCROLL_TOP', confidence: 0.85, entities: {} } : null),
    // --- PrivAgent UI/state commands
    (t) => (/^open\s+dashboard$/.test(t) ? { intent: 'OPEN_DASHBOARD', confidence: 0.93, entities: {} } : null),
    (t) => (/^open\s+settings$/.test(t) ? { intent: 'OPEN_SETTINGS', confidence: 0.93, entities: {} } : null),
    (t) => (/^show\s+activity$/.test(t) ? { intent: 'SHOW_ACTIVITY', confidence: 0.93, entities: {} } : null),
    (t) => (/^enable\s+protection$/.test(t) ? { intent: 'ENABLE_PROTECTION', confidence: 0.93, entities: {} } : null),
    (t) => (/^disable\s+protection$/.test(t) ? { intent: 'DISABLE_PROTECTION', confidence: 0.93, entities: {} } : null)
  ];

  function parseCommand(rawText) {
    const norm = normalize(rawText);
    if (!norm) return { intent: 'UNKNOWN', confidence: 0, entities: {}, raw: rawText, norm };
    for (const matcher of MATCHERS) {
      const result = matcher(norm);
      if (result) return { ...result, raw: rawText, norm };
    }
    return { intent: 'UNKNOWN', confidence: 0, entities: {}, raw: rawText, norm };
  }

  function isConfident(parsed) {
    return !!parsed && parsed.intent !== 'UNKNOWN' && parsed.confidence >= CONFIDENCE_THRESHOLD;
  }

  root.PrivAgentCommandParser = { CONFIDENCE_THRESHOLD, SITE_MAP, normalize, parseCommand, isConfident };
})(typeof self !== 'undefined' ? self : window);
