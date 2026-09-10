const SERVER_BASE_URL = 'http://127.0.0.1:8000';

const els = {
  serverBadge: document.getElementById('serverBadge'),
  statDetected: document.getElementById('statDetected'),
  statBlocked: document.getElementById('statBlocked'),
  statRequests: document.getElementById('statRequests'),
  statScore: document.getElementById('statScore'),
  piiTable: document.getElementById('piiTable'),
  sentPayload: document.getElementById('sentPayload'),
  eventLog: document.getElementById('eventLog'),
  rescanBtn: document.getElementById('rescanBtn'),
  refreshBtn: document.getElementById('refreshBtn')
};

let requestCount = 0;

async function checkServer() {
  try {
    const res = await fetch(`${SERVER_BASE_URL}/health`);
    const data = await res.json();
    els.serverBadge.textContent = `server online · ${data.requests_received} requests logged`;
    els.serverBadge.className = 'badge online';
  } catch (e) {
    els.serverBadge.textContent = 'server offline';
    els.serverBadge.className = 'badge offline';
  }
}

async function scanActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;
  try {
    const piiRes = await chrome.tabs.sendMessage(tab.id, { type: 'SCAN_PII' });
    renderPii(piiRes);

    const ctxRes = await chrome.tabs.sendMessage(tab.id, { type: 'BUILD_SANITIZED_CONTEXT', task: 'dashboard_preview' });
    if (ctxRes && ctxRes.ok) {
      els.sentPayload.textContent = JSON.stringify(ctxRes.context, null, 2);
    }
  } catch (e) {
    addEvent('info', 'Could not reach content script on this tab (try reloading it).');
  }
}

function renderPii(piiRes) {
  const counts = { email: 0, password: 0, name: 0, phone: 0 };
  let total = 0;
  if (piiRes && piiRes.ok) {
    piiRes.items.forEach((i) => { if (counts[i.type] !== undefined) counts[i.type]++; total++; });
  }
  els.piiTable.innerHTML = Object.entries(counts).map(([type, count]) => `
    <div class="pii-row"><span>${type[0].toUpperCase() + type.slice(1)}</span><b>${count > 0 ? '✓ Protected (' + count + ')' : '—'}</b></div>
  `).join('');
  els.statDetected.textContent = total;
  els.statBlocked.textContent = total;
  els.statScore.textContent = total > 0 ? '100%' : '—';
}

function addEvent(kind, text) {
  const empty = els.eventLog.querySelector('.event-empty');
  if (empty) empty.remove();
  const item = document.createElement('div');
  item.className = 'event-item';
  const cls = kind === 'pii' ? 'kind-pii' : kind === 'injection' ? 'kind-injection' : kind === 'request' ? 'kind-request' : '';
  item.innerHTML = `<span class="${cls}">${text}</span><span>${new Date().toLocaleTimeString()}</span>`;
  els.eventLog.prepend(item);
}

async function loadEventHistory() {
  chrome.runtime.sendMessage({ type: 'GET_EVENTS' }, (res) => {
    const events = (res && res.events) || [];
    if (events.length === 0) return;
    els.eventLog.innerHTML = '';
    events.slice(0, 20).forEach((e) => {
      let text = '';
      let kind = 'info';
      if (e.kind === 'pii_detected') { text = `🔎 PII auto-detected on ${e.host} — ${e.count} field(s)`; kind = 'pii'; }
      else if (e.kind === 'injection_detected') { text = `⚠ Prompt injection detected on ${e.host} — ${e.hits} pattern(s)`; kind = 'injection'; }
      else { text = `${e.kind}: ${JSON.stringify(e.detail || {})}`; kind = 'request'; }
      const item = document.createElement('div');
      item.className = 'event-item';
      const cls = kind === 'pii' ? 'kind-pii' : kind === 'injection' ? 'kind-injection' : 'kind-request';
      item.innerHTML = `<span class="${cls}">${text}</span><span>${new Date(e.timestamp).toLocaleTimeString()}</span>`;
      els.eventLog.appendChild(item);
    });
  });
}

els.rescanBtn.addEventListener('click', scanActiveTab);
els.refreshBtn.addEventListener('click', () => {
  checkServer();
  scanActiveTab();
  loadEventHistory();
});

checkServer();
scanActiveTab();
loadEventHistory();
setInterval(checkServer, 6000);
