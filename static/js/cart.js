/*
  Корзина: шторка, полёт товара, счётчик суммы, нативная кнопка Telegram.
*/
(function () {
  'use strict';

  var K = window.Klubok;
  var scrim = document.querySelector('[data-scrim]');

  function panel() { return document.querySelector('[data-cart]'); }

  // --- Шторка -------------------------------------------------------------

  function open() {
    var p = panel();
    if (!p) return;
    p.classList.add('is-open');
    if (scrim) {
      scrim.hidden = false;
      requestAnimationFrame(function () { scrim.classList.add('is-on'); });
    }
    syncMainButton();
  }

  function close() {
    var p = panel();
    if (p) p.classList.remove('is-open');
    if (scrim) {
      scrim.classList.remove('is-on');
      setTimeout(function () { scrim.hidden = true; }, K.calm ? 0 : 320);
    }
    syncMainButton();
  }

  document.addEventListener('click', function (e) {
    if (e.target.closest('[data-open-cart]')) { open(); return; }
    if (e.target.closest('[data-close-cart]') || e.target === scrim) close();
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') close();
  });

  // --- Нативная кнопка Telegram ------------------------------------------
  // Дублирует оформление заказа, пока корзина открыта, — так пользователю
  // не нужно искать кнопку внутри страницы.

  function syncMainButton() {
    if (!K.tg) return;
    var p = panel();
    var hasForm = p && p.querySelector('form');
    if (p && p.classList.contains('is-open') && hasForm) K.tg.MainButton.show();
    else K.tg.MainButton.hide();
  }

  if (K.tg) {
    K.tg.MainButton.setText('Оформить заказ');
    K.tg.MainButton.onClick(function () {
      var form = document.querySelector('#cart-panel form');
      if (form) form.requestSubmit();
    });
  }

  // --- Полёт товара в иконку корзины -------------------------------------
  // Движение в ответ на действие: показывает, куда именно уехала вещь,
  // и коротко пружинит счётчик, подтверждая, что долетела.

  document.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-add]');
    if (!btn) return;

    K.haptic('light');

    // Кнопка сразу подтверждает действие, не дожидаясь ответа сервера.
    btn.textContent = 'В корзине';
    btn.classList.add('is-done');
    btn.disabled = true;

    if (!K.motion) return;

    var art = btn.closest('.card').querySelector('[data-art] [data-body]');
    var target = document.querySelector('.bar__cart, .tgbar__cart');
    if (!art || !target) return;

    var from = art.getBoundingClientRect();
    var to = target.getBoundingClientRect();
    var fill = art.querySelector('[fill]');

    var dot = document.createElement('div');
    dot.className = 'flyer';
    dot.style.background = fill ? fill.getAttribute('fill') : '#7C3247';
    dot.style.left = (from.left + from.width / 2 - 24) + 'px';
    dot.style.top = (from.top + from.height / 2 - 24) + 'px';
    document.body.appendChild(dot);

    gsap.timeline({ onComplete: function () { dot.remove(); } })
      .to(dot, {
        x: to.left + to.width / 2 - (from.left + from.width / 2),
        y: to.top + to.height / 2 - (from.top + from.height / 2),
        scale: 0.22, opacity: 0.2, duration: 0.62, ease: 'power2.in'
      })
      .to(target, { scale: 1.14, duration: 0.14, ease: 'power2.out' }, '-=0.08')
      .to(target, { scale: 1, duration: 0.32, ease: 'elastic.out(1, 0.45)' });
  });

  // --- Сумма набегает, а не подменяется рывком ---------------------------

  var lastTotal = 0;

  function readTotal() {
    var el = document.querySelector('[data-total]');
    return el ? (parseInt(el.textContent.replace(/\D/g, ''), 10) || 0) : 0;
  }

  function countTotal() {
    var el = document.querySelector('[data-total]');
    if (!el) { lastTotal = 0; return; }

    var to = readTotal();
    if (!K.motion || to === lastTotal) { lastTotal = to; return; }

    var box = { v: lastTotal };
    gsap.to(box, {
      v: to, duration: 0.55, ease: 'power2.out',
      onUpdate: function () {
        // Разряды — тем же неразрывным пробелом, что и на сервере,
        // иначе число дёргается по ширине на каждом кадре.
        el.textContent = Math.round(box.v).toString()
          .replace(/\B(?=(\d{3})+(?!\d))/g, '\u00a0') + '\u00a0₽';
      }
    });
    lastTotal = to;
  }

  // --- htmx --------------------------------------------------------------

  document.body.addEventListener('htmx:beforeSwap', function (e) {
    if (e.detail.target && e.detail.target.id === 'cart-panel') lastTotal = readTotal();
  });

  document.body.addEventListener('htmx:afterSwap', function (e) {
    var t = e.detail.target;
    if (!t || !(t.id === 'cart-panel' || (t.closest && t.closest('#cart-panel')))) return;

    // Панель заменилась целиком — класс открытости пришлось бы потерять.
    open();
    countTotal();
    if (K.motion) {
      gsap.from('.cart__line', { opacity: 0, x: 24, duration: 0.4, stagger: 0.05, ease: 'power2.out' });
    }
  });

  lastTotal = readTotal();
  syncMainButton();
})();
