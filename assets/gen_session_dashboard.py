"""
Generate a 30-second promotional video of a live Overmind session dashboard.

Renders 900 frames at 30fps (1920x1080), then encodes to MP4 via ffmpeg.
Run: python assets/gen_session_dashboard.py
Output: assets/session_dashboard.mp4
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
DURATION_S = 30
TOTAL_FRAMES = FPS * DURATION_S  # 900

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

# Overmind constants
PARTY_CODE = "XKRF"
MAX_MEMBERS = 8

# ---------------------------------------------------------------------------
# Font helpers
# ---------------------------------------------------------------------------

_font_cache: dict[tuple[int, bool], ImageFont.FreeTypeFont] = {}

MONO_CANDIDATES = [
    "DejaVu Sans Mono",
    "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf",
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
            font = ImageFont.truetype(name, size)
            _font_cache[key] = font
            return font
        except (OSError, IOError):
            continue
    font = ImageFont.load_default()
    _font_cache[key] = font
    return font


def font(size: int) -> ImageFont.FreeTypeFont:
    return _resolve_font(size, bold=False)


def font_bold(size: int) -> ImageFont.FreeTypeFont:
    return _resolve_font(size, bold=True)


# ---------------------------------------------------------------------------
# Drawing primitives
# ---------------------------------------------------------------------------


def draw_panel(
    draw: ImageDraw.ImageDraw,
    x: int,
    y: int,
    w: int,
    h: int,
    title: str,
    accent: str = CYAN,
) -> int:
    """Draw a rounded-corner panel and return the y position below the title."""
    draw.rounded_rectangle(
        [(x, y), (x + w, y + h)], radius=8, fill=PANEL_BG, outline=PANEL_BORDER
    )
    # title bar
    draw.rounded_rectangle(
        [(x, y), (x + w, y + 32)], radius=8, fill=PANEL_BORDER
    )
    draw.rectangle([(x, y + 20), (x + w, y + 32)], fill=PANEL_BORDER)
    draw.text((x + 12, y + 7), title, fill=accent, font=font_bold(14))
    return y + 40


def draw_status_dot(
    draw: ImageDraw.ImageDraw, x: int, y: int, color: str, radius: int = 5
) -> None:
    draw.ellipse(
        [(x - radius, y - radius), (x + radius, y + radius)], fill=color
    )


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


def draw_badge(
    draw: ImageDraw.ImageDraw,
    x: int,
    y: int,
    text: str,
    bg_color: str,
    text_color: str = "#000000",
) -> int:
    """Draw a small badge and return the x position after the badge."""
    f = font(11)
    bbox = f.getbbox(text)
    tw = bbox[2] - bbox[0] + 12
    th = 18
    draw.rounded_rectangle(
        [(x, y), (x + tw, y + th)], radius=4, fill=bg_color
    )
    draw.text((x + 6, y + 2), text, fill=text_color, font=f)
    return x + tw + 6


# ---------------------------------------------------------------------------
# Data model
# ---------------------------------------------------------------------------


@dataclass
class Member:
    name: str
    color: str
    join_frame: int
    status: str = "idle"


@dataclass
class PromptEntry:
    user: str
    text: str
    submit_frame: int
    status: str = "queued"
    files_affected: int = 0
    pr_number: Optional[int] = None
    tasks: int = 0
    completed_tasks: int = 0


MEMBERS = [
    Member("alice", CYAN, 20),
    Member("bob", PURPLE, 40),
    Member("charlie", GREEN, 60),
    Member("host", YELLOW, 0),
]

PROMPTS = [
    PromptEntry(
        "alice",
        "Add rate limiting to API routes",
        submit_frame=100,
        files_affected=4,
        pr_number=42,
        tasks=3,
    ),
    PromptEntry(
        "bob",
        "Refactor auth to JWT",
        submit_frame=460,
        files_affected=3,
        pr_number=43,
        tasks=2,
    ),
]

STORY_FEATURES = [
    ("Rate Limiting", CYAN, 360),
    ("Auth Refactor", PURPLE, 700),
]

# ---------------------------------------------------------------------------
# Frame-level animation helpers
# ---------------------------------------------------------------------------


def visible_members(frame: int) -> list[Member]:
    return [m for m in MEMBERS if frame >= m.join_frame]


def lerp(a: float, b: float, t: float) -> float:
    return a + (b - a) * min(1.0, max(0.0, t))


def ease_out(t: float) -> float:
    return 1 - (1 - min(1.0, max(0.0, t))) ** 3


def pulse(frame: int, period: int = 60) -> float:
    return 0.5 + 0.5 * math.sin(2 * math.pi * frame / period)


def typewriter(text: str, frame: int, start: int, chars_per_frame: float = 0.8) -> str:
    elapsed = max(0, frame - start)
    n = int(elapsed * chars_per_frame)
    return text[:n]


def get_prompt_status(p: PromptEntry, frame: int) -> str:
    """Determine prompt status based on frame number."""
    sf = p.submit_frame
    if frame < sf:
        return "hidden"
    if frame < sf + 30:
        return "queued"
    if frame < sf + 60:
        return "greenlit"
    if frame < sf + 80:
        return "approved"
    if frame < sf + 200:
        return "executing"
    if frame < sf + 260:
        return "merging"
    return "complete"


STATUS_COLORS = {
    "queued": DIM,
    "greenlit": CYAN,
    "approved": GREEN,
    "executing": YELLOW,
    "merging": PURPLE,
    "complete": GREEN,
}

STATUS_LABELS = {
    "queued": "QUEUED",
    "greenlit": "GREENLIT",
    "approved": "APPROVED",
    "executing": "EXECUTING",
    "merging": "MERGING",
    "complete": "COMPLETE",
}

# Execution task definitions per prompt
EXEC_TASKS = {
    0: [
        ("Parse route definitions", ["read_file src/routes/api.ts", "read_file src/middleware/index.ts"]),
        ("Create rate limiter", ["write_file src/middleware/rate-limit.ts", "read_file src/utils/cache.ts"]),
        ("Wire middleware", ["write_file src/routes/api.ts", "write_file src/server/index.ts"]),
    ],
    1: [
        ("Extract JWT helpers", ["read_file src/auth/session.ts", "write_file src/auth/jwt.ts"]),
        ("Migrate token flow", ["write_file src/auth/session.ts", "write_file src/client/auth.ts"]),
    ],
}


# ---------------------------------------------------------------------------
# Render a single frame
# ---------------------------------------------------------------------------


def render_frame(frame: int) -> Image.Image:
    img = Image.new("RGB", (WIDTH, HEIGHT), BG)
    draw = ImageDraw.Draw(img)

    # ---- Top bar ----
    draw.rectangle([(0, 0), (WIDTH, 48)], fill=PANEL_BG)
    draw.line([(0, 48), (WIDTH, 48)], fill=PANEL_BORDER, width=1)

    # Title
    title = f"OVERMIND SESSION  --  PARTY: {PARTY_CODE}"
    draw.text((20, 14), title, fill=CYAN, font=font_bold(18))

    # Member count
    n_members = len(visible_members(frame))
    mc_text = f"{n_members}/{MAX_MEMBERS} MEMBERS"
    draw.text((600, 16), mc_text, fill=WHITE, font=font(14))

    # Uptime
    seconds = frame / FPS
    mm, ss = divmod(int(seconds), 60)
    uptime_text = f"UPTIME {mm:02d}:{ss:02d}"
    draw.text((WIDTH - 180, 16), uptime_text, fill=DIM, font=font(14))

    # Port
    draw.text((WIDTH - 380, 16), "PORT 4444", fill=DIM, font=font(14))

    # ---- Layout dimensions ----
    top = 60
    panel_h = HEIGHT - top - 16
    left_w = int(WIDTH * 0.38)
    right_w = int(WIDTH * 0.20)
    center_w = WIDTH - left_w - right_w - 48

    lx = 12
    cx = lx + left_w + 12
    rx = cx + center_w + 12

    # ---- Left panel: PROMPT QUEUE ----
    content_y = draw_panel(draw, lx, top, left_w, panel_h, "PROMPT QUEUE", CYAN)

    for i, p in enumerate(PROMPTS):
        status = get_prompt_status(p, frame)
        if status == "hidden":
            continue
        py = content_y + i * 110
        if py + 100 > top + panel_h:
            break

        member_color = next(
            (m.color for m in MEMBERS if m.name == p.user), WHITE
        )

        # user label
        draw.text((lx + 16, py), f"@{p.user}", fill=member_color, font=font_bold(13))

        # status badge
        sc = STATUS_COLORS.get(status, DIM)
        sl = STATUS_LABELS.get(status, status.upper())
        draw_badge(draw, lx + 120, py, sl, sc, "#000000")

        # prompt text
        visible_text = typewriter(p.text, frame, p.submit_frame, 0.6)
        draw.text(
            (lx + 16, py + 24), f'"{visible_text}"', fill=WHITE, font=font(12)
        )

        # details line
        if status not in ("queued",):
            detail_parts = []
            if p.files_affected:
                detail_parts.append(f"{p.files_affected} files")
            if status in ("executing", "merging", "complete"):
                detail_parts.append(f"complexity: moderate")
            draw.text(
                (lx + 16, py + 46),
                "  ".join(detail_parts),
                fill=DIM,
                font=font(11),
            )

        # progress bar for executing
        if status == "executing":
            exec_progress = min(
                1.0, (frame - p.submit_frame - 80) / 120
            )
            draw_progress_bar(
                draw, lx + 16, py + 66, left_w - 44, 8, exec_progress, CYAN
            )
        elif status in ("merging", "complete"):
            draw_progress_bar(
                draw, lx + 16, py + 66, left_w - 44, 8, 1.0, GREEN
            )

        # completion info
        if status == "complete":
            draw.text(
                (lx + 16, py + 82),
                f"{p.files_affected} files changed, PR #{p.pr_number} opened",
                fill=GREEN,
                font=font(11),
            )

    # ---- Center panel: EXECUTION ----
    content_y = draw_panel(
        draw, cx, top, center_w, panel_h, "EXECUTION", PURPLE
    )

    active_prompt = None
    active_idx = -1
    for i, p in enumerate(PROMPTS):
        status = get_prompt_status(p, frame)
        if status in ("executing", "merging"):
            active_prompt = p
            active_idx = i
            break

    if active_prompt is not None:
        tasks = EXEC_TASKS.get(active_idx, [])
        exec_start = active_prompt.submit_frame + 80
        task_duration = 40

        # planner header
        planner_frame = active_prompt.submit_frame + 60
        if frame >= planner_frame:
            draw.text(
                (cx + 16, content_y),
                f"PLANNER  --  {len(tasks)} subtasks",
                fill=PURPLE,
                font=font_bold(13),
            )
            content_y += 24

        for ti, (task_name, tool_calls) in enumerate(tasks):
            task_start = exec_start + ti * task_duration
            if frame < task_start:
                continue
            ty = content_y + ti * 90
            if ty + 80 > top + panel_h:
                break

            task_progress = min(1.0, (frame - task_start) / task_duration)
            task_done = task_progress >= 1.0
            task_color = GREEN if task_done else YELLOW

            # task label
            check = "v" if task_done else ">"
            draw.text(
                (cx + 16, ty),
                f"[{check}] Task {ti + 1}: {task_name}",
                fill=task_color,
                font=font_bold(12),
            )

            # progress bar
            draw_progress_bar(
                draw,
                cx + 16,
                ty + 20,
                center_w - 44,
                6,
                task_progress,
                task_color,
            )

            # tool calls
            for ci, tc in enumerate(tool_calls):
                tc_frame = task_start + int(ci * task_duration / len(tool_calls))
                if frame >= tc_frame:
                    icon = "+" if "write" in tc else "~"
                    draw.text(
                        (cx + 28, ty + 34 + ci * 16),
                        f"  {icon} {tc}",
                        fill=DIM if task_done else CYAN,
                        font=font(11),
                    )

            # thinking text
            if not task_done and task_progress > 0.3:
                thinking_texts = [
                    "analyzing dependencies...",
                    "resolving imports...",
                    "validating types...",
                ]
                tt = thinking_texts[ti % len(thinking_texts)]
                blink = "" if int(frame / 15) % 2 == 0 else "_"
                draw.text(
                    (cx + 28, ty + 34 + len(tool_calls) * 16),
                    f"  >> {tt}{blink}",
                    fill=YELLOW,
                    font=font(10),
                )
    else:
        # idle state or stats display
        if frame > 750:
            # session stats
            stats_y = content_y + 20
            draw.text(
                (cx + 16, stats_y),
                "SESSION SUMMARY",
                fill=CYAN,
                font=font_bold(16),
            )
            stats = [
                ("Prompts executed", "2"),
                ("Files changed", "7"),
                ("PRs opened", "2"),
                ("Merge conflicts", "0"),
                ("Avg execution time", "12.4s"),
            ]
            for si, (label, value) in enumerate(stats):
                sy = stats_y + 36 + si * 28
                draw.text(
                    (cx + 16, sy), label, fill=DIM, font=font(13)
                )
                v_color = GREEN if value == "0" or value == "2" else WHITE
                draw.text(
                    (cx + 280, sy), value, fill=v_color, font=font_bold(13)
                )
        else:
            draw.text(
                (cx + 16, content_y + 40),
                "Waiting for execution...",
                fill=DIM,
                font=font(13),
            )

    # ---- Right panel: MEMBERS ----
    members_h = int(panel_h * 0.45)
    content_y = draw_panel(
        draw, rx, top, right_w, members_h, "MEMBERS", GREEN
    )

    for mi, m in enumerate(MEMBERS):
        if frame < m.join_frame:
            continue
        my = content_y + mi * 32
        if my + 20 > top + members_h:
            break

        # join animation
        alpha = min(1.0, (frame - m.join_frame) / 15)
        dot_color = m.color if alpha >= 1.0 else DIM

        # determine member status
        m_status = "idle"
        for pi, p in enumerate(PROMPTS):
            ps = get_prompt_status(p, frame)
            if p.user == m.name and ps in ("executing", "merging"):
                m_status = "active"
            elif m.name == "host" and ps == "approved":
                m_status = "reviewing"

        if m_status == "active":
            dot_color = YELLOW
        elif m_status == "reviewing":
            dot_color = PURPLE

        draw_status_dot(draw, rx + 20, my + 8, dot_color, 5)

        role_tag = " (host)" if m.name == "host" else ""
        draw.text(
            (rx + 32, my),
            f"{m.name}{role_tag}",
            fill=WHITE if alpha >= 1.0 else DIM,
            font=font(12),
        )

    # ---- Right panel: STORY ----
    story_top = top + members_h + 12
    story_h = panel_h - members_h - 12
    content_y = draw_panel(
        draw, rx, story_top, right_w, story_h, "STORY", PURPLE
    )

    draw.text(
        (rx + 16, content_y),
        "Feature clusters:",
        fill=DIM,
        font=font(11),
    )
    for fi, (feat_name, feat_color, feat_frame) in enumerate(STORY_FEATURES):
        if frame < feat_frame:
            continue
        fy = content_y + 20 + fi * 36
        fade = min(1.0, (frame - feat_frame) / 30)
        fc = feat_color if fade >= 1.0 else DIM
        draw.rounded_rectangle(
            [(rx + 16, fy), (rx + right_w - 16, fy + 28)],
            radius=4,
            fill=PANEL_BORDER,
            outline=fc,
        )
        draw.text(
            (rx + 24, fy + 6), feat_name, fill=fc, font=font(11)
        )

    # ---- Merge resolution overlay ----
    if 600 <= frame <= 680:
        overlay_w, overlay_h = 400, 80
        ox = (WIDTH - overlay_w) // 2
        oy = HEIGHT - 140
        merge_alpha = min(1.0, (frame - 600) / 15) * (
            1.0 if frame < 660 else max(0.0, 1.0 - (frame - 660) / 20)
        )
        if merge_alpha > 0.1:
            draw.rounded_rectangle(
                [(ox, oy), (ox + overlay_w, oy + overlay_h)],
                radius=8,
                fill=PANEL_BG,
                outline=GREEN,
            )
            draw.text(
                (ox + 16, oy + 12),
                "MERGE RESOLUTION",
                fill=GREEN,
                font=font_bold(14),
            )
            draw.text(
                (ox + 16, oy + 36),
                "Clean merge -- no conflicts detected",
                fill=WHITE,
                font=font(12),
            )

    return img


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def main() -> None:
    script_dir = os.path.dirname(os.path.abspath(__file__))
    output_path = os.path.join(script_dir, "session_dashboard.mp4")
    tmp_dir = tempfile.mkdtemp(prefix="overmind_dashboard_")

    print(f"Rendering {TOTAL_FRAMES} frames to {tmp_dir}...")
    try:
        for f_idx in range(TOTAL_FRAMES):
            img = render_frame(f_idx)
            img.save(os.path.join(tmp_dir, f"frame_{f_idx:04d}.png"))
            if (f_idx + 1) % 90 == 0:
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
