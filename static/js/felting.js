/*
  Сцена валяния.

  Вся сцена подчинена одному числу — плотности d от 0 до 1. Каждый клочок
  шерсти знает две своих позиции (рыхлую и упакованную) и просто
  интерполирует между ними. Ядро, тень и готовая фигурка тоже читают d.
  Поэтому состояние нельзя рассинхронизировать, а режим «меньше движения»
  рисует нужный кадр без переходов — той же функцией.
*/
(function () {
  'use strict';

  var K = window.Klubok;
  var stage = document.querySelector('[data-felt]');
  if (!stage) return;

  var STRIKES = 16; // ударов до готовой фигурки на экране

  var svg     = stage.querySelector('svg');
  var needle  = svg.querySelector('[data-needle]');
  var tufts   = Array.prototype.slice.call(svg.querySelectorAll('[data-tuft]'));
  var tuftG   = svg.querySelector('[data-tufts]');
  var core    = svg.querySelector('[data-core]');
  var shape   = svg.querySelector('[data-shape]');
  var shadow  = svg.querySelector('[data-shadow]');
  var dimple  = svg.querySelector('[data-dimple]');
  var spray   = svg.querySelector('[data-spray]');

  var hint    = document.querySelector('[data-felt-hint]');
  var countEl = document.querySelector('[data-felt-count]');
  var fillEl  = document.querySelector('[data-felt-fill]');
  var noteEl  = document.querySelector('[data-felt-note]');
  var pitch   = document.querySelector('[data-pitch]');

  var hits = 0;
  var busy = false;
  var done = false;

  var notes = [
    'Шерсть спутывается от каждого укола. Обратно уже не расправится.',
    'Зазубрины на игле тащат волокна внутрь — вот и весь механизм.',
    'Ком становится плотнее и меньше. Так и должно быть.',
    'Уже держит форму. Дальше только уточнять детали.',
    'Почти. Ещё пара уколов — и проступят уши.'
  ];

  // Первые удары меняют много, последние — уточняют. Так и в жизни.
  function curve(d) { return 1 - Math.pow(1 - d, 1.7); }

  function lerp(a, b, t) { return a + (b - a) * t; }

  // Плотность → геометрия. Одна функция на анимацию и на мгновенный кадр.
  function apply(d, animate) {
    var v = curve(d);
    var go = animate && K.motion ? gsap.to.bind(gsap) : gsap.set.bind(gsap);
    var ease = animate ? { duration: 0.5, ease: 'power2.out' } : {};

    tufts.forEach(function (t, i) {
      var D = t.dataset;
      // Клочки не едут строем: каждый чуть отстаёт или опережает.
      var tv = Math.min(1, Math.max(0, v + (i % 5 - 2) * 0.04));
      go(t, Object.assign({
        attr: {
          cx: lerp(+D.x0, +D.x1, tv),
          cy: lerp(+D.y0, +D.y1, tv),
          r:  lerp(+D.r0, +D.r1, tv)
        },
        // На последней трети клочки растворяются в ядре.
        opacity: v < 0.7 ? +t.getAttribute('data-op') || 0.75 : (1 - (v - 0.7) / 0.3) * 0.75
      }, ease));
    });

    go(core, Object.assign({
      opacity: v < 0.25 ? 0 : Math.min(1, (v - 0.25) / 0.5),
      attr: { rx: lerp(30, 34, v), ry: lerp(24, 27, v) }
    }, ease));

    go(shape, Object.assign({ opacity: v < 0.72 ? 0 : (v - 0.72) / 0.28 }, ease));

    go(shadow, Object.assign({
      attr: { rx: lerp(96, 42, v) }, opacity: lerp(0.14, 0.22, v)
    }, ease));

    if (fillEl) fillEl.style.width = Math.round(d * 100) + '%';
  }

  function finish() {
    done = true;
    if (hint) hint.textContent = 'Нажмите — и начнём заново';
    if (!pitch || !pitch.hidden) return;
    pitch.hidden = false;
    var n = document.querySelector('[data-pitch-count]');
    if (n) n.textContent = hits;
    if (K.motion) gsap.from(pitch, { opacity: 0, y: 18, duration: 0.6, ease: 'power2.out' });
  }

  function reset() {
    hits = 0;
    done = false;
    if (countEl) countEl.textContent = '0';
    if (noteEl) noteEl.textContent = notes[0];
    if (hint) hint.textContent = 'Ещё';
    apply(0, true);
  }

  function strike() {
    if (busy) return;
    if (done) { reset(); return; }

    hits++;
    K.haptic(hits === STRIKES ? 'heavy' : 'light');

    var d = Math.min(hits / STRIKES, 1);
    if (countEl) countEl.textContent = hits;
    if (noteEl) noteEl.textContent = notes[Math.min(Math.floor(curve(d) * notes.length), notes.length - 1)];
    if (hint && hits === 1) hint.textContent = 'Ещё';

    if (!K.motion) {
      apply(d, false);
      if (d === 1) finish();
      return;
    }

    busy = true;

    gsap.timeline({ onComplete: function () { busy = false; if (d === 1) finish(); } })
      // Вниз резко, вверх мягко — так двигается рука, а не механизм.
      .to(needle, { y: 50, duration: 0.1, ease: 'power3.in' })
      .add(function () { apply(d, true); })
      // Ком проседает под ударом и отыгрывает пружиной.
      .to(tuftG, { scaleY: 0.92, transformOrigin: '340px 258px', duration: 0.08, ease: 'power2.out' }, '<')
      .fromTo(dimple, { attr: { r: 4 }, opacity: 0.8 }, { attr: { r: 26 }, opacity: 0, duration: 0.45, ease: 'power2.out' }, '<')
      .to(spray, { opacity: 0.8, scale: 1.55, transformOrigin: '340px 214px', duration: 0.24, ease: 'power2.out' }, '<')
      .to(tuftG, { scaleY: 1, duration: 0.34, ease: 'elastic.out(1, 0.5)' })
      .to(spray, { opacity: 0, scale: 1, duration: 0.2 }, '<')
      .to(needle, { y: 0, duration: 0.28, ease: 'power2.out' }, '-=0.3');
  }

  // Запоминаем исходную прозрачность клочков — apply() к ней возвращается.
  tufts.forEach(function (t) { t.setAttribute('data-op', t.getAttribute('opacity')); });

  stage.addEventListener('click', strike);

  // Один удар при появлении секции — иначе неочевидно, что это кнопка.
  if (K.motion && window.ScrollTrigger) {
    ScrollTrigger.create({
      trigger: stage, start: 'top 75%', once: true,
      onEnter: function () { setTimeout(strike, 600); }
    });
  }
})();
