/* Generate the training set in the browser, with the same encoder that
   runs at inference — so there is no chance of the two drifting apart. */
import { chromium } from 'playwright';
import { writeFileSync } from 'fs';

const PER_LETTER = +(process.argv[2] || 2400);
const SEED = +(process.argv[3] || 12345);
const STRENGTH = +(process.argv[4] || 1);
const OUT = process.argv[5] || 'train.json';
const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args:['--enable-unsafe-swiftshader'] });
const p = await b.newPage();
p.on('pageerror', e => console.log('ERR', e.message));
await p.goto('http://127.0.0.1:8000/studio.html', { waitUntil:'domcontentloaded' });

const data = await p.evaluate(async ({ N, SEED, STRENGTH }) => {
  const { solve, mixPose } = await import('/assets/js/studio/rig.js');
  const { SIGNS } = await import('/assets/js/studio/alphabet.js');
  const { encode, augment, ENCODE_DIM } = await import('/assets/js/studio/encode.js');

  // deterministic PRNG so the dataset is reproducible
  let s = SEED >>> 0;
  const rnd = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;

  // J is I plus a hook, Z is D plus a zigzag: as stills they are the same
  // shape, so they are not separate classes. Motion promotes them later.
  const MOTION = { J: 'I', Z: 'D' };
  const letters = Object.keys(SIGNS).filter(l => !(l in MOTION));
  const X = [], y = [];

  for (let li = 0; li < letters.length; li++) {
    const L = letters[li];
    const base = SIGNS[L];
    // fold the motion letters' samples into their static twin, so the
    // model sees the natural variety of that shape
    const sources = [base, ...Object.entries(MOTION)
      .filter(([, twin]) => twin === L).map(([m]) => SIGNS[m])];
    for (let n = 0; n < N; n++) {
      const src = sources[n % sources.length];
      // jitter the pose parameters themselves, so the shape varies the way
      // a different person's version of the same letter would
      const pose = {
        c: src.c.map(v => Math.max(0, Math.min(1, v + (rnd() - 0.5) * 0.17))),
        s: src.s.map(v => v + (rnd() - 0.5) * 0.19),
        ...(src.o ? { o: { roll:(src.o.roll||0)+(rnd()-0.5)*0.3,
                           pitch:(src.o.pitch||0)+(rnd()-0.5)*0.3,
                           yaw:(src.o.yaw||0)+(rnd()-0.5)*0.3 } } : {})
      };
      const lm = augment(solve(pose), rnd, STRENGTH);
      X.push(Array.from(encode(lm)));
      y.push(li);
    }
  }
  return { X, y, letters, dim: ENCODE_DIM };
}, { N: PER_LETTER, SEED, STRENGTH });

writeFileSync(OUT, JSON.stringify(data));
console.log(`generated ${data.X.length} samples · ${data.letters.length} classes · ${data.dim} dims`);
await b.close();
