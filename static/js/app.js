(function () {
  'use strict';

  var calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // -------------------------------------------------------------------------
  // Telegram Mini App
  // -------------------------------------------------------------------------
  var tg = window.Telegram && window.Telegram.WebApp;

  if (tg) {
    tg.ready();
    tg.expand();

    // initData прикладывается заголовком к КАЖДОМУ htmx-запросу, а не к
    // одной форме: так бэкенд опознаёт человека на любом действии —
    // добавлении в корзину, фильтре, чекауте, — и хендлерам не нужно
    // знать, из какой витрины пришёл запрос.
    document.body.addEventListener('htmx:configRequest', function (e) {
      if (tg.initData) e.detail.headers['Authorization'] = 'tma ' + tg.initData;
    });

    // Нативная кнопка Telegram дублирует оформление заказа, когда корзина
    // открыта — так пользователю не нужно искать кнопку внутри страницы.
    tg.MainButton.setText('Оформить заказ');
    tg.MainButton.onClick(function () {
      var form = document.querySelector('#cart-panel form');
      if (form) form.requestSubmit();
    });
  }

  function syncMainButton() {
    if (!tg) return;
    var open = document.querySelector('[data-cart]');
    var hasForm = open && open.querySelector('form');
    if (open && open.classList.contains('is-open') && hasForm) tg.MainButton.show();
    else tg.MainButton.hide();
  }

  // -------------------------------------------------------------------------
  // Шторка корзины
  // -------------------------------------------------------------------------
  var scrim = document.querySelector('[data-scrim]');

  function cart() { return document.querySelector('[data-cart]'); }

  function openCart() {
    var c = cart();
    if (!c) return;
    c.classList.add('is-open');
    if (scrim) { scrim.hidden = false; requestAnimationFrame(function () { scrim.classList.add('is-on'); }); }
    syncMainButton();
  }

  function closeCart() {
    var c = cart();
    if (c) c.classList.remove('is-open');
    if (scrim) {
      scrim.classList.remove('is-on');
      setTimeout(function () { scrim.hidden = true; }, calm ? 0 : 320);
    }
    syncMainButton();
  }

  document.addEventListener('click', function (e) {
    if (e.target.closest('[data-open-cart]')) { openCart(); return; }
    if (e.target.closest('[data-close-cart]') || e.target === scrim) closeCart();
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closeCart();
  });

  // -------------------------------------------------------------------------
  // Фильтры каталога: активное состояние переключаем сами, htmx отвечает
  // только за подмену сетки.
  // -------------------------------------------------------------------------
  document.addEventListener('click', function (e) {
    var chip = e.target.closest('[data-chip]');
    if (!chip) return;
    document.querySelectorAll('[data-chip]').forEach(function (c) { c.classList.remove('is-on'); });
    chip.classList.add('is-on');
  });

  // -------------------------------------------------------------------------
  // Полёт товара в корзину — движение в ответ на действие, показывает,
  // куда именно уехала вещь.
  // -------------------------------------------------------------------------
  document.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-add]');
    if (!btn || calm || !window.gsap) return;

    var art = btn.closest('.card').querySelector('[data-art] svg path[fill]');
    var target = document.querySelector('.bar__cart');
    if (!art || !target) return;

    var from = art.getBoundingClientRect();
    var to = target.getBoundingClientRect();

    var dot = document.createElement('div');
    dot.className = 'flyer';
    dot.style.background = art.getAttribute('fill');
    dot.style.width = dot.style.height = '3rem';
    dot.style.left = (from.left + from.width / 2 - 24) + 'px';
    dot.style.top = (from.top + from.height / 2 - 24) + 'px';
    document.body.appendChild(dot);

    gsap.to(dot, {
      x: to.left + to.width / 2 - (from.left + from.width / 2),
      y: to.top + to.height / 2 - (from.top + from.height / 2),
      scale: 0.25,
      opacity: 0.2,
      duration: 0.62,
      ease: 'power2.in',
      onComplete: function () { dot.remove(); }
    });
  });

  // -------------------------------------------------------------------------
  // Появление карточек при скролле
  // -------------------------------------------------------------------------
  function revealCards(scope) {
    if (calm || !window.gsap || !window.ScrollTrigger) return;
    var items = (scope || document).querySelectorAll('[data-reveal]:not(.is-shown)');
    if (!items.length) return;

    gsap.set(items, { opacity: 0, y: 26 });
    ScrollTrigger.batch(items, {
      start: 'top 88%',
      once: true,
      onEnter: function (batch) {
        batch.forEach(function (el) { el.classList.add('is-shown'); });
        gsap.to(batch, { opacity: 1, y: 0, duration: 0.7, stagger: 0.07, ease: 'power2.out' });
      }
    });
  }

  // -------------------------------------------------------------------------
  // Один срежиссированный момент на загрузке: прорисовываются нити шерсти,
  // затем поднимаются строки заголовка.
  // -------------------------------------------------------------------------
  function playHero() {
    var fibres = document.querySelectorAll('.hero__fibres path');
    var lines = document.querySelectorAll('.hero__title .line');

    if (calm || !window.gsap) {
      gsap && gsap.set([fibres, lines], { clearProps: 'all' });
      return;
    }

    var tl = gsap.timeline();

    fibres.forEach(function (p) {
      var len = p.getTotalLength();
      gsap.set(p, { strokeDasharray: len, strokeDashoffset: len });
    });

    tl.to(fibres, {
      strokeDashoffset: 0,
      duration: 1.5,
      stagger: 0.11,
      ease: 'power1.inOut'
    });

    tl.from(lines, {
      yPercent: 108,
      duration: 0.85,
      stagger: 0.08,
      ease: 'power3.out'
    }, '-=1.05');

    tl.from('.hero__kicker, .hero__lede, .hero__acts', {
      opacity: 0,
      y: 14,
      duration: 0.6,
      stagger: 0.09,
      ease: 'power2.out'
    }, '-=0.5');
  }

  // -------------------------------------------------------------------------
  // htmx: после каждой подмены восстанавливаем то, что живёт на клиенте.
  // -------------------------------------------------------------------------
  document.body.addEventListener('htmx:afterSwap', function (e) {
    var id = e.detail.target && e.detail.target.id;

    if (id === 'cart-panel' || (e.detail.target.closest && e.detail.target.closest('#cart-panel'))) {
      // Панель заменилась целиком — класс открытости пришлось бы потерять.
      openCart();
    }

    if (id === 'grid') revealCards(document.getElementById('grid'));
  });

  // Ошибку сервера htmx по умолчанию не рисует — показываем её сами,
  // иначе кнопка просто молча ничего не делает.
  document.body.addEventListener('htmx:responseError', function (e) {
    if (e.detail.xhr.status === 422) return; // это валидация, её рисует сервер
    var box = document.getElementById('signup-result');
    if (box) box.innerHTML = '<div class="note note--bad"><p>Сервер не ответил. Попробуйте ещё раз через минуту.</p></div>';
  });

  // -------------------------------------------------------------------------
  playHero();
  revealCards();
  syncMainButton();

  // Первый GET страницы Mini App уходит до того, как выполнился этот скрипт,
  // то есть без заголовка с initData — сервер отвечает как анонимному гостю
  // и рисует пустую корзину. Перезапрашиваем её уже подписанным запросом,
  // иначе человек с товарами в корзине увидит «пока пусто».
  if (tg && tg.initData && window.htmx) {
    htmx.ajax('GET', '/cart', { target: '#cart-panel', swap: 'outerHTML' });
  }
})();
