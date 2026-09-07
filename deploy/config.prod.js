// OrionTrade — продовый конфиг фронтенда. Образ broker-web кладёт этот файл
// вместо репозиторного config.js (там адреса localhost для разработки).
// Бэкенд на том же домене: /api -> Django, /quotes -> Go quotes-service.
window.LUMIT_CONFIG = {
  quotesBase: window.location.origin + '/quotes',
  apiBase: window.location.origin,
  // Счёт появляется после регистрации/входа и хранится в localStorage.
  accountId: '',
  pollMs: 1000,
};
