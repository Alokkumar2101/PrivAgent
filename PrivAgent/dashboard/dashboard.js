/**
 * PrivAgent :: Dashboard Controller
 * Overview / Protection / History / Analytics / Settings — all backed by
 * real chrome.storage.local data (history + settings) plus the last known
 * live tab scan summary from the background service worker. No fabricated
 * numbers, ever.
 */

function sendMessage(message) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (res) => {
      if (chrome.runtime.lastError) { resolve({ ok: false }); return; }
      resolve(res || { ok: false });
    });
  });
}

// ---------- Navigation ----------
const navItems = document.querySelectorAll('.nav-item');
const views = document.querySelectorAll('.view');
navItems.forEach((btn) => {
  btn.addEventListener('click', () => {
    navItems.forEach((b) => b.classList.remove('active'));
    views.forEach((v) => v.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(`view-${btn.dataset.view}`).classList.add('active');
    if (btn.dataset.view === 'history') loadHistory();
    if (btn.dataset.view === 'analytics') loadAnalytics();
    if (btn.dataset.view === 'protection' || btn.dataset.view === 'settings') loadSettingsUI();
  });
});

// ---------- Confirm modal ----------
const confirmModal = document.getElementById('confirmModal');
function askConfirm(title, body) {
  return new Promise((resolve) => {
    document.getElementById('confirmTitle').textContent = title;
    document.getElementById('confirmBody').textContent = body;
    confirmModal.classList.remove('hidden');
    const cancel = document.getElementById('confirmCancel');
    const ok = document.getElementById('confirmOk');
    const cleanup = () => { confirmModal.classList.add('hidden'); cancel.onclick = null; ok.onclick = null; };
    cancel.onclick = () => { cleanup(); resolve(false); };
    ok.onclick = () => { cleanup(); resolve(true); };
  });
}

// ---------- Overview ----------
async function loadOverview() {
  const [historyRes, lastTabRes] = await Promise.all([
    sendMessage({ type: 'GET_HISTORY' }),
    sendMessage({ type: 'GET_LAST_TAB_STATE' })
  ]);
  const history = (historyRes && historyRes.history) || [];
  const state = (lastTabRes && lastTabRes.state) || {};

  document.getElementById('overviewSubtitle').textContent = state.domain
    ? `Most recently scanned page: ${state.domain}`
    : 'No page scanned yet — browse to a website to see live data here.';

  document.getElementById('ovScore').textContent = (state.privacyScore ?? '—');

  const detectedEvents = history.filter((h) => h.eventType === 'Sensitive Data Detected');
  document.getElementById('ovDetected').textContent = detectedEvents.length;
  document.getElementById('ovProtected').textContent = detectedEvents.filter((h) => h.action === 'Protected').length;
  document.getElementById('ovProtectedReq').textContent = history.filter((h) => h.action === 'Blocked' && h.eventType !== 'Sensitive Data Detected').length + detectedEvents.filter(h => h.action === 'Protected').length;
  document.getElementById('ovBlockedReq').textContent = history.filter((h) => h.action === 'Blocked').length;
  document.getElementById('ovThirdParty').textContent = (state.thirdParty && state.thirdParty.thirdParty) || 0;

  document.getElementById('ovEmptyState').classList.toggle('show', history.length === 0 && !state.domain);
}

// ---------- Protection & Settings shared controls ----------
const CATEGORY_LIST = [
  ['email', 'Email'], ['phone', 'Phone'], ['name', 'Name'], ['password', 'Password'],
  ['otp', 'OTP'], ['cvv', 'CVV'], ['address', 'Address'], ['aadhaar', 'Aadhaar-like ID'],
  ['pan', 'PAN-like ID'], ['card', 'Card Number'], ['bank', 'Bank Info'],
  ['auth_token', 'Auth Token'], ['medical', 'Medical Info']
];

async function loadSettingsUI() {
  const res = await sendMessage({ type: 'GET_SETTINGS' });
  const settings = (res && res.settings) || PrivAgentStorage.DEFAULT_SETTINGS;

  setSwitch('protectionToggle', settings.protectionEnabled);
  document.getElementById('modeSelect').value = settings.protectionMode;
  setSwitch('maskingToggleDash', settings.maskingEnabled);
  setSwitch('tpMonitorToggle', settings.thirdPartyMonitoring);
  setSwitch('demoModeToggle', settings.demoMode);

  const grid = document.getElementById('categoryGrid');
  grid.innerHTML = CATEGORY_LIST.map(([key, label]) => `
    <label class="checkbox-item">
      <input type="checkbox" data-cat="${key}" ${settings.detectionCategories[key] !== false ? 'checked' : ''} />
      ${label}
    </label>
  `).join('');
  grid.querySelectorAll('input[type=checkbox]').forEach((cb) => {
    cb.addEventListener('change', async () => {
      const partial = { detectionCategories: { [cb.dataset.cat]: cb.checked } };
      await sendMessage({ type: 'SET_SETTINGS', partial });
    });
  });
}

function setSwitch(id, value) {
  document.getElementById(id).setAttribute('aria-checked', String(!!value));
}

function wireSwitch(id, key) {
  const el = document.getElementById(id);
  el.addEventListener('click', async () => {
    const next = el.getAttribute('aria-checked') !== 'true';
    el.setAttribute('aria-checked', String(next));
    await sendMessage({ type: 'SET_SETTINGS', partial: { [key]: next } });
  });
}

wireSwitch('protectionToggle', 'protectionEnabled');
wireSwitch('maskingToggleDash', 'maskingEnabled');
wireSwitch('tpMonitorToggle', 'thirdPartyMonitoring');
wireSwitch('demoModeToggle', 'demoMode');

document.getElementById('modeSelect').addEventListener('change', async (e) => {
  await sendMessage({ type: 'SET_SETTINGS', partial: { protectionMode: e.target.value } });
});

// ---------- History ----------
let fullHistory = [];

async function loadHistory() {
  const res = await sendMessage({ type: 'GET_HISTORY' });
  fullHistory = (res && res.history) || [];
  populateFilterOptions();
  renderHistory();
}

function populateFilterOptions() {
  const eventTypes = [...new Set(fullHistory.map((h) => h.eventType))];
  const dataTypes = [...new Set(fullHistory.map((h) => h.dataType).filter(Boolean))];
  const risks = [...new Set(fullHistory.map((h) => h.riskLevel))];
  const actions = [...new Set(fullHistory.map((h) => h.action))];

  fillSelect('filterEventType', eventTypes);
  fillSelect('filterDataType', dataTypes);
  fillSelect('filterRisk', risks);
  fillSelect('filterAction', actions);
}

function fillSelect(id, values) {
  const el = document.getElementById(id);
  const current = el.value;
  const firstOption = el.querySelector('option');
  el.innerHTML = '';
  el.appendChild(firstOption);
  values.forEach((v) => {
    const opt = document.createElement('option');
    opt.value = v; opt.textContent = v;
    el.appendChild(opt);
  });
  if (values.includes(current)) el.value = current;
}

function renderHistory() {
  const search = document.getElementById('searchInput').value.trim().toLowerCase();
  const eventType = document.getElementById('filterEventType').value;
  const dataType = document.getElementById('filterDataType').value;
  const risk = document.getElementById('filterRisk').value;
  const action = document.getElementById('filterAction').value;

  const filtered = fullHistory.filter((h) => {
    if (search && !h.domain.toLowerCase().includes(search)) return false;
    if (eventType && h.eventType !== eventType) return false;
    if (dataType && h.dataType !== dataType) return false;
    if (risk && h.riskLevel !== risk) return false;
    if (action && h.action !== action) return false;
    return true;
  });

  const list = document.getElementById('historyList');
  if (filtered.length === 0) {
    list.innerHTML = '<div class="history-empty">No privacy activity yet</div>';
    return;
  }

  list.innerHTML = filtered.map((h) => {
    const date = new Date(h.timestamp);
    const dateStr = date.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
    const timeStr = date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    const title = h.dataType ? `${labelForType(h.dataType)} ${h.eventType === 'Sensitive Data Detected' ? 'detected' : h.eventType.toLowerCase()}` : h.eventType;
    return `
      <div class="history-item">
        <div class="history-left">
          <span class="history-risk ${h.riskLevel}">${riskIcon(h.riskLevel)} ${h.riskLevel}</span>
          <span class="history-title">${title}</span>
          <span class="history-domain">${h.domain}</span>
        </div>
        <div class="history-right">
          <div class="history-action">${h.action}</div>
          <div>${dateStr} • ${timeStr}</div>
        </div>
      </div>
    `;
  }).join('');
}

function riskIcon(level) {
  if (level === 'HIGH') return '🔴';
  if (level === 'MEDIUM') return '🟡';
  return '⚪';
}

function labelForType(type) {
  const map = { email: 'Email', password: 'Password', phone: 'Phone', name: 'Name', otp: 'OTP',
    cvv: 'CVV', address: 'Address', aadhaar: 'Aadhaar-like ID', pan: 'PAN-like ID',
    card: 'Card number', bank: 'Bank info', auth_token: 'Auth token', medical: 'Medical info' };
  return map[type] || type;
}

['searchInput', 'filterEventType', 'filterDataType', 'filterRisk', 'filterAction'].forEach((id) => {
  document.getElementById(id).addEventListener('input', renderHistory);
  document.getElementById(id).addEventListener('change', renderHistory);
});

async function clearHistoryFlow() {
  const confirmed = await askConfirm('Are you sure you want to clear your privacy history?', 'This cannot be undone. Your settings will not be affected.');
  if (!confirmed) return;
  await sendMessage({ type: 'CLEAR_HISTORY' });
  loadHistory();
  loadOverview();
}
document.getElementById('clearHistoryBtn').addEventListener('click', clearHistoryFlow);
document.getElementById('clearHistoryBtn2').addEventListener('click', clearHistoryFlow);

document.getElementById('resetSettingsBtn').addEventListener('click', async () => {
  const confirmed = await askConfirm('Reset settings to default?', 'Protection, masking, and detection category settings will be restored to their defaults. History is not affected.');
  if (!confirmed) return;
  await sendMessage({ type: 'RESET_SETTINGS' });
  loadSettingsUI();
});

document.getElementById('clearAllDataBtn').addEventListener('click', async () => {
  const confirmed = await askConfirm('Clear ALL local PrivAgent data?', 'This clears settings AND history permanently. This cannot be undone.');
  if (!confirmed) return;
  await sendMessage({ type: 'CLEAR_ALL_DATA' });
  loadSettingsUI();
  loadHistory();
  loadOverview();
});

// ---------- Analytics ----------
async function loadAnalytics() {
  const res = await sendMessage({ type: 'GET_HISTORY' });
  const history = (res && res.history) || [];
  renderByType(history);
  renderByRisk(history);
  renderDaily(history);
}

function renderBarChart(containerId, entries) {
  const container = document.getElementById(containerId);
  if (entries.length === 0) {
    container.innerHTML = '<div class="bar-empty">No activity yet</div>';
    return;
  }
  const max = Math.max(...entries.map((e) => e.count), 1);
  container.innerHTML = entries.map((e) => `
    <div class="bar-row">
      <span>${e.label}</span>
      <div class="bar-track"><div class="bar-fill" style="width:${Math.round((e.count / max) * 100)}%"></div></div>
      <span>${e.count}</span>
    </div>
  `).join('');
}

function renderByType(history) {
  const counts = {};
  history.filter((h) => h.dataType).forEach((h) => { counts[h.dataType] = (counts[h.dataType] || 0) + 1; });
  const entries = Object.entries(counts).map(([type, count]) => ({ label: labelForType(type), count }))
    .sort((a, b) => b.count - a.count);
  renderBarChart('chartByType', entries);
}

function renderByRisk(history) {
  const order = ['HIGH', 'MEDIUM', 'LOW'];
  const counts = { HIGH: 0, MEDIUM: 0, LOW: 0 };
  history.forEach((h) => { if (counts[h.riskLevel] !== undefined) counts[h.riskLevel]++; });
  const entries = order.filter((k) => counts[k] > 0).map((k) => ({ label: k, count: counts[k] }));
  renderBarChart('chartByRisk', entries);
}

function renderDaily(history) {
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    days.push(d.toISOString().slice(0, 10));
  }
  const counts = Object.fromEntries(days.map((d) => [d, 0]));
  history.forEach((h) => {
    const day = h.timestamp.slice(0, 10);
    if (counts[day] !== undefined) counts[day]++;
  });
  const entries = days.map((d) => ({ label: d.slice(5), count: counts[d] }));
  const hasActivity = entries.some((e) => e.count > 0);
  if (!hasActivity) {
    document.getElementById('chartDaily').innerHTML = '<div class="bar-empty">No activity yet</div>';
    return;
  }
  renderBarChart('chartDaily', entries);
}

// ---------- Init ----------
loadOverview();
loadSettingsUI();
