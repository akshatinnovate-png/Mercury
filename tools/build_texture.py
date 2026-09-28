"""
MERCURY — build the planet texture.

Input is an orthographic photograph of Mercury's lit hemisphere. Rotating
that image directly would carry its baked-in shadow around with the terrain,
which reads as a spinning picture rather than a turning planet.

This unwraps the disc to an equirectangular lat/lon map, divides out the
illumination to recover something close to albedo, fills the unseen far side
by mirroring, and flattens any residual banding so the seams do not show.
The result is lit fresh at render time by a fixed sun.

    python tools/build_texture.py <source.png> [out.png]
"""
import sys
import numpy as np
from PIL import Image

SRC = sys.argv[1] if len(sys.argv) > 1 else 'mercury.png'
OUT = sys.argv[2] if len(sys.argv) > 2 else 'assets/textures/mercury-map.png'
W, H = 1024, 512


def circular_flatten(img, strength=1.0, window=81):
    """Remove systematic brightness variation with longitude, keeping texture.

    Any step across a seam shows up as a jump in the column mean, so
    normalising that profile removes the seam without blurring the surface.
    """
    col = np.nanmean(img, axis=0)
    good = ~np.isnan(col)
    col = np.interp(np.arange(len(col)), np.nonzero(good)[0], col[good])
    pad = np.r_[col[-window:], col, col[:window]]
    smooth = np.convolve(pad, np.ones(window) / window, mode='same')[window:-window]
    smooth = np.maximum(smooth, 1e-3)
    target = smooth.mean()
    gain = (target / smooth) ** strength
    return img * gain[None, :]


def main() -> None:
    a = np.array(Image.open(SRC).convert('RGBA')).astype(np.float32)
    lum, alpha = a[..., :3].mean(2), a[..., 3]

    # locate the disc rather than assuming it is centred
    ys, xs = np.nonzero(alpha > 10)
    cx, cy = (xs.min() + xs.max()) / 2, (ys.min() + ys.max()) / 2
    R = ((xs.max() - xs.min()) + (ys.max() - ys.min())) / 4
    print(f"disc  centre ({cx:.1f}, {cy:.1f})  radius {R:.1f}")

    lon = (np.arange(W) + 0.5) / W * 2 * np.pi - np.pi
    lat = np.pi / 2 - (np.arange(H) + 0.5) / H * np.pi
    LON, LAT = np.meshgrid(lon, lat)
    x, y = np.cos(LAT) * np.sin(LON), np.sin(LAT)
    z = np.cos(LAT) * np.cos(LON)

    px = np.clip((cx + x * R).astype(np.int32), 0, a.shape[1] - 1)
    py = np.clip((cy - y * R).astype(np.int32), 0, a.shape[0] - 1)
    samp = lum[py, px]
    off_disc = alpha[py, px] < 8
    samp[off_disc] = np.nan

    albedo = circular_flatten(samp, strength=1.0, window=61)

    # How trustworthy each sample is: face-on pixels carry real detail, limb
    # pixels are smeared across many degrees of longitude and carry almost none.
    # a gentler falloff widens the handover, so neither source dominates abruptly
    trust = np.clip(z, 0, 1) ** 1.1
    trust[off_disc] = 0.0
    albedo = np.nan_to_num(albedo, nan=0.0)

    # The far side was never photographed, so it has to be borrowed from the
    # near side. Mirroring is the obvious choice and the wrong one: a mirror
    # leaves a reflection axis, which the eye finds instantly as a seam down
    # the middle of the globe. A plain translation has no axis at all, so the
    # borrowed terrain simply reads as more of the same surface. It is flipped
    # top to bottom as well, so the two hemispheres are not recognisably the
    # same ground.
    # The roll has to be exactly half the width or the borrowed hemisphere
    # lands out of register and leaves an unfilled band. The flip is vertical
    # only: that puts its mirror axis on the equator, where a horizontal line
    # is invisible on a rotating sphere, and it keeps the far side from being
    # a recognisable repeat of the near side.
    far_val = np.roll(albedo[::-1, :], W // 2, axis=1)
    far_trust = np.roll(trust[::-1, :], W // 2, axis=1)
    total = trust + far_trust + 1e-6
    out = (albedo * trust + far_val * far_trust) / total

    # anything both views missed (the poles) falls back to its row
    dead = total < 1e-4
    rows = np.where(dead.all(1), np.nan, np.nansum(out * ~dead, 1) / np.maximum((~dead).sum(1), 1))
    rows = np.nan_to_num(rows, nan=float(np.nanmean(out)))
    out[dead] = np.take(rows, np.nonzero(dead)[0])

    out = circular_flatten(out, strength=0.9, window=97)

    # one light horizontal pass; the map is sampled down onto a ~600px sphere,
    # so this costs nothing visible and removes any residual single-pixel step
    out = (np.roll(out, 1, 1) + out * 2 + np.roll(out, -1, 1)) / 4

    # percentile stretch: min/max lets one bright crater rim set the range
    lo, hi = np.percentile(out, 1.5), np.percentile(out, 99.2)
    out = np.clip((out - lo) / max(hi - lo, 1e-6), 0, 1)
    out = np.clip(out * 0.80 + 0.18, 0, 1)

    Image.fromarray((out * 255).astype(np.uint8), 'L').save(OUT, optimize=True)
    print(f"wrote {OUT}  {W}x{H}  mean {out.mean():.3f}")


if __name__ == '__main__':
    main()
