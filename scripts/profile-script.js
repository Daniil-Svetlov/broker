document.querySelectorAll('.nav-item[data-page]').forEach(btn => {
    btn.addEventListener('click', () => {
        const pageId = btn.dataset.page;
        document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
        document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
        document.getElementById('page-' + pageId).classList.add('active');
        btn.classList.add('active');
        if (window.innerWidth <= 900) toggleSidebar();
    });
});

// --- MOBILE SIDEBAR ---
function toggleSidebar() {
    document.getElementById('sidebar').classList.toggle('open');
    document.getElementById('sidebar-overlay').classList.toggle('active');
}

// --- SAVE PROFILE ---
function saveProfile(e) {
    e.preventDefault();
    showNotification('Профиль сохранён');
}

// --- NOTIFICATION ---
function showNotification(msg) {
    const el = document.getElementById('notification');
    el.textContent = msg;
    el.classList.add('show');
    setTimeout(() => el.classList.remove('show'), 3000);
}

// --- EQUITY CHART ---
const equityCanvas = document.getElementById('equity-chart');
if (equityCanvas) {
    const ctx = equityCanvas.getContext('2d');

    function drawEquityChart() {
        equityCanvas.width = equityCanvas.offsetWidth * 2;
        equityCanvas.height = equityCanvas.offsetHeight * 2;
        ctx.scale(2, 2);

        const w = equityCanvas.offsetWidth;
        const h = equityCanvas.offsetHeight;

        let data = [];
        let val = 10000;
        for (let i = 0; i < 50; i++) {
            val += (Math.random() - 0.4) * 500;
            data.push(val);
        }

        const min = Math.min(...data);
        const max = Math.max(...data);
        const range = max - min || 1;

        const gradient = ctx.createLinearGradient(0, 0, 0, h);
        gradient.addColorStop(0, 'rgba(48, 209, 88, 0.2)');
        gradient.addColorStop(1, 'transparent');

        ctx.beginPath();
        ctx.moveTo(0, h);
        data.forEach((v, i) => {
            const x = (i / (data.length - 1)) * w;
            const y = h - ((v - min) / range) * (h - 10) - 5;
            ctx.lineTo(x, y);
        });
        ctx.lineTo(w, h);
        ctx.closePath();
        ctx.fillStyle = gradient;
        ctx.fill();

        ctx.beginPath();
        data.forEach((v, i) => {
            const x = (i / (data.length - 1)) * w;
            const y = h - ((v - min) / range) * (h - 10) - 5;
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        });
        ctx.strokeStyle = '#30D158';
        ctx.lineWidth = 2;
        ctx.stroke();
    }

    drawEquityChart();
    window.addEventListener('resize', drawEquityChart);
}

// --- TRADES DATA ---
const allTrades = [
    { asset: 'BTC/USD', icon: 'btc', letter: 'B', sub: 'Bitcoin', dir: 'call', amount: 250, result: 'win', profit: '+$237.50', date: 'Сегодня, 14:32' },
    { asset: 'ETH/USD', icon: 'eth', letter: 'E', sub: 'Ethereum', dir: 'put', amount: 100, result: 'loss', profit: '-$100.00', date: 'Сегодня, 14:17' },
    { asset: 'SOL/USD', icon: 'sol', letter: 'S', sub: 'Solana', dir: 'call', amount: 500, result: 'win', profit: '+$475.00', date: 'Сегодня, 13:45' },
    { asset: 'EUR/USD', icon: 'eur', letter: '€', sub: 'Euro', dir: 'put', amount: 150, result: 'pending', profit: 'В процессе', date: 'Сегодня, 14:30' },
    { asset: 'GBP/USD', icon: 'gbp', letter: '£', sub: 'Pound', dir: 'call', amount: 200, result: 'win', profit: '+$190.00', date: 'Вчера, 18:22' },
    { asset: 'BTC/USD', icon: 'btc', letter: 'B', sub: 'Bitcoin', dir: 'put', amount: 300, result: 'loss', profit: '-$300.00', date: 'Вчера, 16:10' },
    { asset: 'ETH/USD', icon: 'eth', letter: 'E', sub: 'Ethereum', dir: 'call', amount: 150, result: 'win', profit: '+$142.50', date: 'Вчера, 12:05' },
    { asset: 'SOL/USD', icon: 'sol', letter: 'S', sub: 'Solana', dir: 'call', amount: 400, result: 'win', profit: '+$380.00', date: '20 мая, 09:30' },
    { asset: 'EUR/USD', icon: 'eur', letter: '€', sub: 'Euro', dir: 'put', amount: 100, result: 'win', profit: '+$95.00', date: '20 мая, 08:15' },
    { asset: 'BTC/USD', icon: 'btc', letter: 'B', sub: 'Bitcoin', dir: 'call', amount: 600, result: 'win', profit: '+$570.00', date: '19 мая, 21:40' },
];

const tradesBody = document.getElementById('trades-body');
allTrades.forEach(t => {
    tradesBody.innerHTML += `
      <tr>
        <td>
          <div class="asset-cell">
            <div class="asset-cell-icon ${t.icon}">${t.letter}</div>
            <div><div class="asset-cell-name">${t.asset}</div><div class="asset-cell-sub">${t.sub}</div></div>
          </div>
        </td>
        <td><span class="direction-badge ${t.dir}">${t.dir.toUpperCase()}</span></td>
        <td>$${t.amount.toFixed(2)}</td>
        <td style="font-weight:600">${t.profit}</td>
        <td><span class="result-badge ${t.result}">${t.result === 'win' ? 'Прибыль' : t.result === 'loss' ? 'Убыток' : 'В процессе'}</span></td>
        <td style="color:var(--text-secondary)">${t.date}</td>
      </tr>
    `;
});