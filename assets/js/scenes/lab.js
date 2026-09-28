/* ================================================================
   MERCURY — ACT VII, THE LAB
   The technical register: a live cellular automaton, a race between
   Mercury and a human relay, and a base64 gutter. All of it real —
   the automaton actually runs Conway's rules.
   ================================================================ */
import { onTick, whenVisible, rng } from '../core/gfx.js';

/* ---------------------------------------------------- Conway's Life */
function life() {
  const cv = document.getElementById('cvLife');
  if (!cv) return;
  const N = 40, ctx = cv.getContext('2d'), cell = cv.width / N;
  const rand = rng(1337);
  let grid = Array.from({ length: N * N }, () => rand() > 0.72 ? 1 : 0);
  let acc = 0, alive = false, gens = 0;

  whenVisible(document.getElementById('act-lab'), () => alive = true, () => alive = false);

  const step = () => {
    const next = new Array(N * N);
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        let n = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (!dx && !dy) continue;
            n += grid[((y + dy + N) % N) * N + ((x + dx + N) % N)];
          }
        }
        const s = grid[y * N + x];
        next[y * N + x] = (s && (n === 2 || n === 3)) || (!s && n === 3) ? 1 : 0;
      }
    }
    grid = next;
    // stagnation guard — reseed so the widget never freezes on a still life
    if (++gens > 260) { gens = 0; grid = grid.map(() => rand() > 0.72 ? 1 : 0); }
  };

  onTick(dt => {
    if (!alive) return;
    acc += dt;
    if (acc < 0.11) return;
    acc = 0;
    step();
    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.fillStyle = '#2a1a20';
    for (let i = 0; i < grid.length; i++) {
      if (!grid[i]) continue;
      ctx.fillRect((i % N) * cell, ((i / N) | 0) * cell, cell, cell);
    }
  });
}

/* ------------------------------------------------------ the race */
const A_SCRIPT = [
  '$ mercury interpret --live',
  'camera  ok   60fps',
  'hands   ok   21/21 landmarks',
  'face    ok   brow + mouth',
  '',
  '[t+000ms] onset detected',
  '[t+011ms] window filled',
  '[t+024ms] gloss  GOOD MORNING APPOINTMENT TEN',
  '[t+038ms] text   "Good morning, I have an',
  '                  appointment at ten."',
  '[t+041ms] speaking █'
];
const B_SCRIPT = [
  '$ relay request --human',
  'queued  position 3',
  'waiting for available interpreter',
  '.',
  '..',
  '...',
  '[t+00:42] still waiting',
  '[t+02:15] still waiting',
  '[t+06:30] interpreter joined',
  '[t+06:44] "sorry, could you start again?"',
  '█'
];

function race() {
  const a = document.getElementById('raceA');
  const b = document.getElementById('raceB');
  if (!a || !b) return;

  const run = (el, script, speed, restart) => {
    let line = 0, ch = 0, acc = 0, out = '';
    return dt => {
      acc += dt;
      if (acc < speed) return;
      acc = 0;
      if (line >= script.length) {
        restart -= speed;
        if (restart < -2.6) { line = 0; ch = 0; out = ''; restart = 0; el.textContent = ''; }
        return;
      }
      const cur = script[line];
      if (ch < cur.length) { out += cur[ch++]; }
      else { out += '\n'; line++; ch = 0; }
      el.textContent = out;
    };
  };

  const stepA = run(a, A_SCRIPT, 0.022, 0);
  const stepB = run(b, B_SCRIPT, 0.085, 0);

  let alive = false;
  whenVisible(document.getElementById('act-lab'), () => alive = true, () => alive = false);
  onTick(dt => { if (!alive) return; stepA(dt); stepB(dt); });
}

/* ------------------------------------------- base64 gutter */
function b64() {
  const el = document.getElementById('b64');
  if (!el) return;
  const seed = 'MERCURY — every hand has a voice. 21 landmarks, 26 handshapes, one interpreter. ';
  let s = '';
  for (let i = 0; i < 6; i++) s += seed;
  el.textContent = btoa(unescape(encodeURIComponent(s))).slice(0, 330);
}

export function sceneLab() { life(); race(); b64(); }

/* --------------------------------------- ACT II — the descent sky */
/* Scrubbing background-position across an oversized gradient reads as
   falling through the atmosphere, and costs nothing to paint. */
export function sceneDescent() {
  const sky = document.getElementById('descentSky');
  const kick = document.getElementById('descentKicker');
  if (!sky) return;

  const MARKS = [
    [0.00, 'ENTERING RANGE'], [0.28, 'ALTITUDE 84 KM'],
    [0.52, 'ALTITUDE 31 KM'], [0.74, 'ALTITUDE 9 KM'], [0.92, 'TOUCHDOWN']
  ];
  let last = '';

  ScrollTrigger.create({
    trigger: '#act-descent', start: 'top top', end: 'bottom bottom', scrub: true,
    onUpdate: s => {
      const p = s.progress;
      sky.style.backgroundPosition = `0% ${(p * 100).toFixed(2)}%`;
      const m = MARKS.reduce((acc, x) => p >= x[0] ? x[1] : acc, MARKS[0][1]);
      if (m !== last) { last = m; kick.textContent = m; }
    }
  });
}
