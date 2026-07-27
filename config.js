// Конфиг фронтенда: адреса бэкенда. accountId теперь НЕ хардкодим —
// он появляется после регистрации/входа и хранится в localStorage
// (ключ lumit_account_id). Терминал берёт его оттуда.
//   localStorage.setItem('lumit_account_id', '<uuid>')  // ручной вход для отладки
window.LUMIT_CONFIG = {
  // Go quotes-service — живая цена для графика.
  quotesBase: 'https://zippy-mercy-production.up.railway.app',
  // Django REST — регистрация/вход, сделки, баланс.
  apiBase: 'https://broker-production-5adc.up.railway.app',
  // Счёт берётся из localStorage после регистрации/входа (общего демо больше нет).
  accountId: '',
  // Период опроса цены и статуса сделок, мс.
  pollMs: 1000,
};
