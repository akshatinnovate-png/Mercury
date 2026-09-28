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

**Interpret** — point a camera at your hands. Mercury tracks 21 landmarks per
hand, recognises the letter, waits for you to hold it, and builds the
sentence. Then it speaks it aloud.

**Spell** — type or dictate a sentence and the rig fingerspells it back, at a
speed you choose. The reverse direction, using the same handshape definitions.

**Practice** — Mercury shows a letter, you sign it, and it scores you. Correct
count, streak and accuracy, with a reference hand showing the shape it wants.

**Alphabet** — all 26 letters as rotating 3D handshapes.

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

## Layout

```
index.html
assets/
  css/      tokens · base · chrome · acts · lab · fonts
  js/
    core/   gfx (3D + ticker) · boot · cursor · scroll · hud
    scenes/ void · descent · hand · pipeline · voice · lab · atmos
    studio/ rig · alphabet · asl · camera · overlay · speller · speech · llm
    ui/     reveal
  models/   hand_landmarker.task
  vendor/   GSAP, ScrollTrigger, Lenis, MediaPipe tasks-vision
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

- recogniser: 24/24 static letters on a rig round-trip
- pipeline: landmarks → letters → sentence → transcript, driven by synthetic
  hands through the real UI
- practice scoring, multi-word spelling with spaces
- no text overlaps at 1600 / 1280 / 1024 / 390 px wide
- landing page holds 38–60 fps on a software rasteriser with no GPU

Not verifiable from here, and worth checking on your machine: detection
accuracy on real hands in real lighting, and the live Groq call.

## Known limits

- Fingerspelling only. Full sign language is not the alphabet — it has its own
  grammar, and uses space, movement and face. The pipeline in Act IV is the
  architecture for that; this build implements the manual alphabet.
- J and Z are animated but not yet recognised from motion.
- One hand at a time is interpreted, though two are tracked and drawn.
