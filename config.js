// Конфиг проверочного стенда. Адреса бэкенда и UUID демо-счёта.
// accountId подставляет bootstrap.sh (manage.py создаёт демо-счёт и печатает id),
// либо вставьте вручную. Можно переопределить из консоли браузера:
//   localStorage.setItem('lumit_account_id', '<uuid>')
window.LUMIT_CONFIG = {
  // Go quotes-service — живая цена для графика.
  quotesBase: 'http://localhost:8090',
  // Django REST — сделки и баланс.
  apiBase: 'http://localhost:8000',
  // UUID демо-счёта (Pay). Заполняется bootstrap.sh.
  accountId: 'f18c031a-4166-4cc8-b7be-7fdadd09f817',
  // Период опроса цены и статуса сделок, мс.
  pollMs: 1000,
};
