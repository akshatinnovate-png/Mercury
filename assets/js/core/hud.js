/* ================================================================
   MERCURY — instrumentation
   The telemetry rail, the ticker, the sticky-nav state and the
   climate switch that repaints chrome light/dark per act.
   ================================================================ */
import { onTick, getFps, clamp, lerp } from './gfx.js';

const TICKER = [
  ['LIVE', 'open the studio and sign into your camera'],
  ['SPEC', '21 landmarks · 20 bones · 3 dimensions'],
  ['WHY',  '1.2 billion people live with hearing loss — WHO'],
  ['NOTE', 'sign languages are not signed versions of spoken ones'],
  ['NAME', 'mercury — roman god of speech, messages and crossings'],
  ['ASL',  '≈ 300 distinct sign languages worldwide']
];

export function instruments() {
  /* ---------- ticker: duplicated once so the loop is seamless ---------- */
  const rail = document.getElementById('tickerRail');
  const row = TICKER.map(([k, v]) => `<span><b>${k}</b> &nbsp;${v}</span>`).join('');
  rail.innerHTML = row + row;

  /* ---------- sticky nav ---------- */
  const nav = document.getElementById('nav');
  ScrollTrigger.create({
    start: 'top -80',
    onUpdate: s => nav.classList.toggle('is-stuck', s.progress > 0 || scrollY > 80),
    onToggle: s => nav.classList.toggle('is-stuck', s.isActive)
  });
  addEventListener('scroll', () => nav.classList.toggle('is-stuck', scrollY > 80), { passive: true });

  /* ---------- act / scene / climate ---------- */
  const hud    = document.getElementById('hud');
  const eAct   = document.getElementById('hudAct');
  const eScene = document.getElementById('hudScene');
  const eFps   = document.getElementById('hudFps');
  const eProg  = document.getElementById('hudProg');
  const ePct   = document.getElementById('hudPct');

  setTimeout(() => hud.classList.add('is-live'), 900);

  // Acts are several viewports tall, so an intersection *ratio* can never
  // reach 50%. Track the act crossing the middle of the screen instead.
  const PAPER = new Set(['act-hand', 'act-pipeline', 'act-lab']);

  document.querySelectorAll('.act').forEach(el => {
    const enter = () => {
      eAct.textContent   = el.dataset.act   || '—';
      eScene.textContent = el.dataset.scene || '—';
      document.documentElement.dataset.climate = PAPER.has(el.id) ? 'paper' : 'void';
    };
    ScrollTrigger.create({
      trigger: el, start: 'top center', end: 'bottom center',
      onEnter: enter, onEnterBack: enter
    });
  });

  /* ---------- live readouts ---------- */
  const eLat = document.getElementById('navLatency');
  const eClk = document.getElementById('footClock');
  let latency = 42, tAcc = 0;

  onTick((dt) => {
    const doc = document.documentElement;
    const max = doc.scrollHeight - innerHeight;
    const p = max > 0 ? clamp(scrollY / max) : 0;
    eProg.style.width = (p * 100).toFixed(1) + '%';
    ePct.textContent = String(Math.round(p * 100)).padStart(3, '0');
    eFps.textContent = getFps();

    tAcc += dt;
    if (tAcc > 0.4) {
      tAcc = 0;
      // a plausible jitter around the target budget — this is UI, not a measurement
      latency = lerp(latency, 38 + Math.random() * 14, 0.5);
      eLat.textContent = latency.toFixed(0);
      const d = new Date();
      eClk.textContent = [d.getHours(), d.getMinutes(), d.getSeconds()]
        .map(n => String(n).padStart(2, '0')).join(':');
    }
  });
}
