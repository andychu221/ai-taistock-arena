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

function fmtMoney(n) { return Math.round(n).toLocaleString('zh-Hant-TW'); }
function fmtPct(n) { return (n >= 0 ? '+' : '') + n.toFixed(2) + '%'; }
function getIcon(config, aiId) { const a = config.ais.find(x => x.id === aiId); return a ? (a.icon || '') : ''; }

// 支援單純數值或 OHLCV 物件的相容函式
function getPriceVal(p) { return (typeof p === 'object' && p !== null) ? p.close : p; }

// 找到某檔股票在某日期(含)之前，最近一筆收盤價
function priceOnOrBefore(prices, ticker, date) {
  const map = prices[ticker];
  if (!map) return null;
  let best = null;
  for (const d in map) {
    if (d <= date && (best === null || d > best)) best = d;
  }
  return best !== null ? getPriceVal(map[best]) : null;
}

// 重播單一 AI 的交易紀錄，回傳每日：現金、持股、成本基礎、資產總值
function computeSeries(aiId, transactions, prices, dates, config) {
  const tx = transactions.filter(t => t.ai === aiId).sort((a, b) => a.date.localeCompare(b.date));
  let cash = config.initial_capital;
  const shares = {};   
  const cost = {};     
  let idx = 0;
  const series = [];

  for (const date of dates) {
    while (idx < tx.length && tx[idx].date <= date) {
      const t = tx[idx];
      const amt = t.shares * t.price;
      if (t.action === 'buy') {
        const fee = Math.floor(amt * (config.buy_fee_rate || 0));
        cash -= (amt + fee);
        shares[t.ticker] = (shares[t.ticker] || 0) + t.shares;
        cost[t.ticker] = (cost[t.ticker] || 0) + (amt + fee);
      } else if (t.action === 'sell') {
        const heldShares = shares[t.ticker] || 0;
        const avgCost = heldShares > 0 ? (cost[t.ticker] || 0) / heldShares : 0;
        const fee = Math.floor(amt * (config.sell_fee_rate || 0));
        const tax = Math.floor(amt * (config.sell_tax_rate || 0));
        
        cash += (amt - fee - tax);
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

// 產生大盤績效序列
function computeBenchmarkSeries(prices, benchmarkTicker, dates, startCapital) {
  const series = [];
  let basePrice = priceOnOrBefore(prices, benchmarkTicker, dates[0]);
  if (!basePrice) basePrice = 1; // 預防查無第一天數據
  const shares = startCapital / basePrice;
  
  for (const date of dates) {
    const p = priceOnOrBefore(prices, benchmarkTicker, date);
    series.push({ date, value: p ? p * shares : startCapital });
  }
  return series;
}

function buildDateAxis(prices, startDate) {
  const set = new Set([startDate, new Date().toISOString().slice(0, 10)]);
  Object.values(prices).forEach(map => Object.keys(map).forEach(d => { if(d >= startDate) set.add(d); }));
  return Array.from(set).sort();
}

// ---------- 主流程 ----------
(async function init() {
  setupTabs();
  let config, transactions, prices, journal;
  try { ({ config, transactions, prices, journal } = await loadData()); } 
  catch (err) {
    console.error('資料讀取失敗', err);
    return;
  }

  const dates = buildDateAxis(prices, config.start_date);
  const seriesByAI = {};
  config.ais.forEach(ai => {
    seriesByAI[ai.id] = computeSeries(ai.id, transactions, prices, dates, config);
  });
  
  let bmSeries = [];
  if (config.benchmark && prices[config.benchmark]) {
     bmSeries = computeBenchmarkSeries(prices, config.benchmark, dates, config.initial_capital);
  }

  safeRun(() => renderScoreboard(config, seriesByAI));
  safeRun(() => renderChart(config, dates, seriesByAI, bmSeries));
  safeRun(() => renderHoldingsView(config, seriesByAI, prices, transactions));
  safeRun(() => renderTransactions(config, transactions));
  safeRun(() => renderJournal(config, journal));
})();

function safeRun(fn) { try { fn(); } catch (err) { console.error(err); } }

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
          <span class="name">${ai.icon||''} ${ai.name}</span>
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

function renderChart(config, dates, seriesByAI, bmSeries) {
  const ctx = document.getElementById('chart-main');
  if (typeof Chart === 'undefined') return;

  const datasets = config.ais.map(ai => ({
    label: ai.name,
    data: seriesByAI[ai.id].map(p => (((p.value - config.initial_capital) / config.initial_capital) * 100).toFixed(2)),
    borderColor: ai.color,
    backgroundColor: ai.color + '22',
    borderWidth: 2,
    pointRadius: 0, tension: 0.25,
  }));
  
  if(bmSeries.length > 0) {
    datasets.push({
      label: `大盤基準 (${config.benchmark})`,
      data: bmSeries.map(p => (((p.value - config.initial_capital) / config.initial_capital) * 100).toFixed(2)),
      borderColor: '#8892AB', 
      borderDash: [5, 5],
      borderWidth: 1.5, 
      pointRadius: 0, tension: 0.25,
    });
  }

  new Chart(ctx, {
    type: 'line', data: { labels: dates, datasets },
    options: {
      responsive: true,
      interaction: { mode: 'index', intersect: false },
      plugins: { tooltip: { callbacks: { label: c => `${c.dataset.label}: ${c.formattedValue}%` } } },
      scales: {
        x: { ticks: { color: '#8892AB', maxTicksLimit: 8 }, grid: { color: '#26314D' } },
        y: { ticks: { color: '#8892AB', callback: v => v + '%' }, grid: { color: '#26314D' } },
      }
    }
  });
}

let holdingsCharts = [];
function renderHoldingsView(config, seriesByAI, prices, transactions) {
  const container = document.getElementById('holdings-container');
  // 建立週次選單與 Grid
  const weeks = [...new Set(transactions.map(t => t.week))].filter(w => w).sort((a,b)=>b-a);
  const weekSelectHtml = `<div class="filters" style="margin-bottom:16px;">
    <select id="holdings-week-select">
      <option value="latest">最新狀態</option>
      ${weeks.map(w => `<option value="${w}">第 ${w} 週</option>`).join('')}
    </select>
  </div>`;
  
  const gridHtml = `<div class="holdings-grid" id="holdings-charts-grid"></div>`;
  container.innerHTML = weekSelectHtml + gridHtml;

  const weekSelect = document.getElementById('holdings-week-select');
  weekSelect.addEventListener('change', () => drawHoldings(weekSelect.value));
  drawHoldings('latest');

  function drawHoldings(weekFilter) {
    const grid = document.getElementById('holdings-charts-grid');
    grid.innerHTML = '';
    holdingsCharts.forEach(c => c.destroy());
    holdingsCharts = [];

    // 找出該週期的最後一個交易日，若是 latest 則取陣列最後一天
    let targetDate = new Date().toISOString().slice(0, 10);
    if(weekFilter !== 'latest') {
        const weekTxs = transactions.filter(t => t.week == weekFilter);
        if(weekTxs.length > 0) targetDate = weekTxs.sort((a,b)=>b.date.localeCompare(a.date))[0].date;
    }

    config.ais.forEach(ai => {
      const s = seriesByAI[ai.id];
      const snap = s.find(p => p.date >= targetDate) || s[s.length - 1]; // 目標日的 snapshot
      
      const tickers = Object.keys(snap.shares);
      const dataLabels = [];
      const dataValues = [];
      const bgColors = ['#4A90E2', '#50E3C2', '#F5A623', '#FF6B6B', '#9B51E0', '#B8E986'];
      
      tickers.forEach(ticker => {
        const curPrice = priceOnOrBefore(prices, ticker, targetDate);
        if(curPrice) {
            dataLabels.push(ticker);
            dataValues.push(snap.shares[ticker] * curPrice);
        }
      });
      
      // 留出現金比例
      dataLabels.push('現金');
      dataValues.push(snap.cash);

      const html = `
      <div class="card" style="text-align:center; display:flex; flex-direction:column; gap:16px;">
        <div class="accent" style="background:${ai.color}"></div>
        <div class="card-head" style="justify-content:center"><span class="name">${ai.icon||''} ${ai.name} 投資分佈</span></div>
        <div style="position:relative; width:100%; height:200px; margin:0 auto;">
          <canvas id="donut-${ai.id}"></canvas>
          <div style="position:absolute; top:50%; left:50%; transform:translate(-50%,-50%); font-size:3rem; pointer-events:none;">${ai.icon||''}</div>
        </div>
        <canvas id="bar-${ai.id}" height="140"></canvas>
      </div>`;
      grid.insertAdjacentHTML('beforeend', html);

      const ctxDonut = document.getElementById(`donut-${ai.id}`);
      holdingsCharts.push(new Chart(ctxDonut, {
        type: 'doughnut',
        data: { labels: dataLabels, datasets: [{ data: dataValues, backgroundColor: bgColors, borderWidth: 0 }] },
        options: { cutout: '75%', plugins: { legend: { display: false } } }
      }));

      const ctxBar = document.getElementById(`bar-${ai.id}`);
      holdingsCharts.push(new Chart(ctxBar, {
        type: 'bar',
        data: { labels: dataLabels, datasets: [{ data: dataValues, backgroundColor: bgColors, borderRadius: 4 }] },
        options: { 
          plugins: { legend: { display: false } }, 
          scales: { 
            x: { ticks: { color: '#8892AB' }, grid: { display:false } }, 
            y: { display: false } 
          } 
        }
      }));
    });
  }
}

function renderTransactions(config, transactions) {
  const tbody = document.querySelector('#tx-table tbody');
  const select = document.getElementById('tx-filter-ai');
  if(select.options.length === 1) {
    config.ais.forEach(ai => select.insertAdjacentHTML('beforeend', `<option value="${ai.id}">${ai.icon||''} ${ai.name}</option>`));
  }

  // 預先計算每次交易的實現損益所需之成本
  const runningCosts = {}; // ai_ticker -> { shares, totalCost }
  const enrichedTx = transactions.sort((a,b)=>a.date.localeCompare(b.date)).map(t => {
    const key = t.ai + '_' + t.ticker;
    if(!runningCosts[key]) runningCosts[key] = { shares: 0, totalCost: 0 };
    const rc = runningCosts[key];
    const amt = t.shares * t.price;
    let fee=0, tax=0, netPl = null;

    if(t.action === 'buy') {
      fee = Math.floor(amt * (config.buy_fee_rate || 0));
      rc.shares += t.shares;
      rc.totalCost += (amt + fee);
    } else {
      fee = Math.floor(amt * (config.sell_fee_rate || 0));
      tax = Math.floor(amt * (config.sell_tax_rate || 0));
      const avgCost = rc.shares > 0 ? (rc.totalCost / rc.shares) : 0;
      const costOfSold = avgCost * t.shares;
      netPl = amt - fee - tax - costOfSold;
      
      rc.shares -= t.shares;
      rc.totalCost = Math.max(0, rc.totalCost - costOfSold);
    }
    return { ...t, fee, tax, netPl };
  });

  function draw() {
    const filter = select.value;
    const rows = enrichedTx.filter(t => !filter || t.ai === filter).reverse();
    if(rows.length === 0){
        tbody.innerHTML = `<tr><td colspan="11" class="empty"><b>尚無交易紀錄</b></td></tr>`;
        return;
    }
    tbody.innerHTML = rows.map(t => {
      const icon = getIcon(config, t.ai);
      const aiInfo = config.ais.find(x => x.id === t.ai);
      const plHtml = t.netPl !== null 
        ? `<span style="color:${t.netPl>=0?'var(--up)':'var(--down)'}">${fmtMoney(t.netPl)}</span>` 
        : '-';

      return `<tr>
        <td class="mono">${t.date}</td>
        <td><span class="ai-tag"><span class="dot" style="background:${aiInfo?.color}"></span>${icon} ${t.ai}</span></td>
        <td class="mono">${t.week ?? '-'}</td>
        <td><span class="pill ${t.action}">${t.action === 'buy' ? '買進' : '賣出'}</span></td>
        <td class="mono">${t.ticker} ${t.name || ''}</td>
        <td class="mono">${t.shares}</td>
        <td class="mono">${t.price}</td>
        <td class="mono">${fmtMoney(t.shares * t.price)}</td>
        <td class="mono" style="color:var(--text-dim)">${t.fee}</td>
        <td class="mono" style="color:var(--text-dim)">${t.tax || '-'}</td>
        <td class="mono" style="font-weight:600">${plHtml}</td>
      </tr>`;
    }).join('');
  }
  select.addEventListener('change', draw);
  draw();
}

function renderJournal(config, journal) {
  const list = document.getElementById('journal-list');
  const select = document.getElementById('journal-filter-ai');
  if(select.options.length === 1) {
    config.ais.forEach(ai => select.insertAdjacentHTML('beforeend', `<option value="${ai.id}">${ai.icon||''} ${ai.name}</option>`));
  }

  function draw() {
    const filter = select.value;
    const rows = journal.filter(j => !filter || j.ai === filter).sort((a, b) => b.date.localeCompare(a.date)).reverse();
    if (rows.length === 0) {
      list.innerHTML = `<div class="empty"><b>還沒有週報</b></div>`;
      return;
    }
    
    list.innerHTML = rows.map(j => {
      // 結合 marked.js (Markdown渲染) 與 DOMPurify (防XSS)
      const htmlContent = typeof DOMPurify !== 'undefined' && typeof marked !== 'undefined'
        ? DOMPurify.sanitize(marked.parse(j.content || '')) 
        : j.content; // Fallback
        
      return `<details class="journal-week" open>
        <summary>
          <span class="weeknum">第 ${j.week} 週</span>
          <span class="ai-tag">${getIcon(config, j.ai)} ${j.ai}</span>
          <span class="mono" style="color:var(--text-dim)">${j.date}</span>
          <strong style="margin-left:auto">${j.title || ''}</strong>
        </summary>
        <div class="content markdown-body">${htmlContent}</div>
      </details>`;
    }).join('');
  }
  select.addEventListener('change', draw);
  draw();
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
