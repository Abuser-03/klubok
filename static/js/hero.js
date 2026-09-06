/*
  Хиро: единственный на странице момент движения, который никто не вызывал.
  Нити прорисовываются, строки заголовка поднимаются, дальше нити медленно
  расходятся при прокрутке.
*/
(function () {
  'use strict';

  var K = window.Klubok;
  var fibres = document.querySelectorAll('.hero__fibres path');
  var lines = document.querySelectorAll('.hero__title .line');
  if (!fibres.length || !K.motion) return;

  fibres.forEach(function (p) {
    var len = p.getTotalLength();
    gsap.set(p, { strokeDasharray: len, strokeDashoffset: len });
  });

  gsap.timeline()
    .to(fibres, { strokeDashoffset: 0, duration: 1.5, stagger: 0.11, ease: 'power1.inOut' })
    .from(lines, { yPercent: 108, duration: 0.85, stagger: 0.08, ease: 'power3.out' }, '-=1.05')
    .from('.hero__kicker, .hero__lede, .hero__acts',
      { opacity: 0, y: 14, duration: 0.6, stagger: 0.09, ease: 'power2.out' }, '-=0.5');

  if (!window.ScrollTrigger) return;

  fibres.forEach(function (p, i) {
    gsap.to(p, {
      y: (i % 2 ? 1 : -1) * (14 + i * 7),
      ease: 'none',
      scrollTrigger: { trigger: '.hero', start: 'top top', end: 'bottom top', scrub: 0.7 }
    });
  });

  gsap.to('.hero__text', {
    y: 48, opacity: 0.35, ease: 'none',
    scrollTrigger: { trigger: '.hero', start: 'top top', end: 'bottom top', scrub: 0.5 }
  });
})();
