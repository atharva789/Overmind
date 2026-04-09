"""
Generate the Overmind banner image (1600x400) for the README.
Dark gradient background with "OVERMIND" text and subtitle.

Usage: python assets/gen_banner.py
Output: assets/overmind-banner.png
"""

from pathlib import Path
import sys

try:
    from PIL import Image, ImageDraw, ImageFont
except ImportError:
    print("Install Pillow: pip install Pillow")
    sys.exit(1)

WIDTH, HEIGHT = 1600, 400
BG_COLOR = (10, 10, 15)
CYAN = (0, 212, 255)
PURPLE = (139, 92, 246)
WHITE = (255, 255, 255)
GRAY = (148, 163, 184)

FONT_PATHS = [
    "/System/Library/Fonts/SFMono-Bold.otf",
    "/System/Library/Fonts/Menlo.ttc",
    "/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf",
    "/usr/share/fonts/TTF/DejaVuSansMono-Bold.ttf",
]

FONT_PATHS_REGULAR = [
    "/System/Library/Fonts/SFMono-Regular.otf",
    "/System/Library/Fonts/Menlo.ttc",
    "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf",
    "/usr/share/fonts/TTF/DejaVuSansMono.ttf",
]


def load_font(paths: list[str], size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    for p in paths:
        try:
            return ImageFont.truetype(p, size)
        except (OSError, IOError):
            continue
    return ImageFont.load_default()


def lerp_color(c1: tuple[int, ...], c2: tuple[int, ...], t: float) -> tuple[int, ...]:
    return tuple(int(a + (b - a) * t) for a, b in zip(c1, c2))


def main() -> None:
    img = Image.new("RGB", (WIDTH, HEIGHT), BG_COLOR)
    draw = ImageDraw.Draw(img)

    # Gradient background (subtle horizontal gradient)
    for x in range(WIDTH):
        t = x / WIDTH
        color = lerp_color((10, 10, 25), (15, 10, 30), t)
        draw.line([(x, 0), (x, HEIGHT)], fill=color)

    # Dot grid pattern
    for x in range(0, WIDTH, 30):
        for y in range(0, HEIGHT, 30):
            alpha = 20
            draw.ellipse(
                [x - 1, y - 1, x + 1, y + 1],
                fill=(255, 255, 255, alpha) if img.mode == "RGBA" else (30, 30, 45),
            )

    # Glow effect behind title
    glow_font = load_font(FONT_PATHS, 90)
    title = "OVERMIND"
    bbox = draw.textbbox((0, 0), title, font=glow_font)
    tw = bbox[2] - bbox[0]
    tx = (WIDTH - tw) // 2
    ty = 100

    # Draw glow layers
    for offset in range(12, 0, -2):
        glow_color = (0, 212 // 4, 255 // 4)
        draw.text(
            (tx - offset, ty), title, fill=glow_color, font=glow_font,
        )
        draw.text(
            (tx + offset, ty), title, fill=glow_color, font=glow_font,
        )

    # Main title with gradient (approximate: left=cyan, right=purple)
    # Since PIL doesn't support gradient text natively, draw in cyan
    draw.text((tx, ty), title, fill=CYAN, font=glow_font)

    # Subtitle
    sub_font = load_font(FONT_PATHS_REGULAR, 28)
    subtitle = "The Multiplayer AI Coding Terminal"
    sub_bbox = draw.textbbox((0, 0), subtitle, font=sub_font)
    sub_w = sub_bbox[2] - sub_bbox[0]
    draw.text(
        ((WIDTH - sub_w) // 2, ty + 110),
        subtitle,
        fill=GRAY,
        font=sub_font,
    )

    # Tagline
    tag_font = load_font(FONT_PATHS_REGULAR, 18)
    tagline = "One session. Multiple developers. One AI pipeline. Zero merge conflicts."
    tag_bbox = draw.textbbox((0, 0), tagline, font=tag_font)
    tag_w = tag_bbox[2] - tag_bbox[0]
    draw.text(
        ((WIDTH - tag_w) // 2, ty + 155),
        tagline,
        fill=(100, 116, 139),
        font=tag_font,
    )

    # Decorative line
    line_y = ty + 200
    line_w = 300
    draw.line(
        [(WIDTH // 2 - line_w, line_y), (WIDTH // 2 + line_w, line_y)],
        fill=CYAN,
        width=1,
    )

    # Save
    out_path = Path(__file__).parent / "overmind-banner.png"
    img.save(str(out_path), "PNG")
    print(f"Banner saved to {out_path}")


if __name__ == "__main__":
    main()
