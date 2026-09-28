/* ================================================================
   MERCURY STUDIO — orchestration
   Wires the tracker, the recogniser, the sentence builder, the voice
   and the four modes together.

   Design rule throughout: every capability degrades. No camera, no
   model, no network, no speech synthesis — each of those removes one
   feature and leaves the rest working.
   ================================================================ */
import { Tracker, STATE } from './camera.js';
import { classify, Stabiliser, NOTES, TEMPLATES, MOTION_LETTERS } from './asl.js';
import { Ensemble } from './ensemble.js';
import { Holistic } from './holistic.js';
import { Predictor } from './predict.js';
import { encode } from './encode.js';
import { drawOverlay } from './overlay.js';
import { Speller } from './speller.js';
import { Voice, Ears } from './speech.js';
import { repair, fallback, llmStatus, localKey, setLocalKey } from './llm.js';
import { solve, BONES, STRUT, ALONG } from './rig.js';
import { SIGNS, LETTER_LIST } from './alphabet.js';
import { fitCanvas, onTick, clamp, lerp, rot, project, TAU } from '../core/gfx.js';

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

/* ---------------------------------------------------------- state */
const cfg = {
  dwell:  +(localStorage.getItem('mercury.dwell') || 380),
  minConf:+(localStorage.getItem('mercury.minConf') || 0.55),
  auto:   localStorage.getItem('mercury.auto') !== '0',
  mirror: localStorage.getItem('mercury.mirror') !== '0',
  camera: localStorage.getItem('mercury.camera') || ''
};

const app = {
  mode: 'interpret',
  letters: '',          // the raw committed run
  sentence: '',
  lastCommitAt: 0,
  busy: false,
  practice: { target: null, right: 0, total: 0, streak: 0 }
};

const voice = new Voice();
const stab = new Stabiliser({ dwell: cfg.dwell, minConfidence: cfg.minConf });

/* A stable id for this machine, so calibration belongs to a person
   rather than to a tab. */
const SESSION = (() => {
  let id = localStorage.getItem('mercury.session');
  if (!id) { id = 'sess-' + Math.random().toString(36).slice(2, 10); localStorage.setItem('mercury.session', id); }
  return id;
})();

const ensemble = new Ensemble({ session: SESSION });
const predictor = new Predictor();
const holistic = new Holistic();
let nmm = null;                 // latest non-manual reading
let holisticAt = 0;

app.calibrate = { letter: null, recording: 0, target: 0, samples: [], counts: {} };

/* ---------------------------------------------------------- toast */
let toastTimer;
function toast(msg, ms = 2600) {
  const el = $('#toast');
  el.textContent = msg; el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, ms);
}

/* ================================================== INTERPRET ==== */
const tracker = new Tracker({
  onState: (s, detail) => paintState(s, detail, '#feedState', '#stateTitle', '#stateBody', '#stateHint'),
  onResult: onFrame
});

function paintState(s, detail, panelSel, titleSel, bodySel, hintSel) {
  const panel = $(panelSel);
  if (!panel) return;
  const set = (sel, txt) => { const e = $(sel); if (e && txt != null) e.textContent = txt; };

  if (s === STATE.READY) { panel.hidden = true; return; }
  panel.hidden = false;

  const copy = {
    [STATE.LOADING]:   ['Starting up', detail || 'One moment…', ''],
    [STATE.DENIED]:    ['Camera blocked', detail, 'Click the camera icon in the address bar to allow it.'],
    [STATE.NO_CAMERA]: ['No camera found', detail, 'You can still use Spell and Alphabet without one.'],
    [STATE.ERROR]:     ['Something went wrong', detail, 'Spell and Alphabet work without a camera.'],
    [STATE.IDLE]:      ['Ready when you are',
                        'Mercury reads your hands entirely on this device. No frame is uploaded, stored, or sent anywhere.',
                        'You will be asked for camera permission.']
  }[s] || ['', detail, ''];

  set(titleSel, copy[0]); set(bodySel, copy[1]); set(hintSel, copy[2]);
  const btn = panel.querySelector('.btn');
  if (btn) btn.textContent = s === STATE.LOADING ? 'LOADING…' : 'START CAMERA';
  if (btn) btn.disabled = s === STATE.LOADING;
}

let overlayCtx = null, overlayCanvas = null;

async function onFrame({ hands }, now) {
  const mode = app.mode;
  const inPractice = mode === 'practice';
  const inCalibrate = mode === 'calibrate';
  const inConverse = mode === 'converse';
  const cv = inPractice ? $('#overlay2')
           : inCalibrate ? $('#overlay3')
           : mode === 'converse' ? $('#overlay4')
           : $('#overlay');
  if (!cv) return;
  const { ctx, w, h } = fitCanvas(cv);

  $('#fpsVal').textContent = tracker.fps || '—';
  $('#handCount').textContent = `${hands.length} hand${hands.length === 1 ? '' : 's'}`;

  /* Face and pose run slower than the hands: grammar changes at the
     speed of a sentence, handshape at the speed of a finger. */
  if (holistic.ready && tracker.video && now - holisticAt > 180) {
    holisticAt = now;
    const read = holistic.detect(tracker.video, now);
    if (read) { nmm = read; paintNmm(read); }
  }

  if (!hands.length) {
    drawOverlay(ctx, w, h, [], { mirror: tracker.mirror });
    stab.reset();
    paintReading(null, 0, inPractice);
    if (!inPractice && !inCalibrate && !inConverse && cfg.auto && app.letters && now - app.lastCommitAt > 2200) {
      app.lastCommitAt = now;
      buildSentence();
    }
    return;
  }

  const hand = hands[0];
  const res = await ensemble.predict(hand.lm, now);

  if (inCalibrate) return onCalibrateFrame(hand, res, ctx, w, h, now);

  const { letter, progress, committed } = stab.push(res, now);

  drawOverlay(ctx, w, h, [hand], {
    mirror: tracker.mirror, dwell: progress,
    letter: letter || '', confidence: res.confidence
  });

  paintReading(res, progress, inPractice);
  paintSources(res);
  if (inConverse) {
    $('#convLetter').textContent = letter || '—';
    setTurn('sign');
  }

  if (committed) {
    if (inPractice) scorePractice(committed);
    else commitLetter(committed, now);
  }
}

function paintSources(res) {
  const map = [['#srcTemplate', res.sources.template], ['#srcNeural', res.sources.neural],
               ['#srcPersonal', res.sources.personal]];
  for (const [sel, src] of map) {
    const el = $(sel);
    if (!el) continue;
    el.classList.toggle('is-off', !src);
    el.classList.toggle('is-lead', !!src && src.letter === res.letter);
    el.querySelector('b').textContent = src ? src.letter : '—';
    el.querySelector('i').style.width = src
      ? `${Math.round((src.confidence ?? 0.8) * 100)}%` : '0%';
  }
  const tag = $('#agreeTag');
  if (tag) {
    const a = res.agreement;
    tag.textContent = a >= 0.99 ? 'unanimous' : a >= 0.5 ? 'split' : 'disputed';
    tag.classList.toggle('is-ai', a >= 0.99);
  }
}

function paintNmm(read) {
  const box = $('#nmm');
  if (!box) return;
  if (!read.marker) { box.hidden = true; return; }
  box.hidden = false;
  $('#nmmMarker').textContent = read.marker.replace('-', ' ').toUpperCase();
  $('#nmmMeaning').textContent = read.meaning;
}

function paintReading(res, progress, inPractice) {
  if (inPractice) {
    $('#pracLetter').textContent = res?.letter || '—';
    $('#pracBar').style.width = `${(progress * 100).toFixed(0)}%`;
    $('#pracHint').textContent = res
      ? `${res.letter} · ${(res.confidence * 100).toFixed(0)}% sure`
      : 'Show your hand to begin';
    return;
  }
  const big = $('#bigLetter');
  big.textContent = res?.letter || '—';
  big.classList.toggle('is-hot', progress > 0.05);
  $('#letterNote').textContent = res ? (NOTES[res.letter] || '') : 'Waiting for a hand';
  $('#confVal').textContent = res ? res.confidence.toFixed(2) : '0.00';
  $('#dwellVal').textContent = `${Math.round(progress * 100)}%`;
  $('#confBar').style.width = `${((res?.confidence || 0) * 100).toFixed(0)}%`;

  const wrap = $('#cands');
  const ranked = res?.ranked || [];
  if (!wrap.children.length) {
    wrap.innerHTML = Array.from({ length: 5 }, () => '<div class="cand"><b>—</b><span>0.00</span></div>').join('');
  }
  [...wrap.children].forEach((el, i) => {
    const r = ranked[i];
    el.querySelector('b').textContent = r ? r.letter : '—';
    el.querySelector('span').textContent = r ? r.score.toFixed(2) : '0.00';
    el.classList.toggle('is-top', i === 0 && !!r);
  });
}

function commitLetter(ch, now = performance.now()) {
  app.letters += ch;
  app.lastCommitAt = now;          // same clock the auto-build compares against
  paintRaw(true);
  paintSuggestions();
  if (app.mode === 'converse') paintConverse();
}

function paintRaw(fresh = false) {
  const el = $('#rawOut');
  if (!app.letters) { el.innerHTML = '<span class="raw__empty">nothing yet</span>'; return; }
  const head = app.letters.slice(0, -1), tail = app.letters.slice(-1);
  el.innerHTML = `${head}<span class="${fresh ? 'fresh' : ''}">${tail}</span>`;
}

/* -------------------------------------------------- suggestions */
/* The word being spelled is whatever follows the last space. */
const currentWord = () => (app.letters.split(' ').pop() || '');

function paintSuggestions() {
  const word = currentWord();
  const list = predictor.suggest(word, 3);
  predictor.askModel(word, app.letters);

  for (const sel of ['#sugg', '#convSugg']) {
    const box = $(sel);
    if (!box) continue;
    if (!list.length) { box.innerHTML = ''; continue; }
    box.innerHTML = list.map((s, i) =>
      `<button class="sugg__chip ${s.source === 'yours' ? 'sugg__chip--yours' : ''}"
               data-word="${s.word}"><kbd>${i + 1}</kbd><b>${s.word}</b><i>${s.source}</i></button>`
    ).join('');
  }
}

/** Replace the half-spelled word with the chosen completion. */
function acceptSuggestion(word) {
  if (!word) return;
  const parts = app.letters.split(' ');
  parts[parts.length - 1] = word;
  app.letters = parts.join(' ') + ' ';
  paintRaw();
  paintSuggestions();
  toast(word);
}

/* ------------------------------------------------ sentence build */
async function buildSentence() {
  const raw = app.letters.trim();
  if (!raw || app.busy) return;
  app.busy = true;
  const btn = $('#btnRepair');
  btn.disabled = true; btn.textContent = 'THINKING…';

  // a raised brow changes a statement into a question; tell the model
  const grammar = holistic.asPrompt(nmm);
  const res = await repair(raw, grammar ? { system: null, context: grammar } : {});
  app.sentence = res.text || fallback(raw);

  const out = $('#sentence');
  out.textContent = app.sentence || '—';
  out.classList.toggle('is-empty', !app.sentence);
  const tag = $('#sentTag');
  tag.textContent = res.ok ? (res.model || 'ai') : (res.reason === 'no-key' ? 'local' : `local · ${res.reason}`);
  tag.classList.toggle('is-ai', !!res.ok);

  if (app.sentence) {
    addLog(app.sentence, raw);
    voice.speak(app.sentence);
    // every finished sentence teaches the completions
    predictor.learn(app.sentence);
    // keep it, so it can be searched by meaning later
    fetch('/api/vectors/remember', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: app.sentence, raw, session: SESSION })
    }).catch(() => {});
    // the utterance is finished, so the next one starts from an empty
    // buffer; without this every sentence repeats all the letters before it
    app.letters = '';
    paintRaw();
    stab.reset();
  }
  btn.disabled = false; btn.textContent = 'BUILD SENTENCE';
  app.busy = false;
}

function addLog(text, raw) {
  const li = document.createElement('li');
  const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  li.innerHTML = `<span>${time} · ${raw}</span>${text}`;
  $('#log').prepend(li);
}

/* ==================================================== PRACTICE === */
const tracker2 = new Tracker({
  onState: (s, d) => paintState(s, d, '#feedState2', null, null, null),
  onResult: (r, now) => onFrame(r, now)
});

function nextPractice() {
  const pool = LETTER_LIST.filter(l => l !== 'J' && l !== 'Z');
  let pick;
  do { pick = pool[(Math.random() * pool.length) | 0]; } while (pick === app.practice.target && pool.length > 1);
  app.practice.target = pick;
  $('#promptLetter').textContent = pick;
  $('#promptNote').textContent = NOTES[pick] || '';
  drawRef(pick);
}

function scorePractice(got) {
  const p = app.practice;
  p.total++;
  if (got === p.target) {
    p.right++; p.streak++;
    toast(`${got} — correct`);
    nextPractice();
  } else {
    p.streak = 0;
    toast(`that read as ${got}`);
  }
  $('#scoreRight').textContent = p.right;
  $('#scoreStreak').textContent = p.streak;
  $('#scoreAcc').textContent = p.total ? `${Math.round(p.right / p.total * 100)}%` : '—';
}

/* Draw a static rig pose into any canvas — used by the practice
   reference and by every cell of the alphabet chart. */
export function drawPose(cv, letter, { spin = 0 } = {}) {
  const pose = SIGNS[letter];
  if (!pose) return;
  const { ctx, w, h } = fitCanvas(cv);
  ctx.clearRect(0, 0, w, h);
  const L = solve(pose);
  const fov = Math.min(w, h) * 2.05;
  const P = L.map(q => {
    const r = rot({ x: q.x * 0.78, y: q.y * 0.78, z: q.z * 0.78 }, -0.28 + spin, -0.08);
    const v = project(r, w, h, fov, 2.5);
    return { x: v.x, y: v.y, z: r.z };
  });

  const across = { x: L[17].x - L[5].x, y: L[17].y - L[5].y, z: L[17].z - L[5].z };
  const wl = { x: L[0].x - across.x*.34, y: L[0].y - across.y*.34, z: L[0].z - across.z*.34 };
  const wr = { x: L[0].x + across.x*.34, y: L[0].y + across.y*.34, z: L[0].z + across.z*.34 };
  const palm = [L[5],L[9],L[13],L[17],wr,wl].map(q => {
    const r = rot({ x: q.x*0.78, y: q.y*0.78, z: q.z*0.78 }, -0.28 + spin, -0.08);
    return project(r, w, h, fov, 2.5);
  });
  ctx.beginPath(); palm.forEach((q,k)=>k?ctx.lineTo(q.x,q.y):ctx.moveTo(q.x,q.y)); ctx.closePath();
  ctx.fillStyle='rgba(159,180,208,.09)'; ctx.fill();
  ctx.strokeStyle='rgba(159,180,208,.26)'; ctx.lineWidth=1.2; ctx.stroke();

  ctx.lineCap = ctx.lineJoin = 'round';
  BONES.forEach(([a,b],bi)=>{
    const A=P[a],B=P[b], d=clamp((((A.z+B.z)/2)+1)/2);
    if (STRUT.has(bi)) { ctx.strokeStyle=`rgba(255,255,255,${0.09+d*0.14})`; ctx.lineWidth=1; }
    else { ctx.strokeStyle=`rgba(215,242,255,${0.3+d*0.5})`;
           ctx.lineWidth=lerp(2.4,7,d)*(1-clamp(ALONG[bi],0,2)*0.19); }
    ctx.beginPath(); ctx.moveTo(A.x,A.y); ctx.lineTo(B.x,B.y); ctx.stroke();
  });
  const TIPS=new Set([4,8,12,16,20]);
  P.forEach((p,i)=>{
    const d=clamp((p.z+1)/2);
    ctx.fillStyle = TIPS.has(i) ? '#e8edf6' : `rgba(255,255,255,${0.4+d*0.5})`;
    ctx.beginPath(); ctx.arc(p.x,p.y,lerp(1.8,4,d),0,TAU); ctx.fill();
  });
}

function drawRef(letter) { drawPose($('#pracRef'), letter); }

/* ======================================================= SPELL === */
let speller = null;
function initSpell() {
  if (speller) return;
  speller = new Speller($('#spellCanvas'), {
    onLetter: (ch, i) => {
      $('#spellNow').textContent = ch === ' ' ? '(space)' : (ch || '—');
      [...$('#spellStrip').children].forEach((b, k) => {
        b.classList.toggle('is-on', k === i);
        b.classList.toggle('is-done', k < i);
      });
    }
  });
  loadSpell();
}
function loadSpell() {
  const text = $('#spellInput').value;
  const n = speller.load(text);
  $('#spellStrip').innerHTML = [...text.toUpperCase()]
    .map(c => `<b>${c === ' ' ? '·' : c}</b>`).join('');
  $('#spellNow').textContent = n ? '—' : 'nothing to sign';
}

/* =================================================== REFERENCE === */
let abcBuilt = false;
function buildAbc() {
  if (abcBuilt) return;
  abcBuilt = true;
  const wrap = $('#abc');
  wrap.innerHTML = LETTER_LIST.map(l =>
    `<div class="abc__cell"><canvas data-l="${l}"></canvas><h3>${l}</h3><p>${NOTES[l] || ''}</p></div>`
  ).join('');
  // one shared slow rotation, so the chart reads as 3D rather than flat
  let spin = 0;
  const cells = $$('#abc canvas');
  requestAnimationFrame(function paint() {
    spin += 0.004;
    const s = Math.sin(spin) * 0.3;
    cells.forEach(c => drawPose(c, c.dataset.l, { spin: s }));
    if ($('.panel[data-panel="reference"]').classList.contains('is-on')) requestAnimationFrame(paint);
    else abcBuilt = 'paused';
  });
}

/* ==================================================== CONVERSE === */
/* Two people, one device. The signer is heard, the speaker is seen.
   Both directions write into the same conversation. */
let convSpeller = null;
let convEars = null;

function initConverse() {
  if (convSpeller) return;
  convSpeller = new Speller($('#convCanvas'), {
    onLetter: (ch, i) => {
      [...$('#convStrip').children].forEach((b, k) => {
        b.classList.toggle('is-on', k === i);
        b.classList.toggle('is-done', k < i);
      });
    }
  });
}

function paintConverse() {
  $('#convRaw').textContent = app.letters || '';
  $('#convLetter').textContent = app.letters.slice(-1) || '—';
}

function setTurn(who) {
  $('#turnSign')?.classList.toggle('is-live', who === 'sign');
  $('#turnSpeak')?.classList.toggle('is-live', who === 'speak');
}

function addChat(side, text, detail = '') {
  const li = document.createElement('li');
  li.className = side === 'sign' ? 'from-sign' : 'from-speak';
  const when = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  li.innerHTML = `<span>${side === 'sign' ? 'SIGNED' : 'SPOKEN'} · ${when}${detail ? ' · ' + detail : ''}</span>${text}`;
  $('#chat').append(li);
  $('#chat').scrollTop = $('#chat').scrollHeight;
}

/** The signer's turn: letters become a sentence, and it is spoken aloud. */
async function convSend() {
  const raw = app.letters.trim();
  if (!raw) return toast('nothing signed yet');
  setTurn('sign');
  const grammar = holistic.asPrompt(nmm);
  const res = await repair(raw, grammar ? { context: grammar } : {});
  const text = res.text || fallback(raw);
  addChat('sign', text, res.ok ? (res.model || 'ai') : 'local');
  predictor.learn(text);
  voice.speak(text, { force: true });
  fetch('/api/vectors/remember', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, raw, session: SESSION })
  }).catch(() => {});
  app.letters = '';
  paintRaw(); paintConverse(); paintSuggestions(); stab.reset();
}

/** The hearing person's turn: what they said is fingerspelled back. */
function convReply(text) {
  if (!text?.trim()) return;
  initConverse();
  setTurn('speak');
  addChat('speak', text);
  predictor.learn(text);
  const clean = text.toUpperCase().replace(/[^A-Z ]/g, '');
  convSpeller.load(clean);
  $('#convStrip').innerHTML = [...clean].map(c => `<b>${c === ' ' ? '·' : c}</b>`).join('');
  convSpeller.play();
  $('#heard').textContent = text;
  $('#heard').classList.remove('is-live');
}

/* =================================================== CALIBRATE === */
// J and Z are motion letters with no distinct still shape, so there is
// nothing to calibrate for them.
const CAL_LETTERS = Object.keys(TEMPLATES).filter(l => !(l in MOTION_LETTERS));

function buildCalGrid() {
  const g = $('#calGrid');
  if (!g || g.children.length) return;
  g.innerHTML = CAL_LETTERS.map(l => `<b data-l="${l}">${l}</b>`).join('');
}

function nextCalLetter(letter) {
  const c = app.calibrate;
  // walk to whichever letter has the fewest samples, so coverage evens out
  c.letter = letter || CAL_LETTERS
    .slice()
    .sort((a, b) => (c.counts[a] || 0) - (c.counts[b] || 0))[0];
  $('#calLetter').textContent = c.letter;
  $('#calNote').textContent = NOTES[c.letter] || '';
  drawPose($('#pracRef'), c.letter);
  paintCalGrid();
}

function paintCalGrid() {
  const c = app.calibrate;
  [...($('#calGrid')?.children || [])].forEach(b => {
    const n = c.counts[b.dataset.l] || 0;
    b.className = '';
    if (n >= 15) b.classList.add('has-3');
    else if (n >= 8) b.classList.add('has-2');
    else if (n > 0) b.classList.add('has-1');
    if (b.dataset.l === c.letter) b.classList.add('is-now');
  });
  const total = Object.values(c.counts).reduce((a, b) => a + b, 0);
  const done = Object.values(c.counts).filter(n => n >= 5).length;
  $('#calTotal').textContent = total;
  $('#calLetters').textContent = done;
  $('#calWeight').textContent = `${Math.round(ensemble.weights.personal * 100)}%`;
}

function onCalibrateFrame(hand, res, ctx, w, h, now) {
  const c = app.calibrate;
  const active = c.recording > 0;
  drawOverlay(ctx, w, h, [hand], {
    mirror: tracker.mirror,
    dwell: active ? 1 - c.recording / c.target : 0,
    letter: c.letter || '', confidence: res.confidence
  });
  $('#calBar').style.width = active ? `${(1 - c.recording / c.target) * 100}%` : '0%';
  if (!active) return;

  // one sample every few frames, so five samples span a real movement
  // rather than five copies of one instant
  if (c.recording % 6 === 0) c.samples.push(Array.from(encode(hand.lm)));
  c.recording--;

  if (c.recording <= 0) {
    const letter = c.letter, batch = c.samples.slice();
    c.samples = [];
    $('#calBar').style.width = '0%';
    fetch('/api/vectors/calibrate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ letter, vectors: batch, session: SESSION })
    }).then(r => r.json()).then(async r => {
      if (!r.ok) return toast(`could not store: ${r.reason || 'error'}`);
      c.counts[letter] = (c.counts[letter] || 0) + r.stored;
      await ensemble.refreshCalibration();
      toast(`${letter}: ${r.stored} samples stored`);
      nextCalLetter();
    }).catch(() => toast('vector store unreachable'));
  }
}

async function loadCalCounts() {
  try {
    const r = await fetch('/api/vectors/summary').then(x => x.json());
    app.calibrate.counts = r.letters || {};
  } catch { app.calibrate.counts = {}; }
  paintCalGrid();
}

/* ====================================================== RECALL === */
async function runRecall() {
  const q = $('#recallQuery').value.trim();
  const list = $('#recallList');
  if (!q) { list.innerHTML = ''; return; }
  list.innerHTML = '<li><p>searching…</p></li>';
  try {
    const r = await fetch('/api/vectors/search', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: q, k: 12 })
    }).then(x => x.json());
    const hits = (r.results || []).filter(h => h.score > 0.04);
    if (!hits.length) { list.innerHTML = '<li><p>nothing matched that.</p></li>'; return; }
    list.innerHTML = hits.map(h => {
      const when = h.ts ? new Date(h.ts * 1000).toLocaleString() : '';
      return `<li><p>${h.text}</p><span><b>${(h.score * 100).toFixed(0)}% match</b>${when}<em>${h.raw || ''}</em></span></li>`;
    }).join('');
  } catch {
    list.innerHTML = '<li><p>the vector store is not reachable.</p></li>';
  }
}

/* ======================================================== MODES == */
/* One camera, several panels: move the existing stream rather than
   asking for permission again each time the mode changes. */
function handOverCamera(videoSel, stateSel) {
  if (tracker.state !== STATE.READY) return;
  const v = $(videoSel);
  if (!v) return;
  v.srcObject = tracker.stream;
  v.play().catch(() => {});
  tracker.video = v;
  if (stateSel) { const s = $(stateSel); if (s) s.hidden = true; }
}

function setMode(mode) {
  app.mode = mode;
  $$('.mode').forEach(b => {
    const on = b.dataset.mode === mode;
    b.classList.toggle('is-on', on);
    b.setAttribute('aria-selected', String(on));
  });
  $$('.panel').forEach(p => p.classList.toggle('is-on', p.dataset.panel === mode));

  if (mode === 'spell') initSpell();
  if (mode === 'reference') { if (abcBuilt === 'paused') { abcBuilt = false; } buildAbc(); }
  if (mode === 'converse') {
    initConverse();
    handOverCamera('#video4', '#feedState4');
    paintConverse();
    paintSuggestions();
  }
  if (mode === 'calibrate') {
    buildCalGrid();
    loadCalCounts();
    if (!app.calibrate.letter) nextCalLetter(); else paintCalGrid();
    handOverCamera('#video3', '#feedState3');
  }
  if (mode === 'recall') setTimeout(() => $('#recallQuery')?.focus(), 60);
  if (mode === 'practice') {
    if (!app.practice.target) nextPractice(); else drawRef(app.practice.target);
    handOverCamera('#video2', '#feedState2');
  }
  if (mode === 'interpret') handOverCamera('#video', null);
  stab.reset();
}

/* ======================================================== WIRE === */
function wire() {
  /* modes */
  $$('.mode').forEach(b => b.addEventListener('click', () => setMode(b.dataset.mode)));

  /* camera */
  const startCam = async (video) => {
    await tracker.start(video, { deviceId: cfg.camera || undefined });
    if (tracker.state === STATE.READY) listCameras();
  };
  $('#btnStart').addEventListener('click', () => startCam($('#video')));
  $('#btnStart2').addEventListener('click', () => startCam($('#video2')));

  $('#btnMirror').addEventListener('click', () => {
    cfg.mirror = !cfg.mirror;
    localStorage.setItem('mercury.mirror', cfg.mirror ? '1' : '0');
    tracker.setMirror(cfg.mirror);
    $$('.feed video').forEach(v => v.classList.toggle('no-mirror', !cfg.mirror));
    toast(cfg.mirror ? 'mirrored' : 'not mirrored');
  });

  /* interpret actions */
  $('#btnRepair').addEventListener('click', buildSentence);
  $('#btnSpeak').addEventListener('click', () => {
    if (app.sentence) voice.speak(app.sentence, { force: true });
    else toast('nothing to speak yet');
  });
  $('#btnClear').addEventListener('click', clearAll);
  $('#btnCopy').addEventListener('click', async () => {
    const text = [...$('#log').children].map(li => li.childNodes[1]?.textContent || '').join('\n');
    if (!text) return toast('transcript is empty');
    try { await navigator.clipboard.writeText(text); toast('copied'); }
    catch { toast('could not copy'); }
  });
  $('#btnDownload').addEventListener('click', () => {
    const text = [...$('#log').children].map(li => li.textContent).join('\n');
    if (!text) return toast('transcript is empty');
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    const a = document.createElement('a');
    a.href = url; a.download = `mercury-transcript-${Date.now()}.txt`; a.click();
    URL.revokeObjectURL(url);
  });

  /* suggestions — click, or press the number shown on the chip */
  document.addEventListener('click', e => {
    const chip = e.target.closest?.('.sugg__chip');
    if (chip) acceptSuggestion(chip.dataset.word);
  });

  /* converse */
  $('#btnStart4').addEventListener('click', () => startCam($('#video4')));
  $('#btnConvSend').addEventListener('click', convSend);
  $('#btnConvClear').addEventListener('click', () => {
    app.letters = ''; paintRaw(); paintConverse(); paintSuggestions(); stab.reset();
  });
  $('#btnConvReplay').addEventListener('click', () => {
    if (!convSpeller?.queue.length) return toast('nothing to replay');
    convSpeller.seek(0); convSpeller.play();
  });
  $('#convType').addEventListener('keydown', e => {
    if (e.key !== 'Enter') return;
    convReply(e.target.value);
    e.target.value = '';
  });

  convEars = new Ears({
    onText: ({ final, interim }) => {
      const el = $('#heard');
      if (interim) { el.textContent = interim; el.classList.add('is-live'); }
      if (final) convReply(final);
    },
    onState: st => {
      const live = st === 'listening';
      $('#btnConvListen').textContent = live ? '\u25a0 STOP' : '\ud83c\udfa4 LISTEN';
      $('#turnSpeak').classList.toggle('is-live', live);
      if (st === 'error') toast('speech recognition failed');
    }
  });
  $('#btnConvListen').addEventListener('click', () => {
    if (!convEars.supported) return toast('this browser has no speech recognition');
    convEars.toggle();
  });
  $('#btnConvSave').addEventListener('click', () => {
    const text = [...$('#chat').children]
      .map(li => `${li.firstChild.textContent}\n${li.lastChild.textContent}`).join('\n\n');
    if (!text.trim()) return toast('the conversation is empty');
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    const a = document.createElement('a');
    a.href = url; a.download = `mercury-conversation-${Date.now()}.txt`; a.click();
    URL.revokeObjectURL(url);
  });

  /* calibrate */
  $('#btnStart3').addEventListener('click', () => startCam($('#video3')));
  $('#btnCalRecord').addEventListener('click', () => {
    if (tracker.state !== STATE.READY) return toast('start the camera first');
    const c = app.calibrate;
    if (c.recording > 0) return;
    c.samples = []; c.target = 30; c.recording = 30;   // ~1s of frames, 5 samples
    toast(`hold ${c.letter}`);
  });
  $('#btnCalSkip').addEventListener('click', () => nextCalLetter(
    CAL_LETTERS[(CAL_LETTERS.indexOf(app.calibrate.letter) + 1) % CAL_LETTERS.length]));
  $('#btnCalReset').addEventListener('click', async () => {
    if (!confirm('Delete every calibration sample you have recorded?')) return;
    await fetch('/api/vectors/reset', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    app.calibrate.counts = {};
    await ensemble.refreshCalibration();
    paintCalGrid();
    toast('calibration cleared');
  });

  /* recall */
  $('#btnRecall').addEventListener('click', runRecall);
  $('#recallQuery').addEventListener('keydown', e => { if (e.key === 'Enter') runRecall(); });

  /* practice */
  $('#btnSkip').addEventListener('click', nextPractice);
  $('#btnResetScore').addEventListener('click', () => {
    app.practice = { target: app.practice.target, right: 0, total: 0, streak: 0 };
    $('#scoreRight').textContent = '0'; $('#scoreStreak').textContent = '0';
    $('#scoreAcc').textContent = '—';
  });

  /* spell */
  $('#spellInput').addEventListener('input', () => speller && loadSpell());
  $('#btnSpellPlay').addEventListener('click', () => { loadSpell(); speller.play(); });
  $('#btnSpellStop').addEventListener('click', () => { speller.stop(); loadSpell(); });
  $('#spellSpeed').addEventListener('input', e => {
    speller.speed = +e.target.value;
    $('#spellSpeedVal').textContent = `${(+e.target.value).toFixed(1)}×`;
  });

  const ears = new Ears({
    onText: ({ final }) => {
      if (!final) return;
      $('#spellInput').value = final.toUpperCase();
      loadSpell(); speller.play();
    },
    onState: s => $('#btnListen').textContent = s === 'listening' ? '■ STOP' : '🎙 DICTATE'
  });
  $('#btnListen').addEventListener('click', () => {
    if (!ears.supported) return toast('this browser has no speech recognition');
    ears.toggle();
  });

  /* settings */
  const sheet = $('#sheet');
  const openSheet = () => { sheet.hidden = false; listCameras(); listVoices(); };
  $('#btnSettings').addEventListener('click', openSheet);
  $('#btnCloseSheet').addEventListener('click', () => sheet.hidden = true);
  sheet.addEventListener('click', e => { if (e.target === sheet) sheet.hidden = true; });

  const bind = (sel, key, fmt, apply) => {
    const el = $(sel);
    el.addEventListener('input', () => {
      const v = el.type === 'checkbox' ? el.checked : +el.value;
      cfg[key] = v;
      localStorage.setItem(`mercury.${key}`, el.type === 'checkbox' ? (v ? '1' : '0') : String(v));
      if (fmt) fmt(v);
      if (apply) apply(v);
    });
  };
  bind('#setDwell', 'dwell', v => $('#dwellLabel').textContent = `${v} ms`, v => stab.dwell = v);
  bind('#setConf', 'minConf', v => $('#confLabel').textContent = v.toFixed(2), v => stab.minConfidence = v);
  bind('#setAuto', 'auto');
  $('#setSpeak').addEventListener('change', e => voice.setEnabled(e.target.checked));
  $('#setRate').addEventListener('input', e => {
    voice.setRate(+e.target.value);
    $('#rateLabel').textContent = `${(+e.target.value).toFixed(2)}×`;
  });
  $('#selVoice').addEventListener('change', e => voice.setVoice(e.target.value));
  $('#selCamera').addEventListener('change', async e => {
    cfg.camera = e.target.value;
    localStorage.setItem('mercury.camera', cfg.camera);
    if (tracker.state === STATE.READY) {
      tracker.stop();
      await tracker.start(app.mode === 'practice' ? $('#video2') : $('#video'), { deviceId: cfg.camera });
    }
  });
  $('#setKey').addEventListener('change', e => {
    setLocalKey(e.target.value);
    e.target.value = e.target.value ? '••••••••' : '';
    checkLlm();
    toast(localKey() ? 'key saved on this device' : 'key cleared');
  });

  /* keyboard */
  addEventListener('keydown', e => {
    const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || '');
    if (e.key === 'Escape') { if (!sheet.hidden) { sheet.hidden = true; return; } if (!typing) clearAll(); return; }
    if (typing) return;
    if (e.key === ',') { e.preventDefault(); openSheet(); }
    if (e.key === ' ') { e.preventDefault(); app.letters += ' '; paintRaw(); }
    if (e.key === 'Backspace') { e.preventDefault(); app.letters = app.letters.slice(0, -1); paintRaw(); }
    if (e.key === 'Enter') { e.preventDefault(); buildSentence(); }
    // a digit takes the matching completion when one is offered,
    // and otherwise switches mode
    if (e.key >= '1' && e.key <= '9') {
      const chips = $$('.panel.is-on .sugg__chip');
      const pick = chips[+e.key - 1];
      if (pick) { e.preventDefault(); acceptSuggestion(pick.dataset.word); return; }
      const modes = ['interpret','converse','spell','practice','calibrate','recall','reference'];
      if (+e.key <= modes.length) setMode(modes[+e.key - 1]);
    }
  });
}

function clearAll() {
  app.letters = ''; app.sentence = '';
  paintRaw();
  $('#sentence').textContent = '—';
  $('#sentence').classList.add('is-empty');
  stab.reset();
  toast('cleared');
}

async function listCameras() {
  const sel = $('#selCamera');
  const list = await tracker.devices();
  if (!list.length) return;
  sel.innerHTML = list.map((d, i) =>
    `<option value="${d.deviceId}">${d.label || `Camera ${i + 1}`}</option>`).join('');
  if (cfg.camera) sel.value = cfg.camera;
}

function listVoices() {
  const sel = $('#selVoice');
  const vs = voice.voices.length ? voice.voices : speechSynthesis?.getVoices?.() || [];
  if (!vs.length) return;
  sel.innerHTML = vs.map(v => `<option value="${v.name}">${v.name} — ${v.lang}</option>`).join('');
  if (voice.voiceName) sel.value = voice.voiceName;
}

async function checkVectors() {
  try {
    const r = await fetch('/api/vectors/status').then(x => x.json());
    const chip = $('#chipVec');
    chip.classList.toggle('is-on', !!r.available);
    chip.classList.toggle('is-off', !r.available);
    $('#vecState').textContent = r.available ? r.mode.split(' ')[0] : 'off';
    chip.title = r.available
      ? `Qdrant, ${r.mode}` : `Vector store unavailable: ${r.reason || 'unknown'}`;
  } catch { /* the chip stays neutral */ }
}

async function checkLlm() {
  const s = await llmStatus();
  const chip = $('#chipLlm');
  chip.classList.toggle('is-on', s.configured);
  chip.classList.toggle('is-off', !s.configured);
  $('#llmState').textContent = s.configured ? (s.model || 'ready') : 'off';
  chip.title = s.configured
    ? `Sentence repair via ${s.model || 'Groq'}`
    : 'Sentence repair is off. Set GROQ_API_KEY, or add a key in settings.';
}

/* ========================================================= BOOT == */
function boot() {
  // reflect stored settings into the controls
  $('#setDwell').value = cfg.dwell; $('#dwellLabel').textContent = `${cfg.dwell} ms`;
  $('#setConf').value = cfg.minConf; $('#confLabel').textContent = cfg.minConf.toFixed(2);
  $('#setAuto').checked = cfg.auto;
  $('#setSpeak').checked = voice.enabled;
  $('#setRate').value = voice.rate; $('#rateLabel').textContent = `${voice.rate.toFixed(2)}×`;
  if (localKey()) $('#setKey').value = '••••••••';
  tracker.setMirror(cfg.mirror);
  $$('.feed video').forEach(v => v.classList.toggle('no-mirror', !cfg.mirror));

  paintRaw();
  paintReading(null, 0, false);
  paintSuggestions();
  wire();
  checkLlm();
  checkVectors();
  setMode('interpret');

  if (!voice.supported) toast('this browser cannot speak aloud');

  // The neural classifier and the vector store are both optional: the
  // studio recognises with geometry alone if either is missing.
  ensemble.init().then(() => {
    const chip = $('#chipNn');
    chip.classList.toggle('is-on', ensemble.neuralReady);
    chip.classList.toggle('is-off', !ensemble.neuralReady);
    $('#nnState').textContent = ensemble.neuralReady
      ? `${(ensemble.neural.meta.params / 1000).toFixed(1)}k` : 'off';
    chip.title = ensemble.neuralReady
      ? `${ensemble.neural.meta.params.toLocaleString()} parameters · ${(ensemble.neural.meta.val_accuracy * 100).toFixed(1)}% on held-out synthetic hands`
      : 'Neural classifier unavailable; geometric matching only.';
  });

  // Face and pose are a real cost, so they load after the hands are working.
  holistic.load().then(() => {
    toast('reading facial grammar');
  }).catch(() => { /* hands-only is a complete product */ });
}

document.readyState === 'loading'
  ? document.addEventListener('DOMContentLoaded', boot)
  : boot();

/* A debug handle, on loopback only. Lets the pipeline be driven with
   synthetic landmarks so the recognise → commit → sentence path can be
   tested without a pair of hands in front of a camera. */
if (['localhost', '127.0.0.1'].includes(location.hostname)) {
  window.__mercury = { app, cfg, stab, tracker, voice, onFrame, buildSentence, setMode,
                      ensemble, holistic, predictor, SESSION,
                      convSend, convReply, acceptSuggestion, paintSuggestions };
}
