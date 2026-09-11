/**
 * PrivAgent :: Popup Controller
 * Pure status + quick controls. No command input, no history, no charts.
 */

const els = {
  protectionDot: document.getElementById('protectionDot'),
  protectionStatusText: document.getElementById('protectionStatusText'),
  currentDomain: document.getElementById('currentDomain'),
  privacyScore: document.getElementById('privacyScore'),
  scoreEmptyNote: document.getElementById('scoreEmptyNote'),
  piiEmail: document.getElementById('piiEmail'),
  piiPassword: document.getElementById('piiPassword'),
  piiPhone: document.getElementById('piiPhone'),
  piiName: document.getElementById('piiName'),
  piiEmptyNote: document.getElementById('piiEmptyNote'),
  maskingToggle: document.getElementById('maskingToggle'),
  thirdPartyRow: document.getElementById('thirdPartyRow'),
  tpEmptyNote: document.getElementById('tpEmptyNote'),
  protectionMode: document.getElementById('protectionMode'),
  openDashboardBtn: document.getElementById('openDashboardBtn')
};

function sendMessage(message) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (res) => {
      if (chrome.runtime.lastError) {
        resolve({ ok: false, message: chrome.runtime.lastError.message });
        return;
      }
      resolve(res || { ok: false });
    });
  });
}

function renderState(state, settings) {
  const protectionOn = settings.protectionEnabled;
  els.protectionDot.classList.toggle('inactive', !protectionOn);
  els.protectionStatusText.textContent = protectionOn ? 'Privacy Protection Active' : 'Privacy Protection Inactive';

  els.currentDomain.textContent = state.domain || 'Unavailable on this page';

  if (state.privacyScore === null || state.privacyScore === undefined) {
    els.privacyScore.textContent = '—';
    els.scoreEmptyNote.classList.remove('hidden');
  } else {
    els.privacyScore.textContent = state.privacyScore;
    els.scoreEmptyNote.classList.add('hidden');
  }

  const detected = state.detected || {};
  const protectedCounts = state.protectedCounts || {};
  els.piiEmail.textContent = protectedCounts.email || 0;
  els.piiPassword.textContent = protectedCounts.password || 0;
  els.piiPhone.textContent = protectedCounts.phone || 0;
  els.piiName.textContent = protectedCounts.name || 0;

  const totalDetected = Object.values(detected).reduce((a, b) => a + b, 0);
  els.piiEmptyNote.classList.toggle('hidden', totalDetected !== 0);

  const tp = state.thirdParty || { thirdParty: 0 };
  if (tp.thirdParty === 0) {
    els.thirdPartyRow.classList.add('hidden');
    els.tpEmptyNote.classList.remove('hidden');
  } else {
    els.thirdPartyRow.classList.remove('hidden');
    els.tpEmptyNote.classList.add('hidden');
    els.thirdPartyRow.textContent = `${tp.thirdParty} detected${tp.blocked ? ` · ${tp.blocked} blocked` : ''}`;
  }

  els.maskingToggle.setAttribute('aria-checked', String(!!settings.maskingEnabled));
  els.protectionMode.value = settings.protectionMode || 'BALANCED';
}

async function refresh() {
  const res = await sendMessage({ type: 'GET_POPUP_STATE' });
  if (!res || !res.ok) {
    els.currentDomain.textContent = 'Unavailable on this page';
    return;
  }
  renderState(res.state, res.state.settings);
}

els.maskingToggle.addEventListener('click', async () => {
  const next = els.maskingToggle.getAttribute('aria-checked') !== 'true';
  els.maskingToggle.setAttribute('aria-checked', String(next));
  await sendMessage({ type: 'SET_SETTINGS', partial: { maskingEnabled: next } });
  refresh();
});

els.protectionMode.addEventListener('change', async () => {
  await sendMessage({ type: 'SET_SETTINGS', partial: { protectionMode: els.protectionMode.value } });
  refresh();
});

els.openDashboardBtn.addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('dashboard/dashboard.html') });
});

refresh();
