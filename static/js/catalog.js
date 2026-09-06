/*
  Каталог: появление карточек, наклон под курсором, переезд при фильтре.
*/
(function () {
  'use strict';

  var K = window.Klubok;

  // --- Фильтры: активное состояние переключаем сами -----------------------

  document.addEventListener('click', function (e) {
    var chip = e.target.closest('[data-chip]');
    if (!chip) return;
    document.querySelectorAll('[data-chip]').forEach(function (c) { c.classList.remove('is-on'); });
    chip.classList.add('is-on');
  });

  // --- Появление при скролле ---------------------------------------------

  function reveal(scope) {
    if (!K.motion || !window.ScrollTrigger) return;
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

  // --- Наклон карточки под курсором --------------------------------------
  // Рисунок смещается сильнее карточки — разная скорость слоёв читается
  // как глубина, и вещь выглядит лежащей в коробке, а не напечатанной.

  var hovered = null;

  function resetTilt(card) {
    if (!card) return;
    var art = card.querySelector('[data-art] svg');
    gsap.to(card, { rotateX: 0, rotateY: 0, duration: 0.6, ease: 'power3.out' });
    if (art) gsap.to(art, { x: 0, y: 0, scale: 1, duration: 0.7, ease: 'power3.out' });
  }

  document.addEventListener('pointermove', function (e) {
    if (!K.motion || e.pointerType === 'touch') return;

    var card = e.target.closest ? e.target.closest('.card') : null;
    if (card !== hovered) { resetTilt(hovered); hovered = card; }
    if (!card || card.classList.contains('card--gone')) return;

    var box = card.getBoundingClientRect();
    var px = (e.clientX - box.left) / box.width - 0.5;
    var py = (e.clientY - box.top) / box.height - 0.5;

    gsap.to(card, { rotateX: -py * 4, rotateY: px * 5, duration: 0.5, ease: 'power2.out', transformPerspective: 900 });

    var art = card.querySelector('[data-art] svg');
    if (art) gsap.to(art, { x: px * 10, y: py * 8, scale: 1.04, duration: 0.6, ease: 'power2.out' });
  });

  // --- Переезд карточек при смене фильтра (FLIP) -------------------------
  // htmx заменяет сетку целиком, и уцелевшие карточки прыгают на новые
  // места рывком. Запоминаем координаты ДО подмены, после — сажаем обратно
  // трансформом и отпускаем: видно, что карточка переехала, а не что
  // исчезла одна и появилась другая.

  var before = null;

  document.body.addEventListener('htmx:beforeSwap', function (e) {
    if (!e.detail.target || e.detail.target.id !== 'grid') return;
    before = new Map();
    document.querySelectorAll('#grid [data-id]').forEach(function (el) {
      before.set(el.dataset.id, el.getBoundingClientRect());
    });
  });

  document.body.addEventListener('htmx:afterSwap', function (e) {
    if (!e.detail.target || e.detail.target.id !== 'grid') return;

    if (!K.motion || !before) { before = null; return; }

    document.querySelectorAll('#grid [data-id]').forEach(function (el, i) {
      el.classList.add('is-shown');
      var prev = before.get(el.dataset.id);
      var now = el.getBoundingClientRect();
      if (prev) {
        gsap.fromTo(el,
          { x: prev.left - now.left, y: prev.top - now.top },
          { x: 0, y: 0, duration: 0.55, ease: 'power3.out' });
      } else {
        gsap.from(el, { opacity: 0, scale: 0.93, duration: 0.45, delay: i * 0.03, ease: 'power2.out' });
      }
    });
    before = null;
  });

  // Ответ формы записи проявляется — иначе неясно, что что-то произошло.
  document.body.addEventListener('htmx:afterSettle', function (e) {
    if (!K.motion) return;
    var note = e.detail.target && e.detail.target.querySelector('[data-note]');
    if (note) gsap.from(note, { opacity: 0, y: -10, duration: 0.4, ease: 'power2.out' });
  });

  document.body.addEventListener('htmx:responseError', function (e) {
    if (e.detail.xhr.status === 422) return; // валидацию рисует сервер
    var box = document.getElementById('signup-result');
    if (box) box.innerHTML = '<div class="note note--bad"><p>Сервер не ответил. Попробуйте ещё раз через минуту.</p></div>';
  });

  reveal();
})();
