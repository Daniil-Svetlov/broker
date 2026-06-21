// --- TICKER MARQUEE DATA ---
const tickerData = [
    { name: 'BTC/USD', price: '68,241.50', up: true, change: '+3.24%' },
    { name: 'ETH/USD', price: '3,812.12', up: true, change: '+1.82%' },
    { name: 'SOL/USD', price: '146.88', up: true, change: '+8.51%' },
    { name: 'EUR/USD', price: '1.0847', up: false, change: '-0.12%' },
    { name: 'XAU/USD', price: '2,384.20', up: true, change: '+0.64%' },
    { name: 'GBP/USD', price: '1.2731', up: false, change: '-0.08%' },
    { name: 'XRP/USD', price: '0.5214', up: true, change: '+5.12%' },
    { name: 'OIL/USD', price: '79.45', up: false, change: '-1.03%' },
];
// --- SCROLL REVEAL OBSERVER (объявлен заранее, используется ниже) ---

const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
        if (entry.isIntersecting) {
            entry.target.classList.add('visible');
            if (entry.target.closest('.stats-bar')) animateCounters();
        }
    });
}, { threshold: 0.1 });
function buildTicker() {
    const track = document.getElementById('ticker-track');
    const renderSet = () => tickerData.map(t => `
    <div class="ticker-item">
      <span class="t-name mono">${t.name}</span>
      <span class="t-price mono">${t.price}</span>
      <span class="t-change ${t.up ? 'up' : 'down'}">${t.change}</span>
    </div>
    <div class="ticker-divider"></div>
  `).join('');
    track.innerHTML = renderSet() + renderSet();
}
buildTicker();
// --- CANDLESTICK-STYLE CHART ---
const chartCanvas = document.getElementById('hero-chart');
const chartCtx = chartCanvas.getContext('2d');
let candles = [];
function genCandles(n, startPrice) {
    let price = startPrice;
    const arr = [];
    for (let i = 0; i < n; i++) {
        const open = price;
        const vol = (Math.random() - 0.47) * 220;
        const close = open + vol;
        const high = Math.max(open, close) + Math.random() * 80;
        const low = Math.min(open, close) - Math.random() * 80;
        arr.push({ open, close, high, low });
        price = close;
    }
    return arr;
}
function initChart() {
    chartCanvas.width = chartCanvas.offsetWidth * 2;
    chartCanvas.height = chartCanvas.offsetHeight * 2;
    chartCtx.scale(2, 2);
    candles = genCandles(46, 68000);
}
function drawChart() {
    const w = chartCanvas.offsetWidth;
    const h = chartCanvas.offsetHeight;
    chartCtx.clearRect(0, 0, w, h);
    const allVals = candles.flatMap(c => [c.high, c.low]);
    const min = Math.min(...allVals);
    const max = Math.max(...allVals);
    const range = (max - min) || 1;
    const padding = 14;
    const usableH = h - padding * 2;
    const slotW = w / candles.length;
    const bodyW = Math.max(2, slotW * 0.5);
    candles.forEach((c, i) => {
        const x = i * slotW + slotW / 2;
        const yOpen = padding + usableH - ((c.open - min) / range) * usableH;
        const yClose = padding + usableH - ((c.close - min) / range) * usableH;
        const yHigh = padding + usableH - ((c.high - min) / range) * usableH;
        const yLow = padding + usableH - ((c.low - min) / range) * usableH;
        const isUp = c.close >= c.open;
        const color = isUp ? '#30D158' : '#FF453A';
        chartCtx.strokeStyle = color;
        chartCtx.lineWidth = 1;
        chartCtx.beginPath();
        chartCtx.moveTo(x, yHigh);
        chartCtx.lineTo(x, yLow);
        chartCtx.stroke();
        chartCtx.fillStyle = color;
        const bodyTop = Math.min(yOpen, yClose);
        const bodyHeight = Math.max(1.5, Math.abs(yClose - yOpen));
        chartCtx.globalAlpha = isUp ? 0.85 : 0.85;
        chartCtx.fillRect(x - bodyW / 2, bodyTop, bodyW, bodyHeight);
        chartCtx.globalAlpha = 1;
    });
    // subtle trend line over closes
    chartCtx.beginPath();
    chartCtx.strokeStyle = 'rgba(0, 122, 255, 0.5)';
    chartCtx.lineWidth = 1.5;
    candles.forEach((c, i) => {
        const x = i * slotW + slotW / 2;
        const y = padding + usableH - ((c.close - min) / range) * usableH;
        if (i === 0) chartCtx.moveTo(x, y);
        else chartCtx.lineTo(x, y);
    });
    chartCtx.stroke();
}
function updateChart() {
    candles.shift();
    const last = candles[candles.length - 1];
    const open = last.close;
    const vol = (Math.random() - 0.47) * 220;
    const close = open + vol;
    const high = Math.max(open, close) + Math.random() * 80;
    const low = Math.min(open, close) - Math.random() * 80;
    candles.push({ open, close, high, low });
    drawChart();
    const priceEl = document.getElementById('live-price');
    if (priceEl) {
        priceEl.textContent = '$' + close.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
}
initChart();
drawChart();
setInterval(updateChart, 1500);
window.addEventListener('resize', () => { initChart(); drawChart(); });
// --- ASSETS GRID ---
const assets = [
    { name: 'Bitcoin', ticker: 'BTC / USD', price: 68241.50, change: '+3.24%', up: true },
    { name: 'Ethereum', ticker: 'ETH / USD', price: 3812.12, change: '+1.82%', up: true },
    { name: 'Solana', ticker: 'SOL / USD', price: 146.88, change: '+8.51%', up: true },
    { name: 'Euro', ticker: 'EUR / USD', price: 1.0847, change: '-0.12%', up: false }
];
const assetsGrid = document.getElementById('assets-grid');
assetsGrid.style.display = 'grid';
assetsGrid.style.gridTemplateColumns = 'repeat(4, 1fr)';
assetsGrid.style.gap = '16px';
assetsGrid.className = 'assets-grid';
assets.forEach(a => {
    const card = document.createElement('div');
    card.className = 'asset-card glass reveal';
    card.innerHTML = `
    <div class="asset-header">
      <div class="asset-ticker mono">${a.ticker}</div>
      <div class="asset-change ${a.up ? 'up' : 'down'}">${a.change}</div>
    </div>
    <div class="asset-name">${a.name}</div>
    <div class="asset-price mono" data-base="${a.price}">$${a.price.toLocaleString('en-US', { minimumFractionDigits: 2 })}</div>
    <div class="asset-chart"><canvas class="mini-chart" data-up="${a.up}"></canvas></div>
  `;
    assetsGrid.appendChild(card);
    observer.observe(card);
});
// Mini candle charts
function drawMiniCharts() {
    document.querySelectorAll('.mini-chart').forEach(canvas => {
        const ctx = canvas.getContext('2d');
        canvas.width = canvas.offsetWidth * 2;
        canvas.height = canvas.offsetHeight * 2;
        ctx.scale(2, 2);
        const w = canvas.offsetWidth;
        const h = canvas.offsetHeight;
        const isUp = canvas.dataset.up === 'true';
        const baseColor = isUp ? '#30D158' : '#FF453A';
        const n = 22;
        let price = 50;
        const candles = [];
        for (let i = 0; i < n; i++) {
            const open = price;
            const vol = (Math.random() - (isUp ? 0.42 : 0.58)) * 12;
            let close = open + vol;
            close = Math.max(6, Math.min(94, close));
            const high = Math.max(open, close) + Math.random() * 4;
            const low = Math.min(open, close) - Math.random() * 4;
            candles.push({ open, close, high, low });
            price = close;
        }
        const allVals = candles.flatMap(c => [c.high, c.low]);
        const min = Math.min(...allVals);
        const max = Math.max(...allVals);
        const range = (max - min) || 1;
        const slotW = w / n;
        const bodyW = Math.max(1.5, slotW * 0.45);
        candles.forEach((c, i) => {
            const x = i * slotW + slotW / 2;
            const yOpen = h - ((c.open - min) / range) * (h - 4) - 2;
            const yClose = h - ((c.close - min) / range) * (h - 4) - 2;
            const yHigh = h - ((c.high - min) / range) * (h - 4) - 2;
            const yLow = h - ((c.low - min) / range) * (h - 4) - 2;
            const color = c.close >= c.open ? baseColor : baseColor;
            ctx.strokeStyle = color;
            ctx.globalAlpha = 0.5;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(x, yHigh);
            ctx.lineTo(x, yLow);
            ctx.stroke();
            ctx.globalAlpha = 0.9;
            ctx.fillStyle = color;
            const bodyTop = Math.min(yOpen, yClose);
            const bodyHeight = Math.max(1, Math.abs(yClose - yOpen));
            ctx.fillRect(x - bodyW / 2, bodyTop, bodyW, bodyHeight);
            ctx.globalAlpha = 1;
        });
    });
}
setTimeout(drawMiniCharts, 100);
window.addEventListener('resize', drawMiniCharts);
// --- COUNTER ANIMATION ---
function animateCounters() {
    document.querySelectorAll('.stat-value[data-count]').forEach(el => {
        const target = parseInt(el.dataset.count);
        let current = 0;
        const step = target / 60;
        const timer = setInterval(() => {
            current += step;
            if (current >= target) { current = target; clearInterval(timer); }
            el.textContent = Math.round(current);
        }, 16);
    });
}
// --- SCROLL REVEAL: подключаем все .reveal элементы ---
document.querySelectorAll('.reveal').forEach(el => observer.observe(el));
// --- HEADER SCROLL ---
window.addEventListener('scroll', () => {
    document.getElementById('header').classList.toggle('scrolled', window.scrollY > 50);
});
// --- LIVE PRICE UPDATE (ASSETS) ---
setInterval(() => {
    document.querySelectorAll('.asset-price[data-base]').forEach(el => {
        const base = parseFloat(el.dataset.base);
        const change = (Math.random() - 0.5) * base * 0.002;
        const newPrice = base + change;
        el.textContent = '$' + newPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    });
}, 3000);

function openModal() {
    document.getElementById('modal-overlay').classList.add('active');
    document.body.style.overflow = 'hidden';
}

function closeModal() {
    document.getElementById('modal-overlay').classList.remove('active');
    document.body.style.overflow = '';
}

function showError(inputElement, message) {
    const group = inputElement.parentElement;
    const errorSpan = group.querySelector('.error-message');
    group.classList.add('invalid');
    if (errorSpan) {
        errorSpan.innerText = message;
    }
}

function clearError(inputElement) {
    const group = inputElement.parentElement;
    group.classList.remove('invalid');
}

function handleRegister(event) {
    event.preventDefault();

    const form = event.target;
    const nameInput = document.getElementById('regName');
    const emailInput = document.getElementById('regEmail');
    const passwordInput = document.getElementById('regPassword');
    
    clearError(nameInput);
    clearError(emailInput);
    clearError(passwordInput);

    let isValid = true;

    if (nameInput.value.trim() === '') {
        showError(nameInput, 'Пожалуйста, введите ваше имя');
        isValid = false;
    } else if (nameInput.value.trim().length < 4) {
        showError(nameInput, 'Имя должно содержать минимум 4 символа');
        isValid = false;
    }

    const emailRegex = /^[^\s@]+@[^\s@.]+\.[^\s@.]+$/;
    if (emailInput.value.trim() === '') {
        showError(emailInput, 'Введите адрес электронной почты');
        isValid = false;
    } else if (!emailRegex.test(emailInput.value.trim())) {
        showError(emailInput, 'Введите корректный адрес электронной почты');
        isValid = false;
    }

    const passwordRegex = /^(?=.*[a-zа-яё])(?=.*[A-ZА-ЯЁ])(?=.*\d).+$/;
    if (passwordInput.value.trim() === '') {
        showError(passwordInput, 'Придумайте пароль');
        isValid = false;
    } else if (passwordInput.value.length < 8) {
        showError(passwordInput, 'Пароль должен содержать минимум 8 символов');
        isValid = false;
    } else if (!passwordRegex.test(passwordInput.value)) {
        showError(passwordInput, 'Пароль должен содержать заглавную, строчную буквы и цифру');
        isValid = false;
    }

    if (!isValid) return;


    console.log('Регистрация...', {
        name: nameInput.value.trim(),
        email: emailInput.value.trim(),
        password: passwordInput.value
    }); 

    const btn = form.querySelector('.modal-btn'); 

    if (btn) {
        const btnText = btn.querySelector('span');
        const originalText = btnText ? btnText.innerText : btn.innerText;
    
        if (btnText) {
            btnText.innerText = 'Аккаунт создан!';
        } else {
            btn.innerText = 'Аккаунт создан!';
        }
        
        btn.classList.add('success');
        form.reset(); 
        
        setTimeout(() => {
            if (btnText) {
                btnText.innerText = originalText;
            } else {
                btn.innerText = originalText;
            }
            btn.classList.remove('success');
            if (typeof closeModal === 'function') {
                closeModal(); 
            }
            alert('Аккаунт создан! Добро пожаловать в LUMIT Trade.');
        }, 1000);
    }
}

document.querySelectorAll('.form-group input').forEach(element => {
    element.addEventListener('input', () => clearError(element));
});

document.getElementById('modal-overlay').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeModal();
});

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeModal();
});