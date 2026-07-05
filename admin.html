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

// ---- GitHub 連線設定表單 ----
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

// ---- 載入 config.json，同時餵給 AI 下拉選單與帳本設定表單 ----
let CONFIG = null;
async function loadConfig() {
  CONFIG = await fetch(`data/config.json?t=${Date.now()}`).then(r => r.json());
  const options = CONFIG.ais.map(a => `<option value="${a.id}">${a.name}</option>`).join('');
  document.getElementById('tx-ai').innerHTML = options;
  document.getElementById('j-ai').innerHTML = options;
  document.getElementById('tx-date').value = new Date().toISOString().slice(0, 10);
  document.getElementById('j-date').value = new Date().toISOString().slice(0, 10);

  document.getElementById('cfg-capital').value = CONFIG.initial_capital ?? 1000000;
  document.getElementById('cfg-start-date').value = CONFIG.start_date ?? '';
  document.getElementById('cfg-buy-fee').value = CONFIG.buy_fee_rate ?? 0.001425;
  document.getElementById('cfg-sell-fee').value = CONFIG.sell_fee_rate ?? 0.001425;
  document.getElementById('cfg-sell-tax').value = CONFIG.sell_tax_rate ?? 0.003;

  refreshHoldingsPreview();
  refreshTxManageList();
  refreshJournalManageList();
}
loadConfig();

// ---- 帳本設定表單 ----
document.getElementById('config-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const statusEl = document.getElementById('config-status');
  setStatus(statusEl, '寫入中...', true);
  try {
    const { sha, json } = await ghGetFile('data/config.json');
    json.initial_capital = Number(document.getElementById('cfg-capital').value);
    json.start_date = document.getElementById('cfg-start-date').value;
    json.buy_fee_rate = Number(document.getElementById('cfg-buy-fee').value);
    json.sell_fee_rate = Number(document.getElementById('cfg-sell-fee').value);
    json.sell_tax_rate = Number(document.getElementById('cfg-sell-tax').value);
    await ghPutFile('data/config.json', json, sha, 'chore: 更新帳本設定');
    setStatus(statusEl, '已寫入 GitHub', true);
    CONFIG = json;
  } catch (err) {
    setStatus(statusEl, err.message, false);
  }
});

// ---- 目前持股預覽(交易表單下方) ----
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

// ---- 交易表單：新增 / 編輯 ----
const txForm = document.getElementById('tx-form');
const txEditingIndex = document.getElementById('tx-editing-index');
const txSubmitBtn = document.getElementById('tx-submit-btn');
const txCancelBtn = document.getElementById('tx-cancel-edit');

function fillTxForm(record) {
  document.getElementById('tx-ai').value = record.ai;
  document.getElementById('tx-week').value = record.week ?? '';
  document.getElementById('tx-date').value = record.date;
  document.getElementById('tx-action').value = record.action;
  document.getElementById('tx-ticker').value = record.ticker;
  document.getElementById('tx-name').value = record.name || '';
  document.getElementById('tx-shares').value = record.shares;
  document.getElementById('tx-price').value = record.price;
  document.getElementById('tx-note').value = record.note || '';
}

function resetTxForm() {
  txForm.reset();
  txEditingIndex.value = '';
  document.getElementById('tx-date').value = new Date().toISOString().slice(0, 10);
  txSubmitBtn.textContent = '寫入 GitHub';
  txCancelBtn.style.display = 'none';
}

txCancelBtn.addEventListener('click', resetTxForm);

txForm.addEventListener('submit', async (e) => {
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
    const editIdx = txEditingIndex.value;
    let message;
    if (editIdx !== '') {
      json[Number(editIdx)] = record;
      message = `chore: 更新 ${record.ai} 第${record.week}週 ${record.ticker} 交易紀錄`;
    } else {
      json.push(record);
      message = `chore: ${record.ai} 第${record.week}週 ${record.action === 'buy' ? '買進' : '賣出'} ${record.ticker}`;
    }
    await ghPutFile('data/transactions.json', json, sha, message);
    setStatus(statusEl, '已寫入 GitHub，網站將在 Pages 重新部署後更新', true);
    resetTxForm();
    refreshHoldingsPreview();
    refreshTxManageList();
  } catch (err) {
    setStatus(statusEl, err.message, false);
  }
});

// ---- 交易紀錄管理清單(刪除/編輯) ----
async function refreshTxManageList() {
  const tbody = document.querySelector('#tx-manage-table tbody');
  tbody.innerHTML = `<tr><td colspan="8" class="empty">載入中...</td></tr>`;
  try {
    const tx = await fetch(`data/transactions.json?t=${Date.now()}`).then(r => r.json());
    if (tx.length === 0) {
      tbody.innerHTML = `<tr><td colspan="8" class="empty">還沒有任何交易紀錄</td></tr>`;
      return;
    }
    tbody.innerHTML = tx.map((t, i) => `
      <tr>
        <td class="mono">${t.date}</td>
        <td>${t.ai}</td>
        <td class="mono">${t.week ?? '-'}</td>
        <td><span class="pill ${t.action}">${t.action === 'buy' ? '買進' : '賣出'}</span></td>
        <td class="mono">${t.ticker} ${t.name || ''}</td>
        <td class="mono">${t.shares}</td>
        <td class="mono">${t.price}</td>
        <td>
          <button type="button" class="btn" data-edit="${i}">編輯</button>
          <button type="button" class="btn" data-delete="${i}">刪除</button>
        </td>
      </tr>
    `).join('');

    tbody.querySelectorAll('[data-edit]').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = Number(btn.dataset.edit);
        txEditingIndex.value = idx;
        fillTxForm(tx[idx]);
        txSubmitBtn.textContent = '更新這筆紀錄';
        txCancelBtn.style.display = 'inline-block';
        txForm.scrollIntoView({ behavior: 'smooth' });
      });
    });
    tbody.querySelectorAll('[data-delete]').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('確定要刪除這筆交易紀錄嗎？此動作會直接寫回 GitHub。')) return;
        try {
          const idx = Number(btn.dataset.delete);
          const { sha, json } = await ghGetFile('data/transactions.json');
          const removed = json.splice(idx, 1)[0];
          await ghPutFile('data/transactions.json', json, sha, `chore: 刪除 ${removed?.ai} ${removed?.ticker} 交易紀錄`);
          refreshTxManageList();
          refreshHoldingsPreview();
        } catch (err) {
          alert('刪除失敗：' + err.message);
        }
      });
    });
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="8" class="empty">讀取失敗：${err.message}</td></tr>`;
  }
}

// ---- 週報表單：新增 / 編輯 ----
const journalForm = document.getElementById('journal-form');
const jEditingIndex = document.getElementById('j-editing-index');
const jSubmitBtn = document.getElementById('j-submit-btn');
const jCancelBtn = document.getElementById('j-cancel-edit');

function fillJournalForm(record) {
  document.getElementById('j-ai').value = record.ai;
  document.getElementById('j-week').value = record.week ?? '';
  document.getElementById('j-date').value = record.date;
  document.getElementById('j-title').value = record.title || '';
  document.getElementById('j-content').value = record.content || '';
}

function resetJournalForm() {
  journalForm.reset();
  jEditingIndex.value = '';
  document.getElementById('j-date').value = new Date().toISOString().slice(0, 10);
  jSubmitBtn.textContent = '寫入 GitHub';
  jCancelBtn.style.display = 'none';
}

jCancelBtn.addEventListener('click', resetJournalForm);

journalForm.addEventListener('submit', async (e) => {
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
    const editIdx = jEditingIndex.value;
    let message;
    if (editIdx !== '') {
      json[Number(editIdx)] = record;
      message = `docs: 更新 ${record.ai} 第${record.week}週週報`;
    } else {
      json.push(record);
      message = `docs: ${record.ai} 第${record.week}週週報`;
    }
    await ghPutFile('data/journal.json', json, sha, message);
    setStatus(statusEl, '已寫入 GitHub，網站將在 Pages 重新部署後更新', true);
    resetJournalForm();
    refreshJournalManageList();
  } catch (err) {
    setStatus(statusEl, err.message, false);
  }
});

// ---- 週報管理清單(刪除/編輯) ----
async function refreshJournalManageList() {
  const el = document.getElementById('journal-manage-list');
  el.innerHTML = `<div class="empty">載入中...</div>`;
  try {
    const journal = await fetch(`data/journal.json?t=${Date.now()}`).then(r => r.json());
    if (journal.length === 0) {
      el.innerHTML = `<div class="empty">還沒有任何週報</div>`;
      return;
    }
    el.innerHTML = journal.map((j, i) => `
      <div class="journal-week">
        <div class="manage-row">
          <span class="weeknum">第 ${j.week} 週</span>
          <span class="ai-tag">${j.ai}</span>
          <span class="mono" style="color:var(--text-dim)">${j.date}</span>
          <strong style="margin-left:auto">${j.title || ''}</strong>
          <button type="button" class="btn" data-jedit="${i}">編輯</button>
          <button type="button" class="btn" data-jdelete="${i}">刪除</button>
        </div>
      </div>
    `).join('');

    el.querySelectorAll('[data-jedit]').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = Number(btn.dataset.jedit);
        jEditingIndex.value = idx;
        fillJournalForm(journal[idx]);
        jSubmitBtn.textContent = '更新這篇週報';
        jCancelBtn.style.display = 'inline-block';
        journalForm.scrollIntoView({ behavior: 'smooth' });
      });
    });
    el.querySelectorAll('[data-jdelete]').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('確定要刪除這篇週報嗎？此動作會直接寫回 GitHub。')) return;
        try {
          const idx = Number(btn.dataset.jdelete);
          const { sha, json } = await ghGetFile('data/journal.json');
          const removed = json.splice(idx, 1)[0];
          await ghPutFile('data/journal.json', json, sha, `docs: 刪除 ${removed?.ai} 第${removed?.week}週週報`);
          refreshJournalManageList();
        } catch (err) {
          alert('刪除失敗：' + err.message);
        }
      });
    });
  } catch (err) {
    el.innerHTML = `<div class="empty">讀取失敗：${err.message}</div>`;
  }
}
