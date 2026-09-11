/**
 * PrivAgent :: Dashboard
 * All Overview/Analytics numbers are computed from chrome.storage.local
 * history + settings — never randomly generated. Demo Mode swaps in a
 * clearly-labelled, separate mock dataset for presentation purposes and
 * never reads or writes real history.
 */

(function () {
  'use strict';

  const el = (id) => document.getElementById(id);
  const PII_TYPES = ['email', 'password', 'phone', 'name', 'address', 'credit_card', 'otp', 'pin', 'cvv', 'api_key', 'auth_token', 'gov_id'];

  const RISK_LEVEL = {
    email: 'MEDIUM', password: 'HIGH', phone: 'MEDIUM', name: 'LOW', address: 'LOW',
    credit_card: 'HIGH', otp: 'HIGH', pin: 'HIGH', cvv: 'HIGH', api_key: 'HIGH',
    auth_token: 'HIGH', gov_id: 'HIGH'
  };

  // ---------------- Demo dataset (never mixed with real history) ----------------
  function buildDemoHistory() {
    const now = Date.now();
    const domains = ['secureportal.example', 'shop.example', 'bank.example', 'social.example'];
    const events = [];
    let t = now;
    const sample = [
      ['pii_detected', 'Email', 'protected', 'MEDIUM'],
      ['pii_detected', 'Password', 'protected', 'HIGH'],
      ['tracker_detected', 'ads.trackernet.example', 'protected', 'MEDIUM'],
      ['pii_detected', 'Phone number', 'detected', 'MEDIUM'],
      ['voice_command', 'open_site', 'executed', 'LOW'],
      ['pii_detected', 'Credit/debit card', 'protected', 'HIGH'],
      ['setting_changed', 'masking', 'enabled', 'LOW']
    ];
    for (let i = 0; i < 24; i++) {
      const s = sample[i % sample.length];
      t -= (2 + Math.random() * 10) * 3600 * 1000;
      events.push({
        id: `demo_${i}`, timestamp: t, domain: domains[i % domains.length],
        eventType: s[0], dataType: s[1], action: s[2], riskLevel: s[3]
      });
    }
    return events;
  }

  // ---------------- Data loading ----------------
  async function loadData() {
    const settings = await self.PrivAgentStorage.getSettings();
    const demo = settings.demoMode === true;
    const history = demo ? buildDemoHistory() : await self.PrivAgentStorage.getHistory();
    return { settings, history, demo };
  }

  function computePrivacyScoreFromHistory(history, protectionMode) {
    const piiEvents = history.filter((h) => h.eventType === 'pii_detected');
    const totalDetected = piiEvents.length;
    const totalProtected = piiEvents.filter((h) => h.action === 'protected').length;
    const trackerCount = new Set(history.filter((h) => h.eventType === 'tracker_detected').map((h) => h.dataType)).size;
    let score = 100;
    score -= Math.min(40, Math.max(0, totalDetected - totalProtected) * 8);
    score -= Math.min(20, trackerCount * 5);
    if (protectionMode === 'OFF') score -= 20;
    if (protectionMode === 'SAFE') score += 5;
    return Math.max(0, Math.min(100, Math.round(score)));
  }

  // ---------------- Tab switching ----------------
  document.querySelectorAll('.nav-item').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.nav-item').forEach((b) => b.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach((p) => { p.hidden = true; });
      btn.classList.add('active');
      el(`tab-${btn.dataset.tab}`).hidden = false;
    });
  });

  // ---------------- Overview ----------------
  async function renderOverview() {
    const { settings, history, demo } = await loadData();
    el('demoBanner').hidden = !demo;

    const piiEvents = history.filter((h) => h.eventType === 'pii_detected');
    const totalDetected = piiEvents.length;
    const totalProtected = piiEvents.filter((h) => h.action === 'protected').length;
    const trackerEvents = history.filter((h) => h.eventType === 'tracker_detected');
    const voiceEvents = history.filter((h) => h.eventType === 'voice_command');
    const voiceExecuted = voiceEvents.filter((h) => h.action === 'executed').length;

    el('ov-score').textContent = String(computePrivacyScoreFromHistory(history, settings.protectionMode));
    el('ov-detected').textContent = String(totalDetected);
    el('ov-protected').textContent = String(totalProtected);
    el('ov-req-protected').textContent = String(trackerEvents.length);
    el('ov-req-blocked').textContent = '0'; // PrivAgent observes and protects, never silently blocks legitimate requests
    el('ov-thirdparty').textContent = String(trackerEvents.length);
    el('ov-mode').textContent = settings.protectionMode;
    el('ov-masking').textContent = settings.maskingEnabled ? 'ON' : 'OFF';
    el('ov-voice').textContent = `${voiceExecuted} executed`;

    el('ov-empty').hidden = history.length > 0;
  }

  // ---------------- Protection ----------------
  async function renderProtection() {
    const settings = await self.PrivAgentStorage.getSettings();
    bindToggle('p-protectionEnabled', settings.protectionEnabled, (v) => updateSetting({ protectionEnabled: v }));
    el('p-protectionMode').value = settings.protectionMode;
    bindToggle('p-piiDetectionEnabled', settings.piiDetectionEnabled, (v) => updateSetting({ piiDetectionEnabled: v }));
    bindToggle('p-thirdPartyDetectionEnabled', settings.thirdPartyDetectionEnabled, (v) => updateSetting({ thirdPartyDetectionEnabled: v }));
    bindToggle('p-networkMonitoringEnabled', settings.networkMonitoringEnabled, (v) => updateSetting({ networkMonitoringEnabled: v }));
    bindToggle('p-maskingEnabled', settings.maskingEnabled, (v) => updateSetting({ maskingEnabled: v }));
  }

  function bindToggle(id, value, onChange) {
    const btn = el(id);
    btn.setAttribute('aria-checked', String(!!value));
    btn.onclick = async () => {
      const next = btn.getAttribute('aria-checked') !== 'true';
      btn.setAttribute('aria-checked', String(next));
      await onChange(next);
      await broadcastSettings();
    };
  }

  async function updateSetting(partial) {
    await self.PrivAgentStorage.setSettings(partial);
  }

  async function broadcastSettings() {
    const settings = await self.PrivAgentStorage.getSettings();
    chrome.tabs.query({}, (tabs) => {
      tabs.forEach((t) => chrome.tabs.sendMessage(t.id, { type: 'SETTINGS_UPDATED', settings }).catch(() => {}));
    });
  }

  el('p-protectionMode').addEventListener('change', async (e) => {
    await updateSetting({ protectionMode: e.target.value });
    await broadcastSettings();
    await renderOverview();
  });

  // ---------------- History ----------------
  let historyCache = [];

  async function renderHistory() {
    const { history, demo } = await loadData();
    historyCache = history.slice().sort((a, b) => b.timestamp - a.timestamp);
    el('demoBanner').hidden = !demo;
    applyHistoryFilters();
  }

  function applyHistoryFilters() {
    const search = el('h-search').value.trim().toLowerCase();
    const eventType = el('h-eventType').value;
    const risk = el('h-risk').value;
    const action = el('h-action').value;

    const filtered = historyCache.filter((h) => {
      if (search && !h.domain.toLowerCase().includes(search)) return false;
      if (eventType && h.eventType !== eventType) return false;
      if (risk && h.riskLevel !== risk) return false;
      if (action && h.action !== action) return false;
      return true;
    });

    const list = el('historyList');
    list.innerHTML = '';
    el('h-empty').hidden = filtered.length > 0;

    filtered.forEach((h) => {
      const li = document.createElement('li');
      li.className = `history-item risk-${h.riskLevel}`;
      const title = eventTitle(h);
      const date = new Date(h.timestamp).toLocaleString();
      li.innerHTML = `
        <div class="row1"><span>${escapeHtml(title)}</span><span class="risk-pill risk-${h.riskLevel}">${h.riskLevel}</span></div>
        <div class="row2"><span>${escapeHtml(h.domain)} • ${escapeHtml(h.action)}</span><span>${escapeHtml(date)}</span></div>
      `;
      list.appendChild(li);
    });
  }

  function eventTitle(h) {
    switch (h.eventType) {
      case 'pii_detected': return `${h.dataType} detected`;
      case 'tracker_detected': return `Tracker detected: ${h.dataType}`;
      case 'voice_command': return `Voice command: ${h.dataType}`;
      case 'setting_changed': return `${h.dataType} setting changed`;
      default: return h.eventType;
    }
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  ['h-search', 'h-eventType', 'h-risk', 'h-action'].forEach((id) => {
    el(id).addEventListener('input', applyHistoryFilters);
    el(id).addEventListener('change', applyHistoryFilters);
  });

  el('h-clear').addEventListener('click', () => {
    showConfirm('Are you sure you want to clear your privacy history?', async () => {
      await self.PrivAgentStorage.clearHistory();
      await renderHistory();
      await renderOverview();
      await renderAnalytics();
    });
  });

  // ---------------- Analytics ----------------
  async function renderAnalytics() {
    const { settings, history, demo } = await loadData();
    el('demoBanner').hidden = !demo;

    const piiEvents = history.filter((h) => h.eventType === 'pii_detected');
    const totalDetected = piiEvents.length;
    const totalProtected = piiEvents.filter((h) => h.action === 'protected').length;
    const trackers = new Set(history.filter((h) => h.eventType === 'tracker_detected').map((h) => h.dataType)).size;

    el('a-total').textContent = String(totalDetected);
    el('a-protected').textContent = String(totalProtected);
    el('a-trackers').textContent = String(trackers);
    el('a-empty').hidden = history.length > 0;

    // By-type breakdown
    const byType = {};
    piiEvents.forEach((h) => { byType[h.dataType] = (byType[h.dataType] || 0) + 1; });
    const maxCount = Math.max(1, ...Object.values(byType));
    const mostCommon = Object.entries(byType).sort((a, b) => b[1] - a[1])[0];
    el('a-common').textContent = mostCommon ? mostCommon[0] : '—';

    const byTypeEl = el('a-byType');
    byTypeEl.innerHTML = '';
    Object.entries(byType).sort((a, b) => b[1] - a[1]).forEach(([type, count]) => {
      const row = document.createElement('div');
      row.className = 'bar-row';
      row.innerHTML = `<span>${escapeHtml(type)}</span>
        <div class="bar-track"><div class="bar-fill" style="width:${(count / maxCount) * 100}%"></div></div>
        <span>${count}</span>`;
      byTypeEl.appendChild(row);
    });

    // 14-day activity timeline (counts) + score trend (derived from cumulative-to-date events)
    const days = [];
    const now = new Date();
    for (let i = 13; i >= 0; i--) {
      const d = new Date(now); d.setDate(now.getDate() - i); d.setHours(0, 0, 0, 0);
      days.push(d);
    }
    const dayCounts = days.map((d) => {
      const next = new Date(d); next.setDate(d.getDate() + 1);
      return history.filter((h) => h.timestamp >= d.getTime() && h.timestamp < next.getTime()).length;
    });
    const maxDay = Math.max(1, ...dayCounts);
    const timelineEl = el('a-timeline');
    timelineEl.innerHTML = '';
    days.forEach((d, i) => {
      const col = document.createElement('div');
      col.className = 'col';
      col.innerHTML = `<div class="bar" style="height:${(dayCounts[i] / maxDay) * 70 + 2}px" title="${dayCounts[i]} events"></div>
        <span class="day-label">${d.getDate()}</span>`;
      timelineEl.appendChild(col);
    });

    // Score trend: score computed from all events up to and including each day.
    const scoreTrendEl = el('a-scoreTrend');
    scoreTrendEl.innerHTML = '';
    days.forEach((d) => {
      const cutoff = new Date(d); cutoff.setDate(d.getDate() + 1);
      const upTo = history.filter((h) => h.timestamp < cutoff.getTime());
      const score = computePrivacyScoreFromHistory(upTo, settings.protectionMode);
      const col = document.createElement('div');
      col.className = 'col';
      col.innerHTML = `<div class="bar" style="height:${(score / 100) * 70 + 2}px" title="Score ${score}"></div>
        <span class="day-label">${d.getDate()}</span>`;
      scoreTrendEl.appendChild(col);
    });
  }

  // ---------------- Settings ----------------
  async function renderSettings() {
    const settings = await self.PrivAgentStorage.getSettings();
    bindToggle('s-voiceCommandsEnabled', settings.voiceCommandsEnabled, (v) => updateSetting({ voiceCommandsEnabled: v }));
    el('s-demoMode').value = String(!!settings.demoMode);
    el('s-historyMax').value = settings.historyMax;
  }

  el('s-demoMode').addEventListener('change', async (e) => {
    await updateSetting({ demoMode: e.target.value === 'true' });
    await renderAll();
  });

  el('s-historyMax').addEventListener('change', async (e) => {
    let v = parseInt(e.target.value, 10);
    if (isNaN(v)) v = 500;
    v = Math.max(50, Math.min(500, v));
    e.target.value = v;
    await updateSetting({ historyMax: v });
  });

  el('s-clearAll').addEventListener('click', () => {
    showConfirm('This erases ALL PrivAgent settings and history and cannot be undone. Continue?', async () => {
      await self.PrivAgentStorage.clearAllData();
      await broadcastSettings();
      await renderAll();
    });
  });

  el('s-resetSettings').addEventListener('click', () => {
    showConfirm('Reset all settings to their defaults? History will be kept.', async () => {
      await self.PrivAgentStorage.resetSettings();
      await broadcastSettings();
      await renderAll();
    });
  });

  // ---------------- Confirm modal ----------------
  let confirmCallback = null;
  function showConfirm(message, onConfirm) {
    el('modalTitle').textContent = message;
    confirmCallback = onConfirm;
    el('confirmModal').hidden = false;
    el('modalConfirm').focus();
  }
  el('modalCancel').addEventListener('click', () => { el('confirmModal').hidden = true; confirmCallback = null; });
  el('modalConfirm').addEventListener('click', async () => {
    el('confirmModal').hidden = true;
    if (confirmCallback) await confirmCallback();
    confirmCallback = null;
  });

  // ---------------- Init ----------------
  async function renderAll() {
    await renderOverview();
    await renderProtection();
    await renderHistory();
    await renderAnalytics();
    await renderSettings();
  }

  renderAll();
})();
