// Проверочный data-слой: ветка main, но вместо socket.io — REST к новому бэку.
//   живая цена  -> GET  {quotesBase}/price?symbol=PAIR        (Go quotes-service)
//   открыть     -> POST {apiBase}/api/trades/                 (Django)
//   закрыть     -> POST {apiBase}/api/trades/<id>/settle/     (когда истёк срок)
//   баланс      -> GET  {apiBase}/api/accounts/<accountId>/   (Django)
// UI-функции (меню, отрисовка) — как в main.

const CFG = window.LUMIT_CONFIG || {};
const QUOTES = CFG.quotesBase || 'http://localhost:8090';
const API = CFG.apiBase || 'http://localhost:8000';
const POLL = CFG.pollMs || 1000;
// accountId: localStorage переопределяет config.js (удобно не трогать файл).
const ACCOUNT_ID = localStorage.getItem('lumit_account_id') || CFG.accountId || '';
// Плейсхолдер из config.js — значит bootstrap.sh не запускали. Считаем «не задан»,
// иначе POST уйдёт с '__ACCOUNT_ID__' и Django ответит невнятным «not a valid UUID».
const ACCOUNT_OK = !!ACCOUNT_ID && ACCOUNT_ID !== '__ACCOUNT_ID__';

let currentPair = 'EUR/USD';
let lineSeries = null;
let chart = null;
let balance = 0;
let activeTrades = [];
let countdownIntervals = [];
let tradeMarkers = [];
let lastChartTime = 0;
// Статистика сессии (бэкенд агрегатов не отдаёт — считаем локально).
let stats = { wins: 0, total: 0, profit: 0 };

// --- форматирование цены: форекс требует больше знаков, чем .toFixed(2) ---
function fmtPrice(v) {
  if (!isFinite(v)) return '—';
  return v >= 100 ? v.toFixed(3) : v.toFixed(5);
}
function fmtMoney(v) {
  return `$${Number(v).toFixed(2)}`;
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

document.querySelectorAll('.sub-btn[data-pair]').forEach(btn => {
  btn.addEventListener('click', function () {
    currentPair = this.getAttribute('data-pair');
    document.querySelectorAll('.sub-btn[data-pair]').forEach(b => b.classList.remove('active'));
    this.classList.add('active');
    if (lineSeries) {
      lineSeries.setData([]);
      lastChartTime = 0;
      tradeMarkers = [];
      lineSeries.setMarkers([]);
    }
    document.getElementById('current-pair').innerText = currentPair;
    document.getElementById('status-bar').innerText = 'Рынок: ' + currentPair;
  });
});

function toggleLeft() {
  document.getElementById('left-bar').classList.toggle('open');
  document.getElementById('overlay').classList.toggle('active');
}
function toggleRight() {
  document.getElementById('sidebar').classList.toggle('open');
  document.getElementById('overlay').classList.toggle('active');
}
function closePanels() {
  document.getElementById('left-bar').classList.remove('open');
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('overlay').classList.remove('active');
}

window.addEventListener('load', function () {
  console.log('Загрузка LUMIT Trading Engine (REST)...');
  const chartElement = document.getElementById('chart');

  if (typeof LightweightCharts === 'undefined') {
    console.error('LightweightCharts не загружена!');
    document.getElementById('status-bar').innerText = 'Ошибка загрузки графика';
    return;
  }
  if (!ACCOUNT_OK) {
    document.getElementById('status-bar').innerText =
      'Не задан accountId — запустите bootstrap.sh (см. README)';
    console.error('accountId не задан в config.js / localStorage');
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
    lineSeries = chart.addLineSeries({ color: '#007AFF', lineWidth: 2, priceLineVisible: false });
    console.log('✅ График создан');
  } catch (error) {
    console.error('Ошибка создания графика:', error);
    return;
  }

  document.getElementById('current-pair').innerText = currentPair;
  document.getElementById('status-bar').innerText = 'Рынок: ' + currentPair;

  // Стартуем опрос цены и подгружаем баланс.
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
    // Время для графика должно строго расти.
    let t = Math.floor(Date.now() / 1000);
    if (t <= lastChartTime) t = lastChartTime + 1;
    lastChartTime = t;
    lineSeries.update({ time: t, value: price });
    document.getElementById('current-price').innerText = `$${fmtPrice(price)}`;
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
    balance = parseFloat(acc.balance);
    document.getElementById('balance-amount-header').innerText = fmtMoney(balance);
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
  if (!ACCOUNT_OK) { alert('Не задан accountId — запустите bootstrap.sh (см. README)'); return; }
  if (isNaN(amount) || amount < 1) { alert('Минимальная ставка: $1'); return; }
  if (amount > balance) { alert('Недостаточно средств на балансе'); return; }

  const direction = type === 'higher' ? 'UP' : 'DOWN';
  try {
    const res = await fetch(`${API}/api/trades/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        account_id: ACCOUNT_ID,
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
  lineSeries.setMarkers(tradeMarkers);

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
    lineSeries.setMarkers(tradeMarkers);
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
  if (lineSeries) lineSeries.setMarkers([]);
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
