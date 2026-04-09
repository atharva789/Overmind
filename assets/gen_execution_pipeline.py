"""
Generate a 25-second promotional video showing a single prompt's journey
through the full Overmind execution pipeline.

Renders 750 frames at 30fps (1920x1080), then encodes to MP4 via ffmpeg.
Run: python assets/gen_execution_pipeline.py
Output: assets/execution_pipeline.mp4
"""

import math
import os
import shutil
import subprocess
import tempfile
from dataclasses import dataclass
from typing import Optional

from PIL import Image, ImageDraw, ImageFont

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

WIDTH, HEIGHT = 1920, 1080
FPS = 30
DURATION_S = 25
TOTAL_FRAMES = FPS * DURATION_S  # 750

# Colors
BG = "#0a0a0f"
PANEL_BG = "#11111b"
PANEL_BORDER = "#1a1a2e"
CYAN = "#00d4ff"
PURPLE = "#8b5cf6"
RED = "#ff4444"
GREEN = "#22c55e"
YELLOW = "#fbbf24"
WHITE = "#e2e2e8"
DIM = "#555566"
DARK_TEXT = "#888899"
GLOW_GREEN = "#22c55e"

PARTY_CODE = "XKRF"
PROMPT_TEXT = "Add WebSocket heartbeat with 30s interval and auto-reconnect"

# ---------------------------------------------------------------------------
# Font helpers
# ---------------------------------------------------------------------------

_font_cache: dict[tuple[int, bool], ImageFont.FreeTypeFont] = {}

MONO_CANDIDATES = [
    "DejaVu Sans Mono",
    "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf",
    "/System/Library/Fonts/Menlo.ttc",
    "/System/Library/Fonts/SFMono-Regular.otf",
    "/System/Library/Fonts/Monaco.ttf",
    "Courier New",
    "Courier",
]

BOLD_CANDIDATES = [
    "/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf",
    "/System/Library/Fonts/Menlo.ttc",
    "/System/Library/Fonts/SFMono-Bold.otf",
    "Courier New Bold",
]


def _resolve_font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    key = (size, bold)
    if key in _font_cache:
        return _font_cache[key]
    candidates = BOLD_CANDIDATES if bold else MONO_CANDIDATES
    for name in candidates:
        try:
            f = ImageFont.truetype(name, size)
            _font_cache[key] = f
            return f
        except (OSError, IOError):
            continue
    f = ImageFont.load_default()
    _font_cache[key] = f
    return f


def font(size: int) -> ImageFont.FreeTypeFont:
    return _resolve_font(size, bold=False)


def font_bold(size: int) -> ImageFont.FreeTypeFont:
    return _resolve_font(size, bold=True)


# ---------------------------------------------------------------------------
# Drawing primitives
# ---------------------------------------------------------------------------


def hex_to_rgb(h: str) -> tuple[int, int, int]:
    h = h.lstrip("#")
    return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16))


def blend_color(c1: str, c2: str, t: float) -> str:
    """Linearly blend two hex colors."""
    r1, g1, b1 = hex_to_rgb(c1)
    r2, g2, b2 = hex_to_rgb(c2)
    t = max(0.0, min(1.0, t))
    r = int(r1 + (r2 - r1) * t)
    g = int(g1 + (g2 - g1) * t)
    b = int(b1 + (b2 - b1) * t)
    return f"#{r:02x}{g:02x}{b:02x}"


def ease_out(t: float) -> float:
    return 1 - (1 - max(0.0, min(1.0, t))) ** 3


def pulse(frame: int, period: int = 60) -> float:
    return 0.5 + 0.5 * math.sin(2 * math.pi * frame / period)


def typewriter(text: str, frame: int, start: int, cps: float = 0.8) -> str:
    elapsed = max(0, frame - start)
    n = int(elapsed * cps)
    return text[:n]


def draw_progress_bar(
    draw: ImageDraw.ImageDraw,
    x: int,
    y: int,
    w: int,
    h: int,
    progress: float,
    color: str = CYAN,
) -> None:
    draw.rounded_rectangle(
        [(x, y), (x + w, y + h)], radius=3, fill="#1a1a2e"
    )
    bar_w = max(0, int(w * min(1.0, progress)))
    if bar_w > 0:
        draw.rounded_rectangle(
            [(x, y), (x + bar_w, y + h)], radius=3, fill=color
        )


# ---------------------------------------------------------------------------
# Pipeline stage definitions
# ---------------------------------------------------------------------------


@dataclass
class Stage:
    name: str
    short: str
    activate_frame: int
    complete_frame: int
    color: str
    row: int
    col: int  # column position in its row


# Row 1: SUBMIT -> QUEUE -> SCOPE -> GREENLIGHT -> HOST APPROVAL
# Row 2: PLANNER -> SA1/SA2/SA3 -> EVALUATION -> FILE SYNC -> MERGE -> PR

ROW1_STAGES = [
    Stage("SUBMIT", "SUBMIT", 0, 50, CYAN, 0, 0),
    Stage("QUEUE", "QUEUE", 50, 100, CYAN, 0, 1),
    Stage("SCOPE", "SCOPE", 100, 180, CYAN, 0, 2),
    Stage("GREENLIGHT", "GREENLIGHT", 180, 230, GREEN, 0, 3),
    Stage("HOST APPROVAL", "APPROVAL", 230, 280, GREEN, 0, 4),
]

ROW2_STAGES = [
    Stage("PLANNER", "PLANNER", 280, 350, PURPLE, 1, 0),
    Stage("SUBAGENT 1", "SA-1", 350, 550, YELLOW, 1, 1),
    Stage("SUBAGENT 2", "SA-2", 350, 550, YELLOW, 1, 2),
    Stage("SUBAGENT 3", "SA-3", 350, 550, YELLOW, 1, 3),
    Stage("EVALUATION", "EVAL", 550, 620, PURPLE, 1, 4),
    Stage("FILE SYNC", "SYNC", 620, 670, CYAN, 1, 5),
    Stage("MERGE", "MERGE", 670, 710, GREEN, 1, 6),
    Stage("PR", "PR", 710, 750, GREEN, 1, 7),
]

ALL_STAGES = ROW1_STAGES + ROW2_STAGES

# Layout constants for stage cards
CARD_W = 180
CARD_H = 100
CARD_PAD = 16
ROW1_Y = 220
ROW2_Y = 500

# Subagent tool call sequences
SA_TOOL_CALLS = {
    "SA-1": [
        (0.0, "read_file src/server/ws.ts"),
        (0.3, "write_file src/server/heartbeat.ts"),
        (0.7, ">> creating heartbeat module..."),
    ],
    "SA-2": [
        (0.0, "read_file src/client/session.ts"),
        (0.4, "write_file src/client/session.ts"),
        (0.7, ">> adding reconnect logic..."),
    ],
    "SA-3": [
        (0.0, "read_file src/shared/constants.ts"),
        (0.3, "write_file src/shared/constants.ts"),
        (0.6, "read_file src/shared/protocol.ts"),
        (0.8, ">> updating types..."),
    ],
}

# Scope extraction files
SCOPE_FILES = [
    "src/server/heartbeat.ts",
    "src/client/session.ts",
    "src/shared/constants.ts",
]

# Planner subtasks
PLANNER_TASKS = [
    "Create heartbeat module",
    "Add client reconnect logic",
    "Update constants and types",
]


# ---------------------------------------------------------------------------
# Card rendering
# ---------------------------------------------------------------------------


def get_row_x_positions(n_cards: int, y: int) -> list[int]:
    """Calculate x positions to center n cards in a row."""
    total_w = n_cards * CARD_W + (n_cards - 1) * CARD_PAD
    start_x = (WIDTH - total_w) // 2
    return [start_x + i * (CARD_W + CARD_PAD) for i in range(n_cards)]


def get_stage_status(stage: Stage, frame: int) -> str:
    if frame < stage.activate_frame:
        return "inactive"
    if frame < stage.complete_frame:
        return "active"
    return "complete"


def draw_card(
    draw: ImageDraw.ImageDraw,
    x: int,
    y: int,
    stage: Stage,
    frame: int,
) -> None:
    status = get_stage_status(stage, frame)

    # Determine card styling
    if status == "inactive":
        border_color = PANEL_BORDER
        fill_color = PANEL_BG
        title_color = DIM
    elif status == "active":
        p = pulse(frame, 40)
        border_color = stage.color
        fill_color = blend_color(PANEL_BG, stage.color, 0.08 + 0.04 * p)
        title_color = stage.color
    else:  # complete
        border_color = GREEN
        fill_color = blend_color(PANEL_BG, GREEN, 0.06)
        title_color = GREEN

    # Draw card
    draw.rounded_rectangle(
        [(x, y), (x + CARD_W, y + CARD_H)],
        radius=8,
        fill=fill_color,
        outline=border_color,
        width=2 if status == "active" else 1,
    )

    # Title
    draw.text(
        (x + 10, y + 8),
        stage.short,
        fill=title_color,
        font=font_bold(13),
    )

    # Checkmark for complete
    if status == "complete":
        draw.text(
            (x + CARD_W - 24, y + 8),
            "v",
            fill=GREEN,
            font=font_bold(14),
        )

    # Active indicator dot
    if status == "active":
        dot_r = 4
        dot_x = x + CARD_W - 16
        dot_y = y + 14
        dot_alpha = pulse(frame, 30)
        draw.ellipse(
            [
                (dot_x - dot_r, dot_y - dot_r),
                (dot_x + dot_r, dot_y + dot_r),
            ],
            fill=stage.color,
        )


def draw_arrow(
    draw: ImageDraw.ImageDraw,
    x1: int,
    y1: int,
    x2: int,
    y2: int,
    active: bool = False,
) -> None:
    color = CYAN if active else PANEL_BORDER
    draw.line([(x1, y1), (x2, y2)], fill=color, width=2)
    # arrowhead
    dx = x2 - x1
    dy = y2 - y1
    length = max(1, math.sqrt(dx * dx + dy * dy))
    ux, uy = dx / length, dy / length
    arrow_len = 8
    px, py = -uy, ux
    draw.polygon(
        [
            (x2, y2),
            (x2 - arrow_len * ux + arrow_len * 0.4 * px, y2 - arrow_len * uy + arrow_len * 0.4 * py),
            (x2 - arrow_len * ux - arrow_len * 0.4 * px, y2 - arrow_len * uy - arrow_len * 0.4 * py),
        ],
        fill=color,
    )


# ---------------------------------------------------------------------------
# Render a single frame
# ---------------------------------------------------------------------------


def render_frame(frame: int) -> Image.Image:
    img = Image.new("RGB", (WIDTH, HEIGHT), BG)
    draw = ImageDraw.Draw(img)

    # ---- Top bar ----
    draw.rectangle([(0, 0), (WIDTH, 48)], fill=PANEL_BG)
    draw.line([(0, 48), (WIDTH, 48)], fill=PANEL_BORDER, width=1)

    title = "OVERMIND EXECUTION PIPELINE"
    draw.text((20, 14), title, fill=CYAN, font=font_bold(18))

    draw.text(
        (WIDTH - 200, 16),
        f"PARTY: {PARTY_CODE}",
        fill=DIM,
        font=font(14),
    )

    # ---- Prompt display ----
    prompt_y = 70
    draw.text(
        (40, prompt_y), "PROMPT:", fill=DIM, font=font_bold(12)
    )
    visible_prompt = typewriter(PROMPT_TEXT, frame, 0, 1.2)
    draw.text(
        (140, prompt_y),
        f'"{visible_prompt}"',
        fill=WHITE,
        font=font(14),
    )
    draw.text(
        (40, prompt_y + 24),
        "@alice  --  complexity: moderate",
        fill=DARK_TEXT,
        font=font(11),
    )

    # ---- Row 1 cards ----
    row1_positions = get_row_x_positions(len(ROW1_STAGES), ROW1_Y)
    for i, stage in enumerate(ROW1_STAGES):
        x = row1_positions[i]
        draw_card(draw, x, ROW1_Y, stage, frame)

        # Stage-specific content inside card
        status = get_stage_status(stage, frame)
        cy = ROW1_Y + 32  # content y inside card

        if stage.short == "SUBMIT" and status != "inactive":
            draw.text(
                (x + 10, cy), "@alice", fill=CYAN, font=font(10)
            )
            draw.text(
                (x + 10, cy + 16), "heartbeat + reconnect", fill=DIM, font=font(9)
            )

        elif stage.short == "QUEUE" and status != "inactive":
            draw.text(
                (x + 10, cy), "Position: 1/1", fill=WHITE, font=font(11)
            )
            draw.text(
                (x + 10, cy + 18), "FIFO order", fill=DIM, font=font(9)
            )

        elif stage.short == "SCOPE" and status != "inactive":
            for fi, fname in enumerate(SCOPE_FILES):
                show_frame = stage.activate_frame + fi * 20
                if frame >= show_frame:
                    visible_name = typewriter(fname, frame, show_frame, 1.0)
                    draw.text(
                        (x + 10, cy + fi * 14),
                        visible_name,
                        fill=CYAN if status == "active" else DIM,
                        font=font(9),
                    )

        elif stage.short == "GREENLIGHT":
            if status != "inactive":
                if status == "active":
                    draw.text(
                        (x + 10, cy),
                        "Analyzing safety...",
                        fill=YELLOW,
                        font=font(10),
                    )
                else:
                    draw.text(
                        (x + 10, cy),
                        "Safe",
                        fill=GREEN,
                        font=font(10),
                    )
                    draw.text(
                        (x + 10, cy + 16),
                        "No destructive ops",
                        fill=DIM,
                        font=font(9),
                    )

        elif stage.short == "APPROVAL":
            if status == "active":
                draw.text(
                    (x + 10, cy),
                    "Awaiting host...",
                    fill=YELLOW,
                    font=font(10),
                )
            elif status == "complete":
                draw.text(
                    (x + 10, cy),
                    "Host approved",
                    fill=GREEN,
                    font=font(10),
                )

        # Draw arrows between row 1 cards
        if i < len(ROW1_STAGES) - 1:
            arrow_active = frame >= ROW1_STAGES[i + 1].activate_frame
            ax1 = x + CARD_W + 2
            ax2 = row1_positions[i + 1] - 2
            ay = ROW1_Y + CARD_H // 2
            draw_arrow(draw, ax1, ay, ax2, ay, arrow_active)

    # ---- Arrow from row 1 to row 2 ----
    row2_positions = get_row_x_positions(len(ROW2_STAGES), ROW2_Y)
    r1_last_x = row1_positions[-1] + CARD_W // 2
    r2_first_x = row2_positions[0] + CARD_W // 2
    mid_y = (ROW1_Y + CARD_H + ROW2_Y) // 2
    if frame >= ROW2_STAGES[0].activate_frame:
        # Vertical down from last row1, horizontal, vertical down to first row2
        draw.line(
            [(r1_last_x, ROW1_Y + CARD_H), (r1_last_x, mid_y)],
            fill=CYAN, width=2,
        )
        draw.line(
            [(r1_last_x, mid_y), (r2_first_x, mid_y)],
            fill=CYAN, width=2,
        )
        draw_arrow(draw, r2_first_x, mid_y, r2_first_x, ROW2_Y - 2, True)

    # ---- Row 2 cards ----
    for i, stage in enumerate(ROW2_STAGES):
        x = row2_positions[i]
        draw_card(draw, x, ROW2_Y, stage, frame)

        status = get_stage_status(stage, frame)
        cy = ROW2_Y + 32

        if stage.short == "PLANNER" and status != "inactive":
            for ti, task in enumerate(PLANNER_TASKS):
                task_frame = stage.activate_frame + ti * 18
                if frame >= task_frame:
                    txt = typewriter(task, frame, task_frame, 0.8)
                    tc = PURPLE if status == "active" else DIM
                    draw.text(
                        (x + 10, cy + ti * 14),
                        f"{ti + 1}. {txt}",
                        fill=tc,
                        font=font(9),
                    )

        elif stage.short in SA_TOOL_CALLS and status != "inactive":
            calls = SA_TOOL_CALLS[stage.short]
            sa_duration = stage.complete_frame - stage.activate_frame
            for ci, (t_pct, call_text) in enumerate(calls):
                call_frame = stage.activate_frame + int(t_pct * sa_duration)
                if frame >= call_frame:
                    is_thinking = call_text.startswith(">>")
                    tc = YELLOW if is_thinking else CYAN
                    if status == "complete":
                        tc = DIM
                    icon = "" if is_thinking else ("+" if "write" in call_text else "~")
                    label = call_text if is_thinking else f"{icon} {call_text.split()[-1]}"
                    # Truncate to fit card
                    max_chars = 20
                    if len(label) > max_chars:
                        label = label[: max_chars - 1] + "."
                    draw.text(
                        (x + 10, cy + ci * 14),
                        label,
                        fill=tc,
                        font=font(9),
                    )

            # progress bar
            if status == "active":
                prog = (frame - stage.activate_frame) / max(
                    1, sa_duration
                )
                draw_progress_bar(
                    draw, x + 10, ROW2_Y + CARD_H - 16, CARD_W - 20, 6, prog, YELLOW
                )
            elif status == "complete":
                draw_progress_bar(
                    draw, x + 10, ROW2_Y + CARD_H - 16, CARD_W - 20, 6, 1.0, GREEN
                )

        elif stage.short == "EVAL" and status != "inactive":
            if status == "active":
                draw.text(
                    (x + 10, cy),
                    "Reviewing changes...",
                    fill=PURPLE,
                    font=font(10),
                )
            else:
                draw.text(
                    (x + 10, cy),
                    "All changes reviewed",
                    fill=GREEN,
                    font=font(10),
                )
                draw.text(
                    (x + 10, cy + 16),
                    "Result: finish",
                    fill=DIM,
                    font=font(9),
                )

        elif stage.short == "SYNC" and status != "inactive":
            if status == "active":
                sync_prog = (frame - stage.activate_frame) / max(
                    1, stage.complete_frame - stage.activate_frame
                )
                draw.text(
                    (x + 10, cy),
                    f"Syncing {int(sync_prog * 3)}/3 files...",
                    fill=CYAN,
                    font=font(10),
                )
            else:
                draw.text(
                    (x + 10, cy),
                    "3 files synced",
                    fill=GREEN,
                    font=font(10),
                )
                draw.text(
                    (x + 10, cy + 16),
                    "to host disk",
                    fill=DIM,
                    font=font(9),
                )

        elif stage.short == "MERGE" and status != "inactive":
            if status == "active":
                draw.text(
                    (x + 10, cy),
                    "Checking conflicts...",
                    fill=GREEN,
                    font=font(10),
                )
            else:
                draw.text(
                    (x + 10, cy),
                    "No conflicts",
                    fill=GREEN,
                    font=font(10),
                )
                draw.text(
                    (x + 10, cy + 16),
                    "Clean merge",
                    fill=DIM,
                    font=font(9),
                )

        elif stage.short == "PR":
            if status == "active":
                draw.text(
                    (x + 10, cy),
                    "Opening PR...",
                    fill=GREEN,
                    font=font(10),
                )
            elif status == "complete":
                draw.text(
                    (x + 10, cy),
                    "PR #43 opened",
                    fill=GREEN,
                    font=font_bold(10),
                )
                draw.text(
                    (x + 10, cy + 16),
                    f"overmind/{PARTY_CODE}",
                    fill=DIM,
                    font=font(9),
                )

        # Draw arrows between row 2 cards
        if i < len(ROW2_STAGES) - 1:
            next_stage = ROW2_STAGES[i + 1]
            arrow_active = frame >= next_stage.activate_frame
            ax1 = x + CARD_W + 2
            ax2 = row2_positions[i + 1] - 2
            ay = ROW2_Y + CARD_H // 2
            draw_arrow(draw, ax1, ay, ax2, ay, arrow_active)

    # ---- Bottom status line ----
    status_y = HEIGHT - 50
    draw.rectangle([(0, status_y - 4), (WIDTH, HEIGHT)], fill=PANEL_BG)
    draw.line([(0, status_y - 4), (WIDTH, status_y - 4)], fill=PANEL_BORDER)

    # Find current active stage
    current_stage_name = "Idle"
    for s in ALL_STAGES:
        if s.activate_frame <= frame < s.complete_frame:
            current_stage_name = s.name
            break
    if frame >= ALL_STAGES[-1].complete_frame:
        current_stage_name = "Complete"

    draw.text(
        (20, status_y + 6),
        f"Stage: {current_stage_name}",
        fill=CYAN,
        font=font(12),
    )

    elapsed_s = frame / FPS
    draw.text(
        (WIDTH - 140, status_y + 6),
        f"T+{elapsed_s:05.1f}s",
        fill=DIM,
        font=font(12),
    )

    # active file count
    files_done = 0
    if frame >= 670:
        files_done = 3
    elif frame >= 620:
        files_done = int(3 * (frame - 620) / 50)
    draw.text(
        (WIDTH // 2 - 60, status_y + 6),
        f"Files: {files_done}/3",
        fill=WHITE,
        font=font(12),
    )

    # ---- Thinking bubbles for subagents ----
    if 380 <= frame <= 530:
        thinking_texts = [
            "parsing WebSocket handlers...",
            "resolving session lifecycle...",
            "checking type exports...",
        ]
        sa_stages = [s for s in ROW2_STAGES if s.short.startswith("SA-")]
        for si, sa in enumerate(sa_stages):
            if get_stage_status(sa, frame) != "active":
                continue
            bx = row2_positions[ROW2_STAGES.index(sa)]
            by = ROW2_Y + CARD_H + 16
            # Cycle through thinking texts
            t_idx = (si + frame // 45) % len(thinking_texts)
            blink = "" if (frame // 12) % 2 == 0 else "_"
            draw.text(
                (bx + 10, by),
                f">> {thinking_texts[t_idx]}{blink}",
                fill=YELLOW,
                font=font(9),
            )

    # ---- Final glow effect on PR card ----
    if frame >= 720:
        pr_stage = ROW2_STAGES[-1]
        pr_x = row2_positions[ROW2_STAGES.index(pr_stage)]
        glow_intensity = min(1.0, (frame - 720) / 20)
        glow_color = blend_color(PANEL_BORDER, GREEN, glow_intensity * 0.3)
        for offset in range(3, 0, -1):
            draw.rounded_rectangle(
                [
                    (pr_x - offset * 2, ROW2_Y - offset * 2),
                    (pr_x + CARD_W + offset * 2, ROW2_Y + CARD_H + offset * 2),
                ],
                radius=8 + offset,
                outline=glow_color,
                width=1,
            )

    return img


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def main() -> None:
    script_dir = os.path.dirname(os.path.abspath(__file__))
    output_path = os.path.join(script_dir, "execution_pipeline.mp4")
    tmp_dir = tempfile.mkdtemp(prefix="overmind_pipeline_")

    print(f"Rendering {TOTAL_FRAMES} frames to {tmp_dir}...")
    try:
        for f_idx in range(TOTAL_FRAMES):
            img = render_frame(f_idx)
            img.save(os.path.join(tmp_dir, f"frame_{f_idx:04d}.png"))
            if (f_idx + 1) % 75 == 0:
                pct = (f_idx + 1) / TOTAL_FRAMES * 100
                print(f"  {pct:5.1f}% ({f_idx + 1}/{TOTAL_FRAMES})")

        print("Encoding video with ffmpeg...")
        cmd = [
            "ffmpeg",
            "-y",
            "-framerate",
            str(FPS),
            "-i",
            os.path.join(tmp_dir, "frame_%04d.png"),
            "-c:v",
            "libx264",
            "-crf",
            "18",
            "-pix_fmt",
            "yuv420p",
            output_path,
        ]
        subprocess.run(cmd, check=True, capture_output=True)
        print(f"Video saved to {output_path}")
    finally:
        print(f"Cleaning up {tmp_dir}...")
        shutil.rmtree(tmp_dir, ignore_errors=True)


if __name__ == "__main__":
    main()
