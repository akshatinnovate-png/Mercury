# MERCURY

**An AI sign language interpreter. Every hand has a voice.**

Named for the Roman god of speech, messages and the crossings between worlds —
which is exactly the job: carry meaning from a pair of hands to a room that
doesn't sign, fast enough that nobody has to wait for it.

This repository currently holds the **interface build**: the full front end,
built and finished, with no model attached behind it yet.

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
| `POST /api/interpret` | `501` — no model attached in this build |

## Layout

```
index.html
assets/
  css/      tokens · base · chrome · acts · lab · fonts
  js/
    core/   gfx (3D + ticker) · boot · cursor · scroll · hud
    scenes/ void · hand · pipeline · voice · lab
    ui/     reveal
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

## Status

Interface build. The model, the camera capture and the speech synthesis are the
next milestone; the pipeline in Act IV is the architecture they slot into.
