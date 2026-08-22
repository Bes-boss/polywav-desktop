"""Generate the Polywav desktop icon (ICO for win build).

Design language mirrors the app palette: warm dark page, tomato accent,
gold secondary — a simple waveform mark. Idempotent: overwrites buildres/icon.ico.
"""
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "buildres" / "icon.ico"

PAGE = (31, 28, 25, 255)       # --page #1f1c19
TOMATO = (208, 113, 79, 255)   # --tomato #d0714f
GOLD = (200, 169, 110, 255)    # --gold #c8a96e
INK = (242, 236, 227, 255)     # --ink #f2ece2


def rounded_bg(size):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    r = max(4, size // 5)
    d.rounded_rectangle([0, 0, size - 1, size - 1], radius=r, fill=PAGE)
    return img, d


def draw_bars(d, size):
    """Five waveform bars, center-weighted heights, tomato/gold alternation."""
    n = 5
    bar_w = size // 9
    gap = (size - n * bar_w) // (n + 1)
    heights = [0.35, 0.62, 0.85, 0.55, 0.30]
    colors = [GOLD, TOMATO, INK, TOMATO, GOLD]
    x = gap
    cy = size / 2
    for h, c in zip(heights, colors):
        bh = int(size * h)
        d.rounded_rectangle(
            [x, int(cy - bh / 2), x + bar_w, int(cy + bh / 2)],
            radius=bar_w // 3,
            fill=c,
        )
        x += bar_w + gap


def main():
    base = 256
    master, d = rounded_bg(base)
    draw_bars(d, base)

    OUT.parent.mkdir(parents=True, exist_ok=True)
    master.save(str(OUT), format="ICO",
                sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
    print(f"wrote {OUT}")


if __name__ == "__main__":
    main()
