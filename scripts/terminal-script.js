let currentPair = 'BTC/USDT';
let lineSeries = null;
let chart = null;
let socket = null;
let balance = 10000.00;
let activeTrades = [];
let countdownIntervals = [];
let tradeMarkers = [];

document.querySelectorAll('.main-category').forEach(button => {
  button.addEventListener('click', () => {
    const submenu = button.nextElementSibling;
    button.classList.toggle('open');
    submenu.classList.toggle('open');
  });
});

document.querySelectorAll('.sub-btn[data-pair]').forEach(btn => {
  btn.addEventListener('click', function() {
    currentPair = this.getAttribute('data-pair');
    document.querySelectorAll('.sub-btn[data-pair]').forEach(b => b.classList.remove('active'));
    this.classList.add('active');
    if (lineSeries) {
      lineSeries.setData([]);
      tradeMarkers = [];
      lineSeries.setMarkers([]);
    }
    document.getElementById('current-pair').innerText = currentPair;
    document.getElementById('status-bar').innerText = "Рынок: " + currentPair;
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

window.addEventListener('load', function() {
  console.log('Загрузка LUMIT Trading Engine...');
  const chartElement = document.getElementById('chart');

  if (typeof LightweightCharts === 'undefined') {
    console.error('LightweightCharts не загружена!');
    document.getElementById('status-bar').innerText = "Ошибка загрузки графика";
    return;
  }

  try {
    chart = LightweightCharts.createChart(chartElement, {
      layout: {
        background: { color: 'transparent' },
        textColor: 'rgba(255,255,255,0.6)'
      },
      grid: {
        vertLines: { color: 'rgba(255,255,255,0.06)' },
        horzLines: { color: 'rgba(255,255,255,0.06)' }
      },
      width: chartElement.clientWidth,
      height: chartElement.clientHeight,
      timeScale: {
        timeVisible: true,
        secondsVisible: true,
        borderColor: 'rgba(255,255,255,0.1)'
      },
      rightPriceScale: {
        borderColor: 'rgba(255,255,255,0.1)'
      },
      crosshair: {
        mode: LightweightCharts.CrosshairMode.Normal
      }
    });

    lineSeries = chart.addLineSeries({
      color: '#007AFF',
      lineWidth: 2,
      priceLineVisible: false
    });

    console.log('✅ График создан');
  } catch (error) {
    console.error('Ошибка создания графика:', error);
    return;
  }

  socket = io();

  socket.on('connect', () => {
    console.log('✅ Подключено к серверу');
    document.getElementById('status-bar').innerText = "Рынок: " + currentPair;
  });

  socket.on('price_update', (data) => {
    try {
      if (data.pairs && data.pairs[currentPair]) {
        const price = parseFloat(data.pairs[currentPair]);
        if (price > 0 && !isNaN(price)) {
          lineSeries.update({ time: data.time, value: price });
          document.getElementById('current-price').innerText = `$${price.toFixed(2)}`;
        }
      }
    } catch (error) {
      console.error('Ошибка обновления графика:', error);
    }
  });

  socket.on('balance_update', (data) => {
    balance = data.balance;
    document.getElementById('balance-amount-header').innerText = `$${balance.toFixed(2)}`;
    const profit = data.totalProfit - data.totalLoss;
    document.getElementById('total-profit').innerText = `${profit >= 0 ? '+' : ''}$${profit.toFixed(2)}`;
    document.getElementById('total-profit').className = `stat-value ${profit >= 0 ? 'profit' : 'loss'}`;
    document.getElementById('win-rate').innerText = `${data.winRate}%`;
  });

  socket.on('trade_opened', (data) => {
    activeTrades.push(data);
    renderActiveTrades();
    const currentTime = Math.floor(Date.now() / 1000);
    const newMarker = {
      time: currentTime,
      position: 'inBar',
      color: data.type === 'higher' ? '#30D158' : '#FF453A',
      shape: data.type === 'higher' ? 'arrowUp' : 'arrowDown',
      text: `${data.type === 'higher' ? '▲' : '▼'} $${data.amount} @ $${data.startPrice.toFixed(2)}`,
      id: data.tradeId
    };
    tradeMarkers.push(newMarker);
    lineSeries.setMarkers(tradeMarkers);
    console.log('📍 Маркер добавлен на график:', newMarker);
    document.getElementById('status-bar').innerText = `Сделка открыта: ${data.type === 'higher' ? '▲' : '▼'} $${data.amount}`;
  });

  socket.on('trade_result', (data) => {
    activeTrades = activeTrades.filter(t => t.tradeId !== data.tradeId);
    renderActiveTrades();
    const markerIndex = tradeMarkers.findIndex(m => m.id === data.tradeId);
    if (markerIndex !== -1) {
      tradeMarkers[markerIndex].color = data.result === 'WIN' ? '#30D158' : '#FF453A';
      tradeMarkers[markerIndex].text = `${data.result === 'WIN' ? '✅' : '❌'} ${data.profit >= 0 ? '+' : ''}$${data.profit.toFixed(2)}`;
      const exitMarker = {
        time: Math.floor(Date.now() / 1000),
        position: 'inBar',
        color: data.result === 'WIN' ? '#30D158' : '#FF453A',
        shape: 'circle',
        text: `Exit: $${data.endPrice}`,
        id: `${data.tradeId}_exit`
      };
      tradeMarkers.push(exitMarker);
      lineSeries.setMarkers(tradeMarkers);
      console.log('📍 Маркер выхода добавлен:', exitMarker);
    }
    const resultText = data.result === 'WIN' ? '✅ ВЫИГРЫШ' : '❌ ПРОИГРЫШ';
    document.getElementById('status-bar').innerText = `${resultText}: ${data.profit >= 0 ? '+' : ''}$${data.profit.toFixed(2)}`;
    setTimeout(() => {
      document.getElementById('status-bar').innerText = "Рынок: " + currentPair;
    }, 4000);
  });

  socket.on('trade_error', (data) => {
    alert(data.message);
  });

  socket.on('demo_reset', (data) => {
    activeTrades = [];
    tradeMarkers = [];
    if (lineSeries) lineSeries.setMarkers([]);
    renderActiveTrades();
    alert('Демо-счет сброшен до $10,000');
  });

  socket.on('disconnect', () => {
    console.log('⚠️ Отключено от серверу');
    document.getElementById('status-bar').innerText = "Нет соединения";
  });

  window.addEventListener('resize', () => {
    if (chart) {
      chart.applyOptions({
        width: chartElement.clientWidth,
        height: chartElement.clientHeight
      });
    }
  });

  document.getElementById('btnUp').addEventListener('click', () => sendTrade('higher'));
  document.getElementById('btnDown').addEventListener('click', () => sendTrade('lower'));
});

function sendTrade(type) {
  const amount = parseFloat(document.getElementById('amount').value);
  const time = parseInt(document.getElementById('time').value);
  if (amount > balance) { alert("Недостаточно средств на балансе"); return; }
  if (amount < 1) { alert("Минимальная ставка: $1"); return; }
  if (!socket || !socket.connected) { alert("Нет подключения к серверу"); return; }
  socket.emit('make_trade', { type, amount, time, pair: currentPair });
}

function resetDemo() {
  if (confirm('Вы уверены, что хотите сбросить демо-счет до $10,000? Вся история будет удалена.')) {
    socket.emit('reset_demo');
  }
}

function renderActiveTrades() {
  const container = document.getElementById('active-trades-container');
  countdownIntervals.forEach(interval => clearInterval(interval));
  countdownIntervals = [];
  if (activeTrades.length === 0) { container.innerHTML = ''; return; }
  container.innerHTML = activeTrades.map((trade, index) => {
    const timeLeft = Math.max(0, trade.expirationTime - Math.floor((Date.now() - new Date().getTime()) / 1000));
    return `
      <div class="active-trade-item" id="trade-${index}">
        <div class="active-trade-header">
          <span>${trade.pair} ${trade.type === 'higher' ? '▲' : '▼'}</span>
          <span class="countdown" id="countdown-${index}">${timeLeft}s</span>
        </div>
        <div>Ставка: $${trade.amount} | Цена: $${trade.startPrice.toFixed(2)}</div>
      </div>
    `;
  }).join('');
  activeTrades.forEach((trade, index) => {
    let timeLeft = trade.expirationTime;
    const interval = setInterval(() => {
      timeLeft--;
      const el = document.getElementById(`countdown-${index}`);
      if (el) el.innerText = `${Math.max(0, timeLeft)}s`;
      if (timeLeft <= 0) clearInterval(interval);
    }, 1000);
    countdownIntervals.push(interval);
  });
}