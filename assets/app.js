// 使用 getlogo.dev API 來載入各 AI 企業的真實 Logo
const getLogoUrl = (domain) => `https://getlogo.dev/logos/${domain}?token=pub_97e0e4df192f20dd2626307d2148f88d`;

const LOGOS = {
  claude: getLogoUrl('anthropic.com'),
  chatgpt: getLogoUrl('openai.com'),
  gemini: getLogoUrl('google.com') // Google 的 G 圖示
};


const BENCHMARKS = [
  { ticker: '2330',   name: '台積電',        domain: 'tsmc.com' },       // 台積電
  { ticker: '0050',   name: '元大台灣50',    domain: 'yuanta.com' },  // 元大證券
  { ticker: '00631L', name: '元大台灣50正2', domain: 'yuanta.com' },  // 元大證券
  { ticker: '00981A', name: '統一台股增長',  domain: 'uni-president.com' },  // 統一證券
];

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
  return LOGOS[aiId] ? `<img src="${LOGOS[aiId]}" alt="${aiId}" onerror="this.style.display='none'">` : ''; 
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

  // 注意：這裡不能無條件把「今天」塞進日期軸——如果今天是週末或颱風假等非交易日，
  // prices.json 裡不會有任何一檔股票的資料，硬塞進去會讓走勢圖多出一段沒有意義的平線。
  // 日期軸只由「實際有交易資料的日子」組成，最新的一天自然就是最後一個真實交易日。
  const set = new Set([dayZero, safeStartDate]);
  Object.values(prices).forEach(map => Object.keys(map).forEach(d => { if(d >= dayZero) set.add(d); }));
  return Array.from(set).sort();
}

let scoreboardCharts = [];
let mainChart = null;

if (typeof Chart !== 'undefined') {
  Chart.defaults.animation = false;
}

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
  
  safeRun(() => renderScoreboard(config, seriesByAI, prices, transactions));
  safeRun(() => renderChart(config, dates, seriesByAI, prices));
  safeRun(() => renderHoldingsView(config, seriesByAI, prices, transactions));
  safeRun(() => renderTransactions(config, transactions));
  safeRun(() => renderJournal(config, journal));
})();

function safeRun(fn) { try { fn(); } catch (err) { console.error(err); } }

// ---- 自訂外部 Tooltip：避開 .card{overflow:hidden} 造成的裁切問題 ----
function scoreboardExternalTooltip(context) {
  const { chart, tooltip } = context;
  let el = document.getElementById('sb-external-tooltip');
  if (!el) {
    el = document.createElement('div');
    el.id = 'sb-external-tooltip';
    el.style.position = 'fixed';
    el.style.pointerEvents = 'none';
    el.style.zIndex = '9999';
    el.style.background = '#FFF3CD';
    el.style.border = '1px solid #E8C77E';
    el.style.borderRadius = '8px';
    el.style.padding = '8px 10px';
    el.style.color = '#1a1a1a';
    el.style.fontFamily = "'Inter', sans-serif";
    el.style.fontSize = '12px';
    el.style.whiteSpace = 'nowrap';
    el.style.boxShadow = '0 6px 18px rgba(0,0,0,0.4)';
    el.style.transition = 'opacity 0.08s ease';
    document.body.appendChild(el);
  }

  if (tooltip.opacity === 0) {
    el.style.opacity = '0';
    return;
  }

  const titleLines = tooltip.title || [];
  const bodyLines = (tooltip.body || []).map(b => b.lines).flat();
  let html = '';
  if (titleLines.length) html += `<div style="font-weight:700; margin-bottom:4px;">${titleLines.join('')}</div>`;
  bodyLines.forEach(line => { if (line) html += `<div>${line}</div>`; });
  el.innerHTML = html;

  const canvasRect = chart.canvas.getBoundingClientRect();
  el.style.opacity = '1';
  el.style.left = (canvasRect.left + tooltip.caretX) + 'px';
  el.style.top = (canvasRect.top + tooltip.caretY) + 'px';
  el.style.transform = 'translate(-50%, -115%)';
}

function renderScoreboard(config, seriesByAI, prices, transactions) {
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
    const tooltipItems = []; // 與 dataLabels/dataValues 同步索引：{ ticker, name, val, unplPct }

    let colorIdx = 0;
    Object.keys(today.shares).forEach(ticker => {
      const curPrice = priceOnOrBefore(prices, ticker, today.date) || (today.cost[ticker] / today.shares[ticker] || 0);
      const val = curPrice * today.shares[ticker];
      const costVal = today.cost[ticker] || 0;
      const unpl = val - costVal;
      const unplPct = costVal > 0 ? (unpl / costVal) * 100 : 0;
      const txName = (transactions || []).find(t => t.ticker === ticker)?.name || ticker;

      totalCost += costVal;
      stockValueSum += val;

      dataLabels.push(ticker);
      dataValues.push(val);
      pieColors.push(bgColors[colorIdx % bgColors.length]);
      tooltipItems.push({ ticker, name: txName, val, unplPct, price: curPrice });
      colorIdx++;
    });
    
    unrealizedAmt = stockValueSum - totalCost;
    const unrealizedPct = totalCost > 0 ? (unrealizedAmt / totalCost) * 100 : 0;
    const unrealizedUp = unrealizedAmt >= 0;

    // 現金 = NAV(當前總資產) - 持股市值加總，確保圓餅圖與總資產永遠對得起來，理論上不會是負值
    const derivedCash = Math.max(0, today.value - stockValueSum);

    dataLabels.push('現金');
    dataValues.push(derivedCash);
    pieColors.push('#262626');
    tooltipItems.push({ ticker: '現金', name: '現金', val: derivedCash, unplPct: null, price: null });

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
            <div class="ret ${unrealizedUp ? 'up' : 'down'} mono">
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

// ---- 自訂外部 Tooltip：避開 .card{overflow:hidden} 造成的裁切問題 ----
    const ctx = document.getElementById(`sb-donut-${ai.id}`);

    scoreboardCharts.push(new Chart(ctx, {
      type: 'doughnut',
      data: { labels: dataLabels, datasets: [{ data: dataValues, backgroundColor: pieColors, borderWidth: 0 }] },
      options: {
        cutout: '80%',
        plugins: {
          legend: { display: false },
          tooltip: {
            enabled: false,
            external: scoreboardExternalTooltip,
            callbacks: {
              title: (items) => {
                const it = tooltipItems[items[0].dataIndex];
                return it.ticker === it.name ? it.name : `${it.ticker} ${it.name}`;
              },
              label: (item) => {
                const it = tooltipItems[item.dataIndex];
                return it.price != null ? `最新股價：NT$ ${it.price.toLocaleString('zh-Hant-TW')}` : '';
              }
            }
          }
        },
        responsive:true,
        maintainAspectRatio:false
      }
    }));
  });
}

// ---- 累積報酬圖：終點 Logo + 數據標籤 ----
// 用「圖片網址」當 key 的共用快取，AI 和 Benchmark 的 logo 都能共用同一套繪製邏輯
const imgCache = {};
function getImgByUrl(url) {
  if (!url) return null;
  if (!imgCache[url]) {
    const img = new Image();
    // 注意：這裡故意不設定 crossOrigin，因為 getlogo.dev 不一定會回傳 CORS header，
    // 設定 crossOrigin='anonymous' 反而可能導致圖片載入失敗(靜默失敗、logo消失不見)。
    // 我們只需要把圖畫上 canvas，不需要用 getImageData/toDataURL 讀取像素，所以不需要 CORS。
    img.onload = () => { if (mainChart) mainChart.draw(); };
    img.onerror = () => { /* 載入失敗就不畫 logo，仍保留百分比標籤 */ };
    img.src = url;
    imgCache[url] = img;
  }
  return imgCache[url];
}
function getLogoImg(aiId) { return getImgByUrl(LOGOS[aiId]); }
// 頁面載入時就先預熱 AI 與 Benchmark 的 logo 圖片，讓走勢圖第一次畫出來時 logo 大機率已經就緒
Object.keys(LOGOS).forEach(aiId => getLogoImg(aiId));
BENCHMARKS.forEach(b => getImgByUrl(getLogoUrl(b.domain)));

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function makeEndpointLabelPlugin() {
  return {
    id: 'endpointLabel',
    afterDatasetsDraw(chart) {
      const { ctx } = chart;
      chart.data.datasets.forEach((ds, i) => {
        const meta = chart.getDatasetMeta(i);
        if (meta.hidden || !meta.data || meta.data.length === 0) return;
        const lastPoint = meta.data[meta.data.length - 1];
        const lastVal = Number(ds.data[ds.data.length - 1]);
        const text = `${lastVal >= 0 ? '+' : ''}${lastVal}%`;
        const color = ds.borderColor;
        const x = lastPoint.x;
        const y = lastPoint.y;
        const logoSize = 18;
        const gap = 6;

        ctx.save();

        // 標籤群組(logo + 百分比)整體往線的終點右側偏移，logo 在前、百分比在後
        let cursorX = x + 8;
        const centerY = y;

        // 終點 Logo：AI 模型用真實圖片 logo；Benchmark 用自繪的色塊縮寫(ds._badge)
        const img = getImgByUrl(ds._logoUrl);
        if (img && img.complete && img.naturalWidth > 0) {
          ctx.save();
          ctx.beginPath();
          ctx.arc(cursorX + logoSize / 2, centerY, logoSize / 2 + 2, 0, Math.PI * 2);
          ctx.fillStyle = '#0d0d0d';
          ctx.fill();
          ctx.clip();
          ctx.drawImage(img, cursorX, centerY - logoSize / 2, logoSize, logoSize);
          ctx.restore();
          cursorX += logoSize + gap;
        }

        // 終點數據標籤(色底白字)，緊接在 logo 後面
        ctx.font = '700 11px Inter, sans-serif';
        const textWidth = ctx.measureText(text).width;
        const padX = 7;
        const pillW = textWidth + padX * 2;
        const pillH = 18;
        const pillX = cursorX;
        const pillY = centerY - pillH / 2;

        ctx.fillStyle = color;
        roundRect(ctx, pillX, pillY, pillW, pillH, 9);
        ctx.fill();

        ctx.fillStyle = '#FFFFFF';
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'left';
        ctx.fillText(text, pillX + padX, pillY + pillH / 2 + 1);

        ctx.restore();
      });
    }
  };
}

function getPeriodStartIndex(dates, period) {
  if (!period || period === 'ALL') return 0;
  const lastDate = new Date(dates[dates.length - 1]);
  let startDate = new Date(lastDate);
  if (period === '1D') startDate.setDate(startDate.getDate() - 1);
  else if (period === '1W') startDate.setDate(startDate.getDate() - 7);
  else if (period === '1M') startDate.setMonth(startDate.getMonth() - 1);
  else if (period === 'YTD') startDate = new Date(lastDate.getFullYear(), 0, 1);
  else if (period === '1Y') startDate.setFullYear(startDate.getFullYear() - 1);
  else return 0;

  const startStr = startDate.toISOString().slice(0, 10);
  const idx = dates.findIndex(d => d >= startStr);
  return idx === -1 ? 0 : idx;
}

function renderChart(config, dates, seriesByAI, prices) {
  const ctx = document.getElementById('chart-main');
  if (typeof Chart === 'undefined') return;

  let currentBenchmark = (BENCHMARKS.find(b => b.ticker === config.benchmark_ticker) || BENCHMARKS[1]).ticker;

  function draw(period) {
    if (mainChart) mainChart.destroy();

    const startIdx = getPeriodStartIndex(dates, period);
    const viewDates = dates.slice(startIdx);
    const rebase = period && period !== 'ALL';

    const datasets = config.ais.map(ai => {
      const series = seriesByAI[ai.id].slice(startIdx);
      const baseValue = rebase ? series[0].value : config.initial_capital;
      return {
        label: ai.name,
        data: series.map(p => (((p.value - baseValue) / baseValue) * 100).toFixed(2)),
        borderColor: ai.color,
        backgroundColor: ai.color, // 安全的 6 碼實色
        borderWidth: 2,
        pointRadius: 0, tension: 0.25,
        _logoUrl: LOGOS[ai.id] || null,
      };
    });

    const bmMeta = BENCHMARKS.find(b => b.ticker === currentBenchmark);
    if (bmMeta && prices[bmMeta.ticker]) {
      const bmSeriesFull = computeBenchmarkSeries(prices, bmMeta.ticker, dates, config.initial_capital);
      const bmSlice = bmSeriesFull.slice(startIdx);
      const bmBase = rebase ? bmSlice[0].value : config.initial_capital;
      datasets.push({
        label: bmMeta.name,
        data: bmSlice.map(p => (((p.value - bmBase) / bmBase) * 100).toFixed(2)),
        borderColor: '#EF4444', // Benchmark 固定用紅色
        backgroundColor: 'transparent',
        borderDash: [5, 5],
        borderWidth: 1.5,
        pointRadius: 0, tension: 0.25,
        _logoUrl: getLogoUrl(bmMeta.domain)
      });
    }

    mainChart = new Chart(ctx, {
      type: 'line', data: { labels: viewDates, datasets },
      plugins: [makeEndpointLabelPlugin()],
      options: {
        responsive: true,
        interaction: { mode: 'index', intersect: false },
        layout: { padding: { right: 96, top: 12 } },
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

  const periodBar = document.getElementById('chart-period-filter');
  if (periodBar && !periodBar.dataset.bound) {
    periodBar.querySelectorAll('.period-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        periodBar.querySelectorAll('.period-btn').forEach(b => b.classList.remove('primary'));
        btn.classList.add('primary');
        draw(btn.dataset.period);
      });
    });
    periodBar.dataset.bound = '1';
  }

  const bmBar = document.getElementById('chart-benchmark-filter');
  if (bmBar && !bmBar.dataset.bound) {
    bmBar.querySelectorAll('.benchmark-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        bmBar.querySelectorAll('.benchmark-btn').forEach(b => b.classList.remove('primary'));
        btn.classList.add('primary');
        currentBenchmark = btn.dataset.benchmark;
        const activePeriodBtn = periodBar ? periodBar.querySelector('.period-btn.primary') : null;
        draw(activePeriodBtn ? activePeriodBtn.dataset.period : 'ALL');
      });
    });
    bmBar.dataset.bound = '1';
  }

  draw('ALL');
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
      
      const bgColors = ['#4A90E2', '#50E3C2', '#F5A623', '#FF6B6B', '#9B51E0', '#B8E986'];

      // 先計算每檔股票的市值/成本，再依投資金額(市值)由大到小排序
      const tickerData = Object.keys(snap.shares).map(ticker => {
        const curPrice = priceOnOrBefore(prices, ticker, targetDate);
        if (!curPrice) return null;
        const val = snap.shares[ticker] * curPrice;
        const cost = snap.cost[ticker] || 0;
        const unpl = val - cost;
        const unplPct = cost > 0 ? (unpl / cost) * 100 : 0;
        const txName = transactions.find(t => t.ticker === ticker)?.name || ticker;
        return { ticker, val, cost, unpl, unplPct, txName };
      }).filter(Boolean).sort((a, b) => b.val - a.val);

      const dataLabels = [];
      const dataValues = [];
      const barLabels = [];
      const barDataValues = [];

      let legendRows = '';
      let totalCost = 0;
      let stockValueSum = 0;

      tickerData.forEach((td, i) => {
        const pctOfPort = (td.val / snap.value) * 100;
        const up = td.unpl >= 0;
        const cStr = bgColors[i % bgColors.length];

        totalCost += td.cost;
        stockValueSum += td.val;

        dataLabels.push(td.txName);
        dataValues.push(td.val);
        barLabels.push(td.txName);
        barDataValues.push(td.val / 10000);

        legendRows += `
          <tr>
            <td><span class="color-box" style="background:${cStr}"></span><span class="mono">${td.ticker}</span> ${td.txName}</td>
            <td class="mono" style="text-align:right">${fmtMoney(td.val)}</td>
            <td class="mono" style="text-align:right">${pctOfPort.toFixed(1)}%</td>
            <td class="mono" style="text-align:right; color:${up?'var(--up)':'var(--down)'}">${fmtPct(td.unplPct)}</td>
          </tr>
        `;
      });

      const unrealizedAmt = stockValueSum - totalCost;
      const unrealizedPct = totalCost > 0 ? (unrealizedAmt / totalCost) * 100 : 0;
      const unrealizedUp = unrealizedAmt >= 0;

      // 現金 = NAV - 持股市值加總，理論上不應為負
      const derivedCash = Math.max(0, snap.value - stockValueSum);

      dataLabels.push('現金');
      dataValues.push(derivedCash);
      const cashPct = snap.value > 0 ? (derivedCash / snap.value) * 100 : 0;
      legendRows += `
          <tr>
            <td><span class="color-box" style="background:#262626"></span>現金</td>
            <td class="mono" style="text-align:right">${fmtMoney(derivedCash)}</td>
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
        <div class="donut-wrap" style="position:relative; width:100%; height:220px; margin:0 auto;">
          <canvas id="donut-${ai.id}"></canvas>
          <div class="donut-center-text">
            <div class="lbl" style="color:#fff;">未實現 P&amp;L</div>
            <div class="val mono" style="color:${unrealizedUp ? 'var(--up)' : 'var(--down)'}; font-size:20px; font-weight:800;">
              ${fmtMoney(unrealizedAmt)}<br/>${fmtPct(unrealizedPct)}
            </div>
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
        data: { labels: dataLabels, datasets: [{ data: dataValues, backgroundColor: [...bgColors.slice(0, tickerData.length), '#262626'], borderWidth: 0 }] },
        options: { 
          cutout: '65%', 
          plugins: { 
            legend: { display: false },
            tooltip: {
              // 預設 title 就會顯示股票名稱，label 不再重複顯示名稱，避免出現兩次
              callbacks: {
                label: (item) => {
                  const val = item.parsed;
                  const pct = snap.value > 0 ? (val / snap.value) * 100 : 0;
                  return `NT$ ${fmtMoney(val)} (${pct.toFixed(1)}%)`;
                }
              }
            }
          }, 
          responsive:true, 
          maintainAspectRatio:false 
        }
      }));

      const ctxBar = document.getElementById(`bar-${ai.id}`);
      holdingsCharts.push(new Chart(ctxBar, {
        type: 'bar',
        data: { labels: barLabels, datasets: [{ data: barDataValues, backgroundColor: bgColors.slice(0, tickerData.length), borderRadius: 4 }] },
        options: { 
          plugins: { 
            legend: { display: false },
            tooltip: { callbacks: { label: c => c.formattedValue + ' 萬' } }
          }, 
          scales: { 
            x: { ticks: { color: '#FFFFFF' }, grid: { display:false } }, 
            y: { ticks: { color: '#FFFFFF' }, grid: { color: '#262626' } } 
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
  const dateSelect = document.getElementById('journal-filter-date');
  if(select && select.options.length === 1) {
    config.ais.forEach(ai => select.insertAdjacentHTML('beforeend', `<option value="${ai.id}">${ai.name}</option>`));
  }
  if(dateSelect && dateSelect.options.length === 1) {
    const dates = [...new Set(journal.map(j => j.date).filter(Boolean))].sort((a, b) => b.localeCompare(a));
    dates.forEach(d => dateSelect.insertAdjacentHTML('beforeend', `<option value="${d}">${d}</option>`));
  }

  function draw() {
    const filter = select ? select.value : '';
    const dateFilter = dateSelect ? dateSelect.value : '';
    const rows = journal.filter(j => {
      const matchAi = !filter || j.ai === filter;
      const matchDate = !dateFilter || j.date === dateFilter;
      return matchAi && matchDate;
    }).sort((a, b) => b.date.localeCompare(a.date));
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
  if(dateSelect) dateSelect.addEventListener('change', draw);
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

      // 修正：圖表若是在隱藏(display:none)的分頁中建立，Chart.js 量測畫布尺寸會失敗，
      // 導致圖表顯示不出來(尤其常見於 Windows Chrome)。切換分頁後強制重新計算尺寸。
      requestAnimationFrame(() => {
        if (typeof Chart !== 'undefined' && Chart.instances) {
          Object.values(Chart.instances).forEach(c => { try { c.resize(); } catch (e) {} });
        }
      });
    });
  });
}
