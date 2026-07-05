// ---------- 資料載入 ----------
async function loadData() {
  const bust = 't=' + Date.now();
  const [config, transactions, prices, journal] = await Promise.all([
    fetch(`data/config.json?${bust}`).then(r => r.json()),
    fetch(`data/transactions.json?${bust}`).then(r => r.json()),
    fetch(`data/prices.json?${bust}`).then(r => r.json()),
    fetch(`data/journal.json?${bust}`).then(r => r.json()),
  ]);
  return { config, transactions, prices, journal };
}

function fmtMoney(n) {
  return Math.round(n).toLocaleString('zh-Hant-TW');
}
function fmtPct(n) {
  return (n >= 0 ? '+' : '') + n.toFixed(2) + '%';
}

// 找到某檔股票在某日期(含)之前，最近一筆收盤價
function priceOnOrBefore(prices, ticker, date) {
  const map = prices[ticker];
  if (!map) return null;
  let best = null;
  for (const d in map) {
    if (d <= date && (best === null || d > best)) best = d;
  }
  return best !== null ? map[best] : null;
}

// 重播單一 AI 的交易紀錄，回傳每日：現金、持股、成本基礎、資產總值
function computeSeries(aiId, transactions, prices, dates, initialCapital) {
  const tx = transactions
    .filter(t => t.ai === aiId)
    .sort((a, b) => a.date.localeCompare(b.date));

  let cash = initialCapital;
  const shares = {};   // ticker -> 股數
  const cost = {};     // ticker -> 總成本
  let idx = 0;
  const series = [];

  for (const date of dates) {
    while (idx < tx.length && tx[idx].date <= date) {
      const t = tx[idx];
      const amt = t.shares * t.price;
      if (t.action === 'buy') {
        cash -= amt;
        shares[t.ticker] = (shares[t.ticker] || 0) + t.shares;
        cost[t.ticker] = (cost[t.ticker] || 0) + amt;
      } else if (t.action === 'sell') {
        const heldShares = shares[t.ticker] || 0;
        const avgCost = heldShares > 0 ? (cost[t.ticker] || 0) / heldShares : 0;
        cash += amt;
        shares[t.ticker] = heldShares - t.shares;
        cost[t.ticker] = Math.max(0, (cost[t.ticker] || 0) - avgCost * t.shares);
        if (shares[t.ticker] <= 0) { delete shares[t.ticker]; delete cost[t.ticker]; }
      }
      idx++;
    }
    let value = cash;
    for (const [ticker, sh] of Object.entries(shares)) {
      const p = priceOnOrBefore(prices, ticker, date);
      if (p) value += p * sh;
    }
    series.push({ date, value, cash, shares: { ...shares }, cost: { ...cost } });
  }
  return series;
}

function buildDateAxis(prices, startDate) {
  const set = new Set([startDate, todayStr()]);
  Object.values(prices).forEach(map => Object.keys(map).forEach(d => set.add(d)));
  return Array.from(set).sort();
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

// ---------- 主流程 ----------
(async function init() {
  const { config, transactions, prices, journal } = await loadData();
  const dates = buildDateAxis(prices, config.start_date);

  const seriesByAI = {};
  config.ais.forEach(ai => {
    seriesByAI[ai.id] = computeSeries(ai.id, transactions, prices, dates, config.initial_capital);
  });

  renderScoreboard(config, seriesByAI);
  renderChart(config, dates, seriesByAI);
  renderHoldings(config, seriesByAI, prices);
  renderTransactions(config, transactions);
  renderJournal(config, journal);
  setupTabs();
})();

function renderScoreboard(config, seriesByAI) {
  const el = document.getElementById('scoreboard');
  el.innerHTML = '';
  config.ais.forEach(ai => {
    const s = seriesByAI[ai.id];
    const last = s[s.length - 1];
    const ret = ((last.value - config.initial_capital) / config.initial_capital) * 100;
    const holdingCount = Object.keys(last.shares).length;
    const up = ret >= 0;
    el.insertAdjacentHTML('beforeend', `
      <div class="card">
        <div class="accent" style="background:${ai.color}"></div>
        <div class="card-head">
          <span class="name">${ai.name}</span>
          <span class="badge">持股 ${holdingCount} 檔</span>
        </div>
        <div class="value-big mono">NT$ ${fmtMoney(last.value)}</div>
        <div class="ret ${up ? 'up' : 'down'} mono">${up ? '▲' : '▼'} ${fmtPct(ret)}</div>
        <div class="subrow">
          <span>現金 <b class="mono">${fmtMoney(last.cash)}</b></span>
          <span>持股市值 <b class="mono">${fmtMoney(last.value - last.cash)}</b></span>
        </div>
      </div>
    `);
  });
}

let mainChart = null;
function renderChart(config, dates, seriesByAI) {
  const ctx = document.getElementById('chart-main');
  const datasets = config.ais.map(ai => ({
    label: ai.name,
    data: seriesByAI[ai.id].map(p => (((p.value - config.initial_capital) / config.initial_capital) * 100).toFixed(2)),
    borderColor: ai.color,
    backgroundColor: ai.color + '22',
    borderWidth: 2,
    pointRadius: 0,
    tension: 0.25,
  }));

  if (dates.length <= 1) {
    ctx.parentElement.insertAdjacentHTML('beforeend', '<div class="empty"><b>還沒有資料</b>等第一筆交易與股價更新後，這裡會出現三條 AI 的績效走勢線。</div>');
    return;
  }

  mainChart = new Chart(ctx, {
    type: 'line',
    data: { labels: dates, datasets },
    options: {
      responsive: true,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { labels: { color: '#E7EAF3', font: { family: 'Inter' } } },
        tooltip: { callbacks: { label: c => `${c.dataset.label}: ${c.formattedValue}%` } },
      },
      scales: {
        x: { ticks: { color: '#8892AB', maxTicksLimit: 8 }, grid: { color: '#26314D' } },
        y: { ticks: { color: '#8892AB', callback: v => v + '%' }, grid: { color: '#26314D' } },
      },
    },
  });
}

function renderHoldings(config, seriesByAI, prices) {
  const grid = document.getElementById('holdings-grid');
  grid.innerHTML = '';
  config.ais.forEach(ai => {
    const s = seriesByAI[ai.id];
    const last = s[s.length - 1];
    const tickers = Object.keys(last.shares);
    let rows = '';
    if (tickers.length === 0) {
      rows = `<tr><td colspan="5" class="empty">目前尚無持股</td></tr>`;
    } else {
      tickers.forEach(ticker => {
        const sh = last.shares[ticker];
        const avgCost = last.cost[ticker] / sh;
        const cur = priceOnOrBefore(prices, ticker, todayStr()) || avgCost;
        const pl = ((cur - avgCost) / avgCost) * 100;
        rows += `<tr>
          <td class="mono">${ticker}</td>
          <td class="mono">${sh}</td>
          <td class="mono">${avgCost.toFixed(1)}</td>
          <td class="mono">${cur.toFixed(1)}</td>
          <td class="mono" style="color:${pl >= 0 ? 'var(--up)' : 'var(--down)'}">${fmtPct(pl)}</td>
        </tr>`;
      });
    }
    grid.insertAdjacentHTML('beforeend', `
      <div class="card" style="overflow:auto">
        <div class="accent" style="background:${ai.color}"></div>
        <div class="card-head"><span class="name">${ai.name}</span></div>
        <table>
          <thead><tr><th>股票</th><th>股數</th><th>均價</th><th>現價</th><th>損益%</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    `);
  });
}

function renderTransactions(config, transactions) {
  const tbody = document.querySelector('#tx-table tbody');
  const aiMap = Object.fromEntries(config.ais.map(a => [a.id, a]));
  const select = document.getElementById('tx-filter-ai');
  config.ais.forEach(ai => select.insertAdjacentHTML('beforeend', `<option value="${ai.id}">${ai.name}</option>`));

  function draw() {
    const filter = select.value;
    const rows = transactions
      .filter(t => !filter || t.ai === filter)
      .sort((a, b) => b.date.localeCompare(a.date));
    if (rows.length === 0) {
      tbody.innerHTML = `<tr><td colspan="9" class="empty"><b>還沒有交易紀錄</b>到「管理後台」新增第一筆買進紀錄吧。</td></tr>`;
      return;
    }
    tbody.innerHTML = rows.map(t => {
      const ai = aiMap[t.ai] || { name: t.ai, color: '#888' };
      return `<tr>
        <td class="mono">${t.date}</td>
        <td><span class="ai-tag"><span class="dot" style="background:${ai.color}"></span>${ai.name}</span></td>
        <td class="mono">${t.week ?? '-'}</td>
        <td><span class="pill ${t.action}">${t.action === 'buy' ? '買進' : '賣出'}</span></td>
        <td class="mono">${t.ticker} ${t.name || ''}</td>
        <td class="mono">${t.shares}</td>
        <td class="mono">${t.price}</td>
        <td class="mono">${fmtMoney(t.shares * t.price)}</td>
        <td>${t.note || ''}</td>
      </tr>`;
    }).join('');
  }
  select.addEventListener('change', draw);
  draw();
}

function renderJournal(config, journal) {
  const list = document.getElementById('journal-list');
  const aiMap = Object.fromEntries(config.ais.map(a => [a.id, a]));
  const select = document.getElementById('journal-filter-ai');
  config.ais.forEach(ai => select.insertAdjacentHTML('beforeend', `<option value="${ai.id}">${ai.name}</option>`));

  function draw() {
    const filter = select.value;
    const rows = journal
      .filter(j => !filter || j.ai === filter)
      .sort((a, b) => b.date.localeCompare(a.date));
    if (rows.length === 0) {
      list.innerHTML = `<div class="empty"><b>還沒有週報</b>到「管理後台」貼上第一篇週報或覆盤分析。</div>`;
      return;
    }
    list.innerHTML = rows.map(j => {
      const ai = aiMap[j.ai] || { name: j.ai, color: '#888' };
      return `<details class="journal-week">
        <summary>
          <span class="weeknum">第 ${j.week} 週</span>
          <span class="ai-tag"><span class="dot" style="background:${ai.color}"></span>${ai.name}</span>
          <span class="mono" style="color:var(--text-dim)">${j.date}</span>
          <strong style="margin-left:auto">${j.title || ''}</strong>
        </summary>
        <div class="content">${escapeHtml(j.content || '')}</div>
      </details>`;
    }).join('');
  }
  select.addEventListener('change', draw);
  draw();
}

function escapeHtml(str) {
  return str.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

function setupTabs() {
  const buttons = document.querySelectorAll('nav.tabs button');
  buttons.forEach(btn => {
    btn.addEventListener('click', () => {
      buttons.forEach(b => b.classList.remove('active'));
      document.querySelectorAll('main > section').forEach(s => s.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(btn.dataset.tab).classList.add('active');
    });
  });
}
