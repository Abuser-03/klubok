(function () {
  'use strict';

  // Единственный переключатель на весь файл: при системной настройке
  // «уменьшить движение» ни одна анимация не запускается, но всё
  // остаётся рабочим.
  var calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var motion = !calm && !!window.gsap;

  // =========================================================================
  // Telegram Mini App
  // =========================================================================
  var tg = window.Telegram && window.Telegram.WebApp;

  if (tg) {
    tg.ready();
    tg.expand();

    // initData прикладывается заголовком к КАЖДОМУ htmx-запросу, а не к
    // одной форме: так бэкенд опознаёт человека на любом действии, и
    // хендлерам не нужно знать, из какой витрины пришёл запрос.
    document.body.addEventListener('htmx:configRequest', function (e) {
      if (tg.initData) e.detail.headers['Authorization'] = 'tma ' + tg.initData;
    });

    tg.MainButton.setText('Оформить заказ');
    tg.MainButton.onClick(function () {
      var form = document.querySelector('#cart-panel form');
      if (form) form.requestSubmit();
    });
  }

  function syncMainButton() {
    if (!tg) return;
    var panel = document.querySelector('[data-cart]');
    if (panel && panel.classList.contains('is-open') && panel.querySelector('form')) tg.MainButton.show();
    else tg.MainButton.hide();
  }

  // =========================================================================
  // Шторка корзины
  // =========================================================================
  var scrim = document.querySelector('[data-scrim]');

  function cart() { return document.querySelector('[data-cart]'); }

  function openCart() {
    var c = cart();
    if (!c) return;
    c.classList.add('is-open');
    if (scrim) {
      scrim.hidden = false;
      requestAnimationFrame(function () { scrim.classList.add('is-on'); });
    }
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

  // =========================================================================
  // Фильтры: активное состояние переключаем сами, htmx отвечает только
  // за подмену сетки.
  // =========================================================================
  document.addEventListener('click', function (e) {
    var chip = e.target.closest('[data-chip]');
    if (!chip) return;
    document.querySelectorAll('[data-chip]').forEach(function (c) { c.classList.remove('is-on'); });
    chip.classList.add('is-on');
  });

  // =========================================================================
  // Наклон карточки под курсором
  //
  // Форма товара смещается сильнее, чем сама карточка, а волоски —
  // сильнее формы. Разная скорость слоёв читается как глубина, поэтому
  // войлок выглядит лежащим в коробке, а не напечатанным на ней.
  // =========================================================================
  var hovered = null;

  function resetTilt(card) {
    if (!card) return;
    var art = card.querySelector('[data-art] svg');
    gsap.to(card, { rotateX: 0, rotateY: 0, duration: 0.6, ease: 'power3.out' });
    if (art) {
      gsap.to(art.querySelector('[data-body]'), { x: 0, y: 0, duration: 0.7, ease: 'power3.out' });
      gsap.to(art.querySelector('[data-fibres]'), { x: 0, y: 0, duration: 0.9, ease: 'power3.out' });
    }
  }

  document.addEventListener('pointermove', function (e) {
    if (!motion || e.pointerType === 'touch') return;

    var card = e.target.closest ? e.target.closest('.card') : null;

    if (card !== hovered) {
      resetTilt(hovered);
      hovered = card;
    }
    if (!card) return;

    var box = card.getBoundingClientRect();
    var px = (e.clientX - box.left) / box.width - 0.5;
    var py = (e.clientY - box.top) / box.height - 0.5;

    gsap.to(card, {
      rotateX: -py * 5,
      rotateY: px * 6,
      duration: 0.5,
      ease: 'power2.out',
      transformPerspective: 900
    });

    var art = card.querySelector('[data-art] svg');
    if (!art) return;
    gsap.to(art.querySelector('[data-body]'), { x: px * 12, y: py * 9, duration: 0.6, ease: 'power2.out' });
    gsap.to(art.querySelector('[data-fibres]'), { x: px * 22, y: py * 16, duration: 0.8, ease: 'power2.out' });
  });

  // =========================================================================
  // Полёт товара в корзину
  // =========================================================================
  document.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-add]');
    if (!btn || !motion) return;

    var art = btn.closest('.card').querySelector('[data-art] svg path[fill]');
    var target = document.querySelector('.bar__cart, .tgbar__cart');
    if (!art || !target) return;

    var from = art.getBoundingClientRect();
    var to = target.getBoundingClientRect();

    var dot = document.createElement('div');
    dot.className = 'flyer';
    dot.style.background = art.getAttribute('fill');
    dot.style.left = (from.left + from.width / 2 - 24) + 'px';
    dot.style.top = (from.top + from.height / 2 - 24) + 'px';
    document.body.appendChild(dot);

    gsap.timeline({ onComplete: function () { dot.remove(); } })
      .to(dot, {
        x: to.left + to.width / 2 - (from.left + from.width / 2),
        y: to.top + to.height / 2 - (from.top + from.height / 2),
        scale: 0.22,
        opacity: 0.2,
        duration: 0.62,
        ease: 'power2.in'
      })
      // Счётчик коротко пружинит — подтверждение, что товар долетел.
      .to(target, { scale: 1.14, duration: 0.14, ease: 'power2.out' }, '-=0.08')
      .to(target, { scale: 1, duration: 0.32, ease: 'elastic.out(1, 0.45)' });
  });

  // =========================================================================
  // Появление карточек при скролле
  // =========================================================================
  function revealCards(scope) {
    if (!motion || !window.ScrollTrigger) return;
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

  // =========================================================================
  // Переезд карточек при смене фильтра (FLIP)
  //
  // htmx заменяет сетку целиком, поэтому уцелевшие карточки перескакивают
  // на новые места рывком. Запоминаем их координаты ДО подмены, после неё
  // сажаем обратно трансформом и отпускаем — глазу видно, что карточка
  // переехала, а не исчезла и появилась другая.
  // =========================================================================
  var before = null;

  function snapshotGrid() {
    before = new Map();
    document.querySelectorAll('#grid [data-id]').forEach(function (el) {
      before.set(el.dataset.id, el.getBoundingClientRect());
    });
  }

  function playFlip() {
    if (!before) return;
    var cards = document.querySelectorAll('#grid [data-id]');

    cards.forEach(function (el, i) {
      el.classList.add('is-shown'); // чтобы revealCards их не перехватил
      var prev = before.get(el.dataset.id);
      var now = el.getBoundingClientRect();

      if (prev) {
        // Карточка была и осталась — довозим её со старого места.
        gsap.fromTo(el,
          { x: prev.left - now.left, y: prev.top - now.top },
          { x: 0, y: 0, duration: 0.55, ease: 'power3.out' });
      } else {
        // Новая в этой категории — проявляется.
        gsap.from(el, { opacity: 0, scale: 0.93, duration: 0.45, delay: i * 0.03, ease: 'power2.out' });
      }
    });

    before = null;
  }

  // =========================================================================
  // Сумма в корзине набегает, а не подменяется рывком
  // =========================================================================
  var lastTotal = 0;

  function readTotal() {
    var el = document.querySelector('[data-total]');
    if (!el) return 0;
    return parseInt(el.textContent.replace(/\D/g, ''), 10) || 0;
  }

  function countTotal() {
    var el = document.querySelector('[data-total]');
    if (!el) { lastTotal = 0; return; }

    var to = readTotal();
    if (!motion || to === lastTotal) { lastTotal = to; return; }

    var box = { v: lastTotal };
    gsap.to(box, {
      v: to,
      duration: 0.55,
      ease: 'power2.out',
      onUpdate: function () {
        // Разряды разделяем неразрывным пробелом — тем же, что и на сервере,
        // иначе число дёргалось бы по ширине на каждом кадре.
        el.textContent = Math.round(box.v).toString()
          .replace(/\B(?=(\d{3})+(?!\d))/g, '\u00a0') + '\u00a0₽';
      }
    });
    lastTotal = to;
  }

  // =========================================================================
  // Хиро: нити прорисовываются на загрузке и плывут при скролле
  // =========================================================================
  function playHero() {
    var fibres = document.querySelectorAll('.hero__fibres path');
    var lines = document.querySelectorAll('.hero__title .line');
    if (!fibres.length || !motion) return;

    var tl = gsap.timeline();

    fibres.forEach(function (p) {
      var len = p.getTotalLength();
      gsap.set(p, { strokeDasharray: len, strokeDashoffset: len });
    });

    tl.to(fibres, { strokeDashoffset: 0, duration: 1.5, stagger: 0.11, ease: 'power1.inOut' })
      .from(lines, { yPercent: 108, duration: 0.85, stagger: 0.08, ease: 'power3.out' }, '-=1.05')
      .from('.hero__kicker, .hero__lede, .hero__acts',
        { opacity: 0, y: 14, duration: 0.6, stagger: 0.09, ease: 'power2.out' }, '-=0.5');

    if (!window.ScrollTrigger) return;

    // Нити расходятся при прокрутке на разной скорости — за счёт этого
    // клубок кажется объёмным, а не плоской картинкой позади текста.
    fibres.forEach(function (p, i) {
      gsap.to(p, {
        y: (i % 2 ? 1 : -1) * (14 + i * 7),
        ease: 'none',
        scrollTrigger: { trigger: '.hero', start: 'top top', end: 'bottom top', scrub: 0.7 }
      });
    });

    gsap.to('.hero__text', {
      y: 48,
      opacity: 0.35,
      ease: 'none',
      scrollTrigger: { trigger: '.hero', start: 'top top', end: 'bottom top', scrub: 0.5 }
    });
  }


  // =========================================================================
  // Сцена валяния
  //
  // Вся анимация подчинена одному числу — плотности от 0 до 1. Каждый удар
  // её повышает, а geometry подтягивается следом: волокна втягиваются,
  // ядро сжимается и темнеет, ореол уходит, к концу проступает фигурка.
  // Состояние живёт в одном месте, поэтому сцену нельзя рассинхронизировать.
  // =========================================================================
  var STRIKES = 14; // столько ударов до готовой фигурки на экране

  function initFelting() {
    var stage = document.querySelector('[data-felt]');
    if (!stage) return;

    var svg     = stage.querySelector('svg');
    var needle  = svg.querySelector('[data-needle]');
    var core    = svg.querySelector('[data-core]');
    var halo    = svg.querySelector('[data-halo]');
    var fibres  = svg.querySelector('[data-fibres]');
    var shape   = svg.querySelector('[data-shape]');
    var spray   = svg.querySelector('[data-spray]');
    var hint    = document.querySelector('[data-felt-hint]');
    var countEl = document.querySelector('[data-felt-count]');
    var fillEl  = document.querySelector('[data-felt-fill]');
    var noteEl  = document.querySelector('[data-felt-note]');
    var pitch   = document.querySelector('[data-pitch]');

    var hits = 0;
    var busy = false;

    var notes = [
      'Шерсть спутывается от каждого укола. Обратно уже не расправится.',
      'Зазубрины на игле тащат волокна внутрь — вот и весь механизм.',
      'Ком становится плотнее и меньше. Так и должно быть.',
      'Уже держит форму. Дальше только уточнять детали.'
    ];

    // Плотность → геометрия. Одна функция, вызывается и после удара,
    // и при мгновенной отрисовке в режиме «меньше движения».
    function apply(d, animate) {
      var to = animate && motion ? gsap.to.bind(gsap) : gsap.set.bind(gsap);
      var dur = { duration: 0.45, ease: 'power2.out' };

      to(fibres, Object.assign({ scale: 1 - d * 0.72, opacity: 0.7 - d * 0.62,
                                 transformOrigin: '340px 236px' }, animate ? dur : {}));
      to(core,   Object.assign({ attr: { rx: 52 - d * 14, ry: 36 - d * 8 },
                                 opacity: 0.42 + d * 0.5 }, animate ? dur : {}));
      to(halo,   Object.assign({ opacity: 0.14 * (1 - d), scale: 1 - d * 0.3,
                                 transformOrigin: '340px 236px' }, animate ? dur : {}));
      // Фигурка проступает только на последней трети — раньше её там нет.
      to(shape,  Object.assign({ opacity: d < 0.66 ? 0 : (d - 0.66) / 0.34 }, animate ? dur : {}));

      if (fillEl) fillEl.style.width = Math.round(d * 100) + '%';
    }

    function finish() {
      if (!pitch || !pitch.hidden) return;
      pitch.hidden = false;
      var n = document.querySelector('[data-pitch-count]');
      if (n) n.textContent = hits;
      if (hint) hint.textContent = 'Ещё раз?';
      if (motion) gsap.from(pitch, { opacity: 0, y: 18, duration: 0.6, ease: 'power2.out' });
    }

    function strike() {
      if (busy) return;

      hits++;
      var d = Math.min(hits / STRIKES, 1);
      if (countEl) countEl.textContent = hits;
      if (noteEl) noteEl.textContent = notes[Math.min(Math.floor(d * notes.length), notes.length - 1)];
      if (hint && hits === 1) hint.textContent = 'Ещё';

      if (!motion) {
        apply(d, false);
        if (d === 1) finish();
        return;
      }

      busy = true;

      gsap.timeline({ onComplete: function () { busy = false; if (d === 1) finish(); } })
        // Вниз резко, вверх мягко — так двигается рука, а не механизм.
        .to(needle, { y: 58, duration: 0.11, ease: 'power3.in' })
        .add(function () { apply(d, true); })
        // Ком проседает под ударом и отыгрывает обратно.
        .to([core, halo], { scaleY: 0.9, transformOrigin: '340px 262px', duration: 0.09, ease: 'power2.out' }, '<')
        .to(spray, { opacity: 0.75, scale: 1.5, transformOrigin: '340px 226px', duration: 0.22, ease: 'power2.out' }, '<')
        .to([core, halo], { scaleY: 1, duration: 0.3, ease: 'elastic.out(1, 0.5)' })
        .to(spray, { opacity: 0, scale: 1, duration: 0.2 }, '<')
        .to(needle, { y: 0, duration: 0.26, ease: 'power2.out' }, '-=0.28');
    }

    stage.addEventListener('click', strike);

    // Один удар при появлении секции — иначе неочевидно, что это кнопка.
    if (motion && window.ScrollTrigger) {
      ScrollTrigger.create({
        trigger: stage,
        start: 'top 75%',
        once: true,
        onEnter: function () { setTimeout(strike, 500); }
      });
    }
  }

  // =========================================================================
  // htmx: восстанавливаем то, что живёт на клиенте
  // =========================================================================
  document.body.addEventListener('htmx:beforeSwap', function (e) {
    var t = e.detail.target;
    if (t && t.id === 'grid') snapshotGrid();
    if (t && t.id === 'cart-panel') lastTotal = readTotal();
  });

  document.body.addEventListener('htmx:afterSwap', function (e) {
    var t = e.detail.target;
    if (!t) return;

    if (t.id === 'grid') {
      playFlip();
      return;
    }

    if (t.id === 'cart-panel' || (t.closest && t.closest('#cart-panel'))) {
      // Панель заменилась целиком — класс открытости пришлось бы потерять.
      openCart();
      countTotal();
      if (motion) {
        gsap.from('.cart__line', { opacity: 0, x: 24, duration: 0.4, stagger: 0.05, ease: 'power2.out' });
      }
    }
  });

  // Ответ формы записи проявляется — иначе неясно, что вообще что-то произошло.
  document.body.addEventListener('htmx:afterSettle', function (e) {
    if (!motion) return;
    var note = e.detail.target && e.detail.target.querySelector('[data-note]');
    if (note) gsap.from(note, { opacity: 0, y: -10, duration: 0.4, ease: 'power2.out' });
  });

  document.body.addEventListener('htmx:responseError', function (e) {
    if (e.detail.xhr.status === 422) return; // это валидация, её рисует сервер
    var box = document.getElementById('signup-result');
    if (box) box.innerHTML = '<div class="note note--bad"><p>Сервер не ответил. Попробуйте ещё раз через минуту.</p></div>';
  });

  // =========================================================================
  playHero();
  initFelting();
  revealCards();
  syncMainButton();
  lastTotal = readTotal();

  // Первый GET страницы Mini App уходит до того, как выполнился этот скрипт,
  // то есть без заголовка с initData — сервер отвечает как анонимному гостю
  // и рисует пустую корзину. Перезапрашиваем её уже подписанным запросом.
  if (tg && tg.initData && window.htmx) {
    htmx.ajax('GET', '/cart', { target: '#cart-panel', swap: 'outerHTML' });
  }
})();
