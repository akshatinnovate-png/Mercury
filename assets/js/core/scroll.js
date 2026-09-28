/* ================================================================
   MERCURY — scroll spine
   Lenis drives momentum; GSAP ScrollTrigger reads from it. Every
   scrubbed scene registers through `scrub()` and gets a 0→1 float.
   ================================================================ */
export function scroll() {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  gsap.registerPlugin(ScrollTrigger);

  if (!reduced && window.Lenis) {
    const lenis = new Lenis({
      duration: 1.15,
      easing: t => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
      smoothWheel: true,
      touchMultiplier: 1.6
    });
    lenis.on('scroll', ScrollTrigger.update);
    gsap.ticker.add(t => lenis.raf(t * 1000));
    gsap.ticker.lagSmoothing(0);

    // let in-page anchors ride the same momentum
    document.querySelectorAll('a[href^="#"]').forEach(a => {
      a.addEventListener('click', e => {
        const t = document.querySelector(a.getAttribute('href'));
        if (!t) return;
        e.preventDefault();
        lenis.scrollTo(t, { offset: -10, duration: 1.5 });
      });
    });
    window.__lenis = lenis;
  }

  ScrollTrigger.refresh();
}

/* Register a scrubbed scene: fn receives progress 0→1 across `trigger`. */
export function scrub(trigger, fn, opts = {}) {
  return ScrollTrigger.create({
    trigger,
    start: opts.start || 'top top',
    end: opts.end || 'bottom bottom',
    scrub: true,
    onUpdate: s => fn(s.progress, s.direction, s.getVelocity())
  });
}
