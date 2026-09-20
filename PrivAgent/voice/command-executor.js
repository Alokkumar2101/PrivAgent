/**
 * PrivAgent :: Voice Command Executor
 * Background-service-worker-only. Takes an already-parsed, already
 * confidence-checked intent (see command-parser.js) and performs the
 * single corresponding browser action. No branch here ever evaluates a
 * string as code or opens a URL that didn't come from the fixed SITE_MAP
 * or a sanitized search-query template — there is no path from spoken
 * text to arbitrary code or an arbitrary raw URL.
 */

(function (root) {
  'use strict';

  async function scrollTab(tabId, direction) {
    if (tabId == null) return;
    await chrome.scripting.executeScript({
      target: { tabId },
      func: (dir) => {
        if (dir === 'down') window.scrollBy({ top: window.innerHeight * 0.8, behavior: 'smooth' });
        else if (dir === 'up') window.scrollBy({ top: -window.innerHeight * 0.8, behavior: 'smooth' });
        else if (dir === 'bottom') window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
        else if (dir === 'top') window.scrollTo({ top: 0, behavior: 'smooth' });
      },
      args: [direction]
    });
  }

  /**
   * execute(parsed, ctx) -> { ok, message }
   * ctx: { tabId }
   */
  async function execute(parsed, ctx) {
    const tabId = ctx.tabId;
    try {
      switch (parsed.intent) {
        case 'OPEN_WEBSITE': {
          const url = parsed.entities.url;
          await chrome.tabs.create({ url });
          return { ok: true, message: `Opened ${(parsed.entities.site || parsed.entities.domain || url).replace(/^https?:\/\//, '')}` };
        }
        case 'SEARCH_YOUTUBE': {
          const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(parsed.entities.query)}`;
          await chrome.tabs.create({ url });
          return { ok: true, message: `Searched YouTube for "${parsed.entities.query}"` };
        }
        case 'SEARCH_GOOGLE': {
          const url = `https://www.google.com/search?q=${encodeURIComponent(parsed.entities.query)}`;
          await chrome.tabs.create({ url });
          return { ok: true, message: `Searched Google for "${parsed.entities.query}"` };
        }
        case 'TAB_BACK':
          if (tabId != null) await chrome.tabs.goBack(tabId);
          return { ok: true, message: 'Navigated back' };
        case 'TAB_FORWARD':
          if (tabId != null) await chrome.tabs.goForward(tabId);
          return { ok: true, message: 'Navigated forward' };
        case 'RELOAD':
          if (tabId != null) await chrome.tabs.reload(tabId);
          return { ok: true, message: 'Page reloaded' };
        case 'NEW_TAB':
          await chrome.tabs.create({});
          return { ok: true, message: 'New tab opened' };
        case 'CLOSE_TAB':
          if (tabId != null) await chrome.tabs.remove(tabId);
          return { ok: true, message: 'Tab closed' };
        case 'SCROLL_DOWN':
          await scrollTab(tabId, 'down');
          return { ok: true, message: 'Scrolled down' };
        case 'SCROLL_UP':
          await scrollTab(tabId, 'up');
          return { ok: true, message: 'Scrolled up' };
        case 'SCROLL_BOTTOM':
          await scrollTab(tabId, 'bottom');
          return { ok: true, message: 'Scrolled to bottom' };
        case 'SCROLL_TOP':
          await scrollTab(tabId, 'top');
          return { ok: true, message: 'Scrolled to top' };
        case 'OPEN_DASHBOARD':
          await chrome.tabs.create({ url: chrome.runtime.getURL('dashboard/dashboard.html#overview') });
          return { ok: true, message: 'Opened dashboard' };
        case 'OPEN_SETTINGS':
          await chrome.tabs.create({ url: chrome.runtime.getURL('dashboard/dashboard.html#settings') });
          return { ok: true, message: 'Opened settings' };
        case 'SHOW_ACTIVITY':
          await chrome.tabs.create({ url: chrome.runtime.getURL('dashboard/dashboard.html#activity') });
          return { ok: true, message: 'Opened activity' };
        case 'ENABLE_PROTECTION': {
          const settings = await self.PrivAgentStorage.setSettings({ protectionEnabled: true });
          await broadcastSettings(settings);
          return { ok: true, message: 'Protection enabled' };
        }
        case 'DISABLE_PROTECTION': {
          const settings = await self.PrivAgentStorage.setSettings({ protectionEnabled: false });
          await broadcastSettings(settings);
          return { ok: true, message: 'Protection disabled' };
        }
        default:
          return { ok: false, message: 'Command not supported.' };
      }
    } catch (e) {
      console.error('PrivAgent voice execution error:', e);
      return { ok: false, message: 'Could not execute that command.' };
    }
  }

  async function broadcastSettings(settings) {
    const tabs = await chrome.tabs.query({});
    tabs.forEach((t) => { chrome.tabs.sendMessage(t.id, { type: 'SETTINGS_UPDATED', settings }).catch(() => {}); });
  }

  root.PrivAgentCommandExecutor = { execute };
})(self);
