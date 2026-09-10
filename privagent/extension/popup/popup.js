/**
 * PrivAgent :: Popup Controller
 */

const SERVER_BASE_URL = 'http://127.0.0.1:8000';

const els = {
  voiceBtn: document.getElementById('voiceBtn'),
  voiceStatus: document.getElementById('voiceStatus'),
  voiceTranscript: document.getElementById('voiceTranscript'),
  commandResult: document.getElementById('commandResult'),
  textCmdInput: document.getElementById('textCmdInput'),
  textCmdBtn: document.getElementById('textCmdBtn'),
  scanBtn: document.getElementById('scanBtn'),
  sendBtn: document.getElementById('sendBtn'),
  planBtn: document.getElementById('planBtn'),
  dashboardBtn: document.getElementById('dashboardBtn'),
  historyList: document.getElementById('historyList'),
  serverStatus: document.getElementById('serverStatus'),
  approvalModal: document.getElementById('approvalModal'),
  approvalAction: document.getElementById('approvalAction'),
  approvalRisk: document.getElementById('approvalRisk'),
  approvalReason: document.getElementById('approvalReason'),
  approveCancel: document.getElementById('approveCancel'),
  approveOk: document.getElementById('approveOk'),
  piiEmail: document.getElementById('piiEmail'),
  piiPassword: document.getElementById('piiPassword'),
  piiName: document.getElementById('piiName'),
  piiPhone: document.getElementById('piiPhone')
};

function setServerStatus(online) {
  els.serverStatus.textContent = online ? 'server online (127.0.0.1:8000)' : 'server offline — start FastAPI backend';
  els.serverStatus.className = 'server-status ' + (online ? 'online' : 'offline');
}

async function checkServer() {
  try {
    const res = await fetch(`${SERVER_BASE_URL}/health`, { method: 'GET' });
    setServerStatus(res.ok);
  } catch (e) {
    setServerStatus(false);
  }
}

function showCommandResult(text, isError = false) {
  els.commandResult.textContent = text;
  els.commandResult.className = 'command-result' + (isError ? ' error' : '');
  els.commandResult.classList.remove('hidden');
}

async function sendToActiveTab(message) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: 'FORWARD_TO_ACTIVE_TAB', payload: message }, (res) => {
      resolve(res);
    });
  });
}

async function runAction(action) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: 'RUN_ACTION', action }, (res) => resolve(res));
  });
}

async function refreshHistory() {
  chrome.runtime.sendMessage({ type: 'GET_HISTORY' }, (res) => {
    const history = (res && res.history) || [];
    if (history.length === 0) {
      els.historyList.innerHTML = '<div class="history-empty">No commands yet — try the voice or text command above.</div>';
      return;
    }
    els.historyList.innerHTML = history.slice(0, 8).map((h) => {
      const ok = h.result && h.result.success;
      return `<div class="history-item">🎙 ${h.action.replace(/_/g, ' ')} — <span class="${ok ? 'ok' : 'fail'}">${ok ? '✓ Executed' : '✗ Failed'}</span></div>`;
    }).join('');
  });
}

async function refreshPiiCounts() {
  const res = await sendToActiveTab({ type: 'SCAN_PII' });
  const items = (res && res.ok && res.result && res.result.items) || [];
  const counts = { email: 0, password: 0, name: 0, phone: 0 };
  items.forEach((i) => { if (counts[i.type] !== undefined) counts[i.type]++; });
  els.piiEmail.textContent = counts.email;
  els.piiPassword.textContent = counts.password;
  els.piiName.textContent = counts.name;
  els.piiPhone.textContent = counts.phone;
}

async function executeParsedCommand(parsed, sourceLabel) {
  const actions = PrivAgentIntentEngine.buildActions(parsed);

  if (actions.length === 0) {
    showCommandResult(`⚠ Could not understand: "${parsed.raw}"`, true);
    return;
  }

  for (const action of actions) {
    const validation = PrivAgentActionValidator.validateAction(action);
    if (!validation.valid) {
      showCommandResult(`⚠ Action blocked: ${validation.reason}`, true);
      continue;
    }

    const risk = PrivAgentRiskEngine.evaluate(action);

    if (risk.approval_required) {
      const approved = await requestApproval(action, risk);
      if (!approved) {
        showCommandResult(`Cancelled: "${action.type}" requires approval and was not approved.`, true);
        continue;
      }
    }

    const result = await runAction(action);
    showCommandResult(
      `✓ COMMAND RECOGNIZED\nIntent: ${parsed.intent}\nAction: ${action.type}\nRisk: ${risk.level} (${risk.score})\n${result.message || (result.success ? 'Executed' : 'Failed')}`,
      !result.success
    );
  }

  refreshHistory();
  setTimeout(refreshPiiCounts, 400);
}

function requestApproval(action, risk) {
  return new Promise((resolve) => {
    els.approvalAction.textContent = `Action: ${action.type}${action.payload && action.payload.target ? ' → ' + action.payload.target : ''}`;
    els.approvalRisk.textContent = `Risk: ${risk.score} / ${risk.level}`;
    els.approvalReason.textContent = `Reason: ${risk.reason}`;
    els.approvalModal.classList.remove('hidden');

    const cleanup = () => {
      els.approvalModal.classList.add('hidden');
      els.approveCancel.onclick = null;
      els.approveOk.onclick = null;
    };
    els.approveCancel.onclick = () => { cleanup(); resolve(false); };
    els.approveOk.onclick = () => { cleanup(); resolve(true); };
  });
}

// ---------- Voice ----------
let voiceListener = null;

function initVoice() {
  voiceListener = new PrivAgentVoice.VoiceListener({
    onStart: () => {
      els.voiceStatus.textContent = '🔴 LISTENING...';
      els.voiceStatus.className = 'voice-status listening';
      els.voiceStatus.classList.remove('hidden');
      els.voiceBtn.textContent = 'Stop Listening';
    },
    onResult: ({ transcript }) => {
      els.voiceTranscript.textContent = `"${transcript}"`;
      els.voiceTranscript.classList.remove('hidden');
      const parsed = PrivAgentCommandParser.parseCommand(transcript);
      executeParsedCommand(parsed, 'voice');
    },
    onError: ({ message }) => {
      els.voiceStatus.textContent = `⚠ ${message}`;
      els.voiceStatus.className = 'voice-status';
      els.voiceStatus.classList.remove('hidden');
    },
    onEnd: () => {
      els.voiceBtn.textContent = 'Start Listening';
    }
  });
}

els.voiceBtn.addEventListener('click', () => {
  if (!PrivAgentVoice.isSupported()) {
    showCommandResult('⚠ Speech recognition is not supported in this browser. Try Chrome on desktop, or use the text command box below.', true);
    return;
  }
  if (voiceListener && voiceListener.listening) {
    voiceListener.stop();
  } else {
    voiceListener.start();
  }
});

// ---------- Text command ----------
els.textCmdBtn.addEventListener('click', () => {
  const text = els.textCmdInput.value.trim();
  if (!text) return;
  const parsed = PrivAgentCommandParser.parseCommand(text);
  executeParsedCommand(parsed, 'text');
  els.textCmdInput.value = '';
});
els.textCmdInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') els.textCmdBtn.click();
});

// ---------- Scan & Protect ----------
els.scanBtn.addEventListener('click', async () => {
  const res = await sendToActiveTab({ type: 'TOGGLE_MASKING' });
  if (res && res.ok) {
    showCommandResult(res.result.active
      ? `🛡 PROTECTION ACTIVE\n${res.result.count} PII PROTECTED`
      : 'Masking removed.');
    refreshPiiCounts();
  } else {
    showCommandResult('⚠ Could not scan this page (unsupported page or content script not loaded — try reloading the tab).', true);
  }
});

// ---------- Send Sanitized Context ----------
els.sendBtn.addEventListener('click', async () => {
  const res = await sendToActiveTab({ type: 'BUILD_SANITIZED_CONTEXT', task: 'user_requested_send' });
  if (!res || !res.ok) {
    showCommandResult('⚠ Could not read this page.', true);
    return;
  }
  const { context, verification } = res.result;
  if (!verification.safe) {
    showCommandResult(`⚠ BLOCKED LOCALLY: ${verification.reason}`, true);
    return;
  }
  try {
    const response = await fetch(`${SERVER_BASE_URL}/api/context`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(context)
    });
    const data = await response.json();
    if (data.status === 'BLOCKED') {
      showCommandResult(`⚠ SERVER BLOCKED REQUEST: ${data.reason}`, true);
    } else {
      showCommandResult(`✓ Sent sanitized context to server.\nPII detected & redacted: ${context.pii_detected}\nServer status: ${data.status}`);
    }
  } catch (e) {
    showCommandResult('⚠ Server offline. Start the FastAPI backend (see README) and try again.', true);
  }
  checkServer();
});

// ---------- Generate Action Plan ----------
els.planBtn.addEventListener('click', async () => {
  const res = await sendToActiveTab({ type: 'BUILD_SANITIZED_CONTEXT', task: 'action_planning' });
  const context = res && res.ok ? res.result.context : { page: 'unknown', fields: {}, pii_detected: 0 };
  try {
    const response = await fetch(`${SERVER_BASE_URL}/api/plan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ context, goal: els.textCmdInput.value || 'Assist the user on this page' })
    });
    const data = await response.json();
    showCommandResult(`🧠 ACTION PLAN\n${data.reasoning.join('\n')}\n\nRisk: ${data.risk.level} (${data.risk.score})`);
  } catch (e) {
    showCommandResult('⚠ Server offline. Start the FastAPI backend (see README) and try again.', true);
  }
  checkServer();
});

// ---------- Dashboard ----------
els.dashboardBtn.addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('dashboard/dashboard.html') });
});

// ---------- Init ----------
initVoice();
checkServer();
refreshHistory();
refreshPiiCounts();
setInterval(checkServer, 8000);
