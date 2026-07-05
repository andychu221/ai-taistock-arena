const LS_KEY = 'ai-stock-arena-settings';

function getSettings() {
  try { return JSON.parse(localStorage.getItem(LS_KEY)) || {}; }
  catch { return {}; }
}
function saveSettings(s) { localStorage.setItem(LS_KEY, JSON.stringify(s)); }

// ---- utf-8 安全的 base64 編碼/解碼 ----
function utf8ToBase64(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  bytes.forEach(b => binary += String.fromCharCode(b));
  return btoa(binary);
}
function base64ToUtf8(b64) {
  const binary = atob(b64.replace(/\n/g, ''));
  const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

// ---- GitHub Contents API ----
async function ghGetFile(path) {
  const s = getSettings();
  const url = `https://api.github.com/repos/${s.owner}/${s.repo}/contents/${path}?ref=${encodeURIComponent(s.branch)}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${s.token}`, Accept: 'application/vnd.github+json' },
  });
  if (!res.ok) throw new Error(`讀取 ${path} 失敗 (${res.status})`);
  const data = await res.json();
  return { sha: data.sha, json: JSON.parse(base64ToUtf8(data.content)) };
}

async function ghPutFile(path, jsonObj, sha, message) {
  const s = getSettings();
  const url = `https://api.github.com/repos/${s.owner}/${s.repo}/contents/${path}`;
  const body = {
    message,
    content: utf8ToBase64(JSON.stringify(jsonObj, null, 2)),
    branch: s.branch,
    sha,
  };
  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${s.token}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`寫入 ${path} 失敗 (${res.status}) ${err.message || ''}`);
  }
  return res.json();
}

function setStatus(el, msg, ok) {
  el.textContent = msg;
  el.className = 'status ' + (ok ? 'ok' : 'err');
}

// ---- 設定表單 ----
const settingsForm = document.getElementById('settings-form');
(function initSettings() {
  const s = getSettings();
  document.getElementById('cfg-owner').value = s.owner || '';
  document.getElementById('cfg-repo').value = s.repo || '';
  document.getElementById('cfg-branch').value = s.branch || 'main';
  document.getElementById('cfg-token').value = s.token || '';
})();

settingsForm.addEventListener('submit', (e) => {
  e.preventDefault();
  saveSettings({
    owner: document.getElementById('cfg-owner').value.trim(),
    repo: document.getElementById('cfg-repo').value.trim(),
    branch: document.getElementById('cfg-branch').value.trim() || 'main',
    token: document.getElementById('cfg-token').value.trim(),
  });
  setStatus(document.getElementById('settings-status'), '已儲存在這台瀏覽器', true);
});

// ---- 載入 AI 清單 + 目前持股預覽 ----
let CONFIG = null;
async function loadConfig() {
  CONFIG = await fetch(`data/config.json?t=${Date.now()}`).then(r => r.json());
  const options = CONFIG.ais.map(a => `<option value="${a.id}">${a.name}</option>`).join('');
  document.getElementById('tx-ai').innerHTML = options;
  document.getElementById('j-ai').innerHTML = options;
  document.getElementById('tx-date').value = new Date().toISOString().slice(0, 10);
  document.getElementById('j-date').value = new Date().toISOString().slice(0, 10);
  refreshHoldingsPreview();
}
loadConfig();

async function refreshHoldingsPreview() {
  const el = document.getElementById('tx-current-holdings');
  try {
    const aiId = document.getElementById('tx-ai').value;
    const tx = await fetch(`data/transactions.json?t=${Date.now()}`).then(r => r.json());
    const shares = {};
    tx.filter(t => t.ai === aiId).sort((a, b) => a.date.localeCompare(b.date)).forEach(t => {
      shares[t.ticker] = (shares[t.ticker] || 0) + (t.action === 'buy' ? t.shares : -t.shares);
    });
    const held = Object.entries(shares).filter(([, n]) => n > 0);
    el.textContent = held.length
      ? '目前持股：' + held.map(([t, n]) => `${t}(${n}股)`).join('、')
      : '目前尚無持股';
  } catch {
    el.textContent = '';
  }
}
document.getElementById('tx-ai').addEventListener('change', refreshHoldingsPreview);

// ---- 交易表單 ----
document.getElementById('tx-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const statusEl = document.getElementById('tx-status');
  setStatus(statusEl, '寫入中...', true);
  try {
    const record = {
      ai: document.getElementById('tx-ai').value,
      week: Number(document.getElementById('tx-week').value),
      date: document.getElementById('tx-date').value,
      action: document.getElementById('tx-action').value,
      ticker: document.getElementById('tx-ticker').value.trim(),
      name: document.getElementById('tx-name').value.trim(),
      shares: Number(document.getElementById('tx-shares').value),
      price: Number(document.getElementById('tx-price').value),
      note: document.getElementById('tx-note').value.trim(),
    };
    const { sha, json } = await ghGetFile('data/transactions.json');
    json.push(record);
    await ghPutFile('data/transactions.json', json, sha,
      `chore: ${record.ai} 第${record.week}週 ${record.action === 'buy' ? '買進' : '賣出'} ${record.ticker}`);
    setStatus(statusEl, '已寫入 GitHub，網站將在 Pages 重新部署後更新', true);
    e.target.reset();
    document.getElementById('tx-date').value = new Date().toISOString().slice(0, 10);
    refreshHoldingsPreview();
  } catch (err) {
    setStatus(statusEl, err.message, false);
  }
});

// ---- 週報表單 ----
document.getElementById('journal-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const statusEl = document.getElementById('j-status');
  setStatus(statusEl, '寫入中...', true);
  try {
    const record = {
      ai: document.getElementById('j-ai').value,
      week: Number(document.getElementById('j-week').value),
      date: document.getElementById('j-date').value,
      title: document.getElementById('j-title').value.trim(),
      content: document.getElementById('j-content').value,
    };
    const { sha, json } = await ghGetFile('data/journal.json');
    json.push(record);
    await ghPutFile('data/journal.json', json, sha,
      `docs: ${record.ai} 第${record.week}週週報`);
    setStatus(statusEl, '已寫入 GitHub，網站將在 Pages 重新部署後更新', true);
    e.target.reset();
    document.getElementById('j-date').value = new Date().toISOString().slice(0, 10);
  } catch (err) {
    setStatus(statusEl, err.message, false);
  }
});
