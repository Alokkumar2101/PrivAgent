/**
 * PrivAgent :: Background Service Worker (MV3)
 * Handles tab-level browser control (chrome.tabs) and relays messages
 * between the popup and the active tab's content script. Also maintains
 * a rolling in-memory + storage log of command history and PII/ injection
 * events for the dashboard.
 */

const SERVER_BASE_URL = 'http://127.0.0.1:8000';

const ALLOWED_TAB_ACTIONS = new Set([
  'navigate', 'go_back', 'go_forward', 'refresh', 'open_new_tab', 'close_tab'
]);

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function appendHistory(entry) {
  const { history = [] } = await chrome.storage.local.get('history');
  history.unshift({ ...entry, timestamp: new Date().toISOString() });
  await chrome.storage.local.set({ history: history.slice(0, 50) });
}

async function appendEventLog(entry) {
  const { events = [] } = await chrome.storage.local.get('events');
  events.unshift({ ...entry, timestamp: new Date().toISOString() });
  await chrome.storage.local.set({ events: events.slice(0, 100) });
}

async function executeTabAction(action) {
  if (!ALLOWED_TAB_ACTIONS.has(action.type)) {
    return { success: false, message: `Tab action "${action.type}" not allowed here` };
  }
  const tab = await getActiveTab();

  switch (action.type) {
    case 'navigate': {
      if (!tab) {
        const newTab = await chrome.tabs.create({ url: action.payload.url });
        return { success: true, message: `Opened new tab: ${action.payload.url}`, tabId: newTab.id };
      }
      await chrome.tabs.update(tab.id, { url: action.payload.url });
      return { success: true, message: `Navigated to ${action.payload.url}` };
    }
    case 'go_back':
      await chrome.tabs.goBack(tab.id);
      return { success: true, message: 'Went back' };
    case 'go_forward':
      await chrome.tabs.goForward(tab.id);
      return { success: true, message: 'Went forward' };
    case 'refresh':
      await chrome.tabs.reload(tab.id);
      return { success: true, message: 'Page refreshed' };
    case 'open_new_tab': {
      const t = await chrome.tabs.create({ url: 'chrome://newtab' });
      return { success: true, message: 'Opened new tab', tabId: t.id };
    }
    case 'close_tab':
      await chrome.tabs.remove(tab.id);
      return { success: true, message: 'Tab closed' };
    default:
      return { success: false, message: 'Unhandled tab action' };
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    switch (message.type) {
      case 'RUN_ACTION': {
        const { action } = message;
        let result;
        if (ALLOWED_TAB_ACTIONS.has(action.type)) {
          result = await executeTabAction(action);
        } else {
          const tab = await getActiveTab();
          if (!tab) {
            result = { success: false, message: 'No active tab' };
          } else {
            try {
              result = await chrome.tabs.sendMessage(tab.id, { type: 'EXECUTE_DOM_ACTION', action });
            } catch (e) {
              result = { success: false, message: 'Could not reach page content script (try reloading the tab).' };
            }
          }
        }
        await appendHistory({ action: action.type, payload: action.payload, result });
        sendResponse(result);
        break;
      }

      case 'GET_HISTORY': {
        const { history = [] } = await chrome.storage.local.get('history');
        sendResponse({ history });
        break;
      }

      case 'GET_EVENTS': {
        const { events = [] } = await chrome.storage.local.get('events');
        sendResponse({ events });
        break;
      }

      case 'PII_AMBIENT_DETECTED':
        await appendEventLog({ kind: 'pii_detected', count: message.count, host: message.host });
        sendResponse({ ok: true });
        break;

      case 'INJECTION_AMBIENT_DETECTED':
        await appendEventLog({ kind: 'injection_detected', hits: message.hits.length, host: message.host });
        sendResponse({ ok: true });
        break;

      case 'FORWARD_TO_ACTIVE_TAB': {
        const tab = await getActiveTab();
        if (!tab) { sendResponse({ ok: false, message: 'No active tab' }); break; }
        try {
          const result = await chrome.tabs.sendMessage(tab.id, message.payload);
          sendResponse({ ok: true, result });
        } catch (e) {
          sendResponse({ ok: false, message: 'Content script not reachable on this page.' });
        }
        break;
      }

      case 'GET_SERVER_BASE_URL':
        sendResponse({ url: SERVER_BASE_URL });
        break;

      case 'SERVER_EVENT_LOG':
        await appendEventLog({ kind: message.kind, detail: message.detail });
        sendResponse({ ok: true });
        break;

      default:
        sendResponse({ ok: false, message: 'Unknown message type' });
    }
  })();
  return true; // keep the message channel open for async response
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({ history: [], events: [] });
});
