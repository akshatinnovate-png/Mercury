# MERCURY

**An AI sign language interpreter. Every hand has a voice.**

Named for the Roman god of speech, messages and the crossings between worlds —
which is exactly the job: carry meaning from a pair of hands to a room that
doesn't sign, fast enough that nobody has to wait for it.

Two pieces: a scroll-driven **story** at `index.html`, and the **studio** at
`studio.html` — a working interpreter that reads your hands through a webcam.

---

## What it is

A single-page, scroll-driven experience in eight acts. The camera never cuts
away — it travels, the way a message travels:

| Act | Scene | What happens |
|-----|-------|--------------|
| I | **The Void** | A point-cloud Mercury turns in space, sign-language corridors arcing between hubs. |
| II | **Descent** | The camera falls through the atmosphere; black → violet → daylight. |
| III | **The Hand** | A 21-landmark rig, solved live, scrubs through `M-E-R-C-U-R-Y` as you scroll. |
| IV | **The Pipeline** | The view flips top-down; a packet runs the signal trace through seven stages. |
| V | **The Voice** | The trace opens into an ocean of sound and the utterance is spoken. |
| VI | **Ascent** | The camera lifts through cloud until the whole network is visible. |
| VII | **The Lab** | The technical register — dithered plasma, window chrome, a live cellular automaton. |
| VIII | **Close** | The ask. |

## The studio

`studio.html` is the working part. Four modes:

**Calibrate** — teach Mercury *your* hands. Record samples of each letter;
they go into Qdrant and personalise recognition from then on.

**Recall** — search every sentence you have spoken, by meaning.

**Interpret** — point a camera at your hands. Mercury tracks 21 landmarks per
hand, recognises the letter, waits for you to hold it, and builds the
sentence. Then it speaks it aloud.

**Spell** — type or dictate a sentence and the rig fingerspells it back, at a
speed you choose. The reverse direction, using the same handshape definitions.

**Practice** — Mercury shows a letter, you sign it, and it scores you. Correct
count, streak and accuracy, with a reference hand showing the shape it wants.

**Alphabet** — all 26 letters as rotating 3D handshapes.

### Architecture

```
browser                                   server
─────────────────────────────────────     ────────────────────────────
MediaPipe HandLandmarker   21 pts/hand
MediaPipe FaceLandmarker   478 pts   ─┐
MediaPipe PoseLandmarker   33 pts    ─┤ non-manual grammar
                                      │
canonical encoder          83 dims    │
  ├─ geometric templates              │
  ├─ MLP, 20,568 params  (ONNX/WASM)  │
  └─ kNN over your own hands  ────────┼──▶ Qdrant  calibration
                                      │            transcript
weighted vote + agreement             │
  ▼                                   │
hold-to-commit stabiliser             │
  ▼                                   │
letters ─────────────────────────────┴──▶ Groq gpt-oss-120b
                                              ▼
                                          sentence ──▶ speech
```

### Three classifiers, not one

Each is wrong in a different way, and their disagreement is itself a
signal. The studio shows all three votes live.

| | what it is | why it is there |
|---|---|---|
| **geometric** | distance to a reference signature | instant, needs nothing loaded, every decision explainable in a sentence |
| **neural** | 20,568-parameter MLP over the canonical encoding | most accurate on hands like its training set, worst at knowing when it is out of its depth |
| **personal** | kNN over your own recorded hands, in Qdrant | worth nothing until you calibrate; worth more than the other two once you have |

Agreement across the three is reported as `unanimous` / `split` /
`disputed` and feeds the confidence score, which is a more honest
signal than any single model's self-reported certainty.

### The model

Trained from scratch, in numpy, no framework — `tools/train_handshape.py`
is the whole thing, and the exported ONNX graph is exactly the arithmetic
in that file.

```
67,200 synthetic hands · 24 classes · 83 dims
MLP 83 → 128 → 64 → 24, ReLU, Adam, cosine decay
validation (same generator)              99.97%
held out (unseen seed, 1.7x distortion)  99.62%
inference, warm                          0.125 ms
```

**What that number does not mean.** Training and validation are both
synthetic — poses from the rig under heavy domain randomisation
(rotation, proportion, tracker jitter). The model has never seen a
photographed hand. The held-out score shows it generalises across
distortions it never trained on; it says nothing about real lighting,
real skin, real hands. That gap is exactly what the calibration store
exists to close, and it is why the geometric classifier is kept in the
ensemble rather than discarded.

Two rounds of honest failure got it here. The first attempt scored 86.6%
and confused J with I, Z with D. That was correct behaviour: those pairs
have identical *still* shapes and differ only in motion, so they should
never have been separate classes. The second scored 94.0% and still
confused M with N and G with Q — because in my rig M and N had nearly
identical thumbs, and because the canonical frame is rotation-invariant
by construction, which erases the only difference between G and Q. Fixing
the data and adding explicit orientation features took it to 99.6%.

### Non-manual grammar

ASL is not carried on the hands alone. Raised brows turn a statement into
a yes/no question; furrowed brows mark a wh-question; a head tilt marks a
conditional. Where a sign is made — forehead, chin, chest — changes what
it means.

Mercury tracks face and pose alongside the hands, learns the signer's
neutral expression over the first second, and reports departures from it
as labelled grammatical markers. Those markers are passed to the language
model as context, so the same letters become a question or a statement
depending on the face that signed them.

This is a beginning, not the whole of non-manual grammar.

### How the recognition works

`assets/js/studio/asl.js` reduces 21 landmarks to features a person can
reason about — how folded each finger is, how far apart adjacent fingers are,
where the thumb sits relative to each knuckle, whether index and middle are
crossed, which way the hand points — all divided by palm length so they hold
regardless of hand size or distance from the lens.

Each letter is a template over those features. The first version used
hand-written thresholds and scored **10 of 24** on a round-trip test. The
templates are now measured signatures, and it scores **24 of 24**:

```
letter  read   conf
  A     A      0.99
  U     U      0.71      <- U/V and M/N and S/T report lower confidence,
  V     V      0.71         which is correct: they differ only in thumb
  M     M      0.56         placement and splay
```

A single frame is never trusted. `Stabiliser` votes across a rolling window
and a letter only commits once it has held the lead for a dwell period, which
is what stops the hand registering every shape it passes through on the way
to the one you meant.

J and Z are motion letters — their still shapes are I and D — so they are
excluded from still matching and animated along their path in Spell mode.

### The vector store

Qdrant, running **embedded** by default — a local on-disk store, no
container, no server, works from a clean clone. Set `QDRANT_URL` and the
same code talks to a cluster instead.

Two collections, both earning their place:

**`calibration`** — your own hands, 83-dim encodings.
The model has never seen a real hand; rather than pretend otherwise,
Mercury lets you record your own version of each letter. Recognition
then queries them by nearest neighbour, and the personal vote's weight
grows with how many you have recorded. This matters most for signers
with unusual hand proportions or limited mobility — the people a model
trained on an average is worst at.

**`transcript`** — everything spoken, embedded and searchable by meaning
rather than scrolled.

The text embedding is a hashed bag of words and character trigrams, not a
neural embedder — deliberately, so search works on a clean clone with no
model download. It captures lexical overlap, which is what makes "find
where I mentioned the pharmacy" work. It does not capture paraphrase.

### Sentence repair

Fingerspelling arrives as a run of letters with no spaces and the occasional
misread. `POST /api/llm` sends that run to **Groq** (`openai/gpt-oss-120b`)
with a prompt that names the common confusions (M/N, S/T, U/V, A/E, D/Z) and
asks only for the sentence that was meant.

```bash
export GROQ_API_KEY=gsk_...       # then start the server
```

The key stays on the server; the page never sees it. There is also a field in
studio settings for a key, which is stored on your device only — the
environment variable is the better path.

**Without a key the studio still works.** It falls back to a local reading and
labels the sentence `local` rather than pretending. Every capability here
degrades that way: no camera, no model, no network, no speech synthesis — each
removes one feature and leaves the rest working.

## The part worth reading

`assets/js/scenes/hand.js` is not an animation. It is a small **forward
kinematics solver** over MediaPipe's real hand topology — 21 landmarks, 20
bones. Each ASL handshape is stored as five curl values and five spread
values; the rig solves every joint per frame and interpolates between letters,
so the transitions are generated, not keyframed.

```js
POSE.U = { c:[0.92,0.04,0.04,1.00,1.00], s:[-0.25,-0.03,0.03,0.10,0.20] }
//          thumb index middle ring pinky
```

## Privacy

Hand tracking runs entirely in the browser. The MediaPipe model is vendored
into this repository and loaded from disk. **No video frame ever leaves the
machine** — the only thing that can go out is the line of recognised letters,
and only when a Groq key is configured.

## No stock imagery

Every pixel on this site is drawn at runtime — the planet, the hand, the road,
the ocean, the clouds, the dithering, the cellular automaton. There is not a
single `.jpg` or `.png` in this repository, and nothing is a video loop.
Resize the window and it redraws; it is never a picture of an animation.

## Running it

```bash
git clone https://github.com/akshatinnovate-png/Mercury.git
cd Mercury
python3 server/app.py          # then open http://127.0.0.1:8000
```

On Windows use `python` instead of `python3`. If port 8000 is already taken,
pass another: `python3 server/app.py 5500`.

**Opening `index.html` by double-clicking will not work.** The site uses ES
modules, which every browser blocks over `file://`. It has to be served over
HTTP — that is all the command above does.

No build step, no `npm install`, no network. GSAP, Lenis and both typefaces are
vendored into `assets/`, so it renders identically on a judging machine with the
wifi off.

The server also stubs the endpoints the interpreter will use:

| Route | Returns |
|-------|---------|
| `GET /api/health` | build status |
| `GET /api/topology` | the 21 landmark names and bone count |
| `GET /api/pipeline` | the seven stages |
| `POST /api/llm` | sentence repair via Groq, or a clear reason why not |
| `POST /api/vectors/calibrate` | store encodings of a letter as you sign it |
| `POST /api/vectors/match` | nearest neighbours among your own hands |
| `POST /api/vectors/remember` | keep a sentence for later recall |
| `POST /api/vectors/search` | search everything said, by meaning |
| `GET /api/vectors/summary` | calibration coverage |

## Layout

```
index.html
assets/
  css/      tokens · base · chrome · acts · lab · fonts
  js/
    core/   gfx (3D + ticker) · boot · cursor · scroll · hud
    scenes/ void · descent · hand · pipeline · voice · lab · atmos
    studio/ rig · alphabet · asl · encode · neural · ensemble
            holistic · camera · overlay · speller · speech · llm
    ui/     reveal
  models/   hand · face · pose landmarkers · handshape.onnx
  vendor/   GSAP, Lenis, MediaPipe tasks-vision, ONNX Runtime Web
server/
  app.py      static files, Groq proxy, vector endpoints
  vectors.py  Qdrant collections and the text embedding
tools/
  train_handshape.py     the model, in numpy
  generate_dataset.mjs   synthetic hands, via the live encoder
  fonts/    Archivo Variable, JetBrains Mono
  vendor/   GSAP, ScrollTrigger, Lenis
server/app.py
```

`assets/js/core/gfx.js` holds the shared kit: a tiny rotate-and-project 3D
pipeline, a Fibonacci sphere, great-circle arcs, and **one** requestAnimationFrame
loop that every scene subscribes to. Scenes idle while off-screen, so at most
two are ever drawing.

## Accessibility

`prefers-reduced-motion` is honoured throughout: the reveal animations are
skipped, smooth scrolling is disabled, and the page renders in its final state.
The custom cursor is removed entirely on touch devices.

## Tested

- ensemble: 24/24 static letters, unanimous agreement
- neural model: 99.62% on held-out synthetic hands at 1.7x distortion
- inference: 0.125 ms warm
- calibration: samples stored, personal weight rises 0 → 0.18, kNN votes correctly
- recall: lexical search ranks the right sentence first
- studio: clean at 1600 / 1280 / 820 / 390 px across all six modes
- pipeline: landmarks → letters → sentence → transcript, driven by synthetic
  hands through the real UI
- practice scoring, multi-word spelling with spaces
- no text overlaps at 1600 / 1280 / 1024 / 390 px wide
- landing page holds 38–60 fps on a software rasteriser with no GPU

Not verifiable from here, and worth checking on your machine: detection
accuracy on real hands in real lighting, the live Groq call
(`api.groq.com` is blocked from the sandbox this was built in), and the
non-manual markers, which need a real face.

## Known limits

- **The accuracy figures are on synthetic hands.** Real-hand accuracy is
  unmeasured. Calibrate before judging it.
- Fingerspelling only. Full sign language is not the alphabet — it has its own
  grammar, and uses space, movement and face. The pipeline in Act IV is the
  architecture for that; this build implements the manual alphabet.
- J and Z are animated but not yet recognised from motion.
- One hand at a time is interpreted, though two are tracked and drawn.
