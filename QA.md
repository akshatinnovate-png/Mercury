# Mercury — questions and answers

Written for the moment someone is standing in front of the project asking.
Answers are short on purpose: say the first line, stop, and let them ask more.

A rule that runs through all of this: **volunteer the limitations before you
are asked.** A judge who finds a weakness you hid stops trusting everything
else you said. A judge who hears you name it yourself starts trusting all of it.

---

## The basics

**What does it do?**
It reads sign language from a webcam and speaks it out loud. And it works the
other way: it listens, and signs back what it hears.

**Who is it for?**
Deaf and hard-of-hearing people in the ordinary situations where no interpreter
is available — a pharmacy counter, a reception desk, a 3am helpline. An
interpreter costs money and has to be booked. This is the part a computer can do.

**Why "Mercury"?**
The Roman god of speech, messages, and crossings between worlds. That is the
job. He is also the god of quicksilver, which is why the whole thing is silver.

**How long did it take / did you build it yourself?**
Answer honestly. You understand every part of it — that is what the rest of
this document is for.

---

## How it works

**Walk me through what happens when I sign a letter.**
The camera gives a frame. MediaPipe finds 21 points on your hand. Those become
83 numbers describing the shape. Three different classifiers each guess a
letter, their votes are combined, and the answer has to hold steady before
Mercury offers it. You press space to accept. Letters build into a word, words
into a sentence, and a language model fixes the spacing and punctuation. Then
the browser speaks it.

**Why 21 points?**
That is MediaPipe's hand topology: the wrist, plus four points on each finger —
knuckle, two joints, tip. Twenty bones connect them.

**How do you turn points into a letter?**
Every hand is reduced to the same 83 numbers: how curled each finger is, how
far apart neighbours are, where the thumb sits, which way the hand points.
Everything is divided by palm length and rotated into a standard frame, so the
same letter gives the same numbers whether your hand is large or small, near or
far, upright or tilted.

**Why three classifiers instead of the best one?**
Because they fail differently. The geometric one is instant and can explain
every decision. The neural one is the most accurate and the worst at knowing
when it is out of its depth. The third is your own recorded hands, which is
worth nothing until you calibrate and worth more than either afterwards. When
they disagree, that disagreement is itself information — the studio shows it as
*unanimous*, *split* or *disputed*.

**What is the confirm step for?**
At natural signing speed your hand passes through several shapes on the way to
the one you mean. A system that commits on a timer takes whichever one the
clock landed on. Mercury proposes and waits, and puts the runners-up one
keypress away — so a wrong reading costs one key, not a backspace and a retry.

---

## The machine learning

**Did you train the model yourself?**
Yes. `tools/train_handshape.py` is the whole thing — an MLP written in numpy,
no framework. The exported ONNX file is exactly the arithmetic in that file.

**What are the numbers?**
83 inputs, two hidden layers of 128 and 64, 24 outputs. 20,568 parameters.
67,200 training examples. 99.62% on held-out data. 0.125 ms per prediction.

**Where did the training data come from?**
I generated it. The rig can produce any handshape, so I generated each letter
thousands of times under randomised rotation, hand proportion and tracker
noise. That technique is called domain randomisation.

**Isn't training on synthetic data cheating?**
It is a real limitation and I would rather say it first: **the model has never
seen a photograph of a hand.** 99.62% is on synthetic hands. What it proves is
that the encoding separates the 24 shapes cleanly and survives distortion it
never trained on — not that it reads your hands. That is exactly why Calibrate
exists, and why the geometric classifier stays in the ensemble instead of being
replaced.

**99.97% sounds too good. Are you overfitting?**
Almost certainly, to the generator. That is why there is a second number: a
held-out set built with a different random seed and 1.7× the distortion the
model ever trained on. It scores 99.62% there. Both numbers are synthetic, and
I would not quote either as real-world accuracy.

**Which letters does it get wrong?**
M/N, S/T and U/V. Those pairs differ only in where the thumb sits or how far
two fingers splay. The model reports lower confidence on them, which is the
correct behaviour — the alternative is a system that is confidently wrong.

**Did it work first time?**
No, and the failures were the useful part. The first version used hand-written
thresholds and got 10 of 24 — A, M, N, S and T all collapsed onto E, because
several of my features were saturated and my thresholds were guesses in units I
had never measured. I dumped the real values and rebuilt the templates from
measurements: 24 of 24. The neural version then scored 86.6% and confused J
with I and Z with D — which was correct, since those pairs have identical still
shapes and should never have been separate classes. Fixing that gave 94.0%,
still confusing M with N and G with Q. M and N had nearly identical thumbs in
my own rig data, and G and Q differ only by orientation, which my canonical
frame was deliberately throwing away. Fixing the data and adding orientation
back explicitly gave 99.6%.

**Why such a small model?**
Because the problem is small once the features are right. The encoding does the
hard work; the network only has to draw boundaries between 24 clusters. A
bigger model would be slower, harder to ship, and no more accurate.

---

## The other technologies

**Why Qdrant? Couldn't you use a normal database?**
A normal database finds exact matches. This needs *similar* — the nearest hands
to the one on camera right now, out of everything you have recorded. That is a
vector search, and it is what Qdrant is for. It runs embedded, as a file on
disk, so there is nothing to install or provision.

**What does the language model actually do?**
Fingerspelling arrives as a run of letters with no spaces and the occasional
misread. The model turns `MYNAMEISADA` into "My name is Ada." Its instructions
name the specific confusions — M/N, S/T, U/V — so it knows what kind of
mistakes to expect. If there is no key it falls back to a local reading and
labels the sentence `local` rather than pretending.

**Why does the face matter?**
Because ASL grammar is not all on the hands. Raised eyebrows turn a statement
into a yes/no question; furrowed brows mark a *wh*-question; a head tilt marks a
conditional. Mercury learns your neutral expression, then reports departures
from it, and passes them to the language model — so the same letters become a
question or a statement depending on your face.

**Is it sending my video anywhere?**
No. Hand, face and pose tracking all run in the browser, and the models are in
the repository rather than downloaded. The only thing that can leave the machine
is the line of recognised letters, and only if a language-model key is set.

**Why is the avatar chrome instead of a person?**
Two reasons. A figure that is almost human is worse than one that is plainly a
machine. And polished metal carries a handshape in its reflections better than
matte skin does, which matters when the whole point is reading the shape.

---

## Pushing back

**This is just fingerspelling. It is not really sign language.**
Correct, and it is the first thing I would say myself. Fingerspelling is the
manual alphabet — how names and new words are spelled out. Full ASL has
thousands of lexical signs, uses the space around the signer, and carries
grammar on the face. Mercury implements the alphabet and reads three facial
markers. The seven-stage pipeline is the architecture the rest slots into, and
the next step is word-level signs from recorded data.

**Google already does this.**
Google publishes the *landmark detector* — the part that finds 21 points. Almost
every project stops there and writes if-statements. What is mine is everything
above it: the encoding, a model I trained, an ensemble that reports its own
disagreement, a personalisation store, and the reverse direction.

**What if it reads the wrong letter?**
Then you do not confirm it, and you take the right one from the alternatives
with a number key. That is the whole reason confirm mode is the default.

**What happens if the internet drops mid-demo?**
Everything keeps working except sentence repair, which falls back to a local
reading. Every model is vendored. I can demo this with the wifi off.

**Why should a deaf person trust this over a human interpreter?**
They should not, and it is not the comparison I would make. A human interpreter
is better at everything except being there at 3am for free. Mercury is for the
gap, not the replacement.

---

## Live demo

**What do I show, in what order?**

1. **Alphabet** — all 26 handshapes rotating. Sets up what the problem is.
2. **Interpret** — sign three or four letters, confirm each. Point at the
   ensemble panel while you do it: three opinions, live.
3. **Word completion** — spell two letters of a word you have used, take the
   suggestion. This is the moment people react to.
4. **Converse** — sign a question, hear it spoken; then speak a reply and watch
   it signed back. This is the one that reframes it from demo to tool.
5. **Avatar** — switch to the hand view. The close-up is the prettiest thing in
   the project.
6. **Calibrate** — if there is time, record two letters and show the personal
   weight rise from 0%.

**If recognition is poor on the day:** go to Calibrate, record five samples of
the letters you plan to sign, and come back. Say what you are doing and why —
it demonstrates the feature rather than hiding a problem.

**Have ready:** the wifi off at least once, to prove it.

---

## Things you should be able to point at

- `tools/train_handshape.py` — the model, in numpy, no framework.
- `assets/js/studio/asl.js` — the measured templates, and the comment saying
  why hand-written thresholds scored 10 of 24.
- `assets/js/studio/encode.js` — the canonical frame, and the comment about
  rotation invariance erasing G from Q.
- `assets/js/studio/ensemble.js` — the three-way vote.
- `server/vectors.py` — the two Qdrant collections and why each exists.
- `tools/build_texture.py` — unwrapping a photograph of Mercury so the planet
  turns instead of the picture spinning.
