/* ================================================================
   MERCURY — the hand rig
   Forward kinematics over MediaPipe's 21-landmark topology. Shared by
   the landing page (Act III) and the studio (text → fingerspelling),
   so there is exactly one definition of what a handshape is.

   Authored in screen space: +x right, +y down, +z away from viewer.
   ================================================================ */
import { lerp, clamp } from '../core/gfx.js';

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
export const STRUT = new Set([0, 4, 8, 12, 16, 20]);
export const ALONG = BONES.map((_, i) => STRUT.has(i) ? 0 : (i % 4) - 1);

export const NAMES = ['WRIST',
  'THUMB_CMC','THUMB_MCP','THUMB_IP','THUMB_TIP',
  'INDEX_MCP','INDEX_PIP','INDEX_DIP','INDEX_TIP',
  'MIDDLE_MCP','MIDDLE_PIP','MIDDLE_DIP','MIDDLE_TIP',
  'RING_MCP','RING_PIP','RING_DIP','RING_TIP',
  'PINKY_MCP','PINKY_PIP','PINKY_DIP','PINKY_TIP'];

const RIG = [
  { base:{x:-0.31,y: 0.14,z: 0.10}, len:[0.21,0.16,0.13], axis:'z', lead:-1.05 }, // thumb
  { base:{x:-0.23,y:-0.28,z: 0.03}, len:[0.29,0.19,0.14], axis:'x', lead: 0.00 }, // index
  { base:{x:-0.02,y:-0.33,z: 0.01}, len:[0.32,0.21,0.15], axis:'x', lead: 0.00 }, // middle
  { base:{x: 0.18,y:-0.29,z:-0.02}, len:[0.29,0.20,0.14], axis:'x', lead: 0.00 }, // ring
  { base:{x: 0.35,y:-0.20,z:-0.05}, len:[0.23,0.16,0.12], axis:'x', lead: 0.00 }  // pinky
];
const JOINT_W = [0.86, 1.00, 0.72];

const rotX = (d,a)=>({x:d.x, y:d.y*Math.cos(a)-d.z*Math.sin(a), z:d.y*Math.sin(a)+d.z*Math.cos(a)});
const rotY = (d,a)=>({x:d.x*Math.cos(a)+d.z*Math.sin(a), y:d.y, z:-d.x*Math.sin(a)+d.z*Math.cos(a)});
const rotZ = (d,a)=>({x:d.x*Math.cos(a)-d.y*Math.sin(a), y:d.x*Math.sin(a)+d.y*Math.cos(a), z:d.z});

/** Solve all 21 landmarks for a pose {c:[5 curls], s:[5 spreads], o?:{roll,pitch,yaw}}. */
export function solve(pose) {
  const P = [{ x: 0, y: 0.34, z: 0 }];              // 0 — wrist
  RIG.forEach((f, i) => {
    const curl = pose.c[i], spread = pose.s[i];
    let d = rotZ({ x: f.lead * 0.55, y: -1, z: 0 }, spread);
    const m = Math.hypot(d.x, d.y, d.z); d = { x: d.x/m, y: d.y/m, z: d.z/m };

    let p = { ...f.base };
    P.push({ ...p });                                // MCP / CMC
    for (let j = 0; j < 3; j++) {
      const a = curl * JOINT_W[j] * (Math.PI / 2);
      d = f.axis === 'z' ? rotZ(d, a) : rotX(d, -a);
      p = { x: p.x + d.x * f.len[j], y: p.y + d.y * f.len[j], z: p.z + d.z * f.len[j] };
      P.push({ ...p });
    }
  });

  // whole-hand orientation, for the letters that point sideways or down
  const o = pose.o;
  if (o) {
    const piv = P[0];
    return P.map(q => {
      let v = { x: q.x - piv.x, y: q.y - piv.y, z: q.z - piv.z };
      if (o.roll)  v = rotZ(v, o.roll);
      if (o.pitch) v = rotX(v, o.pitch);
      if (o.yaw)   v = rotY(v, o.yaw);
      return { x: v.x + piv.x, y: v.y + piv.y, z: v.z + piv.z };
    });
  }
  return P;
}

/** Blend two poses. Orientations blend too, so transitions stay smooth. */
export function mixPose(a, b, t) {
  const o = (a.o || b.o) ? {
    roll:  lerp(a.o?.roll  || 0, b.o?.roll  || 0, t),
    pitch: lerp(a.o?.pitch || 0, b.o?.pitch || 0, t),
    yaw:   lerp(a.o?.yaw   || 0, b.o?.yaw   || 0, t)
  } : null;
  return {
    c: a.c.map((v, i) => lerp(v, b.c[i], t)),
    s: a.s.map((v, i) => lerp(v, b.s[i], t)),
    ...(o ? { o } : {})
  };
}
