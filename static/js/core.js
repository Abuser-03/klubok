/*
  Ядро. Единственное, что должно быть загружено раньше остальных модулей.

  Даёт общее пространство имён window.Klubok с тем, что нужно всем:
  · motion — можно ли анимировать (учитывает системную настройку
    «уменьшить движение» и наличие GSAP);
  · tg — объект Telegram WebApp, если мы внутри мессенджера;
  · haptic() — тактильный отклик на телефоне, безопасно вызывать где угодно.

  Каждый модуль (cart.js, catalog.js, felting.js, hero.js) — отдельная
  IIFE, которая сама подписывается на нужные события. Никакого общего
  «init», который надо не забыть обновить.
*/
(function () {
  'use strict';

  var calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var tg = window.Telegram && window.Telegram.WebApp;

  window.Klubok = {
    motion: !calm && !!window.gsap,
    calm: calm,
    tg: tg || null,

    haptic: function (style) {
      if (tg && tg.HapticFeedback) {
        try { tg.HapticFeedback.impactOccurred(style || 'light'); } catch (e) {}
      }
    }
  };

  if (!tg) return;

  tg.ready();
  tg.expand();

  // initData прикладывается заголовком к КАЖДОМУ htmx-запросу, а не к
  // одной форме: так бэкенд опознаёт человека на любом действии, и
  // хендлерам не нужно знать, из какой витрины пришёл запрос.
  document.body.addEventListener('htmx:configRequest', function (e) {
    if (tg.initData) e.detail.headers['Authorization'] = 'tma ' + tg.initData;
  });

  // Первый GET страницы уходит до того, как выполнился этот скрипт, то есть
  // без заголовка с initData — сервер отвечает как анонимному гостю и рисует
  // пустую корзину. Перезапрашиваем её уже подписанным запросом.
  if (tg.initData && window.htmx) {
    htmx.ajax('GET', '/cart', { target: '#cart-panel', swap: 'outerHTML' });
  }
})();
