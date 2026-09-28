/* ================================================================
   MERCURY — type reveal
   Display lines rise out of their own overflow box; supporting copy
   fades up behind them. Using gsap's own scrollTrigger config (not a
   standalone create) so elements already on screen at load still play.
   ================================================================ */
export function reveal() {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduced) return;                    // markup is already in its final state

  document.querySelectorAll('.display').forEach(h => {
    const words = h.querySelectorAll('.word');
    if (!words.length) return;
    gsap.fromTo(words,
      { yPercent: 108, opacity: 0 },
      {
        yPercent: 0, opacity: 1, duration: 1.15, ease: 'expo.out', stagger: 0.085,
        scrollTrigger: { trigger: h, start: 'top 90%', once: true }
      });
  });

  document.querySelectorAll('.lede, .eyebrow, .cta-row, .meta__cell, .lab__col, .caption-box')
    .forEach(el => {
      gsap.fromTo(el,
        { y: 26, opacity: 0 },
        {
          y: 0, opacity: 1, duration: 1, ease: 'expo.out', delay: 0.1,
          scrollTrigger: { trigger: el, start: 'top 95%', once: true }
        });
    });
}
