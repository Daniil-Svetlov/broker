function switchPage(pageId) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    const pageEl = document.getElementById('page-' + pageId);
    if (pageEl) pageEl.classList.add('active');
    const navEl = document.querySelector('.nav-item[data-page="' + pageId + '"]');
    if (navEl) navEl.classList.add('active');
    window.scrollTo({ top: 0, behavior: 'smooth' });
    if (window.innerWidth <= 900) toggleSidebar();
}

document.querySelectorAll('.nav-item[data-page]').forEach(btn => {
    btn.addEventListener('click', () => switchPage(btn.dataset.page));
});

function goToDeposit() {
    switchPage('deposit');
}

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
        setText('pf-member', acc.account_type === 'DEMO' ? 'Демо-аккаунт Orion Trade' : 'Аккаунт Orion Trade');
        setText('deposit-account-badge', acc.account_type === 'DEMO' ? 'Демо-счёт' : 'Реальный счёт');
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

// --- DEPOSIT PAGE ---
const depositAmountInput = document.getElementById('deposit-amount');
let selectedPaymentMethod = 'visa';

function updateDepositSummary() {
    const amount = Math.max(0, Number(depositAmountInput?.value) || 0);
    setText('deposit-summary-amount', money(amount));
    setText('deposit-summary-total', money(amount));
}

document.querySelectorAll('.quick-amount-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.quick-amount-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        if (depositAmountInput) depositAmountInput.value = btn.dataset.amount;
        updateDepositSummary();
    });
});

document.querySelectorAll('.payment-method-row').forEach(row => {
    row.addEventListener('click', () => {
        document.querySelectorAll('.payment-method-row').forEach(r => r.classList.remove('selected'));
        row.classList.add('selected');
        selectedPaymentMethod = row.dataset.method;
    });
});

if (depositAmountInput) {
    depositAmountInput.addEventListener('input', updateDepositSummary);
    updateDepositSummary();
}

async function submitDeposit() {
    const amount = Number(depositAmountInput?.value);
    if (!amount || amount < 10) {
        showNotification('Минимальная сумма пополнения — $10');
        return;
    }
    try {
        // TODO: подключить реальный эндпоинт пополнения на бэкенде, например:
        // await fetch(`${API}/api/accounts/${ACCOUNT_ID}/deposit/`, {
        //   method: 'POST',
        //   headers: { 'Content-Type': 'application/json' },
        //   body: JSON.stringify({ amount, method: selectedPaymentMethod })
        // });
        showNotification('Заявка на пополнение $' + amount + ' создана');
    } catch (err) {
        console.error('Не удалось создать пополнение:', err);
        showNotification('Ошибка при пополнении');
    }
}

// --- PAYMENT HISTORY ---
function paymentMethodLabel(method) {
    const map = { visa: 'Visa •••• 4242', btc: 'Bitcoin Wallet', usdt: 'USDT (TRC-20)' };
    return map[method] || method || '—';
}

function paymentStatusBadge(status) {
    if (status === 'SUCCESS') return { cls: 'win', text: 'Успешно' };
    if (status === 'FAILED') return { cls: 'loss', text: 'Отклонён' };
    return { cls: 'pending', text: 'В обработке' };
}

function paymentRow(p) {
    const typeClass = p.type === 'WITHDRAW' ? 'withdraw' : 'deposit';
    const typeText = p.type === 'WITHDRAW' ? 'Вывод' : 'Пополнение';
    const status = paymentStatusBadge(p.status);
    const sign = p.type === 'WITHDRAW' ? '-' : '+';
    return `
      <tr>
        <td><span class="payment-type-badge ${typeClass}">${typeText}</span></td>
        <td>${paymentMethodLabel(p.method)}</td>
        <td style="font-weight:600">${sign}${money(p.amount)}</td>
        <td><span class="result-badge ${status.cls}">${status.text}</span></td>
        <td style="color:var(--text-secondary)">${fmtDate(p.created_at)}</td>
      </tr>`;
}

async function loadPayments() {
    const body = document.getElementById('payments-body');
    if (!body) return;
    try {
        const res = await fetch(`${API}/api/accounts/${ACCOUNT_ID}/payments/`);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const payments = await res.json();

        if (!payments.length) {
            body.innerHTML = '<tr><td colspan="5" style="color:var(--text-secondary)">Платежей пока нет</td></tr>';
        } else {
            body.innerHTML = payments.map(paymentRow).join('');
        }
    } catch (err) {
        console.error('Не удалось загрузить платежи:', err);
        body.innerHTML = '<tr><td colspan="5" style="color:var(--text-secondary)">Ошибка загрузки</td></tr>';
    }
}

if (ACCOUNT_ID) {
    loadPayments();
}