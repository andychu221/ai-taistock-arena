// 準備 SVG 格式的企業 LOGO
const LOGOS = {
  claude: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>`,
  chatgpt: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v20M2 12h20M12 2a10 10 0 0 1 10 10M12 22a10 10 0 0 1-10-10"/></svg>`, // 抽象示意圖
  gemini: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>`
};

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
function getIconHtml(aiId) { return LOGOS[aiId] || ''; }

function getPriceVal(p) { return (typeof p === 'object' && p !== null) ? p.close : p; }

function priceOnOrBefore(prices, ticker, date) {
  const map = prices[ticker];
  if (!map) return null;
  let best = null;
  for (const d in map) {
    if (d <= date && (best === null || d > best)) best = d;
  }
  return best !== null ? getPriceVal(map[best]) : null;
}

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

function computeBenchmarkSeries(prices, benchmarkTicker, dates, startCapital) {
  const series = [];
  let basePrice = priceOnOrBefore(prices, benchmarkTicker, dates[0]);
  if (!basePrice) basePrice = 1;
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

let scoreboardCharts = [];

(async function init() {
  setupTabs();
  let config, transactions, prices, journal;
  try { ({ config, transactions, prices, journal } = await loadData()); } 
  catch (err) { console.error(err); return; }

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
  scoreboardCharts.forEach(c => c.destroy());
  scoreboardCharts = [];

  config.ais.forEach(ai => {
    const s = seriesByAI[ai.id];
    const today = s[s.length - 1];
    const yesterday = s.length > 1 ? s[s.length - 2] : s[0];
    
    // 計算每日 P&L
    const dailyPlAmt = today.value - yesterday.value;
    const dailyPlPct = (dailyPlAmt / yesterday.value) * 100;
    const dailyUp = dailyPlAmt >= 0;

    // 計算未實現 P&L (當前持股市值 - 總成本)
    let totalStockVal = 0;
    let totalCost = 0;
    const labels = [], dataVals = [], bgColors = ['#4A90E2', '#50E3C2', '#F5A623', '#FF6B6B', '#9B51E0', '#B8E986'];
    
    Object.keys(today.shares).forEach((ticker, idx) => {
      const p = today.value - today.cash; // approximations later fixed
      const sh = today.shares[ticker];
      const cost = today.cost[ticker];
      // Need current price to get actual holding val
      // Workaround since today.value is already calculated accurately in computeSeries
      // We'll recalculate holding values here for the chart
    });

    // We must re-fetch price for accuracy in pie chart
    // Re-evaluating holding values based on today's price (or latest available)
    // to get accurate unrealized P&L
    // Note: totalStockVal could just be (today.value - today.cash)
    // but calculating per stock is better for the donut.

    el.insertAdjacentHTML('beforeend', `
      <div class="card">
        <div class="accent" style="background:${ai.color}"></div>
        <div class="sb-layout">
          <div class="sb-left">
            <div class="card-head">
              <span style="color:${ai.color}">${getIconHtml(ai.id)}</span>
              <span class="name">${ai.name}</span>
            </div>
            <div class="value-big mono">NT$ ${fmtMoney(today.value)}</div>
            <div class="ret ${dailyUp ? 'up' : 'down'} mono">
              每日 P&L: ${fmtMoney(dailyPlAmt)} / ${fmtPct(dailyPlPct)}
            </div>
          </div>
          <div class="sb-right">
            <canvas id="sb-donut-${ai.id}"></canvas>
            <div class="donut-center-text">
              <div class="lbl">未實現 P&L</div>
              <div id="sb-donut-val-${ai.id}" class="val mono">-</div>
            </div>
          </div>
        </div>
      </div>
    `);
  });

  // 繪製記分板的小圓餅圖與計算總未實現
  config.ais.forEach(ai => {
    const s = seriesByAI[ai.id];
    const today = s[s.length - 1];
    
    let unrealizedAmt = 0;
    let totalCost = 0;
    let stockValueSum = 0;
    const dataLabels = [], dataValues = [];
    const bgColors = ['#4A90E2', '#50E3C2', '#F5A623', '#FF6B6B', '#9B51E0', '#B8E986'];

    Object.keys(today.shares).forEach(ticker => {
      // Find latest price from the series value difference (or we can just calculate it)
      // For simplicity, we know today.value = cash + sum(shares * price)
      // So price = (value - cash) logic per stock.
      // To be precise we need `priceOnOrBefore` again, but we don't have `prices` here easily.
      // Wait, we DO need `prices`. Let's assume we can approximate or we just pass it in.
      // To keep it simple, I'll calculate total cost directly from today.cost
      totalCost += today.cost[ticker];
    });
    
    stockValueSum = today.value - today.cash;
    unrealizedAmt = stockValueSum - totalCost;
    const unrealizedPct = totalCost > 0 ? (unrealizedAmt / totalCost) * 100 : 0;
    
    const up = unrealizedAmt >= 0;
    const valEl = document.getElementById(`sb-donut-val-${ai.id}`);
    valEl.innerHTML = `<span style="color:${up?'var(--up)':'var(--down)'}">${fmtMoney(unrealizedAmt)}<br/>${fmtPct(unrealizedPct)}</span>`;

    // 圓餅圖內容：持股比例 + 現金
    dataLabels.push('持股', '現金');
    dataValues.push(stockValueSum, today.cash);

    const ctx = document.getElementById(`sb-donut-${ai.id}`);
    scoreboardCharts.push(new Chart(ctx, {
      type: 'doughnut',
      data: { labels: dataLabels, datasets: [{ data: dataValues, backgroundColor: [ai.color, '#262626'], borderWidth: 0 }] },
      options: { cutout: '80%', plugins: { legend: { display: false }, tooltip: { enabled: false } }, responsive:true, maintainAspectRatio:false }
    }));
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
      borderColor: '#9CA3AF', 
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
      plugins: { 
        legend: { labels: { color: '#FFFFFF' } }, // 圖例文字改為白色
        tooltip: { callbacks: { label: c => `${c.dataset.label}: ${c.formattedValue}%` } } 
      },
      scales: {
        x: { ticks: { color: '#9CA3AF', maxTicksLimit: 8 }, grid: { color: '#262626' } },
        y: { ticks: { color: '#9CA3AF', callback: v => v + '%' }, grid: { color: '#262626' } },
      }
    }
  });
}

let holdingsCharts = [];
function renderHoldingsView(config, seriesByAI, prices, transactions) {
  const container = document.getElementById('holdings-container');
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

    let targetDate = new Date().toISOString().slice(0, 10);
    if(weekFilter !== 'latest') {
        const weekTxs = transactions.filter(t => t.week == weekFilter);
        if(weekTxs.length > 0) targetDate = weekTxs.sort((a,b)=>b.date.localeCompare(a.date))[0].date;
    }

    config.ais.forEach(ai => {
      const s = seriesByAI[ai.id];
      const snap = s.find(p => p.date >= targetDate) || s[s.length - 1]; 
      
      const tickers = Object.keys(snap.shares);
      const dataLabels = [];
      const dataValues = [];
      const bgColors = ['#4A90E2', '#50E3C2', '#F5A623', '#FF6B6B', '#9B51E0', '#B8E986'];
      
      let legendRows = '';
      
      tickers.forEach((ticker, i) => {
        const curPrice = priceOnOrBefore(prices, ticker, targetDate);
        if(curPrice) {
            const val = snap.shares[ticker] * curPrice;
            const cost = snap.cost[ticker] || 0;
            const unpl = val - cost;
            const unplPct = cost > 0 ? (unpl/cost)*100 : 0;
            const pctOfPort = (val / snap.value) * 100;
            const up = unpl >= 0;
            const cStr = bgColors[i % bgColors.length];
            
            dataLabels.push(ticker);
            dataValues.push(val);
            
            // 抓取最後一個已知名字 (如果需要的話可以從 tx 中反推)
            const txName = transactions.find(t=>t.ticker===ticker)?.name || '';
            
            legendRows += `
              <tr>
                <td><span class="color-box" style="background:${cStr}"></span><span class="mono">${ticker}</span> ${txName}</td>
                <td class="mono" style="text-align:right">${fmtMoney(val)}</td>
                <td class="mono" style="text-align:right">${pctOfPort.toFixed(1)}%</td>
                <td class="mono" style="text-align:right; color:${up?'var(--up)':'var(--down)'}">${fmtPct(unplPct)}</td>
              </tr>
            `;
        }
      });
      
      dataLabels.push('現金');
      dataValues.push(snap.cash);
      const cashPct = (snap.cash / snap.value) * 100;
      legendRows += `
          <tr>
            <td><span class="color-box" style="background:#333"></span>現金</td>
            <td class="mono" style="text-align:right">${fmtMoney(snap.cash)}</td>
            <td class="mono" style="text-align:right">${cashPct.toFixed(1)}%</td>
            <td class="mono" style="text-align:right">-</td>
          </tr>
      `;

      const html = `
      <div class="card" style="display:flex; flex-direction:column; gap:16px;">
        <div class="accent" style="background:${ai.color}"></div>
        <div class="card-head" style="justify-content:center"><span style="color:${ai.color}">${getIconHtml(ai.id)}</span> <span class="name">${ai.name} 分佈</span></div>
        <div style="position:relative; width:100%; height:180px; margin:0 auto;">
          <canvas id="donut-${ai.id}"></canvas>
        </div>
        <canvas id="bar-${ai.id}" height="100"></canvas>
        
        <table class="legend-table">
          <thead><tr><th>標的</th><th style="text-align:right">市值</th><th style="text-align:right">佔比</th><th style="text-align:right">未實現損益</th></tr></thead>
          <tbody>${legendRows}</tbody>
        </table>
      </div>`;
      grid.insertAdjacentHTML('beforeend', html);

      const ctxDonut = document.getElementById(`donut-${ai.id}`);
      holdingsCharts.push(new Chart(ctxDonut, {
        type: 'doughnut',
        data: { labels: dataLabels, datasets: [{ data: dataValues, backgroundColor: [...bgColors.slice(0, tickers.length), '#333'], borderWidth: 0 }] },
        options: { cutout: '65%', plugins: { legend: { display: false } }, responsive:true, maintainAspectRatio:false }
      }));

      const ctxBar = document.getElementById(`bar-${ai.id}`);
      holdingsCharts.push(new Chart(ctxBar, {
        type: 'bar',
        data: { labels: dataLabels, datasets: [{ data: dataValues, backgroundColor: [...bgColors.slice(0, tickers.length), '#333'], borderRadius: 4 }] },
        options: { 
          plugins: { legend: { display: false } }, 
          scales: { 
            x: { ticks: { color: '#9CA3AF' }, grid: { display:false } }, 
            y: { display: false } 
          } 
        }
      }));
    });
  }
}

function renderTransactions(config, transactions) {
  const tbody = document.querySelector('#tx-table tbody');
  const aiSelect = document.getElementById('tx-filter-ai');
  const actionSelect = document.getElementById('tx-filter-action');
  const tickerInput = document.getElementById('tx-filter-ticker');
  
  if(aiSelect.options.length === 1) {
    config.ais.forEach(ai => aiSelect.insertAdjacentHTML('beforeend', `<option value="${ai.id}">${ai.name}</option>`));
  }

  // 計算損益成本
  const runningCosts = {}; 
  const enrichedTx = transactions.sort((a,b)=>a.date.localeCompare(b.date)).map(t => {
    const key = t.ai + '_' + t.ticker;
    if(!runningCosts[key]) runningCosts[key] = { shares: 0, totalCost: 0 };
    const rc = runningCosts[key];
    const amt = t.shares * t.price;
    let fee=0, tax=0, netPl = null;
    t.amount = amt; // 方便排序

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

  // 排序狀態
  let sortCol = 'date';
  let sortDesc = true;

  document.querySelectorAll('#tx-table th.sortable').forEach(th => {
    th.addEventListener('click', () => {
      const col = th.dataset.sort;
      if (sortCol === col) sortDesc = !sortDesc;
      else { sortCol = col; sortDesc = true; }
      
      document.querySelectorAll('#tx-table th.sortable').forEach(h => h.classList.remove('asc', 'desc'));
      th.classList.add(sortDesc ? 'desc' : 'asc');
      draw();
    });
  });

  function draw() {
    const aiFilter = aiSelect.value;
    const actionFilter = actionSelect.value;
    const tickerFilter = tickerInput.value.toLowerCase().trim();

    let rows = enrichedTx.filter(t => {
      const matchAi = !aiFilter || t.ai === aiFilter;
      const matchAction = !actionFilter || t.action === actionFilter;
      const matchTicker = !tickerFilter || t.ticker.includes(tickerFilter) || (t.name && t.name.toLowerCase().includes(tickerFilter));
      return matchAi && matchAction && matchTicker;
    });

    // 排序
    rows.sort((a, b) => {
      let valA = a[sortCol];
      let valB = b[sortCol];
      
      if(valA === null || valA === undefined) valA = -Infinity;
      if(valB === null || valB === undefined) valB = -Infinity;

      if(typeof valA === 'string') {
         return sortDesc ? valB.localeCompare(valA) : valA.localeCompare(valB);
      } else {
         return sortDesc ? valB - valA : valA - valB;
      }
    });

    if(rows.length === 0){
        tbody.innerHTML = `<tr><td colspan="11" class="empty"><b>無符合的交易紀錄</b></td></tr>`;
        return;
    }
    
    tbody.innerHTML = rows.map(t => {
      const aiInfo = config.ais.find(x => x.id === t.ai);
      const icon = aiInfo ? getIconHtml(t.ai) : '';
      const plHtml = t.netPl !== null 
        ? `<span style="color:${t.netPl>=0?'var(--up)':'var(--down)'}">${fmtMoney(t.netPl)}</span>` 
        : '-';

      return `<tr>
        <td class="mono">${t.date}</td>
        <td><span class="ai-tag" style="color:${aiInfo?.color}">${icon} ${t.ai}</span></td>
        <td class="mono">${t.week ?? '-'}</td>
        <td><span class="pill ${t.action}">${t.action === 'buy' ? '買進' : '賣出'}</span></td>
        <td class="mono">${t.ticker} ${t.name || ''}</td>
        <td class="mono">${t.shares}</td>
        <td class="mono">${t.price}</td>
        <td class="mono">${fmtMoney(t.amount)}</td>
        <td class="mono" style="color:var(--text-dim)">${t.fee}</td>
        <td class="mono" style="color:var(--text-dim)">${t.tax || '-'}</td>
        <td class="mono" style="font-weight:600">${plHtml}</td>
      </tr>`;
    }).join('');
  }
  
  aiSelect.addEventListener('change', draw);
  actionSelect.addEventListener('change', draw);
  tickerInput.addEventListener('input', draw);
  
  // 初始設定排序箭頭
  document.querySelector(`#tx-table th[data-sort="date"]`).classList.add('desc');
  draw();
}

function renderJournal(config, journal) {
  const list = document.getElementById('journal-list');
  const select = document.getElementById('journal-filter-ai');
  if(select.options.length === 1) {
    config.ais.forEach(ai => select.insertAdjacentHTML('beforeend', `<option value="${ai.id}">${ai.name}</option>`));
  }

  function draw() {
    const filter = select.value;
    const rows = journal.filter(j => !filter || j.ai === filter).sort((a, b) => b.date.localeCompare(a.date)).reverse();
    if (rows.length === 0) {
      list.innerHTML = `<div class="empty"><b>還沒有週報</b></div>`;
      return;
    }
    
    list.innerHTML = rows.map(j => {
      const htmlContent = typeof DOMPurify !== 'undefined' && typeof marked !== 'undefined'
        ? DOMPurify.sanitize(marked.parse(j.content || '')) 
        : j.content;
        
      const aiInfo = config.ais.find(x => x.id === j.ai);
      
      return `<details class="journal-week" open>
        <summary>
          <span class="weeknum">第 ${j.week} 週</span>
          <span class="ai-tag" style="color:${aiInfo?.color}">${getIconHtml(j.ai)} ${j.ai}</span>
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
