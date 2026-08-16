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

// === РЕАЛЬНЫЕ ДАННЫЕ ИЗ БЭКА ===
const CFG = window.LUMIT_CONFIG || {};
const API = CFG.apiBase || '';
const ACCOUNT_ID = localStorage.getItem('lumit_account_id') || '';

const money = (v) => '$' + Number(v || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const setText = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };

function fmtDate(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    return d.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

// Если пользователь не вошёл — на главную (там регистрация/вход).
if (!ACCOUNT_ID) {
    alert('Сначала войдите или зарегистрируйтесь');
    window.location.href = 'index.html';
}

// Личность берём из localStorage (положили при входе/регистрации).
function fillIdentity() {
    const name = localStorage.getItem('lumit_username') || 'Пользователь';
    const email = localStorage.getItem('lumit_email') || '';
    const letter = (name[0] || '·').toUpperCase();
    setText('pf-username', name);
    setText('pf-email', email);
    setText('pf-name2', name);
    setText('pf-email2', email);
    setText('pf-avatar', letter);
    setText('pf-avatar2', letter);
    const nameInput = document.getElementById('pf-input-name');
    const emailInput = document.getElementById('pf-input-email');
    if (nameInput) nameInput.value = name;
    if (emailInput) emailInput.value = email;
}

async function loadAccount() {
    try {
        const res = await fetch(`${API}/api/accounts/${ACCOUNT_ID}/`);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const acc = await res.json();
        setText('pf-balance-dash', Number(acc.balance).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
        setText('pf-balance-wallet', Number(acc.balance).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
        setText('pf-currency', acc.currency || 'USD');
        setText('pf-account-type', acc.account_type === 'DEMO' ? 'Демо-счёт' : 'Реальный счёт');
        setText('pf-member', acc.account_type === 'DEMO' ? 'Демо-аккаунт LUMIT Trade' : 'Аккаунт LUMIT Trade');
    } catch (err) {
        console.error('Не удалось загрузить счёт:', err);
    }
}

function tradeRow(t) {
    const dirClass = t.direction === 'UP' ? 'call' : 'put';
    const dirText = t.direction === 'UP' ? 'ВЫШЕ' : 'НИЖЕ';
    const base = (t.asset_pair || '').split('/')[0];
    let result, badgeClass, profitText;
    const amount = Number(t.amount);
    if (t.status === 'WIN') {
        const net = Number(t.payout) - amount;
        result = 'Прибыль'; badgeClass = 'win'; profitText = '+' + money(net);
    } else if (t.status === 'LOSS') {
        result = 'Убыток'; badgeClass = 'loss'; profitText = '-' + money(amount);
    } else {
        result = 'В процессе'; badgeClass = 'pending'; profitText = '—';
    }
    return `
      <tr>
        <td>
          <div class="asset-cell">
            <div class="asset-cell-icon">${base[0] || '?'}</div>
            <div><div class="asset-cell-name">${t.asset_pair}</div><div class="asset-cell-sub">${base}</div></div>
          </div>
        </td>
        <td><span class="direction-badge ${dirClass}">${dirText}</span></td>
        <td>${money(amount)}</td>
        <td style="font-weight:600">${profitText}</td>
        <td><span class="result-badge ${badgeClass}">${result}</span></td>
        <td style="color:var(--text-secondary)">${fmtDate(t.created_at)}</td>
      </tr>`;
}

// Строка для дашборда — без колонки «Выплата» (там 5 колонок).
function recentRow(t) {
    const dirClass = t.direction === 'UP' ? 'call' : 'put';
    const dirText = t.direction === 'UP' ? 'ВЫШЕ' : 'НИЖЕ';
    const base = (t.asset_pair || '').split('/')[0];
    const amount = Number(t.amount);
    let badgeClass, profitText;
    if (t.status === 'WIN') { badgeClass = 'win'; profitText = '+' + money(Number(t.payout) - amount); }
    else if (t.status === 'LOSS') { badgeClass = 'loss'; profitText = '-' + money(amount); }
    else { badgeClass = 'pending'; profitText = 'В процессе'; }
    return `
      <tr>
        <td>
          <div class="asset-cell">
            <div class="asset-cell-icon">${base[0] || '?'}</div>
            <div><div class="asset-cell-name">${t.asset_pair}</div><div class="asset-cell-sub">${base}</div></div>
          </div>
        </td>
        <td><span class="direction-badge ${dirClass}">${dirText}</span></td>
        <td>${money(amount)}</td>
        <td><span class="result-badge ${badgeClass}">${profitText}</span></td>
        <td style="color:var(--text-secondary)">${fmtDate(t.created_at)}</td>
      </tr>`;
}

async function loadTrades() {
    const fullBody = document.getElementById('trades-body');
    const recentBody = document.getElementById('recent-trades-body');
    try {
        const res = await fetch(`${API}/api/accounts/${ACCOUNT_ID}/trades/`);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const trades = await res.json();

        if (!trades.length) {
            const empty = '<tr><td colspan="6" style="color:var(--text-secondary)">Сделок пока нет</td></tr>';
            if (fullBody) fullBody.innerHTML = empty;
            if (recentBody) recentBody.innerHTML = '<tr><td colspan="5" style="color:var(--text-secondary)">Сделок пока нет</td></tr>';
        } else {
            if (fullBody) fullBody.innerHTML = trades.map(tradeRow).join('');
            if (recentBody) recentBody.innerHTML = trades.slice(0, 5).map(recentRow).join('');
        }

        // Статистика по реальным сделкам.
        const wins = trades.filter(t => t.status === 'WIN').length;
        const losses = trades.filter(t => t.status === 'LOSS').length;
        const settled = wins + losses;
        const profit = trades.reduce((sum, t) => {
            if (t.status === 'WIN') return sum + (Number(t.payout) - Number(t.amount));
            if (t.status === 'LOSS') return sum - Number(t.amount);
            return sum;
        }, 0);
        setText('pf-stat-total', String(trades.length));
        setText('pf-stat-winrate', (settled ? Math.round((wins / settled) * 100) : 0) + '%');
        const profitEl = document.getElementById('pf-stat-profit');
        if (profitEl) {
            profitEl.textContent = (profit >= 0 ? '+' : '−') + money(Math.abs(profit));
            profitEl.classList.toggle('green', profit >= 0);
        }
    } catch (err) {
        console.error('Не удалось загрузить сделки:', err);
        if (fullBody) fullBody.innerHTML = '<tr><td colspan="6" style="color:var(--text-secondary)">Ошибка загрузки</td></tr>';
        if (recentBody) recentBody.innerHTML = '<tr><td colspan="5" style="color:var(--text-secondary)">Ошибка загрузки</td></tr>';
    }
}

if (ACCOUNT_ID) {
    fillIdentity();
    loadAccount();
    loadTrades();
}