// 使用 getlogo.dev API 來載入各 AI 企業的真實 Logo
const getLogoUrl = (domain) => `https://getlogo.dev/logos/${domain}?token=pub_97e0e4df192f20dd2626307d2148f88d`;

const LOGOS = {
  claude: getLogoUrl('anthropic.com'),
  chatgpt: getLogoUrl('openai.com'),
  gemini: getLogoUrl('google.com') // Google 的 G 圖示
};

// 安全抓取 JSON，防止 404 網頁導致 Safari 拋出 SyntaxError
async function fetchSafeJson(url, fallback) {
  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.warn(`[狀態] 檔案獲取失敗或尚未建立 ${url} (HTTP ${res.status})`);
      return fallback;
    }
    const text = await res.text();
    return JSON.parse(text);
  } catch (e) {
    console.error(`[錯誤] 解析 JSON 失敗 ${url}:`, e);
    return fallback;
  }
}

async function loadData() {
  const bust = 't=' + Date.now();
  const [config, transactions, prices, journal] = await Promise.all([
    fetchSafeJson(`data/config.json?${bust}`, { ais: [], initial_capital: 1000000, start_date: '2026-06-22' }),
    fetchSafeJson(`data/transactions.json?${bust}`, []),
    fetchSafeJson(`data/prices.json?${bust}`, {}),
    fetchSafeJson(`data/journal.json?${bust}`, []),
  ]);
  return { config, transactions, prices, journal };
}

function fmtMoney(n) { return Math.round(n).toLocaleString('zh-Hant-TW'); }
function fmtPct(n) { return (n >= 0 ? '+' : '') + n.toFixed(2) + '%'; }

function getIconHtml(aiId) { 
  return LOGOS[aiId] ? `<img src="${LOGOS[aiId]}" alt="${aiId}">` : ''; 
}

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
  const safeStartDate = startDate || '2026-06-22';
  const startDt = new Date(safeStartDate);
  startDt.setDate(startDt.getDate() - 1);
  const dayZero = startDt.toISOString().slice(0, 10);

  const set = new Set([dayZero, safeStartDate, new Date().toISOString().slice(0, 10)]);
  Object.values(prices).forEach(map => Object.keys(map).forEach(d => { if(d >= dayZero) set.add(d); }));
  return Array.from(set).sort();
}

let scoreboardCharts = [];
let mainChart = null; 

(async function init() {
  setupTabs();
  let config, transactions, prices, journal;
  
  try { 
    ({ config, transactions, prices, journal } = await loadData()); 
  } catch (err) { 
    console.error("資料載入發生未預期錯誤:", err); 
    return; 
  }

  // 確保 config 正確載入
  if(!config || !config.ais) return;

  const dates = buildDateAxis(prices, config.start_date);
  const seriesByAI = {};
  config.ais.forEach(ai => {
    seriesByAI[ai.id] = computeSeries(ai.id, transactions, prices, dates, config);
  });
  
  let bmSeries = [];
  if (config.benchmark_ticker && prices[config.benchmark_ticker]) {
     bmSeries = computeBenchmarkSeries(prices, config.benchmark_ticker, dates, config.initial_capital);
  }

  safeRun(() => renderScoreboard(config, seriesByAI, prices));
  safeRun(() => renderChart(config, dates, seriesByAI, bmSeries));
  safeRun(() => renderHoldingsView(config, seriesByAI, prices, transactions));
  safeRun(() => renderTransactions(config, transactions));
  safeRun(() => renderJournal(config, journal));
})();

function safeRun(fn) { try { fn(); } catch (err) { console.error(err); } }

function renderScoreboard(config, seriesByAI, prices) {
  const el = document.getElementById('scoreboard');
  el.innerHTML = '';
  scoreboardCharts.forEach(c => c.destroy());
  scoreboardCharts = [];

  const bgColors = ['#4A90E2', '#50E3C2', '#F5A623', '#FF6B6B', '#9B51E0', '#B8E986', '#F0F8FF', '#FFD700'];

  config.ais.forEach(ai => {
    const s = seriesByAI[ai.id];
    const today = s[s.length - 1];
    const yesterday = s.length > 1 ? s[s.length - 2] : s[0];
    
    const dailyPlAmt = today.value - yesterday.value;
    const dailyPlPct = (dailyPlAmt / yesterday.value) * 100;
    const dailyUp = dailyPlAmt >= 0;

    const totalPlAmt = today.value - config.initial_capital;
    const totalPlPct = (totalPlAmt / config.initial_capital) * 100;
    const totalPlUp = totalPlAmt >= 0;
    
    let unrealizedAmt = 0;
    let totalCost = 0;
    let stockValueSum = 0;
    const dataLabels = [], dataValues = [], pieColors = [];
    
    let colorIdx = 0;
    Object.keys(today.shares).forEach(ticker => {
      dataLabels.push(ticker);
      
      const curPrice = priceOnOrBefore(prices, ticker, today.date) || (today.cost[ticker] / today.shares[ticker] || 0);
      const val = curPrice * today.shares[ticker];
      
      totalCost += today.cost[ticker];
      stockValueSum += val;
      
      dataValues.push(val);
      pieColors.push(bgColors[colorIdx % bgColors.length]);
      colorIdx++;
    });
    
    unrealizedAmt = stockValueSum - totalCost;
    const unrealizedPct = totalCost > 0 ? (unrealizedAmt / totalCost) * 100 : 0;
    const unrealizedUp = unrealizedAmt >= 0;

    dataLabels.push('現金');
    dataValues.push(today.cash);
    pieColors.push('#262626');

    el.insertAdjacentHTML('beforeend', `
      <div class="card">
        <div class="accent" style="background:${ai.color}"></div>
        <div class="sb-layout">
          <div class="sb-left">
            <div class="card-head">
              <span style="color:${ai.color}; display:flex; align-items:center;">${getIconHtml(ai.id)}</span>
              <span class="name">${ai.name}</span>
            </div>
            <div class="value-big mono">NT$ ${fmtMoney(today.value)}</div>
            <div class="ret ${dailyUp ? 'up' : 'down'} mono">
              未實現 P&L: ${fmtMoney(unrealizedAmt)} / ${fmtPct(unrealizedPct)}
            </div>
            <div class="ret ${totalPlUp ? 'up' : 'down'} mono" style="margin-top:4px; font-size:12px;">
              累積 P&L: ${fmtMoney(totalPlAmt)} / ${fmtPct(totalPlPct)}
            </div>
          </div>
          <div class="sb-right">
            <canvas id="sb-donut-${ai.id}"></canvas>
            <div class="donut-center-text">
              <div class="lbl">今日 P&L</div>
              <div class="val mono" style="color:${dailyUp ? 'var(--up)' : 'var(--down)'}">
                ${fmtMoney(dailyPlAmt)}<br/>${fmtPct(dailyPlPct)}
              </div>
            </div>
          </div>
        </div>
      </div>
    `);

    const ctx = document.getElementById(`sb-donut-${ai.id}`);
    const tooltipData = {}; // key: label, value: { name, val, pct, unplPct }
    
    scoreboardCharts.push(new Chart(ctx, {
      type: 'doughnut',
      data: { labels: dataLabels, datasets: [{ data: dataValues, backgroundColor: pieColors, borderWidth: 0 }] },
      options: { cutout: '80%', plugins: { legend: { display: false }, tooltip: { enabled: false } }, responsive:true, maintainAspectRatio:false }
    }));
  });
}

function renderChart(config, dates, seriesByAI, bmSeries) {
  const ctx = document.getElementById('chart-main');
  if (typeof Chart === 'undefined') return;

  if (mainChart) mainChart.destroy();

  const datasets = config.ais.map(ai => ({
    label: ai.name,
    data: seriesByAI[ai.id].map(p => (((p.value - config.initial_capital) / config.initial_capital) * 100).toFixed(2)),
    borderColor: ai.color,
    backgroundColor: ai.color, // 安全的 6 碼實色
    borderWidth: 2,
    pointRadius: 0, tension: 0.25,
  }));
  
  if(bmSeries && bmSeries.length > 0) {
    datasets.push({
      label: `大盤基準 (${config.benchmark})`,
      data: bmSeries.map(p => (((p.value - config.initial_capital) / config.initial_capital) * 100).toFixed(2)),
      borderColor: '#9CA3AF', 
      backgroundColor: 'transparent', 
      borderDash: [5, 5],
      borderWidth: 1.5, 
      pointRadius: 0, tension: 0.25,
    });
  }

  mainChart = new Chart(ctx, {
    type: 'line', data: { labels: dates, datasets },
    options: {
      responsive: true,
      interaction: { mode: 'index', intersect: false },
      plugins: { 
        legend: { labels: { color: '#FFFFFF' } }, 
        tooltip: { callbacks: { label: c => `${c.dataset.label}: ${c.formattedValue}%` } } 
      },
      scales: {
        x: { ticks: { color: '#FFFFFF', maxTicksLimit: 8 }, grid: { color: '#262626' } },
        y: { ticks: { color: '#FFFFFF', callback: v => v + '%' }, grid: { color: '#262626' } },
      }
    }
  });
}

let holdingsCharts = [];
function renderHoldingsView(config, seriesByAI, prices, transactions) {
  const container = document.getElementById('holdings-container');
  // 如果 container 不存在（例如 HTML 尚未更新成最新版本），則相容舊 ID
  if (!container) return; 

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
      const barDataValues = [];  
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
            
            const txName = transactions.find(t=>t.ticker===ticker)?.name || ticker;
            
            dataLabels.push(txName);
          
            dataValues.push(val);
            barDataValues.push(val / 10000); 
            
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
      barDataValues.push(snap.cash / 10000);
      const cashPct = (snap.cash / snap.value) * 100;
      legendRows += `
          <tr>
            <td><span class="color-box" style="background:#262626"></span>現金</td>
            <td class="mono" style="text-align:right">${fmtMoney(snap.cash)}</td>
            <td class="mono" style="text-align:right">${cashPct.toFixed(1)}%</td>
            <td class="mono" style="text-align:right">-</td>
          </tr>
      `;

      const html = `
      <div class="card" style="display:flex; flex-direction:column; gap:16px;">
        <div class="accent" style="background:${ai.color}"></div>
        <div class="card-head" style="justify-content:center">
          <span style="color:${ai.color}; display:flex; align-items:center;">${getIconHtml(ai.id)}</span> <span class="name">${ai.name} 投資組合</span>
        </div>
        
        <div style="position:relative; width:100%; height:220px; margin:0 auto;">
          <canvas id="donut-${ai.id}"></canvas>
          <div class="donut-center-logo">
            ${getIconHtml(ai.id)}
          </div>
        </div>
        
        <canvas id="bar-${ai.id}" height="130"></canvas>
        
        <table class="legend-table">
          <thead><tr><th>標的</th><th style="text-align:right">市值</th><th style="text-align:right">佔比</th><th style="text-align:right">未實現損益</th></tr></thead>
          <tbody>${legendRows}</tbody>
        </table>
      </div>`;
      grid.insertAdjacentHTML('beforeend', html);

      const ctxDonut = document.getElementById(`donut-${ai.id}`);
      holdingsCharts.push(new Chart(ctxDonut, {
        type: 'doughnut',
        data: { labels: dataLabels, datasets: [{ data: dataValues, backgroundColor: [...bgColors.slice(0, tickers.length), '#262626'], borderWidth: 0 }] },
        options: { 
          cutout: '65%', 
          plugins: { 
            legend: { display: true, position: 'right', labels: { color: '#F3F4F6', boxWidth: 12 } } 
          }, 
          responsive:true, 
          maintainAspectRatio:false 
        }
      }));

      const ctxBar = document.getElementById(`bar-${ai.id}`);
      holdingsCharts.push(new Chart(ctxBar, {
        type: 'bar',
        data: { labels: dataLabels, datasets: [{ data: barDataValues, backgroundColor: [...bgColors.slice(0, tickers.length), '#262626'], borderRadius: 4 }] },
        options: { 
          plugins: { 
            legend: { display: false },
            tooltip: { callbacks: { label: c => c.formattedValue + ' 萬' } }
          }, 
          scales: { 
            x: { ticks: { color: '#9CA3AF' }, grid: { display:false } }, 
            y: { ticks: { color: '#9CA3AF' }, grid: { color: '#262626' } } 
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
  
  if(aiSelect && aiSelect.options.length === 1) {
    config.ais.forEach(ai => aiSelect.insertAdjacentHTML('beforeend', `<option value="${ai.id}">${ai.name}</option>`));
  }

  const runningCosts = {}; 
  const enrichedTx = transactions.sort((a,b)=>a.date.localeCompare(b.date)).map(t => {
    const key = t.ai + '_' + t.ticker;
    if(!runningCosts[key]) runningCosts[key] = { shares: 0, totalCost: 0 };
    const rc = runningCosts[key];
    const amt = t.shares * t.price;
    let fee=0, tax=0, netPl = null;
    t.amount = amt; 

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
    const aiFilter = aiSelect ? aiSelect.value : '';
    const actionFilter = actionSelect ? actionSelect.value : '';
    const tickerFilter = tickerInput ? tickerInput.value.toLowerCase().trim() : '';

    let rows = enrichedTx.filter(t => {
      const matchAi = !aiFilter || t.ai === aiFilter;
      const matchAction = !actionFilter || t.action === actionFilter;
      const matchTicker = !tickerFilter || t.ticker.includes(tickerFilter) || (t.name && t.name.toLowerCase().includes(tickerFilter));
      return matchAi && matchAction && matchTicker;
    });

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
        <td><span class="ai-tag" style="color:${aiInfo?.color}; display:flex; align-items:center; gap:6px;">${icon} ${t.ai}</span></td>
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
  
  if(aiSelect) aiSelect.addEventListener('change', draw);
  if(actionSelect) actionSelect.addEventListener('change', draw);
  if(tickerInput) tickerInput.addEventListener('input', draw);
  const sortHeader = document.querySelector(`#tx-table th[data-sort="date"]`);
  if (sortHeader) sortHeader.classList.add('desc');
  draw();
}

function renderJournal(config, journal) {
  const list = document.getElementById('journal-list');
  const select = document.getElementById('journal-filter-ai');
  if(select && select.options.length === 1) {
    config.ais.forEach(ai => select.insertAdjacentHTML('beforeend', `<option value="${ai.id}">${ai.name}</option>`));
  }

  function draw() {
    const filter = select ? select.value : '';
    const rows = journal.filter(j => !filter || j.ai === filter).sort((a, b) => b.date.localeCompare(a.date));
    if (rows.length === 0) {
      list.innerHTML = `<div class="empty"><b>還沒有週報</b></div>`;
      return;
    }
    
    list.innerHTML = rows.map(j => {
      const htmlContent = typeof DOMPurify !== 'undefined' && typeof marked !== 'undefined'
        ? DOMPurify.sanitize(marked.parse(j.content || '')) 
        : j.content;
        
      const aiInfo = config.ais.find(x => x.id === j.ai);
      
      return `<details class="journal-week">
        <summary>
          <span class="weeknum">第 ${j.week} 週</span>
          <span class="ai-tag" style="color:${aiInfo?.color}; display:flex; align-items:center; gap:6px;">${getIconHtml(j.ai)} ${j.ai}</span>
          <span class="mono" style="color:var(--text-dim)">${j.date}</span>
          <strong style="margin-left:auto">${j.title || ''}</strong>
        </summary>
        <div class="content markdown-body">${htmlContent}</div>
      </details>`;
    }).join('');
  }
  if(select) select.addEventListener('change', draw);
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
