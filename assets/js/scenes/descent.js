/* ================================================================
   MERCURY — ACT II, THE DESCENT   &   ACT VI, THE ASCENT
   A single continuous fall: space, stars streaking as you pick up
   speed, the airglow band, three cloud decks rushing past, then
   daylight. The ascent runs the same machine in reverse so the
   site opens and closes at the same altitude.
   ================================================================ */
import { fitCanvas, onTick, whenVisible, clamp, lerp, ease, getFps, TAU } from '../core/gfx.js';
import { makeStars, drawStars, makeClouds, drawClouds, drawAirglow, skyAt,
         cloudBuffer, blitClouds, cloudScale } from './atmos.js';
import { scrub } from '../core/scroll.js';

/* Altitude read-out. Falling 120 km reads better than a percentage. */
const MARKS = [
  [0.00, 'ALTITUDE 120 KM', 'EXOSPHERE'],
  [0.18, 'ALTITUDE  84 KM', 'MESOSPHERE'],
  [0.38, 'ALTITUDE  47 KM', 'STRATOSPHERE'],
  [0.58, 'ALTITUDE  19 KM', 'CLOUD DECK'],
  [0.78, 'ALTITUDE   6 KM', 'BREAKING THROUGH'],
  [0.93, 'ALTITUDE   0 KM', 'GROUND']
];

export function sceneDescent() {
  const cv = document.getElementById('cvDescent');
  if (!cv) return;

  const stars  = makeStars(820, 3);
  const deckA  = makeClouds(16, 11);   // high cirrus
  const deckB  = makeClouds(20, 29);   // the main cumulus deck
  const deckC  = makeClouds(13, 47);   // low scud, right before ground

  const eAlt   = document.getElementById('descentAlt');
  const eLayer = document.getElementById('descentLayer');
  let lastMark = '';

  let prog = 0, alive = false, t = 0;
  scrub('#act-descent', p => { prog = p; }, { start: 'top top', end: 'bottom bottom' });
  whenVisible(document.getElementById('act-descent'), () => alive = true, () => alive = false);

  onTick(dt => {
    if (!alive) return;
    t += dt;
    const { ctx, w, h } = fitCanvas(cv);
    const p = clamp(prog);

    /* ---- the column of air we are currently inside ---- */
    const sky = skyAt(p);
    const deep = skyAt(Math.max(0, p - 0.14));
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, `rgb(${deep[0]},${deep[1]},${deep[2]})`);
    g.addColorStop(1, `rgb(${sky[0]},${sky[1]},${sky[2]})`);
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);

    /* ---- stars: full above 90 km, gone by the time air thickens ---- */
    const starFade = 1 - ease(clamp(p / 0.42));
    // speed peaks mid-fall, so the streaks bloom and then settle
    const speed = Math.sin(clamp(p / 0.9) * Math.PI) ** 0.8;
    drawStars(ctx, w, h, stars, t, {
      scroll: p * 3.2, alpha: starFade, streak: speed * 0.85
    });

    /* ---- airglow rides down the frame as we drop into it ---- */
    drawAirglow(ctx, w, h, {
      y: lerp(-0.1, 0.62, ease(clamp(p / 0.55))),
      thickness: 0.2,
      tint: [110, 180, 255],
      alpha: Math.sin(clamp(p / 0.62) * Math.PI) * 0.85
    });

    /* ---- three decks, entered in turn, drawn into a half-res buffer ---- */
    const B = cloudBuffer(w, h, cloudScale(getFps()));
    // high cirrus, thin and cold
    drawClouds(B.ctx, B.w, B.h, deckA, t, {
      camZ: (p * 1.6) % 1,
      tint: [198, 222, 252],
      alpha: clamp((p - 0.22) / 0.16) * (1 - clamp((p - 0.56) / 0.2)) * 0.8,
      spread: 1.35
    });
    // the main deck — this is the one you fly into
    drawClouds(B.ctx, B.w, B.h, deckB, t, {
      camZ: (p * 2.1) % 1,
      tint: [252, 250, 248],
      alpha: clamp((p - 0.46) / 0.14) * (1 - clamp((p - 0.86) / 0.14)),
      spread: 1
    });
    // low scud, lit warm from below
    drawClouds(B.ctx, B.w, B.h, deckC, t, {
      camZ: (p * 2.6) % 1,
      tint: [236, 240, 248],
      alpha: clamp((p - 0.72) / 0.12) * (1 - clamp((p - 0.95) / 0.05)) * 0.9,
      spread: 0.8
    });

    blitClouds(ctx, w, h, B);

    /* ---- the last moment: everything blows out to daylight ---- */
    const bloom = ease(clamp((p - 0.86) / 0.14));
    if (bloom > 0) {
      ctx.fillStyle = `rgba(247,247,244,${bloom})`;
      ctx.fillRect(0, 0, w, h);
    }

    /* ---- readout ---- */
    const m = MARKS.reduce((acc, x) => p >= x[0] ? x : acc, MARKS[0]);
    if (m[1] !== lastMark) {
      lastMark = m[1];
      if (eAlt) eAlt.textContent = m[1];
      if (eLayer) eLayer.textContent = m[2];
    }
  });
}

/* --------------------------------------------------------- ASCENT */
export function sceneAscent() {
  const cv = document.getElementById('cvAscent');
  if (!cv) return;

  const stars = makeStars(900, 61);
  const deckA = makeClouds(16, 71);
  const deckB = makeClouds(14, 89);
  /* The network we are climbing away from — people, still connected. */
  const NODES = 64;
  const net = Array.from({ length: NODES }, (_, i) => {
    const a = (i / NODES) * TAU * 3.1;
    return { a, r: 0.2 + ((i * 37) % 100) / 125, sp: ((i % 7) - 3) * 0.012, z: (i % 11) / 11 };
  });

  let prog = 0, alive = false, t = 0;
  scrub('#act-ascent', p => { prog = p; }, { start: 'top top', end: 'bottom bottom' });
  whenVisible(document.getElementById('act-ascent'), () => alive = true, () => alive = false);

  onTick(dt => {
    if (!alive) return;
    t += dt;
    const { ctx, w, h } = fitCanvas(cv);
    const p = clamp(prog);

    /* climbing: sample the same air column, upward */
    const sky = skyAt(1 - p);
    const up = skyAt(clamp(1 - p - 0.16));
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, `rgb(${up[0]},${up[1]},${up[2]})`);
    g.addColorStop(1, `rgb(${sky[0]},${sky[1]},${sky[2]})`);
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);

    /* decks fall away beneath us */
    const B = cloudBuffer(w, h, cloudScale(getFps()));
    drawClouds(B.ctx, B.w, B.h, deckB, t, {
      camZ: (1 - p * 2.0 % 1 + 1) % 1,
      tint: [238, 242, 249],
      alpha: (1 - clamp((p - 0.06) / 0.3)) * 0.95,
      spread: 0.9
    });
    drawClouds(B.ctx, B.w, B.h, deckA, t, {
      camZ: (1 - p * 1.5 % 1 + 1) % 1,
      tint: [206, 226, 250],
      alpha: clamp((p - 0.12) / 0.16) * (1 - clamp((p - 0.5) / 0.22)) * 0.8,
      spread: 1.3
    });

    blitClouds(ctx, w, h, B);

    drawAirglow(ctx, w, h, {
      y: lerp(1.05, 0.34, ease(clamp(p / 0.7))),
      thickness: 0.22, tint: [120, 190, 255],
      alpha: Math.sin(clamp(p / 0.8) * Math.PI) * 0.8
    });

    /* stars come back as the air thins */
    const starIn = ease(clamp((p - 0.34) / 0.46));
    drawStars(ctx, w, h, stars, t, { scroll: -p * 2.4, alpha: starIn, streak: 0 });

    /* ---- the network, shrinking below as we climb ---- */
    const netFade = 1 - clamp((p - 0.55) / 0.4);
    if (netFade > 0.01) {
      const cx = w / 2, cy = h * lerp(0.52, 0.78, p);
      const R = Math.min(w, h) * lerp(0.42, 0.10, ease(p));
      const pts = net.map(n => {
        const a = n.a + t * n.sp;
        return { x: cx + Math.cos(a) * R * n.r, y: cy + Math.sin(a) * R * n.r * 0.5, z: n.z };
      });
      for (let i = 0; i < pts.length; i++) {
        for (let j = i + 1; j < pts.length; j++) {
          const d = Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y);
          if (d > R * 0.36) continue;
          ctx.strokeStyle = `rgba(168,188,214,${(1 - d / (R * 0.36)) * 0.2 * netFade})`;
          ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(pts[i].x, pts[i].y); ctx.lineTo(pts[j].x, pts[j].y); ctx.stroke();
        }
      }
      for (const q of pts) {
        const pulse = 0.55 + Math.sin(t * 2 + q.z * 9) * 0.45;
        ctx.fillStyle = `rgba(${(214 + q.z * 40) | 0},${(224 + q.z * 28) | 0},${(240 + q.z * 15) | 0},${(0.35 + pulse * 0.5) * netFade})`;
        ctx.beginPath(); ctx.arc(q.x, q.y, 1.2 + q.z * 2.2, 0, TAU); ctx.fill();
      }
    }
  });
}
