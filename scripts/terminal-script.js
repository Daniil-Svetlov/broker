// Проверочный data-слой: ветка main, но вместо socket.io — REST к новому бэку.
//   живая цена  -> GET  {quotesBase}/price?symbol=PAIR        (Go quotes-service)
//   открыть     -> POST {apiBase}/api/trades/                 (Django)
//   закрыть     -> POST {apiBase}/api/trades/<id>/settle/     (когда истёк срок)
//   баланс      -> GET  {apiBase}/api/accounts/<accountId>/   (Django)
// UI-функции (меню, отрисовка) — как в main.

const CFG = window.LUMIT_CONFIG || {};
const QUOTES = CFG.quotesBase || 'https://zippy-mercy-production.up.railway.app';
const API = CFG.apiBase || 'https://broker-production-5adc.up.railway.app';
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
let tradeMarkers = [];
let lastChartTime = 0;
// Статистика сессии (бэкенд агрегатов не отдаёт — считаем локально).
let stats = { wins: 0, total: 0, profit: 0 };

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

function switchChartType(type) {
  if (type === chartType) return;
  chartType = type;
  localStorage.setItem('lumit_chart_type', type);

  document.querySelectorAll('#chart-type-menu .sub-btn').forEach(b =>
    b.classList.toggle('active', b.getAttribute('data-chart-type') === type));

  if (activeSeries) chart.removeSeries(activeSeries);
  activeSeries = createSeriesForType(type);
  renderChartData();
  activeSeries.setMarkers(tradeMarkers);
}

function setTimeframe(seconds) {
  candleIntervalSec = seconds;
  localStorage.setItem('lumit_candle_interval', String(seconds));
  document.querySelectorAll('[data-tf]').forEach(b =>
    b.classList.toggle('active', parseInt(b.getAttribute('data-tf'), 10) === seconds));
  if (chartType !== 'line') renderChartData();
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
document.querySelectorAll('.main-category').forEach(button => {
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

  tradeMarkers = [];
  document.getElementById('current-pair').innerText = pair;

  const cached = loadCachedHistory(pair);
  priceHistory = cached.slice();
  candles = [];

  if (activeSeries) {
    activeSeries.setMarkers([]);
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
  console.log('Загрузка LUMIT Trading Engine (REST)...');
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

function onTradeOpened(trade, type, time) {
  const startPrice = parseFloat(trade.entry_price);
  const t = {
    tradeId: trade.id,
    type: type, // higher/lower — для разметки
    amount: parseFloat(trade.amount),
    startPrice: startPrice,
    pair: trade.asset_pair,
    expirationTime: time,
    expiresAt: Date.now() + time * 1000,
  };
  activeTrades.push(t);
  renderActiveTrades();

  const marker = {
    time: Math.floor(Date.now() / 1000),
    position: 'inBar',
    color: type === 'higher' ? '#30D158' : '#FF453A',
    shape: type === 'higher' ? 'arrowUp' : 'arrowDown',
    text: `${type === 'higher' ? '▲' : '▼'} $${t.amount} @ ${fmtPrice(startPrice)}`,
    id: t.tradeId,
  };
  tradeMarkers.push(marker);
  activeSeries.setMarkers(tradeMarkers);

  document.getElementById('status-bar').innerText =
    `Сделка открыта: ${type === 'higher' ? '▲' : '▼'} $${t.amount}`;
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

function onTradeResult(trade, local) {
  activeTrades = activeTrades.filter(x => x.tradeId !== trade.id);
  renderActiveTrades();

  const win = trade.status === 'WIN';
  const payout = parseFloat(trade.payout || 0);
  // Чистый результат: на выигрыш payout включает возврат ставки.
  const profit = win ? payout - local.amount : -local.amount;
  stats.total += 1;
  if (win) stats.wins += 1;
  stats.profit += profit;
  updateStats();

  const idx = tradeMarkers.findIndex(m => m.id === trade.id);
  if (idx !== -1) {
    tradeMarkers[idx].color = win ? '#30D158' : '#FF453A';
    tradeMarkers[idx].text = `${win ? '✅' : '❌'} ${profit >= 0 ? '+' : ''}$${profit.toFixed(2)}`;
    tradeMarkers.push({
      time: Math.floor(Date.now() / 1000),
      position: 'inBar',
      color: win ? '#30D158' : '#FF453A',
      shape: 'circle',
      text: `Exit: ${fmtPrice(parseFloat(trade.exit_price))}`,
      id: `${trade.id}_exit`,
    });
    activeSeries.setMarkers(tradeMarkers);
  }

  const resultText = win ? '✅ ВЫИГРЫШ' : '❌ ПРОИГРЫШ';
  document.getElementById('status-bar').innerText =
    `${resultText}: ${profit >= 0 ? '+' : ''}$${profit.toFixed(2)}`;
  loadBalance();
  setTimeout(() => {
    document.getElementById('status-bar').innerText = 'Рынок: ' + currentPair;
  }, 4000);
}

// В REST-бэке нет «сброса демо». Просто перечитываем баланс и чистим разметку.
function resetDemo() {
  activeTrades = [];
  tradeMarkers = [];
  if (activeSeries) activeSeries.setMarkers([]);
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
