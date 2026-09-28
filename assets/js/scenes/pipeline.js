/* ================================================================
   MERCURY — ACT IV, THE PIPELINE
   The camera flips top-down and the corridor becomes the subject:
   a signal trace the packet runs along as you scroll. Same trick as
   a road seen from above — the path IS the layout.
   ================================================================ */
import { fitCanvas, onTick, whenVisible, clamp, lerp, TAU } from '../core/gfx.js';
import { scrub } from '../core/scroll.js';

const STAGES = [
  ['01','CAPTURE',   'Camera frames in, 60 per second, never stored.'],
  ['02','LANDMARKS', '21 points per hand, solved on device.'],
  ['03','TEMPORAL',  'A 16-frame window — movement is meaning.'],
  ['04','FACE',      'Brow, mouth and gaze carry the grammar.'],
  ['05','DECODE',    'Sequence model resolves the utterance.'],
  ['06','GLOSS',     'Signed order becomes written order.'],
  ['07','VOICE',     'Spoken aloud in the signer’s cadence.']
];

/* Waypoints of the trace, in a virtual space 1 unit wide. */
const WAY = [
  [ 0.00, 0.00],[ 0.00, 0.10],[-0.26, 0.17],[-0.26, 0.29],
  [ 0.22, 0.37],[ 0.22, 0.49],[-0.18, 0.57],[-0.18, 0.69],
  [ 0.26, 0.77],[ 0.26, 0.89],[ 0.00, 0.96],[ 0.00, 1.06]
];

/* Round the corners so the trace reads as routed copper, not a zigzag. */
function smooth(pts, passes = 3) {
  let p = pts;
  for (let k = 0; k < passes; k++) {
    const out = [p[0]];
    for (let i = 0; i < p.length - 1; i++) {
      const a = p[i], b = p[i + 1];
      out.push([a[0]*0.75 + b[0]*0.25, a[1]*0.75 + b[1]*0.25]);
      out.push([a[0]*0.25 + b[0]*0.75, a[1]*0.25 + b[1]*0.75]);
    }
    out.push(p[p.length - 1]);
    p = out;
  }
  return p;
}
const PATH = smooth(WAY);

/* Arc-length table so the packet moves at a constant speed. */
const LEN = [0];
for (let i = 1; i < PATH.length; i++) {
  LEN[i] = LEN[i-1] + Math.hypot(PATH[i][0]-PATH[i-1][0], PATH[i][1]-PATH[i-1][1]);
}
const TOTAL = LEN[LEN.length - 1];

function at(s) {                        // s in 0..1 of total arc length
  const d = clamp(s) * TOTAL;
  let i = 1;
  while (i < LEN.length - 1 && LEN[i] < d) i++;
  const t = (d - LEN[i-1]) / Math.max(1e-6, LEN[i] - LEN[i-1]);
  const a = PATH[i-1], b = PATH[i];
  return {
    x: lerp(a[0], b[0], t), y: lerp(a[1], b[1], t),
    ang: Math.atan2(b[1]-a[1], b[0]-a[0])
  };
}

export function scenePipeline() {
  const cv = document.getElementById('cvPipe');
  if (!cv) return;

  const cards = document.getElementById('pipeCards');
  cards.innerHTML = STAGES.map(([i, t, d]) =>
    `<article class="pcard" data-s="${i}">
       <p class="pcard__i">${i}</p><h4 class="pcard__t">${t}</h4><p class="pcard__d">${d}</p>
     </article>`).join('');
  const cardEls = [...cards.children];

  const eMs    = document.getElementById('pipeMs');
  const eStage = document.getElementById('pipeStage');

  let prog = 0, alive = false, t = 0, cur = -1;

  scrub('#act-pipeline', p => { prog = p; }, { start: 'top top', end: 'bottom bottom' });
  whenVisible(document.getElementById('act-pipeline'), () => alive = true, () => alive = false);

  onTick(dt => {
    if (!alive) return;
    t += dt;
    const { ctx, w, h } = fitCanvas(cv);
    ctx.clearRect(0, 0, w, h);

    const S     = Math.max(w, h) * 1.55;   // world → px
    const head  = clamp(prog);
    const me    = at(head);
    const road  = Math.max(40, Math.min(w, h) * 0.082);

    // camera follows the packet, keeping it just below centre
    const camX = w / 2 - me.x * S;
    const camY = h * 0.52 - me.y * S;
    ctx.save();
    ctx.translate(camX, camY);

    const px = p => [p[0] * S, p[1] * S];

    /* ---- the trace: dark body, then a routed inner channel ---- */
    ctx.lineJoin = ctx.lineCap = 'round';
    ctx.beginPath();
    PATH.forEach((p, i) => { const [x, y] = px(p); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
    ctx.strokeStyle = '#0a0a0b'; ctx.lineWidth = road; ctx.stroke();

    // travelled portion: a thin amber rail along the trace, not a wide wash —
    // a fill at this width muddied the black into brown
    ctx.beginPath();
    const upto = Math.max(2, Math.floor(head * (PATH.length - 1)) + 1);
    PATH.slice(0, upto).forEach((p, i) => { const [x, y] = px(p); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
    ctx.strokeStyle = 'rgba(226,233,245,.85)'; ctx.lineWidth = 2.5; ctx.stroke();

    // dashed centre line, scrolling
    ctx.beginPath();
    PATH.forEach((p, i) => { const [x, y] = px(p); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
    ctx.setLineDash([road * 0.22, road * 0.30]);
    ctx.lineDashOffset = -t * 60;
    ctx.strokeStyle = 'rgba(247,247,244,.34)'; ctx.lineWidth = 2; ctx.stroke();
    ctx.setLineDash([]);

    /* ---- stage gates along the trace ---- */
    ctx.font = '500 10px "JetBrains Mono", monospace';
    STAGES.forEach(([id, name], i) => {
      const s  = (i + 0.5) / STAGES.length;
      const pt = at(s);
      const x  = pt.x * S, y = pt.y * S;
      const on = head >= s - 0.02;

      ctx.save();
      ctx.translate(x, y); ctx.rotate(pt.ang + Math.PI / 2);
      ctx.strokeStyle = on ? '#e8edf6' : 'rgba(247,247,244,.45)';
      ctx.lineWidth = on ? 3 : 1.5;
      ctx.beginPath();
      ctx.moveTo(-road/2, 0); ctx.lineTo(road/2, 0);
      ctx.stroke();
      ctx.restore();

      ctx.fillStyle = on ? '#e8edf6' : 'rgba(10,10,11,.42)';
      ctx.fillText(`${id} ${name}`, x + road * 0.62, y);
    });

    /* ---- the packet ---- */
    const hx = me.x * S, hy = me.y * S;
    ctx.save();
    ctx.translate(hx, hy); ctx.rotate(me.ang + Math.PI / 2);
    // wake
    const wg = ctx.createLinearGradient(0, 0, 0, road * 1.9);
    wg.addColorStop(0, 'rgba(159,180,208,.55)');
    wg.addColorStop(1, 'rgba(159,180,208,0)');
    ctx.fillStyle = wg;
    ctx.fillRect(-road * 0.10, 0, road * 0.20, road * 1.9);
    // body
    const bw = road * 0.30, bh = road * 0.62;
    ctx.fillStyle = '#f7f7f4';
    ctx.fillRect(-bw/2, -bh/2, bw, bh);
    ctx.fillStyle = '#e8edf6';
    ctx.fillRect(-bw/2, -bh/2, bw, bh * 0.22);
    ctx.strokeStyle = '#0a0a0b'; ctx.lineWidth = 1.5;
    ctx.strokeRect(-bw/2, -bh/2, bw, bh);
    ctx.restore();

    // halo
    const hg = ctx.createRadialGradient(hx, hy, 0, hx, hy, road * 1.5);
    hg.addColorStop(0, 'rgba(226,233,245,.24)');
    hg.addColorStop(1, 'rgba(226,233,245,0)');
    ctx.fillStyle = hg;
    ctx.beginPath(); ctx.arc(hx, hy, road * 1.5, 0, TAU); ctx.fill();

    ctx.restore();

    /* ---- readouts ---- */
    const idx = clamp(Math.floor(head * STAGES.length), 0, STAGES.length - 1);
    if (idx !== cur) {
      cur = idx;
      eStage.textContent = `${STAGES[idx][0]} — ${STAGES[idx][2]}`;
      cardEls.forEach((c, i) => c.classList.toggle('is-live', i === idx));
      cardEls[idx]?.scrollIntoView?.({ block: 'nearest' });
    }
    // the budget fills as the packet advances
    eMs.textContent = String(Math.round(6 + head * 46 + Math.sin(t * 4) * 1.5)).padStart(3, '0');
  });
}
