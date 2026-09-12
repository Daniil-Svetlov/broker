// Проверочный data-слой: ветка main, но вместо socket.io — REST к новому бэку.
//   живая цена  -> GET  {quotesBase}/price?symbol=PAIR        (Go quotes-service)
//   открыть     -> POST {apiBase}/api/trades/                 (Django)
//   закрыть     -> POST {apiBase}/api/trades/<id>/settle/     (когда истёк срок)
//   баланс      -> GET  {apiBase}/api/accounts/<accountId>/   (Django)
// UI-функции (меню, отрисовка) — как в main.

const CFG = window.LUMIT_CONFIG || {};
const QUOTES = CFG.quotesBase || (location.origin + '/quotes');
const API = CFG.apiBase || location.origin;
const POLL = CFG.pollMs || 1000;
// accountId: localStorage переопределяет config.js (удобно не трогать файл).
const ACCOUNT_ID = localStorage.getItem('lumit_account_id') || CFG.accountId || '';
// Плейсхолдер из config.js — значит bootstrap.sh не запускали. Считаем «не задан»,
// иначе POST уйдёт с '__ACCOUNT_ID__' и Django ответит невнятным «not a valid UUID».
const ACCOUNT_OK = !!ACCOUNT_ID && ACCOUNT_ID !== '__ACCOUNT_ID__';

// --- кэш свечей для мгновенного рендера при повторном заходе ---
const CHART_CACHE_PREFIX = 'lumit_chart_cache_';
const CHART_CACHE_MAX_POINTS = 300;
const CHART_CACHE_SAVE_INTERVAL_MS = 5000;

let priceHistory = [];
let lastCacheSaveAt = 0;
let skeletonHidden = false;

let accountType = localStorage.getItem('lumit_account_type') || 'demo'; // 'demo' | 'real'
let balances = { demo: 0, real: 0 };

let currentPair = 'EUR/USD';
let activeSeries = null;
let chartType = localStorage.getItem('lumit_chart_type') || 'line'; // 'line' | 'candles' | 'bars'
let candleIntervalSec = parseInt(localStorage.getItem('lumit_candle_interval') || '60', 10);
let candles = [];
let chart = null;
let balance = 0;
let activeTrades = [];
let countdownIntervals = [];
let lastChartTime = 0;
// Статистика сессии (бэкенд агрегатов не отдаёт — считаем локально).
let stats = { wins: 0, total: 0, profit: 0 };

const activeTradeLines = new Map();

// Векторные SVG-значки (без эмодзи)
const SVG_CHECK = `<svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
const SVG_CROSS = `<svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`;

let drawTool = 'none';        // 'none' | 'hline' | 'trend' | 'rect' | 'fib' | 'erase'
let drawings = [];
let pendingPoints = [];
let hoverPoint = null;
let drawCanvas = null;
let drawCtx = null;

let indicators = [];
let subCharts = {};

const DEFAULT_PARAMS = {
  SMA: { period: 14, color: '#FF9F0A', lineWidth: 2 },
  EMA: { period: 14, color: '#5856D6', lineWidth: 2 },
  BB: { period: 20, stdDev: 2, color: '#00D4AA', lineWidth: 1 },
  RSI: { period: 14, color: '#FF9F0A', lineWidth: 2 },
  MACD: { fast: 12, slow: 26, signal: 9, colorMacd: '#007AFF', colorSignal: '#FF9F0A' },
};

function genIndId() { return 'ind_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6); }

// --- унифицированный ряд закрытий под текущий режим графика ---
function getClosesSeries() {
  if (chartType === 'line') {
    return priceHistory.map(p => ({ time: p.time, close: p.value }));
  }
  return candles.map(c => ({ time: c.time, close: c.close }));
}

// --- матем. расчёты ---
function calcSMA(closes, period) {
  const out = [];
  for (let i = period - 1; i < closes.length; i++) {
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += closes[j].close;
    out.push({ time: closes[i].time, value: sum / period });
  }
  return out;
}

function calcEMA(closes, period) {
  const out = [];
  const k = 2 / (period + 1);
  let prev = null;
  closes.forEach((c, i) => {
    if (i === period - 1) {
      let sum = 0;
      for (let j = 0; j < period; j++) sum += closes[j].close;
      prev = sum / period;
      out.push({ time: c.time, value: prev });
    } else if (i >= period) {
      prev = c.close * k + prev * (1 - k);
      out.push({ time: c.time, value: prev });
    }
  });
  return out;
}

function calcRSI(closes, period) {
  const out = [];
  if (closes.length < period + 1) return out;
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i].close - closes[i - 1].close;
    if (diff >= 0) gains += diff; else losses -= diff;
  }
  let avgGain = gains / period, avgLoss = losses / period;
  out.push({ time: closes[period].time, value: rsiFromAvg(avgGain, avgLoss) });
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i].close - closes[i - 1].close;
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    out.push({ time: closes[i].time, value: rsiFromAvg(avgGain, avgLoss) });
  }
  return out;
}
function rsiFromAvg(avgGain, avgLoss) {
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

function calcBollinger(closes, period, stdDevMult) {
  const upper = [], mid = [], lower = [];
  for (let i = period - 1; i < closes.length; i++) {
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += closes[j].close;
    const mean = sum / period;
    let variance = 0;
    for (let j = i - period + 1; j <= i; j++) variance += (closes[j].close - mean) ** 2;
    const sd = Math.sqrt(variance / period);
    const t = closes[i].time;
    mid.push({ time: t, value: mean });
    upper.push({ time: t, value: mean + stdDevMult * sd });
    lower.push({ time: t, value: mean - stdDevMult * sd });
  }
  return { upper, mid, lower };
}

function calcMACD(closes, fast, slow, signal) {
  const emaFast = calcEMA(closes, fast);
  const emaSlow = calcEMA(closes, slow);
  const slowMap = new Map(emaSlow.map(p => [p.time, p.value]));
  const macdLine = emaFast
    .filter(p => slowMap.has(p.time))
    .map(p => ({ time: p.time, close: p.value - slowMap.get(p.time) }));
  const signalLine = calcEMA(macdLine, signal).map(p => ({ time: p.time, value: p.value }));
  const signalMap = new Map(signalLine.map(p => [p.time, p.value]));
  const hist = macdLine
    .filter(p => signalMap.has(p.time))
    .map(p => ({ time: p.time, value: p.close - signalMap.get(p.time) }));
  return {
    macd: macdLine.map(p => ({ time: p.time, value: p.close })),
    signal: signalLine,
    hist,
  };
}

function toggleAccountMenu(evt) {
  if (evt) evt.stopPropagation();
  document.getElementById('account-switcher').classList.toggle('open');
}

function closeAccountMenu() {
  document.getElementById('account-switcher').classList.remove('open');
}

function selectAccountType(type) {
  if (type === accountType) { closeAccountMenu(); return; }
  accountType = type;
  localStorage.setItem('lumit_account_type', type);
  updateAccountUI();
  closeAccountMenu();
  document.getElementById('status-bar').innerText =
    type === 'real' ? 'Переключено на реальный счёт' : 'Переключено на демо-счёт';
}

function updateAccountUI() {
  const badge = document.getElementById('account-badge');
  badge.innerText = accountType === 'real' ? 'REAL' : 'DEMO';
  badge.classList.toggle('real', accountType === 'real');

  document.getElementById('balance-amount-header').innerText = fmtMoney(balances[accountType]);
  document.getElementById('account-balance-demo').innerText = fmtMoney(balances.demo);
  document.getElementById('account-balance-real').innerText = fmtMoney(balances.real);

  document.querySelectorAll('.account-option').forEach(b =>
    b.classList.toggle('active', b.getAttribute('data-account-type') === accountType));

  // balance используется в sendTrade для проверки "хватает ли средств"
  balance = balances[accountType];
}

// --- форматирование цены: форекс требует больше знаков, чем .toFixed(2) ---
function fmtPrice(v) {
  if (!isFinite(v)) return '—';
  return v >= 100 ? v.toFixed(3) : v.toFixed(5);
}

function fmtMoney(v) {
  return `$${Number(v).toFixed(2)}`;
}

function cacheKeyFor(pair) {
  return CHART_CACHE_PREFIX + pair.replace('/', '_');
}

function loadCachedHistory(pair) {
  try {
    const raw = localStorage.getItem(cacheKeyFor(pair));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.warn('Кэш графика повреждён, игнорирую:', err);
    return [];
  }
}

function saveCachedHistory(pair, history) {
  try {
    const trimmed = history.slice(-CHART_CACHE_MAX_POINTS);
    localStorage.setItem(cacheKeyFor(pair), JSON.stringify(trimmed));
  } catch (err) {
    // localStorage переполнен/недоступен (приватный режим) — не критично.
    console.warn('Не удалось сохранить кэш графика:', err);
  }
}

function maybePersistHistory() {
  const now = Date.now();
  if (now - lastCacheSaveAt < CHART_CACHE_SAVE_INTERVAL_MS) return;
  lastCacheSaveAt = now;
  saveCachedHistory(currentPair, priceHistory);
}

function hideSkeleton() {
  if (skeletonHidden) return;
  skeletonHidden = true;
  const el = document.getElementById('chart-skeleton');
  if (el) el.classList.add('hidden');
}

function createSeriesForType(type) {
  if (type === 'candles') {
    return chart.addCandlestickSeries({
      upColor: '#30D158', downColor: '#FF453A',
      borderUpColor: '#30D158', borderDownColor: '#FF453A',
      wickUpColor: '#30D158', wickDownColor: '#FF453A',
      priceLineVisible: false,
    });
  }
  if (type === 'bars') {
    return chart.addBarSeries({
      upColor: '#30D158', downColor: '#FF453A',
      thinBars: false,
      priceLineVisible: false,
    });
  }
  return chart.addLineSeries({ color: '#007AFF', lineWidth: 2, priceLineVisible: false });
}

function buildCandlesFromHistory(history, intervalSec) {
  const result = [];
  let cur = null;
  for (const pt of history) {
    const bucket = Math.floor(pt.time / intervalSec) * intervalSec;
    if (!cur || cur.time !== bucket) {
      if (cur) result.push(cur);
      cur = { time: bucket, open: pt.value, high: pt.value, low: pt.value, close: pt.value };
    } else {
      cur.high = Math.max(cur.high, pt.value);
      cur.low = Math.min(cur.low, pt.value);
      cur.close = pt.value;
    }
  }
  if (cur) result.push(cur);
  return result;
}

function updateCandleFromTick(point) {
  const bucket = Math.floor(point.time / candleIntervalSec) * candleIntervalSec;
  const last = candles[candles.length - 1];
  if (last && last.time === bucket) {
    last.high = Math.max(last.high, point.value);
    last.low = Math.min(last.low, point.value);
    last.close = point.value;
  } else {
    candles.push({ time: bucket, open: point.value, high: point.value, low: point.value, close: point.value });
    if (candles.length > CHART_CACHE_MAX_POINTS) candles.shift();
  }
  if (chartType !== 'line' && activeSeries) {
    activeSeries.update(candles[candles.length - 1]);
  }
}

function renderChartData() {
  if (!activeSeries) return;
  if (chartType === 'line') {
    activeSeries.setData(priceHistory);
    if (priceHistory.length) hideSkeleton();
  } else {
    candles = buildCandlesFromHistory(priceHistory, candleIntervalSec);
    activeSeries.setData(candles);
    if (candles.length) hideSkeleton();
  }
}

// --- overlay-слой сделок: контейнер поверх canvas графика ---
function getOverlayContainer() {
  const chartEl = document.getElementById('chart');
  chartEl.style.position = 'relative';

  let overlay = chartEl.querySelector('.chart-trade-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.className = 'chart-trade-overlay';
    overlay.style.cssText = `
      position: absolute !important;
      top: 0 !important;
      left: 0 !important;
      width: 100% !important;
      height: 100% !important;
      pointer-events: none !important;
      z-index: 99 !important;
      overflow: hidden !important;
    `;
    chartEl.appendChild(overlay);
  }
  return overlay;
}

function clearAllTradeVisuals() {
  activeTradeLines.forEach((visual) => {
    clearInterval(visual.intervalId);
    if (visual.dot) visual.dot.remove();
    if (visual.badge) visual.badge.remove();
    if (activeSeries && visual.priceLine) {
      try { activeSeries.removePriceLine(visual.priceLine); } catch (err) { /* серия уже могла смениться */ }
    }
  });
  activeTradeLines.clear();

  const overlay = document.querySelector('.chart-trade-overlay');
  if (overlay) overlay.innerHTML = '';
}

function switchChartType(type) {
  if (type === chartType) return;
  chartType = type;
  localStorage.setItem('lumit_chart_type', type);

  document.querySelectorAll('#chart-type-menu .sub-btn').forEach(b =>
    b.classList.toggle('active', b.getAttribute('data-chart-type') === type));

  if (activeSeries) chart.removeSeries(activeSeries);
  activeSeries = createSeriesForType(type);
  renderChartData();

  // Серия пересоздана — старые priceLine на ней уже невалидны.
  // Пересоздаём их на новой серии и пересчитываем позиции dot/badge.
  activeTradeLines.forEach((visual) => {
    visual.priceLine = activeSeries.createPriceLine({
      price: visual.startPrice,
      color: visual.color,
      lineWidth: 1,
      lineStyle: LightweightCharts.LineStyle.Dashed,
      axisLabelVisible: true,
      title: fmtPrice(visual.startPrice),
    });
    visual.updatePositions();
  });

  redrawAll();
  recomputeAndRenderIndicators();
}

function setTimeframe(seconds) {
  if (candleIntervalSec === seconds) return;

  candleIntervalSec = seconds;
  localStorage.setItem('lumit_candle_interval', String(seconds));

  // Подсвечиваем активную кнопку таймфрейма
  document.querySelectorAll('#timeframe-menu .sub-btn[data-tf]').forEach(b => {
    b.classList.toggle('active', parseInt(b.getAttribute('data-tf'), 10) === seconds);
  });

  // Если был выбран линейный график ('line'), при смене таймфрейма переключаем на свечи ('candles')
  if (chartType === 'line') {
    switchChartType('candles');
  } else {
    // Если уже свечи или бары — перерисовываем данные
    renderChartData();
    recomputeAndRenderIndicators();
  }

  // Обновляем статус-бар
  const tfName = seconds >= 60 ? `${seconds / 60}м` : `${seconds}с`;
  const statusBar = document.getElementById('status-bar');
  if (statusBar) {
    statusBar.innerText = `Таймфрейм изменён на ${tfName}`;
  }
}

// DRF возвращает ошибки по-разному: {error}, {detail} или {поле: [сообщения]}.
// Сводим к читаемой строке, чтобы видеть реальную причину, а не «Ошибка».
function describeApiError(data) {
  if (!data || typeof data !== 'object') return 'неизвестная ошибка';
  if (data.error) return data.error;
  if (data.detail) return data.detail;
  const parts = [];
  for (const [field, val] of Object.entries(data)) {
    const text = Array.isArray(val) ? val.join(', ') : String(val);
    parts.push(`${field}: ${text}`);
  }
  return parts.join('; ') || 'неизвестная ошибка';
}

// --- меню/панели (без изменений относительно main) ---
document.querySelectorAll('.main-category:not([data-no-submenu])').forEach(button => {
  button.addEventListener('click', () => {
    const submenu = button.nextElementSibling;
    button.classList.toggle('open');
    submenu.classList.toggle('open');
  });
});

// Символ валюты для иконки (база пары). Фолбэк — первая буква.
const CURRENCY_ICON = {
  EUR: '€', USD: '$', GBP: '£', JPY: '¥', AUD: 'A$',
  CAD: 'C$', CHF: '₣', NZD: 'NZ$', CNY: '¥', RUB: '₽',
};

function selectPair(pair) {
  currentPair = pair;
  document.querySelectorAll('.sub-btn[data-pair]').forEach(b =>
    b.classList.toggle('active', b.getAttribute('data-pair') === pair));

  clearAllTradeVisuals();
  document.getElementById('current-pair').innerText = pair;

  const cached = loadCachedHistory(pair);
  priceHistory = cached.slice();
  candles = [];

  // фигуры рисования свои на каждую пару
  drawings = loadDrawings(pair);
  pendingPoints = [];
  hoverPoint = null;

  if (activeSeries) {
    if (cached.length) {
      renderChartData();
      lastChartTime = cached[cached.length - 1].time;
      hideSkeleton();
      document.getElementById('status-bar').innerText = 'Рынок: ' + pair + ' (кэш)';
    } else {
      activeSeries.setData([]);
      lastChartTime = 0;
      document.getElementById('status-bar').innerText = 'Рынок: ' + pair;
    }
  }
  redrawAll();
  recomputeAndRenderIndicators();
}

// Список валютных пар берём из Django (/api/assets/), а не из захардкоженного HTML —
// сколько пар отдаёт бэк, столько и показываем.
async function loadAssets() {
  const menu = document.getElementById('pairs-menu');
  try {
    const res = await fetch(`${API}/api/assets/`);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const assets = await res.json();
    if (!Array.isArray(assets) || assets.length === 0) throw new Error('пусто');

    menu.innerHTML = '';
    assets.forEach((a, i) => {
      const base = (a.symbol || '').split('/')[0];
      const icon = CURRENCY_ICON[base] || (base[0] || '?');
      const btn = document.createElement('button');
      btn.className = 'sub-btn' + (i === 0 ? ' active' : '');
      btn.setAttribute('data-pair', a.symbol);
      btn.innerHTML = `<span class="sub-icon">${icon}</span> ${a.name || a.symbol}`;
      btn.addEventListener('click', () => selectPair(a.symbol));
      menu.appendChild(btn);
    });
    // Активируем первую пару (или сохраняем текущую, если она есть в списке).
    const symbols = assets.map(a => a.symbol);
    selectPair(symbols.includes(currentPair) ? currentPair : symbols[0]);
  } catch (err) {
    console.error('Не удалось загрузить список пар:', err);
    menu.innerHTML = '<button class="sub-btn" disabled>Пары недоступны</button>';
  }
}

function toggleLeft() {
  document.getElementById('left-bar').classList.toggle('open');
  document.getElementById('overlay').classList.toggle('active');
}

function closePanels() {
  document.getElementById('left-bar').classList.remove('open');
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('overlay').classList.remove('active');
}

document.addEventListener('click', (e) => {
  const switcher = document.getElementById('account-switcher');
  if (switcher && !switcher.contains(e.target)) {
    switcher.classList.remove('open');
  }
});

window.addEventListener('load', function () {
  updateAccountUI();
  console.log('Загрузка Orion Trading Engine (REST)...');
  const chartElement = document.getElementById('chart');

  if (typeof LightweightCharts === 'undefined') {
    console.error('LightweightCharts не загружена!');
    document.getElementById('status-bar').innerText = 'Ошибка загрузки графика';
    return;
  }
  if (!ACCOUNT_OK) {
    document.getElementById('status-bar').innerText =
      'Войдите или зарегистрируйтесь, чтобы торговать';
    console.error('accountId не задан — нужна регистрация/вход');
  }

  try {
    chart = LightweightCharts.createChart(chartElement, {
      // autoSize: график сам подстраивается под контейнер через ResizeObserver —
      // не зависит от того, успел ли примениться CSS на момент создания (иначе
      // при clientHeight=0 график рисуется невидимым).
      autoSize: true,
      layout: { background: { color: 'transparent' }, textColor: 'rgba(255,255,255,0.6)' },
      grid: {
        vertLines: { color: 'rgba(255,255,255,0.06)' },
        horzLines: { color: 'rgba(255,255,255,0.06)' },
      },
      width: chartElement.clientWidth || 800,
      height: chartElement.clientHeight || 420,
      timeScale: { timeVisible: true, secondsVisible: true, borderColor: 'rgba(255,255,255,0.1)' },
      rightPriceScale: { borderColor: 'rgba(255,255,255,0.1)' },
      crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
    });

    activeSeries = createSeriesForType(chartType);
    initDrawingLayer();

    indicators = loadIndicatorsConfig();
    renderActiveIndicatorsPanel();

    document.querySelector(`#chart-type-menu .sub-btn[data-chart-type="${chartType}"]`)
      ?.classList.add('active');
    document.querySelector('#chart-type-menu .sub-btn[data-chart-type="line"]')
      ?.classList.toggle('active', chartType === 'line');
    document.querySelector(`.sub-btn[data-tf="${candleIntervalSec}"]`)?.classList.add('active');
    console.log('✅ График создан');
  } catch (error) {
    console.error('Ошибка создания графика:', error);
    return;
  }

  document.getElementById('current-pair').innerText = currentPair;
  document.getElementById('status-bar').innerText = 'Рынок: ' + currentPair;

  // Подгружаем список пар из бэка, баланс и стартуем опрос цены.
  loadAssets();
  loadBalance();
  pollPrice();
  setInterval(pollPrice, POLL);

  window.addEventListener('resize', () => {
    if (chart) {
      chart.applyOptions({ width: chartElement.clientWidth, height: chartElement.clientHeight });
    }
    resizeDrawCanvas();
  });

  document.getElementById('btnUp').addEventListener('click', () => sendTrade('higher'));
  document.getElementById('btnDown').addEventListener('click', () => sendTrade('lower'));

  // Если ни кэша, ни живых данных не пришло за 8 сек — не держим скелетон вечно.
  setTimeout(() => {
    if (!skeletonHidden) {
      hideSkeleton();
      document.getElementById('status-bar').innerText = 'Не удалось получить котировки';
    }
  }, 8000);

  window.addEventListener('beforeunload', () => {
    saveCachedHistory(currentPair, priceHistory);
  });
});

// Рисование
// --- инициализация слоя рисования (вызывается один раз после создания chart/activeSeries) ---
function initDrawingLayer() {
  drawCanvas = document.getElementById('drawing-canvas');
  drawCtx = drawCanvas.getContext('2d');
  resizeDrawCanvas();

  drawCanvas.addEventListener('click', (evt) => {
    const rect = drawCanvas.getBoundingClientRect();
    const x = evt.clientX - rect.left;
    const y = evt.clientY - rect.top;
    if (drawTool === 'erase') { eraseNearest(x, y); return; }
    onCanvasClick(x, y);
  });

  drawCanvas.addEventListener('mousemove', (evt) => {
    if (pendingPoints.length !== 1) return;
    const rect = drawCanvas.getBoundingClientRect();
    const x = evt.clientX - rect.left;
    const y = evt.clientY - rect.top;
    hoverPoint = pixelToPoint(x, y);
    redrawAll();
  });

  document.addEventListener('keydown', (evt) => {
    if (evt.key === 'Escape' && drawTool !== 'none') {
      pendingPoints = [];
      setDrawTool(drawTool);
    }
  });

  chart.timeScale().subscribeVisibleTimeRangeChange(redrawAll);
}

function resizeDrawCanvas() {
  if (!drawCanvas) return;
  const chartEl = document.getElementById('chart');
  drawCanvas.width = chartEl.clientWidth;
  drawCanvas.height = chartEl.clientHeight;
  redrawAll();
}

// --- выбор активного инструмента ---
function setDrawTool(tool) {
  drawTool = (drawTool === tool) ? 'none' : tool;
  pendingPoints = [];
  hoverPoint = null;

  document.querySelectorAll('#drawing-menu .sub-btn[data-tool]').forEach(b =>
    b.classList.toggle('active', b.getAttribute('data-tool') === drawTool));

  drawCanvas.classList.toggle('tool-active', drawTool !== 'none');

  chart.applyOptions({
    handleScroll: drawTool === 'none',
    handleScale: drawTool === 'none',
  });

  redrawAll();
}

// --- перевод координат: пиксель канваса <-> логическая точка {time, price} ---
function pointToPixel(pt) {
  const x = chart.timeScale().timeToCoordinate(pt.time);
  const y = activeSeries.priceToCoordinate(pt.price);
  if (x === null || y === null) return null;
  return { x, y };
}

function pixelToPoint(x, y) {
  const time = chart.timeScale().coordinateToTime(x);
  const price = activeSeries.coordinateToPrice(y);
  return { time: time ?? lastChartTime, price };
}

// --- обработка клика по канвасу ---
function onCanvasClick(x, y) {
  if (drawTool === 'none' || drawTool === 'erase') return;
  const pt = pixelToPoint(x, y);
  if (pt.price === null || pt.price === undefined) return;

  if (drawTool === 'hline') {
    drawings.push({ id: genId(), type: 'hline', price: pt.price });
    pendingPoints = [];
    saveDrawings(currentPair);
    redrawAll();
    return;
  }

  // trend / rect / fib — двухточечные фигуры: первый клик, затем второй
  pendingPoints.push(pt);
  if (pendingPoints.length === 2) {
    drawings.push({ id: genId(), type: drawTool, p1: pendingPoints[0], p2: pendingPoints[1] });
    pendingPoints = [];
    hoverPoint = null;
    saveDrawings(currentPair);
  }
  redrawAll();
}

function genId() {
  return 'd_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
}

// --- отрисовка всех фигур ---
function redrawAll() {
  if (!drawCtx || !chart || !activeSeries) return;
  drawCtx.clearRect(0, 0, drawCanvas.width, drawCanvas.height);
  drawings.forEach(shape => drawShape(drawCtx, shape));

  if (pendingPoints.length === 1 && hoverPoint) {
    drawShape(drawCtx, { type: drawTool, p1: pendingPoints[0], p2: hoverPoint, preview: true });
  }
}

function drawShape(ctx, shape) {
  ctx.save();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = shape.preview ? 'rgba(0,122,255,0.5)' : '#00D4AA';
  ctx.setLineDash(shape.preview ? [4, 4] : []);

  if (shape.type === 'hline') {
    const y = activeSeries.priceToCoordinate(shape.price);
    if (y === null) { ctx.restore(); return; }
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(drawCanvas.width, y);
    ctx.stroke();
    ctx.fillStyle = '#00D4AA';
    ctx.font = '11px Inter, sans-serif';
    ctx.fillText(fmtPrice(shape.price), 6, y - 4);
    ctx.restore();
    return;
  }

  const a = pointToPixel(shape.p1);
  const b = pointToPixel(shape.p2);
  if (!a || !b) { ctx.restore(); return; }

  if (shape.type === 'trend') {
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  } else if (shape.type === 'rect') {
    const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
    const w = Math.abs(b.x - a.x), h = Math.abs(b.y - a.y);
    ctx.fillStyle = 'rgba(0, 212, 170, 0.12)';
    ctx.fillRect(x, y, w, h);
    ctx.strokeRect(x, y, w, h);
  } else if (shape.type === 'fib') {
    const levels = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
    const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x);
    const priceHigh = Math.max(shape.p1.price, shape.p2.price);
    const priceLow = Math.min(shape.p1.price, shape.p2.price);
    levels.forEach(lv => {
      const price = priceHigh - (priceHigh - priceLow) * lv;
      const y = activeSeries.priceToCoordinate(price);
      if (y === null) return;
      ctx.strokeStyle = (lv === 0 || lv === 1) ? '#FF9F0A' : 'rgba(0, 212, 170, 0.7)';
      ctx.beginPath();
      ctx.moveTo(x0, y);
      ctx.lineTo(x1, y);
      ctx.stroke();
      ctx.fillStyle = ctx.strokeStyle;
      ctx.font = '10px Inter, sans-serif';
      ctx.fillText(`${(lv * 100).toFixed(1)}%  ${fmtPrice(price)}`, x1 + 4, y + 3);
    });
  }
  ctx.restore();
}

// --- удаление фигуры под курсором ---
function eraseNearest(x, y) {
  const THRESH = 8;
  for (let i = drawings.length - 1; i >= 0; i--) {
    if (hitTest(drawings[i], x, y, THRESH)) {
      drawings.splice(i, 1);
      saveDrawings(currentPair);
      redrawAll();
      return;
    }
  }
}

function hitTest(shape, x, y, thresh) {
  if (shape.type === 'hline') {
    const py = activeSeries.priceToCoordinate(shape.price);
    return py !== null && Math.abs(py - y) <= thresh;
  }
  const a = pointToPixel(shape.p1);
  const b = pointToPixel(shape.p2);
  if (!a || !b) return false;

  if (shape.type === 'rect') {
    const minX = Math.min(a.x, b.x) - thresh, maxX = Math.max(a.x, b.x) + thresh;
    const minY = Math.min(a.y, b.y) - thresh, maxY = Math.max(a.y, b.y) + thresh;
    const onVerticalBorder = x >= minX && x <= maxX &&
      (Math.abs(y - Math.min(a.y, b.y)) <= thresh || Math.abs(y - Math.max(a.y, b.y)) <= thresh);
    const onHorizontalBorder = y >= minY && y <= maxY &&
      (Math.abs(x - Math.min(a.x, b.x)) <= thresh || Math.abs(x - Math.max(a.x, b.x)) <= thresh);
    return onVerticalBorder || onHorizontalBorder;
  }
  return distToSegment(x, y, a.x, a.y, b.x, b.y) <= thresh;
}

function distToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  let t = lenSq === 0 ? 0 : ((px - x1) * dx + (py - y1) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const cx = x1 + t * dx, cy = y1 + t * dy;
  return Math.hypot(px - cx, py - cy);
}

function drawingsKeyFor(pair) {
  return 'lumit_drawings_' + pair.replace('/', '_');
}

function saveDrawings(pair) {
  try {
    localStorage.setItem(drawingsKeyFor(pair), JSON.stringify(drawings));
  } catch (err) {
    console.warn('Не удалось сохранить рисунки:', err);
  }
}

function loadDrawings(pair) {
  try {
    const raw = localStorage.getItem(drawingsKeyFor(pair));
    return raw ? JSON.parse(raw) : [];
  } catch (err) {
    console.warn('Кэш рисунков повреждён, игнорирую:', err);
    return [];
  }
}

function clearDrawings() {
  drawings = [];
  saveDrawings(currentPair);
  redrawAll();
}

// модалка выбора и добавление индикатора
function openIndicatorModal() {
  document.getElementById('indicator-modal-overlay').classList.add('open');
}

function closeIndicatorModal() {
  document.getElementById('indicator-modal-overlay').classList.remove('open');
}

function closeIndicatorModalOnOverlay(evt) {
  if (evt.target.id === 'indicator-modal-overlay') closeIndicatorModal();
}

function switchIndicatorTab(cat) {
  document.querySelectorAll('.indicator-tab').forEach(t =>
    t.classList.toggle('active', t.getAttribute('data-cat') === cat));
  ['trend', 'oscillator', 'volume'].forEach(c =>
    document.getElementById(`indicator-list-${c}`).style.display = c === cat ? 'flex' : 'none');
}

function addIndicator(type) {
  const ind = {
    id: genIndId(),
    type,
    params: { ...DEFAULT_PARAMS[type] },
    visible: true,
  };
  indicators.push(ind);
  saveIndicators();
  closeIndicatorModal();
  renderActiveIndicatorsPanel();
  recomputeAndRenderIndicators();
}

function removeIndicator(id) {
  const ind = indicators.find(i => i.id === id);
  if (ind) destroyIndicatorSeries(ind);
  indicators = indicators.filter(i => i.id !== id);
  saveIndicators();
  renderActiveIndicatorsPanel();
  recomputeAndRenderIndicators();
}

function toggleIndicatorVisibility(id) {
  const ind = indicators.find(i => i.id === id);
  if (!ind) return;
  ind.visible = !ind.visible;
  saveIndicators();
  renderActiveIndicatorsPanel();
  recomputeAndRenderIndicators();
}

// sub-panes для RSI/MACD
function ensureSubPane(key, label) {
  if (subCharts[key]) return subCharts[key];
  const container = document.getElementById('sub-panes');
  const paneEl = document.createElement('div');
  paneEl.className = 'sub-pane';
  paneEl.id = `sub-pane-${key}`;
  const labelEl = document.createElement('div');
  labelEl.className = 'sub-pane-label';
  labelEl.innerText = label;
  paneEl.appendChild(labelEl);
  container.appendChild(paneEl);

  const subChart = LightweightCharts.createChart(paneEl, {
    autoSize: true,
    layout: { background: { color: 'transparent' }, textColor: 'rgba(255,255,255,0.5)' },
    grid: { vertLines: { color: 'rgba(255,255,255,0.04)' }, horzLines: { color: 'rgba(255,255,255,0.04)' } },
    timeScale: { visible: false }, // время синхронизируем с главным графиком
    rightPriceScale: { borderColor: 'rgba(255,255,255,0.1)' },
  });

  chart.timeScale().subscribeVisibleLogicalRangeChange(range => {
    if (range) subChart.timeScale().setVisibleLogicalRange(range);
  });

  subCharts[key] = { chart: subChart, el: paneEl };
  return subCharts[key];
}

function destroySubPaneIfEmpty(key) {
  const stillUsed = indicators.some(i =>
    (key === 'rsi' && i.type === 'RSI') || (key === 'macd' && i.type === 'MACD'));
  if (stillUsed || !subCharts[key]) return;
  subCharts[key].chart.remove();
  subCharts[key].el.remove();
  delete subCharts[key];
}

// создание/обновление серий индикаторов
function destroyIndicatorSeries(ind) {
  const removeFrom = (chartInst, series) => { if (series) chartInst.removeSeries(series); };
  if (ind.type === 'SMA' || ind.type === 'EMA') {
    removeFrom(chart, ind.series?.line);
  } else if (ind.type === 'BB') {
    removeFrom(chart, ind.series?.upper);
    removeFrom(chart, ind.series?.mid);
    removeFrom(chart, ind.series?.lower);
  } else if (ind.type === 'RSI' && subCharts.rsi) {
    removeFrom(subCharts.rsi.chart, ind.series?.line);
    destroySubPaneIfEmpty('rsi');
  } else if (ind.type === 'MACD' && subCharts.macd) {
    removeFrom(subCharts.macd.chart, ind.series?.macd);
    removeFrom(subCharts.macd.chart, ind.series?.signal);
    removeFrom(subCharts.macd.chart, ind.series?.hist);
    destroySubPaneIfEmpty('macd');
  }
  ind.series = {};
}

function recomputeAndRenderIndicators() {
  const closes = getClosesSeries();
  indicators.forEach(ind => renderOneIndicator(ind, closes));
}

function renderOneIndicator(ind, closes) {
  const p = ind.params;

  if (ind.type === 'SMA' || ind.type === 'EMA') {
    if (!ind.series) ind.series = {};
    if (!ind.series.line) {
      ind.series.line = chart.addLineSeries({ color: p.color, lineWidth: p.lineWidth, priceLineVisible: false });
    } else {
      ind.series.line.applyOptions({ color: p.color, lineWidth: p.lineWidth });
    }
    const data = ind.type === 'SMA' ? calcSMA(closes, p.period) : calcEMA(closes, p.period);
    ind.series.line.setData(ind.visible ? data : []);
    return;
  }

  if (ind.type === 'BB') {
    if (!ind.series) ind.series = {};
    if (!ind.series.upper) {
      ind.series.upper = chart.addLineSeries({ color: p.color, lineWidth: p.lineWidth, priceLineVisible: false });
      ind.series.mid = chart.addLineSeries({ color: p.color, lineWidth: p.lineWidth, lineStyle: 2, priceLineVisible: false });
      ind.series.lower = chart.addLineSeries({ color: p.color, lineWidth: p.lineWidth, priceLineVisible: false });
    } else {
      [ind.series.upper, ind.series.mid, ind.series.lower].forEach(s => s.applyOptions({ color: p.color, lineWidth: p.lineWidth }));
    }
    const { upper, mid, lower } = calcBollinger(closes, p.period, p.stdDev);
    ind.series.upper.setData(ind.visible ? upper : []);
    ind.series.mid.setData(ind.visible ? mid : []);
    ind.series.lower.setData(ind.visible ? lower : []);
    return;
  }

  if (ind.type === 'RSI') {
    const pane = ensureSubPane('rsi', 'RSI');
    if (!ind.series) ind.series = {};
    if (!ind.series.line) {
      ind.series.line = pane.chart.addLineSeries({ color: p.color, lineWidth: p.lineWidth, priceLineVisible: false });
      pane.chart.addLineSeries({ color: 'rgba(255,255,255,0.15)', lineWidth: 1 }).setData(
        closes.length ? [{ time: closes[0].time, value: 70 }, { time: closes[closes.length - 1].time, value: 70 }] : []
      ); // визуальные уровни 70/30 — упрощённо, без хранения ссылки (статичные)
    } else {
      ind.series.line.applyOptions({ color: p.color, lineWidth: p.lineWidth });
    }
    const data = calcRSI(closes, p.period);
    ind.series.line.setData(ind.visible ? data : []);
    return;
  }

  if (ind.type === 'MACD') {
    const pane = ensureSubPane('macd', 'MACD');
    if (!ind.series) ind.series = {};
    if (!ind.series.macd) {
      ind.series.hist = pane.chart.addHistogramSeries({ priceLineVisible: false });
      ind.series.macd = pane.chart.addLineSeries({ color: p.colorMacd, lineWidth: 2, priceLineVisible: false });
      ind.series.signal = pane.chart.addLineSeries({ color: p.colorSignal, lineWidth: 2, priceLineVisible: false });
    } else {
      ind.series.macd.applyOptions({ color: p.colorMacd });
      ind.series.signal.applyOptions({ color: p.colorSignal });
    }
    const { macd, signal, hist } = calcMACD(closes, p.fast, p.slow, p.signal);
    const histColored = hist.map(h => ({ time: h.time, value: h.value, color: h.value >= 0 ? 'rgba(48,209,88,0.5)' : 'rgba(255,69,58,0.5)' }));
    ind.series.hist.setData(ind.visible ? histColored : []);
    ind.series.macd.setData(ind.visible ? macd : []);
    ind.series.signal.setData(ind.visible ? signal : []);
    return;
  }
}

// панель активных индикаторов
const INDICATOR_LABELS = { SMA: 'SMA', EMA: 'EMA', BB: 'Bollinger', RSI: 'RSI', MACD: 'MACD' };

function renderActiveIndicatorsPanel() {
  const panel = document.getElementById('active-indicators-panel');
  panel.innerHTML = indicators.map(ind => {
    const label = `${INDICATOR_LABELS[ind.type]} ${ind.params.period ?? ''}`.trim();
    const dotColor = ind.params.color || ind.params.colorMacd || '#00D4AA';
    return `
      <div class="indicator-chip ${ind.visible ? '' : 'hidden-ind'}">
        <span class="indicator-chip-dot" style="background:${dotColor}"></span>
        <span onclick="openIndicatorSettings('${ind.id}')" style="cursor:pointer">${label}</span>
        <button class="indicator-chip-btn" title="Показать/скрыть" onclick="toggleIndicatorVisibility('${ind.id}')">${ind.visible ? '👁' : '🚫'}</button>
        <button class="indicator-chip-btn" title="Удалить" onclick="removeIndicator('${ind.id}')">✕</button>
      </div>`;
  }).join('');
}

// модалка настроек индикатора
function openIndicatorSettings(id) {
  const ind = indicators.find(i => i.id === id);
  if (!ind) return;
  const modal = document.getElementById('indicator-settings-modal');
  modal.innerHTML = buildSettingsForm(ind);
  document.getElementById('indicator-settings-overlay').classList.add('open');
  modal.dataset.editingId = id;
}
function closeIndicatorSettings() {
  document.getElementById('indicator-settings-overlay').classList.remove('open');
}
function closeIndicatorSettingsOnOverlay(evt) {
  if (evt.target.id === 'indicator-settings-overlay') closeIndicatorSettings();
}

function buildSettingsForm(ind) {
  const p = ind.params;
  let fields = '';
  if (ind.type === 'SMA' || ind.type === 'EMA') {
    fields = `
      <div class="settings-row"><label>Период</label><input type="number" id="set-period" value="${p.period}" min="2" max="500"></div>
      <div class="settings-row"><label>Цвет линии</label><input type="color" id="set-color" value="${p.color}"></div>
      <div class="settings-row"><label>Толщина</label><input type="number" id="set-width" value="${p.lineWidth}" min="1" max="6"></div>`;
  } else if (ind.type === 'BB') {
    fields = `
      <div class="settings-row"><label>Период</label><input type="number" id="set-period" value="${p.period}" min="2" max="500"></div>
      <div class="settings-row"><label>Стандартных отклонений</label><input type="number" id="set-stddev" value="${p.stdDev}" min="0.5" max="5" step="0.1"></div>
      <div class="settings-row"><label>Цвет</label><input type="color" id="set-color" value="${p.color}"></div>`;
  } else if (ind.type === 'RSI') {
    fields = `
      <div class="settings-row"><label>Период</label><input type="number" id="set-period" value="${p.period}" min="2" max="100"></div>
      <div class="settings-row"><label>Цвет линии</label><input type="color" id="set-color" value="${p.color}"></div>`;
  } else if (ind.type === 'MACD') {
    fields = `
      <div class="settings-row"><label>Быстрая EMA</label><input type="number" id="set-fast" value="${p.fast}" min="2" max="100"></div>
      <div class="settings-row"><label>Медленная EMA</label><input type="number" id="set-slow" value="${p.slow}" min="2" max="200"></div>
      <div class="settings-row"><label>Сигнальная линия</label><input type="number" id="set-signal" value="${p.signal}" min="2" max="100"></div>
      <div class="settings-row"><label>Цвет MACD</label><input type="color" id="set-color-macd" value="${p.colorMacd}"></div>
      <div class="settings-row"><label>Цвет сигнала</label><input type="color" id="set-color-signal" value="${p.colorSignal}"></div>`;
  }
  return `
    <div class="indicator-modal-header"><h3>Настройки: ${INDICATOR_LABELS[ind.type]}</h3>
      <button class="modal-close-btn" onclick="closeIndicatorSettings()">✕</button></div>
    ${fields}
    <div class="settings-actions">
      <button class="settings-cancel-btn" onclick="closeIndicatorSettings()">Отмена</button>
      <button class="settings-save-btn" onclick="saveIndicatorSettings()">Сохранить</button>
    </div>`;
}

function saveIndicatorSettings() {
  const modal = document.getElementById('indicator-settings-modal');
  const id = modal.dataset.editingId;
  const ind = indicators.find(i => i.id === id);
  if (!ind) return;
  const val = (elId) => document.getElementById(elId)?.value;

  if (ind.type === 'SMA' || ind.type === 'EMA') {
    ind.params.period = parseInt(val('set-period'), 10) || ind.params.period;
    ind.params.color = val('set-color') || ind.params.color;
    ind.params.lineWidth = parseInt(val('set-width'), 10) || ind.params.lineWidth;
  } else if (ind.type === 'BB') {
    ind.params.period = parseInt(val('set-period'), 10) || ind.params.period;
    ind.params.stdDev = parseFloat(val('set-stddev')) || ind.params.stdDev;
    ind.params.color = val('set-color') || ind.params.color;
  } else if (ind.type === 'RSI') {
    ind.params.period = parseInt(val('set-period'), 10) || ind.params.period;
    ind.params.color = val('set-color') || ind.params.color;
  } else if (ind.type === 'MACD') {
    ind.params.fast = parseInt(val('set-fast'), 10) || ind.params.fast;
    ind.params.slow = parseInt(val('set-slow'), 10) || ind.params.slow;
    ind.params.signal = parseInt(val('set-signal'), 10) || ind.params.signal;
    ind.params.colorMacd = val('set-color-macd') || ind.params.colorMacd;
    ind.params.colorSignal = val('set-color-signal') || ind.params.colorSignal;
  }

  saveIndicators();
  closeIndicatorSettings();
  renderActiveIndicatorsPanel();
  recomputeAndRenderIndicators();
}

function saveIndicators() {
  try {
    const plain = indicators.map(({ id, type, params, visible }) => ({ id, type, params, visible }));
    localStorage.setItem('lumit_indicators', JSON.stringify(plain));
  } catch (err) {
    console.warn('Не удалось сохранить индикаторы:', err);
  }
}

function loadIndicatorsConfig() {
  try {
    const raw = localStorage.getItem('lumit_indicators');
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(i => ({ ...i, series: {} })) : [];
  } catch (err) {
    console.warn('Конфиг индикаторов повреждён, игнорирую:', err);
    return [];
  }
}

// --- живая цена: опрос Go quotes-service ---
async function pollPrice() {
  try {
    const res = await fetch(`${QUOTES}/price?symbol=${encodeURIComponent(currentPair)}`);
    if (!res.ok) {
      document.getElementById('current-price').innerText = '—';
      return;
    }
    const data = await res.json();
    const price = parseFloat(data.mid);
    if (!(price > 0) || isNaN(price)) return;

    let t = Math.floor(Date.now() / 1000);
    if (t <= lastChartTime) t = lastChartTime + 1;
    lastChartTime = t;

    const point = { time: t, value: price };

    priceHistory.push(point);
    if (priceHistory.length > CHART_CACHE_MAX_POINTS) {
      priceHistory = priceHistory.slice(-CHART_CACHE_MAX_POINTS);
    }

    if (chartType === 'line') {
      activeSeries.update(point);
    } else {
      updateCandleFromTick(point);
    }

    maybePersistHistory();
    document.getElementById('current-price').innerText = `$${fmtPrice(price)}`;
    hideSkeleton();
    redrawAll();
    recomputeAndRenderIndicators();
  } catch (err) {
    console.error('Ошибка опроса цены:', err);
  }
}

// --- баланс счёта ---
async function loadBalance() {
  if (!ACCOUNT_OK) return;
  try {
    const res = await fetch(`${API}/api/accounts/${ACCOUNT_ID}/`);
    if (!res.ok) return;
    const acc = await res.json();
    // Бэкенд отдаёт раздельные балансы; balance оставлен как фолбэк
    balances.demo = parseFloat(acc.demo_balance ?? acc.balance ?? 0);
    balances.real = parseFloat(acc.real_balance ?? 0);
    updateAccountUI();
  } catch (err) {
    console.error('Ошибка загрузки баланса:', err);
  }
}

function updateStats() {
  const el = document.getElementById('total-profit');
  el.innerText = `${stats.profit >= 0 ? '+' : ''}${fmtMoney(stats.profit)}`;
  el.className = `stat-value ${stats.profit >= 0 ? 'profit' : 'loss'}`;
  const wr = stats.total ? Math.round((stats.wins / stats.total) * 100) : 0;
  document.getElementById('win-rate').innerText = `${wr}%`;
}

// --- открытие сделки: POST в Django ---
async function sendTrade(type) {
  const amount = parseFloat(document.getElementById('amount').value);
  const time = parseInt(document.getElementById('time').value);
  if (!ACCOUNT_OK) { alert('Сначала войдите или зарегистрируйтесь на главной странице'); return; }
  if (isNaN(amount) || amount < 1) { alert('Минимальная ставка: $1'); return; }
  if (amount > balance) { alert('Недостаточно средств на балансе'); return; }

  const direction = type === 'higher' ? 'UP' : 'DOWN';
  try {
    const res = await fetch(`${API}/api/trades/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        account_id: ACCOUNT_ID,
        account_type: accountType,
        asset_pair: currentPair,
        amount: amount,
        direction: direction,
        duration: time,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      const msg = describeApiError(data);
      console.error('Открытие сделки отклонено:', res.status, data);
      document.getElementById('status-bar').innerText = 'Ошибка: ' + msg;
      alert(`Не удалось открыть сделку (${res.status}): ${msg}`);
      return;
    }
    onTradeOpened(data, type, time);
  } catch (err) {
    console.error('Ошибка открытия сделки:', err);
    alert('Сеть/бэкенд недоступны: ' + err.message);
  }
}

// Открытие сделки: линия цены входа + точка (dot) + плашка с таймером (badge) на графике.
// Координаты пересчитываются при скролле/зуме и при смене типа графика (см. switchChartType).
function onTradeOpened(trade, type, time) {
  const startPrice = parseFloat(trade.entry_price);
  const isUp = type === 'higher';
  const lineColor = isUp ? '#00e676' : '#ff5252';

  const t = {
    tradeId: trade.id,
    type: type,
    amount: parseFloat(trade.amount),
    startPrice: startPrice,
    pair: trade.asset_pair,
    expirationTime: time,
    expiresAt: Date.now() + time * 1000,
    openTimeSec: lastChartTime || Math.floor(Date.now() / 1000), // время последней тикнувшей цены
  };
  activeTrades.push(t);
  renderActiveTrades();

  // Пунктирная линия цены входа
  const priceLine = activeSeries.createPriceLine({
    price: startPrice,
    color: lineColor,
    lineWidth: 1,
    lineStyle: LightweightCharts.LineStyle.Dashed,
    axisLabelVisible: true,
    title: `${fmtPrice(startPrice)}`,
  });

  const overlay = getOverlayContainer();

  // Точка ТВХ
  const dot = document.createElement('div');
  dot.style.cssText = `
    position: absolute;
    width: 10px;
    height: 10px;
    border-radius: 50%;
    transform: translate(-50%, -50%);
    background-color: ${lineColor};
    border: 2px solid #ffffff;
    box-shadow: 0 0 8px ${lineColor};
    z-index: 100;
    display: none;
  `;

  // Плашка таймера
  const badge = document.createElement('div');
  badge.style.cssText = `
    position: absolute;
    transform: translate(-50%, -100%);
    margin-top: -8px;
    background: rgba(18, 24, 38, 0.92);
    border: 1px solid rgba(255, 255, 255, 0.2);
    border-radius: 6px;
    padding: 3px 7px;
    color: #ffffff;
    font-family: system-ui, -apple-system, sans-serif;
    font-size: 11px;
    font-weight: 600;
    display: none;
    flex-direction: column;
    align-items: center;
    box-shadow: 0 4px 12px rgba(0,0,0,0.5);
    white-space: nowrap;
    z-index: 101;
  `;
  badge.innerHTML = `
    <div style="color: ${lineColor}; font-size: 11px;">
      ${isUp ? '▲' : '▼'} $${t.amount}
    </div>
    <div id="badge-timer-${t.tradeId}" style="color: rgba(255,255,255,0.7); font-size: 10px;">${time}s</div>
  `;

  overlay.appendChild(dot);
  overlay.appendChild(badge);

  // Функция позиционирования — использует ГЛОБАЛЬНЫЕ chart/activeSeries,
  // поэтому корректно работает и после смены типа графика (line/candles/bars).
  const updatePositions = () => {
    if (!chart || !activeSeries) return;

    const y = activeSeries.priceToCoordinate(startPrice);
    let x = chart.timeScale().timeToCoordinate(t.openTimeSec);

    if (x === null || isNaN(x)) {
      const chartWidth = document.getElementById('chart').clientWidth;
      x = chartWidth - 65;
    }

    if (y !== null && !isNaN(y)) {
      dot.style.left = `${x}px`;
      dot.style.top = `${y}px`;
      badge.style.left = `${x}px`;
      badge.style.top = `${y}px`;
      dot.style.display = 'block';
      badge.style.display = 'flex';
    }
  };

  chart.timeScale().subscribeVisibleLogicalRangeChange(updatePositions);
  requestAnimationFrame(updatePositions);

  const lineTimer = setInterval(() => {
    const leftSec = Math.max(0, Math.ceil((t.expiresAt - Date.now()) / 1000));
    const timerEl = document.getElementById(`badge-timer-${t.tradeId}`);
    if (timerEl) timerEl.innerText = `${leftSec}s`;

    updatePositions();

    if (leftSec <= 0) {
      clearInterval(lineTimer);
    }
  }, 200);

  activeTradeLines.set(t.tradeId, {
    priceLine,
    intervalId: lineTimer,
    dot,
    badge,
    startPrice,
    color: lineColor,
    openTimeSec: t.openTimeSec,
    updatePositions,
  });

  document.getElementById('status-bar').innerText =
    `Сделка открыта: ${isUp ? '▲' : '▼'} $${t.amount}`;
  loadBalance(); // ставка уже списана на бэке
  watchTrade(t);
}

// Ждём истечения срока, затем закрываем сделку через settle и показываем итог.
// settle идемпотентен и закроет только когда срок истёк (без force).
function watchTrade(t) {
  const timer = setInterval(async () => {
    if (Date.now() < t.expiresAt) return;
    clearInterval(timer);
    let trade = null;
    try {
      // Сначала пробуем закрыть (если settler-воркер не запущен).
      let res = await fetch(`${API}/api/trades/${t.tradeId}/settle/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      if (res.ok) {
        trade = await res.json();
      } else {
        // Возможно, уже закрыл settler-воркер — читаем сделку.
        res = await fetch(`${API}/api/trades/${t.tradeId}/`);
        if (res.ok) trade = await res.json();
      }
    } catch (err) {
      console.error('Ошибка закрытия сделки:', err);
    }
    if (trade && trade.status && trade.status !== 'OPEN') {
      onTradeResult(trade, t);
    }
  }, POLL);
  countdownIntervals.push(timer);
}

// Закрытие сделки: убираем dot/badge/priceLine открытой сделки, показываем
// анимированный бейдж результата (иконка + сумма) в точке выхода, который
// плавно исчезает через 4 секунды.
function onTradeResult(trade, local) {
  activeTrades = activeTrades.filter(x => x.tradeId !== trade.id);
  renderActiveTrades();

  const win = trade.status === 'WIN';
  const payout = win ? parseFloat(trade.payout || (local.amount * 1.9)) : 0;
  const profit = win ? payout - local.amount : -local.amount;

  stats.total += 1;
  if (win) stats.wins += 1;
  stats.profit += profit;
  updateStats();

  // 1. Очищаем визуальные элементы открытой сделки
  const visual = activeTradeLines.get(trade.id);
  if (visual) {
    clearInterval(visual.intervalId);
    if (activeSeries) {
      try { activeSeries.removePriceLine(visual.priceLine); } catch (err) { /* серия могла смениться */ }
    }
    if (visual.dot) visual.dot.remove();
    if (visual.badge) visual.badge.remove();
    activeTradeLines.delete(trade.id);
  }

  // 2. Бейдж результата (иконка + сумма)
  const overlay = getOverlayContainer();
  const resultBadge = document.createElement('div');

  const mainColor = win ? '#00e676' : '#ff5252';

  resultBadge.style.cssText = `
    position: absolute;
    transform: translate(-50%, -50%) scale(1);
    display: none;
    align-items: center;
    gap: 6px;
    background: rgba(18, 24, 38, 0.95);
    border: 1px solid ${mainColor};
    border-radius: 20px;
    padding: 3px 10px 3px 4px;
    box-shadow: 0 0 15px ${win ? 'rgba(0, 230, 118, 0.4)' : 'rgba(255, 82, 82, 0.4)'};
    z-index: 105;
    transition: opacity 0.5s ease, transform 0.5s ease;
    white-space: nowrap;
  `;

  const iconMarkup = win ? SVG_CHECK : SVG_CROSS;
  resultBadge.innerHTML = `
    <div style="
      width: 20px;
      height: 20px;
      border-radius: 50%;
      background-color: ${mainColor};
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 0 8px ${mainColor};
      flex-shrink: 0;
    ">
      ${iconMarkup}
    </div>
    <span style="
      color: ${mainColor};
      font-family: system-ui, -apple-system, sans-serif;
      font-size: 12px;
      font-weight: 700;
    ">
      +$${payout.toFixed(0)}
    </span>
  `;

  const svgEl = resultBadge.querySelector('svg');
  if (svgEl) {
    svgEl.style.cssText = 'width: 12px; height: 12px; stroke: #ffffff; stroke-width: 3; fill: none; stroke-linecap: round; stroke-linejoin: round;';
  }

  overlay.appendChild(resultBadge);

  const exitPrice = parseFloat(trade.exit_price || local.startPrice);
  const exitTimeSec = lastChartTime || Math.floor(Date.now() / 1000);

  const updateBadgePos = () => {
    if (!chart || !activeSeries) return;

    const y = activeSeries.priceToCoordinate(exitPrice);
    let x = chart.timeScale().timeToCoordinate(exitTimeSec);

    if (x === null || isNaN(x)) {
      const chartWidth = document.getElementById('chart').clientWidth;
      x = chartWidth - 65;
    }

    if (y !== null && !isNaN(y)) {
      resultBadge.style.left = `${x}px`;
      resultBadge.style.top = `${y}px`;
      resultBadge.style.display = 'flex';
    }
  };

  chart.timeScale().subscribeVisibleLogicalRangeChange(updateBadgePos);
  requestAnimationFrame(updateBadgePos);

  setTimeout(() => {
    resultBadge.style.opacity = '0';
    resultBadge.style.transform = 'translate(-50%, -50%) scale(0.6)';
    setTimeout(() => resultBadge.remove(), 500);
  }, 4000);

  const resultText = win ? 'ВЫИГРЫШ' : 'ПРОИГРЫШ';
  document.getElementById('status-bar').innerText =
    `${resultText}: ${profit >= 0 ? '+' : ''}$${profit.toFixed(2)}`;
  loadBalance();
  setTimeout(() => {
    document.getElementById('status-bar').innerText = 'Рынок: ' + currentPair;
  }, 4000);
}

// В REST-бэке нет «сброса демо». Просто перечитываем баланс и чистим визуал сделок.
function resetDemo() {
  activeTrades = [];
  clearAllTradeVisuals();
  renderActiveTrades();
  loadBalance();
  document.getElementById('status-bar').innerText = 'Баланс обновлён';
}

function renderActiveTrades() {
  const container = document.getElementById('active-trades-container');
  countdownIntervals.forEach(i => clearInterval(i));
  countdownIntervals = [];
  if (activeTrades.length === 0) { container.innerHTML = ''; return; }
  container.innerHTML = activeTrades.map((trade, index) => {
    const timeLeft = Math.max(0, Math.ceil((trade.expiresAt - Date.now()) / 1000));
    return `
      <div class="active-trade-item" id="trade-${index}">
        <div class="active-trade-header">
          <span>${trade.pair} ${trade.type === 'higher' ? '▲' : '▼'}</span>
          <span class="countdown" id="countdown-${index}">${timeLeft}s</span>
        </div>
        <div>Ставка: $${trade.amount} | Цена: ${fmtPrice(trade.startPrice)}</div>
      </div>
    `;
  }).join('');
  activeTrades.forEach((trade, index) => {
    const interval = setInterval(() => {
      const left = Math.max(0, Math.ceil((trade.expiresAt - Date.now()) / 1000));
      const el = document.getElementById(`countdown-${index}`);
      if (el) el.innerText = `${left}s`;
      if (left <= 0) clearInterval(interval);
    }, 500);
    countdownIntervals.push(interval);
  });
}