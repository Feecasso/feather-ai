#!/usr/bin/env python3
"""Generate the Feather AI icon set (PNG + Windows ICO).

Run from the project root:
    uv run --with pillow python scripts/make_icons.py

The mark is a white quill feather with a navy outline and a bold navy "F".
Everything is drawn at 4x and downsampled for clean small sizes.
"""
from __future__ import annotations

import math
import os
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
ASSETS = ROOT / "assets"
BUILD = ROOT / "build"
NAVY = (0, 0, 128, 255)
WHITE = (255, 255, 255, 255)
GRAY = (192, 192, 192, 255)
DARK = (32, 32, 32, 255)

S = 4  # supersample factor
SIZE = 1024


def find_font() -> str:
    candidates = [
        "/usr/share/fonts/TTF/DejaVuSans-Bold.ttf",
        "/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/usr/share/fonts/liberation/LiberationSans-Bold.ttf",
        "C:/Windows/Fonts/arialbd.ttf",
    ]
    for path in candidates:
        if os.path.exists(path):
            return path
    raise SystemExit("No bold sans font found. Install DejaVu Sans or edit find_font().")


def rotated(points: list[tuple[float, float]], angle: float, origin=(512, 512)):
    """Rotate points around origin."""
    a = math.radians(angle)
    ox, oy = origin
    out = []
    for x, y in points:
        dx, dy = x - ox, y - oy
        out.append((ox + dx * math.cos(a) - dy * math.sin(a), oy + dx * math.sin(a) + dy * math.cos(a)))
    return out


def feather_polygon() -> list[tuple[float, float]]:
    """A simple quill silhouette pointing up and to the right."""
    left: list[tuple[float, float]] = []
    right: list[tuple[float, float]] = []
    steps = 90
    for i in range(steps + 1):
        t = i / steps
        # Narrow at the quill base, widest around 35%, sharp at the tip.
        width = 150 * (math.sin(math.pi * min(1.0, (t + 0.04) * 0.98)) ** 0.75) * (1.0 - 0.35 * t)
        x = 330 + (760 - 330) * t
        y = 760 + (220 - 760) * t
        # perpendicular
        left.append((x + width, y + width * 0.62))
        right.append((x - width, y - width * 0.62))
    return left + list(reversed(right))


def barbs(draw: ImageDraw.ImageDraw) -> None:
    """A few engraved barb lines so the feather reads at medium sizes."""
    for i in range(8):
        t = 0.18 + i * 0.08
        x = 330 + (760 - 330) * t
        y = 760 + (220 - 760) * t
        w = 120 * (1.0 - t * 0.55)
        draw.line([(x, y), (x - w * 0.9, y + w * 0.2)], fill=(210, 218, 235, 255), width=6 * S)
        draw.line([(x, y), (x + w * 0.4, y - w * 0.95)], fill=(210, 218, 235, 255), width=6 * S)


def make_master() -> Image.Image:
    img = Image.new("RGBA", (SIZE * S, SIZE * S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    poly = [(x * S, y * S) for x, y in feather_polygon()]

    # Soft drop shadow for the icon on light surfaces.
    shadow = [(x + 10 * S, y + 12 * S) for x, y in poly]
    d.polygon(shadow, fill=(0, 0, 0, 55))

    d.polygon(poly, fill=WHITE, outline=NAVY, width=18 * S)
    # Quill shaft.
    d.line([(335 * S, 745 * S), (748 * S, 250 * S)], fill=NAVY, width=16 * S)
    barbs(d)

    # Feather-shaped F: a bold navy F with a white halo sits over the quill.
    font = ImageFont.truetype(find_font(), 470 * S)
    bbox = d.textbbox((0, 0), "F", font=font, stroke_width=22 * S)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    tx = 512 * S - tw / 2 - bbox[0]
    ty = 512 * S - th / 2 - bbox[1]
    d.text((tx, ty), "F", font=font, fill=NAVY, stroke_width=22 * S, stroke_fill=WHITE)

    return img.resize((SIZE, SIZE), Image.LANCZOS)


def main() -> None:
    ASSETS.mkdir(exist_ok=True)
    BUILD.mkdir(exist_ok=True)
    (BUILD / "icons").mkdir(exist_ok=True)

    master = make_master()
    master.save(ASSETS / "feather-ai-1024.png")
    master.save(BUILD / "icon.png")

    for size in (1024, 512, 256, 128, 64, 48, 32, 24, 16):
        resized = master.resize((size, size), Image.LANCZOS)
        resized.save(ASSETS / f"feather-ai-{size}.png")
        if size in (16, 24, 32, 48, 64, 128, 256, 512):
            resized.save(BUILD / "icons" / f"{size}x{size}.png")

    sizes = [(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
    master.save(BUILD / "icon.ico", sizes=sizes)
    # A small copy used inside the custom title bar.
    master.resize((32, 32), Image.LANCZOS).save(ASSETS / "feather-ai-title.png")
    print("Wrote icon assets to assets/ and build/")


if __name__ == "__main__":
    main()
