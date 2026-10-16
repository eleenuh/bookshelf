"""Draw the "worn book" texture that style.css lays over every cover: textures/wear.webp

Run it from the project folder:  python scripts/make_wear_texture.py
You only need to run it again if you want to change the texture (e.g. more or fewer scuffs).

The image is mostly see-through. On top of it are:
  - pale scuffed patches, which show up on dark covers
  - faint creases (a dark line with a pale line beside it, like a fold catching the light)
  - dust specks
(The fine paper grain comes from style.css, not from this image.)

It's 900 x 1350 px (the same 2:3 shape as a cover) but each cover only shows a third of it
across and down, so different books show different scuffs (see .cover::after in style.css).
Needs Pillow and numpy (pip install pillow numpy). The website itself doesn't need them.
"""

from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

WIDTH, HEIGHT = 900, 1350
OUTPUT = Path(__file__).resolve().parent.parent / "textures" / "wear.webp"
rng = np.random.default_rng(7)  # a fixed seed, so the texture comes out the same every time

PALE = (255, 251, 242)  # rubbed card / scuffs
DARK = (52, 44, 30)     # dust, crease shadows


def new_layer():
    """A blank greyscale image; each pixel's brightness = how strongly that mark shows (0-255)."""
    return Image.new("L", (WIDTH, HEIGHT), 0)


def wobbly_line(x, y, length, angle, wobble):
    """Points along a gently curving line, so creases aren't perfectly straight."""
    steps = max(3, int(length // 12))
    points = []
    for i in range(steps + 1):
        t = i / steps
        bend = np.sin(t * np.pi) * wobble
        px = x + np.cos(angle) * length * t - np.sin(angle) * bend
        py = y + np.sin(angle) * length * t + np.cos(angle) * bend
        points.append((float(px), float(py)))
    return points


def main():
    pale, dark = new_layer(), new_layer()
    draw_pale, draw_dark = ImageDraw.Draw(pale), ImageDraw.Draw(dark)

    # Scuffed patches: rubbed areas made of many tiny, faint pale specks, stretched in one
    # direction (as if the book slid against something), thickest in the middle
    for _ in range(30):
        cx, cy = rng.uniform(0, WIDTH), rng.uniform(0, HEIGHT)
        length, width = rng.uniform(20, 70), rng.uniform(5, 16)
        angle = rng.normal(0.35, 0.4)
        for _ in range(int(length * 5)):
            along, across = rng.normal(0, length / 2.5), rng.normal(0, width / 2.5)
            x = cx + np.cos(angle) * along - np.sin(angle) * across
            y = cy + np.sin(angle) * along + np.cos(angle) * across
            size = rng.uniform(0.3, 0.9)
            draw_pale.ellipse((x - size, y - size, x + size, y + size), fill=int(rng.uniform(30, 90)))

    # Creases: long, gentle curves; a dark shadow line with a pale highlight just beside it
    for _ in range(9):
        angle = rng.uniform(0, np.pi)
        line = wobbly_line(rng.uniform(0, WIDTH), rng.uniform(0, HEIGHT), rng.uniform(250, 700), angle, rng.uniform(-25, 25))
        draw_dark.line(line, fill=80, width=2)
        draw_pale.line([(x + 2, y + 2) for x, y in line], fill=100, width=1)

    # Dust: little dark and pale specks
    for _ in range(450):
        x, y, size = rng.uniform(0, WIDTH), rng.uniform(0, HEIGHT), rng.uniform(0.4, 1.2)
        target = draw_dark if rng.random() < 0.6 else draw_pale
        target.ellipse((x - size, y - size, x + size, y + size), fill=int(rng.uniform(40, 100)))

    # Soften everything slightly so nothing looks pixel-sharp
    pale_a = np.asarray(pale.filter(ImageFilter.GaussianBlur(0.6)), dtype=float) / 255
    dark_a = np.asarray(dark.filter(ImageFilter.GaussianBlur(0.9)), dtype=float) / 255

    # Combine both layers into one see-through image
    alpha = 1 - (1 - pale_a) * (1 - dark_a)
    # Marks too faint to see are made fully see-through: the file compresses much smaller that way
    alpha[alpha < 0.03] = 0
    weight = np.where(alpha > 0, pale_a / np.maximum(pale_a + dark_a, 1e-6), 0)[..., None]
    rgb = weight * np.array(PALE) + (1 - weight) * np.array(DARK)
    rgba = np.dstack([rgb, alpha * 255]).round().astype("uint8")

    OUTPUT.parent.mkdir(exist_ok=True)
    Image.fromarray(rgba, "RGBA").save(OUTPUT, "WEBP", quality=75, method=6, alpha_quality=50)
    print(f"Saved {OUTPUT.name}: {OUTPUT.stat().st_size // 1024} KB")


if __name__ == "__main__":
    main()
