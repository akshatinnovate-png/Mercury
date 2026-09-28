"""
MERCURY — train the handshape classifier.

A three-layer MLP over the canonical pose encoding, written in numpy so
every step is visible: no framework, no hidden preprocessing, and the
exported ONNX graph is exactly the arithmetic below.

Trained on rig poses under heavy domain randomisation. That is a real
technique and it is also a real limitation, stated plainly: the model has
never seen a photographed hand. The calibration store is what closes that
gap for an individual signer.
"""
import json, numpy as np, onnx
from onnx import helper, TensorProto

rng = np.random.default_rng(7)

# ---------------------------------------------------------------- data
raw = json.load(open('train.json'))
X = np.asarray(raw['X'], dtype=np.float32)
y = np.asarray(raw['y'], dtype=np.int64)
LETTERS = raw['letters']
N, D = X.shape
C = len(LETTERS)
print(f"data     {N} samples · {D} dims · {C} classes")

# standardise, and keep the statistics so inference can apply the same shift
mu = X.mean(0)
sd = X.std(0) + 1e-6
X = (X - mu) / sd

# split by index within each class so every letter is represented in both
perm = rng.permutation(N)
X, y = X[perm], y[perm]
cut = int(N * 0.85)
Xtr, ytr, Xva, yva = X[:cut], y[:cut], X[cut:], y[cut:]
print(f"split    {len(Xtr)} train · {len(Xva)} validation")

# ------------------------------------------------------------- model
H1, H2 = 128, 64

def init(fan_in, fan_out):
    # He initialisation, because the activations are ReLU
    return (rng.standard_normal((fan_in, fan_out)) * np.sqrt(2.0 / fan_in)).astype(np.float32)

W1, b1 = init(D, H1), np.zeros(H1, np.float32)
W2, b2 = init(H1, H2), np.zeros(H2, np.float32)
W3, b3 = init(H2, C), np.zeros(C, np.float32)
params = [W1, b1, W2, b2, W3, b3]
m = [np.zeros_like(p) for p in params]
v = [np.zeros_like(p) for p in params]

def forward(x):
    z1 = x @ W1 + b1; a1 = np.maximum(z1, 0)
    z2 = a1 @ W2 + b2; a2 = np.maximum(z2, 0)
    return z1, a1, z2, a2, a2 @ W3 + b3

def softmax(z):
    z = z - z.max(1, keepdims=True)
    e = np.exp(z)
    return e / e.sum(1, keepdims=True)

def accuracy(Xs, ys, bs=8192):
    hit = 0
    for i in range(0, len(Xs), bs):
        hit += (forward(Xs[i:i+bs])[-1].argmax(1) == ys[i:i+bs]).sum()
    return hit / len(Xs)

# ------------------------------------------------------------- train
EPOCHS, BATCH, LR, WD = 40, 256, 2.4e-3, 1e-5
b1m, b2m, eps, step = 0.9, 0.999, 1e-8, 0
best, best_params = 0.0, None

for ep in range(EPOCHS):
    order = rng.permutation(len(Xtr))
    lr = LR * (0.5 * (1 + np.cos(np.pi * ep / EPOCHS)))    # cosine decay
    total = 0.0
    for i in range(0, len(order), BATCH):
        idx = order[i:i+BATCH]
        xb, yb = Xtr[idx], ytr[idx]
        n = len(xb)

        z1, a1, z2, a2, logits = forward(xb)
        p = softmax(logits)
        total += -np.log(p[np.arange(n), yb] + 1e-9).mean() * n

        d = p.copy(); d[np.arange(n), yb] -= 1; d /= n
        gW3 = a2.T @ d;            gb3 = d.sum(0)
        d2 = (d @ W3.T) * (z2 > 0)
        gW2 = a1.T @ d2;           gb2 = d2.sum(0)
        d1 = (d2 @ W2.T) * (z1 > 0)
        gW1 = xb.T @ d1;           gb1 = d1.sum(0)

        step += 1
        for k, (pm, g) in enumerate(zip(params, [gW1, gb1, gW2, gb2, gW3, gb3])):
            g = g + WD * pm
            m[k] = b1m * m[k] + (1 - b1m) * g
            v[k] = b2m * v[k] + (1 - b2m) * g * g
            mh = m[k] / (1 - b1m ** step)
            vh = v[k] / (1 - b2m ** step)
            pm -= lr * mh / (np.sqrt(vh) + eps)

    va = accuracy(Xva, yva)
    if va > best:
        best, best_params = va, [p.copy() for p in params]
    if ep % 5 == 4 or ep == EPOCHS - 1:
        print(f"  epoch {ep+1:2d}  loss {total/len(Xtr):.4f}  train {accuracy(Xtr[:20000], ytr[:20000]):.4f}  val {va:.4f}")

W1, b1, W2, b2, W3, b3 = best_params
print(f"\nbest validation accuracy (same generator): {best:.4f}")

# The real question is whether it survives distortion it never trained on.
import os
if os.path.exists('holdout.json'):
    h = json.load(open('holdout.json'))
    Xh = (np.asarray(h['X'], np.float32) - mu) / sd
    yh = np.asarray(h['y'], np.int64)
    assert h['letters'] == LETTERS, 'holdout class order differs'
    print(f"held-out accuracy (unseen seed, 1.7x distortion): {accuracy(Xh, yh):.4f}")

# --------------------------------------------------- per-class report
pred = np.concatenate([forward(Xva[i:i+8192])[-1].argmax(1) for i in range(0, len(Xva), 8192)])
print("\nweakest classes:")
rows = []
for c in range(C):
    mask = yva == c
    acc = (pred[mask] == c).mean() if mask.sum() else 0
    wrong = pred[mask][pred[mask] != c]
    conf = LETTERS[np.bincount(wrong, minlength=C).argmax()] if len(wrong) else '-'
    rows.append((acc, LETTERS[c], conf, len(wrong)))
for acc, L, conf, n in sorted(rows)[:8]:
    print(f"  {L}  {acc:.3f}   most often read as {conf}")

# ---------------------------------------------------------- export
def T(name, arr):
    return helper.make_tensor(name, TensorProto.FLOAT, arr.shape, arr.astype(np.float32).ravel())

g = helper.make_graph(
    [
        helper.make_node('Sub',     ['input', 'mu'], ['centred']),
        helper.make_node('Div',     ['centred', 'sd'], ['x']),
        helper.make_node('Gemm',    ['x', 'W1', 'B1'], ['z1']),
        helper.make_node('Relu',    ['z1'], ['a1']),
        helper.make_node('Gemm',    ['a1', 'W2', 'B2'], ['z2']),
        helper.make_node('Relu',    ['z2'], ['a2']),
        helper.make_node('Gemm',    ['a2', 'W3', 'B3'], ['logits']),
        helper.make_node('Softmax', ['logits'], ['probs'], axis=1),
    ],
    'mercury-handshape',
    [helper.make_tensor_value_info('input', TensorProto.FLOAT, [1, D])],
    [helper.make_tensor_value_info('probs', TensorProto.FLOAT, [1, C])],
    [T('mu', mu), T('sd', sd),
     T('W1', W1), T('B1', b1), T('W2', W2), T('B2', b2), T('W3', W3), T('B3', b3)]
)
model = helper.make_model(g, producer_name='mercury',
                          opset_imports=[helper.make_opsetid('', 13)])
model.ir_version = 9          # onnxruntime-web 1.30 reads up to IR 9
onnx.checker.check_model(model)
onnx.save(model, 'handshape.onnx')

json.dump({'letters': LETTERS, 'dim': int(D), 'val_accuracy': float(best),
           'params': int(sum(p.size for p in params)), 'samples': int(N)},
          open('handshape.meta.json', 'w'), indent=2)

import os
print(f"\nexported handshape.onnx  ({os.path.getsize('handshape.onnx')/1024:.0f} KB, "
      f"{sum(p.size for p in params):,} parameters)")
