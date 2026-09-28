# Mercury — the whole project, explained

Everything here is written to be read by someone who has never seen the code.
Start at the top; each section assumes only what came before it.

---

## 1. The one-sentence version

**Mercury watches your hands through a webcam, works out which letters you are
signing, builds them into a sentence, and says it out loud — and it can do the
reverse, turning speech back into signing.**

---

## 2. The one-paragraph version

About 1.2 billion people live with hearing loss. Many sign; almost nobody
around them does. A human interpreter costs money and has to be booked, so a
deaf person at a pharmacy counter or an emergency line usually waits. Mercury
is an attempt at the part a computer can do: it reads the American manual
alphabet from a normal webcam, entirely on your own machine, and speaks what
you spell. It also listens, and signs back what it hears — so it is a
conversation, not a readout.

---

## 3. What it actually is, as files

Two things live in one repository:

| | |
|---|---|
| **The story** — `index.html` | A scroll-driven page, roughly 36 screens tall, that explains the problem and the method. Eight "acts", each a rendered scene. |
| **The studio** — `studio.html` | The working tool. Eight tabs: Interpret, Converse, Avatar, Spell, Practice, Calibrate, Recall, Alphabet. |

Plus a small Python server that serves both, talks to the language model, and
keeps the vector store.

---

## 4. How it works, in one pass

Follow a single letter from your hand to a spoken word.

```
1. CAMERA        your webcam gives the browser a video frame
2. LANDMARKS     MediaPipe finds 21 points on your hand in that frame
3. ENCODE        those 21 points become 83 numbers that describe the shape
4. THREE GUESSES  geometric rules, a trained neural network, and your own
                  recorded hands each propose a letter
5. VOTE          the three are weighted and combined into one answer
6. SETTLE        the answer must hold steady before it is offered
7. CONFIRM       you press space to accept it — nothing is taken automatically
8. WORD          letters gather into a word; completions are offered
9. SENTENCE      the raw letters go to a language model, which returns the
                  sentence you meant, punctuation and all
10. VOICE        the browser speaks it
```

Steps 1–8 never leave your computer. Only step 9 sends anything out, and only
the letters — never a video frame.

---

## 5. Every feature, in one line each

**Interpret** — camera in, letters out, sentence spoken.
**Converse** — two-way: you sign and are heard, they speak and are shown.
**Avatar** — a 3D quicksilver figure that fingerspells what you type.
**Spell** — type or dictate; the hand rig signs it back.
**Practice** — Mercury asks for a letter, you sign it, it scores you.
**Calibrate** — record your own hands so recognition adapts to you.
**Recall** — search everything you have said, by meaning.
**Alphabet** — all 26 handshapes as rotating 3D references.

Supporting:

- **Confirm-to-commit** — nothing is accepted until you say so, and the
  runners-up are one keypress away.
- **Word completion** — after two or three letters, likely words appear.
- **Non-manual markers** — raised eyebrows turn a statement into a question.
- **Works offline** — every model is in the repository; no network needed.
- **Degrades gracefully** — no camera, no model, no internet, no microphone:
  each removes one feature and leaves the rest working.

---

## 6. The numbers

| Thing | Value |
|---|---|
| Landmarks tracked per hand | 21 |
| Letters recognised | 24 static, plus J and Z by motion |
| Neural network size | 20,568 parameters |
| Input to the network | 83 numbers |
| Training examples | 67,200 |
| Accuracy, held-out synthetic | 99.62% |
| Time to classify one frame | 0.125 ms |
| Repository size | 56 MB |
| Third-party Python packages | 1, and it is optional |

**The honest asterisk:** that accuracy is on *synthetic* hands generated from
the rig. The model has never seen a photograph of a real hand. Say this before
a judge asks — it turns a weakness into evidence that you understood your own
method. The Calibrate tab exists precisely to close that gap.

---

## 7. Glossary — every technical term in this project

Ordered from the ones you will be asked about most, to the ones you only need
if pressed.

### The hand

**Landmark** — a single tracked point on the body. Mercury tracks 21 per hand:
the wrist, and four points on each finger (knuckle, two joints, tip).

**Topology** — which landmarks connect to which. Mercury's 21 landmarks are
joined by 20 bones; the topology is what turns a cloud of points into a hand.

**MediaPipe** — Google's on-device vision library. Mercury uses its hand, face
and pose models. It runs in the browser, so no video is uploaded.

**Rig** — a skeleton you can pose. Mercury's rig is 21 joints with rules about
how they bend.

**Forward kinematics (FK)** — working out where the end of a chain of joints
ends up, given the angle of each joint. Bend the knuckle 30°, then the next
joint 40°, and FK tells you where the fingertip lands. Mercury uses this to
*generate* handshapes, which is the opposite of what the camera does.

**Curl** — how folded a finger is, from 0 (straight) to 1 (fully closed).

**Spread** — how far apart two neighbouring fingers are.

**Handshape** — the configuration of the hand at one instant. `V` and `U` are
the same two fingers; the difference is spread.

### Sign language

**ASL** — American Sign Language. A full language with its own grammar, not
English on the hands.

**Fingerspelling** — spelling a word letter by letter using the manual
alphabet. Used for names and words with no sign. **This is what Mercury does.**

**Manual alphabet** — the 26 handshapes for the letters. ASL's is one-handed;
British Sign Language's is two-handed, which is why they are not interchangeable.

**Gloss** — writing signs down in the order they are signed, which is not
English word order. "STORE I GO" is the gloss of "I am going to the store".

**Non-manual markers** — the grammar that is not on the hands. Raised eyebrows
mark a yes/no question; furrowed brows mark a *wh*-question; a head tilt marks
a conditional. A system reading only handshape is reading about half the
language.

**Motion letters** — J and Z, which are drawn in the air. Their *still* shapes
are identical to I and D, so only movement tells them apart.

### The maths of describing a shape

**Feature** — one measurable number about the hand, chosen because it means
something. "How curled is the index finger" is a feature.

**Feature vector** — all those numbers in a fixed order. Mercury's is 83 long.

**Invariance** — a property that does not change when something irrelevant
does. Mercury's features are **scale invariant** (same numbers whether your
hand is near or far) and **rotation invariant** (same numbers whether your
hand is upright or tilted), because both are achieved by dividing by palm
length and rotating into a fixed frame.

**Canonical frame** — a standard orientation everything is converted into.
Mercury moves the wrist to the origin, scales so the palm is length 1, and
rotates so the palm faces forward. After that, two different people signing
the same letter produce nearly the same numbers.

**Normalisation** — rescaling numbers so they are comparable. Without it a
feature measured in hundreds would drown out one measured in fractions.

### The neural network

**Neural network** — a stack of multiplications and simple thresholds whose
numbers are found by trial and error rather than written by hand.

**MLP (multilayer perceptron)** — the simplest useful kind: layers of numbers,
each fully connected to the next. Mercury's is 83 → 128 → 64 → 24.

**Parameter (weight)** — one of the numbers the network learns. Mercury has
20,568. For comparison a large language model has billions; this is a
deliberately small model that fits in 81 KB and runs in a fraction of a
millisecond.

**Layer** — one stage of the network. **Hidden layer** — any layer that is not
the input or the output.

**ReLU** — the threshold between layers: negative numbers become zero,
positive ones pass through. Without something like it the whole network would
collapse into a single multiplication and could only draw straight lines.

**Softmax** — turns the network's raw output scores into probabilities that add
up to 1, so "0.94 confident it is a V" means something.

**Training** — showing the network examples and nudging every parameter
slightly whenever it is wrong.

**Loss** — a number measuring how wrong the network is. Training is the search
for parameters that make it small. Mercury uses **cross-entropy**, the standard
loss for choosing between categories.

**Backpropagation** — the method for working out which direction to nudge each
parameter, by tracing the error backwards through the layers.

**Gradient** — the direction and steepness of that nudge.

**Adam** — a popular recipe for applying those nudges, which adapts the step
size per parameter instead of using one fixed rate.

**Learning rate** — how big each nudge is. Too big and training thrashes; too
small and it never arrives.

**Cosine decay** — starting with a large learning rate and smoothly reducing it,
so training explores early and settles late.

**Epoch** — one pass through all the training data. Mercury trains for 40.

**Batch** — the handful of examples looked at before each nudge. Mercury uses 256.

**He initialisation** — a sensible starting spread for the parameters before
training begins, chosen to suit ReLU.

**Weight decay** — a gentle pull of all parameters toward zero, which
discourages the network from memorising.

### Judging whether a model is any good

**Training set / validation set** — the examples used to learn, and a held-back
portion used only to check. Testing on what you trained on tells you nothing.

**Overfitting** — memorising the training examples instead of learning the
pattern. Recognised by high training accuracy and poor validation accuracy.

**Generalisation** — performing well on things never seen. The only thing that
matters.

**Domain randomisation** — deliberately varying everything irrelevant in
training data (angle, size, proportion, noise) so the model learns the thing
that stays the same. This is how Mercury trains on simulated hands and has any
hope of reading real ones.

**Sim-to-real gap** — the drop in performance when a model trained on
simulation meets reality. Mercury's honest weak point, and the reason
Calibrate exists.

**Confidence** — how sure the model claims to be. **Calibration** is whether
that claim is honest: if it says 90% a hundred times, it should be right about
ninety of them.

**Confusion** — which classes get mistaken for which. Mercury's are M/N, S/T
and U/V, and they are genuinely similar handshapes.

### Running the model

**ONNX** — a standard file format for trained models, readable by many tools.
It means Mercury's model is a portable artefact, not locked to one library.

**ONNX Runtime Web** — the engine that runs that file inside a browser.

**Inference** — using a trained model to make one prediction. (Training is
learning; inference is answering.)

**WASM (WebAssembly)** — a fast, low-level format browsers can run, used here
so the model executes at close to native speed.

**SIMD** — "single instruction, multiple data": a processor feature that
applies one operation to several numbers at once. Mercury ships both a SIMD
and a non-SIMD build so older machines still work.

### Combining opinions

**Ensemble** — using several models and combining their answers, because each
is wrong in a different way.

**Weighted vote** — combining those answers with each one's say proportional to
how much it is trusted.

**Agreement** — whether the members of the ensemble picked the same thing.
Mercury reports *unanimous*, *split* or *disputed*, which is a more honest
signal than any single model's self-confidence.

**kNN (k-nearest neighbours)** — the simplest possible classifier: find the *k*
most similar examples you have already seen, and go with the majority. Mercury
uses it over *your* recorded hands.

### Storing and searching

**Vector** — a list of numbers describing something. Mercury's hand encoding
is an 83-number vector.

**Embedding** — a vector produced specifically so that similar things land near
each other.

**Vector database** — a database that finds *similar* rows rather than exactly
matching ones. Mercury uses **Qdrant**.

**Collection** — one table in that database. Mercury has two: `calibration`
(your hands) and `transcript` (what you have said).

**Cosine similarity** — a way of measuring how alike two vectors are by the
angle between them, ignoring their length. 1 is identical, 0 is unrelated.

**Embedded mode** — running the database as a file on your disk instead of a
separate server. This is why Mercury needs no Docker.

**Upsert** — insert, or update if it already exists.

### Language

**LLM (large language model)** — a model trained to predict text, which is how
it ends up able to fix, complete and rewrite it.

**Groq** — the service Mercury sends its sentence-repair requests to.

**gpt-oss-120b** — the specific open-weights model used, with 120 billion
parameters. (Mercury's own model has 20,568 — they do completely different jobs.)

**System prompt** — the standing instruction given to the model before the
user's text. Mercury's names the letters most often confused, so the model
knows what kind of mistakes to expect.

**Token** — the unit a language model reads and writes; roughly a short word or
part of one.

**Temperature** — how random the model's output is. Mercury uses 0.2: nearly
deterministic, because the goal is the right sentence, not a creative one.

**Proxy** — the server standing between the browser and Groq, so the API key
never reaches the page.

**API key** — the secret that identifies your account to a service. Kept in an
environment variable, never in the code.

### The interface

**Dwell** — how long a handshape must be held. Mercury's default mode does not
use it to commit, only to decide when a reading is steady enough to offer.

**Temporal smoothing** — combining several recent frames instead of trusting
one, because a single frame is noisy.

**Debounce** — waiting for activity to stop before acting, so a request is not
fired on every keystroke.

**Web Speech API** — the browser's built-in speech synthesis (**TTS**,
text-to-speech) and recognition (**STT**, speech-to-text).

**Graceful degradation** — designing so that when a part is missing the rest
still works, rather than everything failing together.

### Graphics

**Canvas 2D** — the browser's basic drawing surface. Most of Mercury's scenes
are drawn here, pixel by pixel.

**WebGL** — the browser's 3D graphics interface. Used only for the avatar.

**three.js** — the library that makes WebGL manageable.

**Frame rate (fps)** — how many pictures are drawn per second. 60 is smooth.

**requestAnimationFrame** — the browser's "draw the next frame now" signal.
Mercury runs one of these for the whole site and lets scenes subscribe.

**Lookup table (LUT)** — a precomputed answer stored so it need not be
recalculated. Mercury solves the planet's projection once into a LUT; after
that each frame is one array read per pixel, which is how a full sphere runs
at 60fps without WebGL.

**Equirectangular map** — a rectangular image of a sphere's surface, like a
world map, with longitude across and latitude down.

**Orthographic projection** — a view with no perspective, as a photograph of a
distant planet effectively is.

**Albedo** — how reflective a surface is, independent of how it happens to be
lit. Mercury divides the lighting out of the photograph to recover albedo, so
the shadow does not rotate with the terrain.

**Terminator** — the line between the lit and unlit halves of a planet.

**Lambert shading** — the standard rule that a surface is brightest when facing
the light directly.

**Fresnel / rim light** — the brightening seen at a glancing angle, along the
edge of a sphere. Without it a dark planet on a dark background has no edge.

**PBR (physically based rendering)** — materials described by real properties
(**metalness**, **roughness**) rather than arbitrary settings.

**Environment map** — the surroundings, stored as an image, so reflective
surfaces have something to reflect. Chrome with no environment is a black blob.

**Scroll scrubbing** — tying an animation's progress to scroll position, so the
viewer controls time. **GSAP** and **ScrollTrigger** do this; **Lenis** smooths
the scroll itself.

**Sticky positioning** — pinning an element while the page scrolls past it,
which is how each act holds still while its scene plays.

**Cellular automaton** — a grid where each cell's next state depends on its
neighbours. **Conway's Game of Life** is the famous one, and the widget in the
Lab genuinely runs its rules.

**Dithering** — simulating shades using patterns of dots.

### Running it

**ES modules** — the modern way JavaScript files import each other. Browsers
refuse to load them over `file://`, which is why Mercury must be served rather
than double-clicked.

**CORS** — the browser rule about which origins may load what. The reason for
the above.

**Localhost** — your own machine, addressed as `127.0.0.1`. Counts as a secure
origin, which is why the camera works without HTTPS.

**Environment variable** — a value set in your shell that a program reads, used
here for secrets so they never enter the code.

**Vendoring** — copying a dependency into your own repository instead of
fetching it at runtime. Everything Mercury needs is vendored, so it works with
no internet.

---

## 8. What Mercury does not do

Say these before you are asked.

- **It fingerspells; it does not interpret full ASL.** Real signing has
  thousands of lexical signs, uses space and movement, and carries grammar on
  the face. Mercury implements the manual alphabet and reads three facial
  markers. The pipeline is the architecture for the rest.
- **Its accuracy figures are on synthetic hands.** Real-world accuracy is
  unmeasured. Calibrate first.
- **J and Z are animated but not yet recognised**, because they need motion.
- **It interprets one hand at a time**, though it tracks and draws two.
