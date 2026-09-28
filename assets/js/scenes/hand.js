/* ================================================================
   MERCURY — ACT III, THE HAND
   A 21-landmark rig on MediaPipe's topology, posed by forward
   kinematics. Scroll scrubs it through M-E-R-C-U-R-Y; the panels
   read out the landmark stream and the inference beside it.

   Nothing here is a recording. Every joint is solved per frame.
   ================================================================ */
import {
  fitCanvas, onTick, whenVisible, clamp, lerp, ease, TAU, rot, project
} from '../core/gfx.js';
import { scrub } from '../core/scroll.js';

/* MediaPipe hand topology — 20 bones over 21 nodes. */
export const BONES = [
  [0,1],[1,2],[2,3],[3,4],            // thumb
  [0,5],[5,6],[6,7],[7,8],            // index
  [5,9],[9,10],[10,11],[11,12],       // middle
  [9,13],[13,14],[14,15],[15,16],     // ring
  [13,17],[17,18],[18,19],[19,20],    // pinky
  [0,17]                              // palm closure
];
/* Which BONES entries lie inside the palm. Drawing these as heavily as a
   finger turns the hand into a wedge, so they get a lighter pass. */
const STRUT = new Set([0, 4, 8, 12, 16, 20]);
/* Position of each bone along its digit, for tapering. */
const ALONG = BONES.map((_, i) => STRUT.has(i) ? 0 : (i % 4) - 1);

const NAMES = ['WRIST',
  'THUMB_CMC','THUMB_MCP','THUMB_IP','THUMB_TIP',
  'INDEX_MCP','INDEX_PIP','INDEX_DIP','INDEX_TIP',
  'MIDDLE_MCP','MIDDLE_PIP','MIDDLE_DIP','MIDDLE_TIP',
  'RING_MCP','RING_PIP','RING_DIP','RING_TIP',
  'PINKY_MCP','PINKY_PIP','PINKY_DIP','PINKY_TIP'];

/* Where each finger leaves the palm, and how long its bones are. */
const RIG = [
  { base:{x:-0.31,y: 0.14,z: 0.10}, len:[0.21,0.16,0.13], axis:'z', lead:-1.05 }, // thumb
  { base:{x:-0.23,y:-0.28,z: 0.03}, len:[0.29,0.19,0.14], axis:'x', lead: 0.00 }, // index
  { base:{x:-0.02,y:-0.33,z: 0.01}, len:[0.32,0.21,0.15], axis:'x', lead: 0.00 }, // middle
  { base:{x: 0.18,y:-0.29,z:-0.02}, len:[0.29,0.20,0.14], axis:'x', lead: 0.00 }, // ring
  { base:{x: 0.35,y:-0.20,z:-0.05}, len:[0.23,0.16,0.12], axis:'x', lead: 0.00 }  // pinky
];
/* How much of the total curl each joint takes. A full fist folds to
   roughly 235 degrees across the three joints, which is about life. */
const JOINT_W = [0.86, 1.00, 0.72];

/* ASL handshapes as {curl, spread} per finger. Interpolating between
   two of these gives a believable transition for free. */
export const POSE = {
  OPEN: { c:[0.08,0.05,0.03,0.05,0.08], s:[-0.55,-0.20,0.00,0.19,0.36] },
  M:    { c:[0.80,0.98,0.98,0.98,0.95], s:[-0.30,-0.06,0.00,0.06,0.12] },
  E:    { c:[0.88,0.78,0.78,0.78,0.78], s:[-0.35,-0.08,0.00,0.08,0.16] },
  R:    { c:[0.88,0.10,0.10,1.00,1.00], s:[-0.30, 0.26,-0.22,0.10,0.20] },
  C:    { c:[0.62,0.52,0.52,0.54,0.58], s:[-0.62,-0.16,0.00,0.14,0.30] },
  U:    { c:[0.92,0.04,0.04,1.00,1.00], s:[-0.25,-0.03,0.03,0.10,0.20] },
  Y:    { c:[0.04,1.00,1.00,1.00,0.06], s:[-0.75,-0.10,0.00,0.10,0.55] }
};
/* The word the hand spells as you scroll. */
const WORD = ['OPEN','M','E','R','C','U','R','Y'];
const SPOKEN = { M:'EM', E:'EE', R:'AR', C:'SEE', U:'YOU', Y:'WHY', OPEN:'—' };

const rotX = (d,a)=>({x:d.x, y:d.y*Math.cos(a)-d.z*Math.sin(a), z:d.y*Math.sin(a)+d.z*Math.cos(a)});
const rotZ = (d,a)=>({x:d.x*Math.cos(a)-d.y*Math.sin(a), y:d.x*Math.sin(a)+d.y*Math.cos(a), z:d.z});

/* Solve all 21 landmarks for a given {c,s} pose. */
export function solve(pose) {
  const P = [{ x: 0, y: 0.34, z: 0 }];           // 0 — wrist
  RIG.forEach((f, i) => {
    const curl = pose.c[i], spread = pose.s[i];
    // base direction: up the palm, splayed sideways by spread
    let d = rotZ({ x: f.lead * 0.55, y: -1, z: 0 }, spread);
    const m = Math.hypot(d.x, d.y, d.z); d = { x: d.x/m, y: d.y/m, z: d.z/m };

    let p = { ...f.base };
    P.push({ ...p });                              // MCP / CMC
    for (let j = 0; j < 3; j++) {
      const a = curl * JOINT_W[j] * (Math.PI / 2);
      d = f.axis === 'z' ? rotZ(d, a) : rotX(d, -a);
      p = { x: p.x + d.x * f.len[j], y: p.y + d.y * f.len[j], z: p.z + d.z * f.len[j] };
      P.push({ ...p });
    }
  });
  return P;
}

const mixPose = (a, b, t) => ({
  c: a.c.map((v, i) => lerp(v, b.c[i], t)),
  s: a.s.map((v, i) => lerp(v, b.s[i], t))
});

export function sceneHand() {
  const cv = document.getElementById('cvHand');
  if (!cv) return;

  /* ---- panels ---- */
  const list = document.getElementById('lmkList');
  list.innerHTML = NAMES.map((n, i) =>
    `<li data-i="${i}"><span>${String(i).padStart(2,'0')} ${n}</span><b>0.00</b></li>`).join('');
  const rows = [...list.children];

  const eGlyph = document.getElementById('inferGlyph');
  const eName  = document.getElementById('inferName');
  const eConf  = document.getElementById('inferConf');
  const barsEl = document.getElementById('inferBars');
  const LETTERS = ['M','E','R','C','U','Y'];
  barsEl.innerHTML = LETTERS.map(l =>
    `<div class="bar" data-l="${l}"><i></i><span>${l}</span></div>`).join('');
  const bars = Object.fromEntries([...barsEl.children].map(b => [b.dataset.l, b]));

  const panels = document.querySelectorAll('.hand__panel');
  const ghost  = document.getElementById('handGhost');

  let prog = 0, alive = false, t = 0, shown = '';

  scrub('#act-hand', p => { prog = p; }, { start: 'top top', end: 'bottom bottom' });
  whenVisible(document.getElementById('act-hand'), () => alive = true, () => alive = false);

  onTick(dt => {
    if (!alive) return;
    t += dt;
    const { ctx, w, h } = fitCanvas(cv);
    ctx.clearRect(0, 0, w, h);

    /* ---- where are we in the word? ---- */
    const span = prog * (WORD.length - 1);
    const i0   = clamp(Math.floor(span), 0, WORD.length - 2);
    const frac = span - i0;
    // hold each shape, then snap through the transition — how signing reads
    const tr   = ease(clamp((frac - 0.34) / 0.44));
    const key  = tr < 0.5 ? WORD[i0] : WORD[i0 + 1];
    const pose = mixPose(POSE[WORD[i0]], POSE[WORD[i0 + 1]], tr);
    const L    = solve(pose);

    /* ---- camera: the hand turns as it is read ---- */
    const ry  = -0.30 + Math.sin(t * 0.22) * 0.12 + (prog - 0.5) * 0.55;
    const rx  = -0.10 + Math.sin(t * 0.17) * 0.05;
    const fov = Math.min(w, h) * 1.42;
    const scale = lerp(0.52, 0.64, ease(clamp(prog * 1.4)));
    // An extended hand is taller than the space left under the caption, so the
    // rig sits right of centre and the caption keeps the free bottom-left.
    const wide = w > 1100;
    const xOff = wide ? w * 0.11 : 0;
    const yOff = wide ? h * 0.02 : -h * 0.04;
    const proj = q => {
      const r = rot({ x: q.x * scale, y: q.y * scale, z: q.z * scale }, ry, rx);
      const v = project(r, w, h, fov, 2.5);
      return { x: v.x + xOff, y: v.y + yOff, s: v.s, z: r.z };
    };

    const P = L.map(proj);

    /* ---- palm wash: a soft field so the rig sits in space ---- */
    const cxp = P[9], g = ctx.createRadialGradient(cxp.x, cxp.y, 0, cxp.x, cxp.y, fov * 0.42);
    g.addColorStop(0, 'rgba(255,107,26,.10)');
    g.addColorStop(1, 'rgba(255,107,26,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);

    /* ---- palm: the knuckle line extruded to a wrist with real width.
       A polygon that converges on landmark 0 reads as a wedge, not a hand. ---- */
    const across = { x: L[17].x - L[5].x, y: L[17].y - L[5].y, z: L[17].z - L[5].z };
    const wristL = { x: L[0].x - across.x * 0.34, y: L[0].y - across.y * 0.34, z: L[0].z - across.z * 0.34 };
    const wristR = { x: L[0].x + across.x * 0.34, y: L[0].y + across.y * 0.34, z: L[0].z + across.z * 0.34 };
    const palm3 = [L[5], L[9], L[13], L[17], wristR, wristL].map(proj);
    ctx.beginPath();
    palm3.forEach((q, k) => k ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y));
    ctx.closePath();
    ctx.fillStyle = 'rgba(10,10,11,.10)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(10,10,11,.34)';
    ctx.lineWidth = 1.4;
    ctx.lineJoin = 'round';
    ctx.stroke();

    /* ---- digits: one tapered stroke per bone, far ones thinner ---- */
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    BONES.forEach(([a, b], bi) => {
      const A = P[a], B = P[b];
      const depth = clamp((((A.z + B.z) / 2) + 1) / 2);

      if (STRUT.has(bi)) {                       // inside the palm — hint only
        ctx.strokeStyle = `rgba(10,10,11,${0.10 + depth * 0.14})`;
        ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.lineTo(B.x, B.y); ctx.stroke();
        return;
      }

      const taper = 1 - clamp(ALONG[bi], 0, 2) * 0.19;
      ctx.strokeStyle = `rgba(10,10,11,${0.26 + depth * 0.5})`;
      ctx.lineWidth = lerp(3.2, 9.5, depth) * taper;
      ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.lineTo(B.x, B.y); ctx.stroke();
      // a lighter core so the digit reads as volume rather than a bar
      ctx.strokeStyle = `rgba(247,247,244,${0.18 + depth * 0.22})`;
      ctx.lineWidth = lerp(1.0, 3.4, depth) * taper;
      ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.lineTo(B.x, B.y); ctx.stroke();
    });

    /* ---- joints: tips get the signal colour ---- */
    const TIPS = new Set([4, 8, 12, 16, 20]);
    P.forEach((p, i) => {
      const depth = clamp((p.z + 1) / 2);
      const r = lerp(2.2, 5.4, depth) * (TIPS.has(i) ? 1.25 : 1);
      if (TIPS.has(i)) {
        const pulse = 0.5 + Math.sin(t * 3 + i) * 0.5;
        ctx.fillStyle = `rgba(255,107,26,${0.22 + pulse * 0.2})`;
        ctx.beginPath(); ctx.arc(p.x, p.y, r * 2.6, 0, TAU); ctx.fill();
        ctx.fillStyle = '#ff6b1a';
      } else {
        ctx.fillStyle = `rgba(10,10,11,${0.4 + depth * 0.6})`;
      }
      ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, TAU); ctx.fill();
      ctx.fillStyle = 'rgba(247,247,244,.9)';
      ctx.beginPath(); ctx.arc(p.x, p.y, r * 0.34, 0, TAU); ctx.fill();
    });

    /* ---- tracking reticle round the whole hand ---- */
    const xs = P.map(p => p.x), ys = P.map(p => p.y);
    const x0 = Math.min(...xs) - 26, x1 = Math.max(...xs) + 26;
    const y0 = Math.min(...ys) - 26, y1 = Math.max(...ys) + 26;
    ctx.strokeStyle = 'rgba(10,10,11,.28)'; ctx.lineWidth = 1;
    const k = 18;
    [[x0,y0,1,1],[x1,y0,-1,1],[x0,y1,1,-1],[x1,y1,-1,-1]].forEach(([x,y,sx,sy])=>{
      ctx.beginPath();
      ctx.moveTo(x, y + k*sy); ctx.lineTo(x, y); ctx.lineTo(x + k*sx, y);
      ctx.stroke();
    });
    ctx.font = '500 9px "JetBrains Mono", monospace';
    ctx.fillStyle = 'rgba(10,10,11,.5)';
    ctx.fillText(`TRACK 0.9${Math.floor(4 + Math.sin(t*2)*3)}`, x0, y0 - 9);

    /* ---- scan line sweeping the rig ---- */
    const sy = y0 + ((t * 0.28) % 1) * (y1 - y0);
    const sg = ctx.createLinearGradient(x0, sy - 18, x0, sy + 18);
    sg.addColorStop(0, 'rgba(77,232,255,0)');
    sg.addColorStop(.5, 'rgba(77,232,255,.5)');
    sg.addColorStop(1, 'rgba(77,232,255,0)');
    ctx.strokeStyle = sg; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x0, sy); ctx.lineTo(x1, sy); ctx.stroke();

    /* ---- panels + ghost word ---- */
    panels.forEach(p => p.style.opacity = String(clamp((prog - 0.04) / 0.1)));
    const conf = lerp(0.42, 0.99, 1 - Math.abs(tr - 0.5) * 2);

    if (key !== shown) {
      shown = key;
      eGlyph.textContent = key === 'OPEN' ? '·' : key;
      eName.textContent  = SPOKEN[key] || '—';
      ghost.textContent  = key === 'OPEN' ? 'READING' : key;
    }
    eConf.textContent = conf.toFixed(2);

    // candidate distribution: the true letter leads, the rest are noise
    LETTERS.forEach(l => {
      const v = l === key ? conf : Math.max(0.02, (0.34 - Math.random() * 0.3) * (1 - conf));
      bars[l].style.setProperty('--v', (v * 100).toFixed(0) + '%');
      bars[l].classList.toggle('is-top', l === key);
      bars[l].querySelector('span').textContent = v.toFixed(2);
    });

    // landmark stream: the live z-depth of every node
    rows.forEach((r, i) => {
      r.children[1].textContent = (L[i].z).toFixed(2);
      r.classList.toggle('is-hot', TIPS.has(i));
    });
  });
}
