#!/usr/bin/env python3
"""Generates the PWA icon set: three valve caps on brass.

An authoring step, like tools/extract-glyphs.mjs — the output in public/icons/
is committed, so building the app needs neither Python nor Pillow.

    python3 tools/make-icons.py
"""

from pathlib import Path

from PIL import Image, ImageDraw

BRASS = (196, 138, 44)
BRASS_DARK = (150, 101, 26)
CAP = (255, 248, 231)
CAP_RIM = (120, 79, 18)

OUTPUT = Path(__file__).resolve().parent.parent / "public" / "icons"

# Supersampling factor; Pillow has no antialiased drawing, so everything is
# rendered large and scaled down.
SCALE = 8


def draw_icon(size: int, *, safe: float = 1.0, rounded: bool = True) -> Image.Image:
    """`safe` shrinks the artwork so maskable icons survive being cropped."""
    big = size * SCALE
    image = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)

    if rounded:
        draw.rounded_rectangle(
            [0, 0, big - 1, big - 1], radius=int(big * 0.22), fill=BRASS
        )
    else:
        draw.rectangle([0, 0, big - 1, big - 1], fill=BRASS)

    # A darker band across the lower half suggests the body of an instrument.
    draw.rounded_rectangle(
        [0, int(big * 0.66), big - 1, big - 1],
        radius=int(big * 0.22),
        fill=BRASS_DARK,
    )

    radius = big * 0.115 * safe
    spacing = big * 0.27 * safe
    centre_y = big * 0.44

    for index in (-1, 0, 1):
        centre_x = big / 2 + index * spacing
        draw.ellipse(
            [
                centre_x - radius,
                centre_y - radius,
                centre_x + radius,
                centre_y + radius,
            ],
            fill=CAP,
            outline=CAP_RIM,
            width=max(1, int(big * 0.012)),
        )

    return image.resize((size, size), Image.LANCZOS)


def main() -> None:
    OUTPUT.mkdir(parents=True, exist_ok=True)

    draw_icon(192).save(OUTPUT / "icon-192.png")
    draw_icon(512).save(OUTPUT / "icon-512.png")
    # Maskable icons are cropped to a platform-chosen shape, so the artwork is
    # inset and the background runs edge to edge.
    draw_icon(512, safe=0.72, rounded=False).save(OUTPUT / "icon-maskable-512.png")
    # iOS ignores the manifest and uses this instead.
    draw_icon(180).save(OUTPUT / "apple-touch-icon.png")

    print(f"Wrote icons to {OUTPUT}")


if __name__ == "__main__":
    main()
