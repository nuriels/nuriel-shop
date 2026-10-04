"""
באנר מונפש (5 שניות, לולאה חלקה) לאתר "יין כיד המלך".

מייצר מתמונת הבאנר:
  out/banner-desktop-1920x600.mp4 / .webm / .gif   — באנר מחשב (יחס 16:5)
  out/banner-mobile-800x800.mp4  / .webm / .gif    — באנר נייד (ריבוע)

אפקטים: זום איטי הלוך-חזור, ברק זהב שעובר על הכותרת, נצנוצים על הבקבוקים,
אבק זהב שעולה, ופס אור שעובר על הזכוכית. הפריים הראשון והאחרון זהים — הלולאה חלקה.

הרצה:  python3 make_banner.py path/to/banner.webp
דורש: pillow (עם raqm), numpy, ffmpeg
"""

import math
import subprocess
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

FPS = 25
SECONDS = 5
N = FPS * SECONDS
HERE = Path(__file__).resolve().parent
OUT = HERE / "out"
FONT = "/usr/share/fonts/truetype/freefont/FreeSerifBold.ttf"

GOLD_HI = np.array([255, 246, 214], np.float32)

# אזור הכותרת (כתר + "יין כיד המלך" + קישוט) בתמונת המקור 1536×1024
TITLE_BOX = (405, 5, 1145, 290)


def smooth(x):
    x = np.clip(x, 0, 1)
    return x * x * (3 - 2 * x)


def pulse(t, start, dur):
    """0→1→0 בתוך [start, start+dur], חלק בקצוות."""
    u = (t - start) / dur
    if u <= 0 or u >= 1:
        return 0.0
    return math.sin(math.pi * u) ** 2


def star_sprite(size):
    """נצנוץ בצורת כוכב 4 קרניים."""
    r = np.linspace(-1, 1, size, dtype=np.float32)
    x, y = np.meshgrid(r, r)
    core = np.exp(-(x * x + y * y) / 0.012)
    glow = np.exp(-(x * x + y * y) / 0.08) * 0.35
    ray_h = np.exp(-(y * y) / 0.0006) * np.exp(-np.abs(x) / 0.28)
    ray_v = np.exp(-(x * x) / 0.0006) * np.exp(-np.abs(y) / 0.28)
    d1, d2 = (x + y) / math.sqrt(2), (x - y) / math.sqrt(2)
    diag = (np.exp(-(d1 * d1) / 0.0004) * np.exp(-np.abs(d2) / 0.12)
            + np.exp(-(d2 * d2) / 0.0004) * np.exp(-np.abs(d1) / 0.12)) * 0.45
    return np.clip(core + glow + ray_h + ray_v + diag, 0, 1.6)


def soft_disc(radius):
    size = int(radius * 4) | 1
    r = np.linspace(-2, 2, size, dtype=np.float32)
    x, y = np.meshgrid(r, r)
    return np.exp(-(x * x + y * y) * 1.6)


def add_sprite(canvas, sprite, cx, cy, color, strength):
    """מוסיף ספרייט (מסכת 0..1) לקנבס float בצבע נתון, עם חיתוך בקצוות."""
    h, w = sprite.shape
    x0, y0 = int(round(cx - w / 2)), int(round(cy - h / 2))
    H, W = canvas.shape[:2]
    sx0, sy0 = max(0, -x0), max(0, -y0)
    sx1, sy1 = min(w, W - x0), min(h, H - y0)
    if sx1 <= sx0 or sy1 <= sy0:
        return
    patch = sprite[sy0:sy1, sx0:sx1, None] * strength
    region = canvas[y0 + sy0:y0 + sy1, x0 + sx0:x0 + sx1]
    # screen-blend: מאיר בלי לשרוף
    region[:] = 255 - (255 - region) * (1 - patch * color / 255.0)


# ---------- אפקטים במרחב תמונת המקור ----------

class SourceFX:
    def __init__(self, src: Image.Image):
        self.src = np.asarray(src, np.float32)
        H, W = self.src.shape[:2]
        self.yy, self.xx = np.mgrid[0:H, 0:W].astype(np.float32)

        rgb = self.src / 255.0
        mx, mn = rgb.max(2), rgb.min(2)
        sat = np.where(mx > 0, (mx - mn) / np.maximum(mx, 1e-6), 0)
        # מסכת "זהב" — אותיות הכותרת והכתר
        gold = smooth((mx - 0.5) / 0.3) * smooth((sat - 0.25) / 0.3)
        tb = np.zeros_like(gold)
        x0, y0, x1, y1 = TITLE_BOX
        tb[y0:y1, x0:x1] = 1
        tb = np.asarray(Image.fromarray((tb * 255).astype(np.uint8)).filter(
            ImageFilter.GaussianBlur(8)), np.float32) / 255
        self.gold = gold * tb
        # מסכת הדגשות לזכוכית (רק האזורים הבהירים מקבלים את פס האור)
        lum = rgb @ np.array([0.299, 0.587, 0.114], np.float32)
        self.high = smooth((lum - 0.55) / 0.4) * (1 - tb) * (self.yy > 250)

        self.star = {s: star_sprite(int(s * 1.35)) for s in (60, 84, 110)}
        # נצנוצים: (x, y, גודל, התחלה בשניות, משך)
        self.sparkles = [
            (767, 22, 110, 0.35, 0.9),     # ראש הכתר
            (1117, 150, 84, 1.55, 0.8),    # קצה הכותרת
            (700, 318, 84, 0.9, 0.8),      # צוואר הוודקה
            (300, 330, 60, 2.2, 0.7),      # שפת כוס היין
            (575, 300, 60, 3.6, 0.7),      # פקק הערק
            (1112, 462, 84, 2.75, 0.8),    # פקק דון חוליו
            (840, 470, 60, 1.25, 0.7),     # שיבאס
            (1395, 330, 84, 3.15, 0.8),    # בקרדי
            (1265, 380, 60, 4.0, 0.7),     # חוסה קוארבו
            (975, 718, 60, 3.35, 0.6),     # פחית קולה
            (725, 935, 60, 1.9, 0.7),      # קוביית קרח
            (455, 400, 60, 4.25, 0.6),     # כוס יין לבן
            (150, 190, 60, 2.5, 0.6),      # בקבוק יין אדום
        ]

    def frame(self, t):
        f = self.src.copy()

        # ברק זהב על הכותרת — מימין לשמאל, כמו כיוון הקריאה
        s = smooth((t - 0.45) / 1.35)
        if 0 < s < 1:
            c = 1250 - s * 1000
            d = (self.xx - 0.45 * self.yy) - c
            band = np.exp(-(d / 46) ** 2) + 0.35 * np.exp(-(d / 140) ** 2)
            a = np.clip(band * self.gold * 1.05, 0, 1)[..., None]
            f = 255 - (255 - f) * (1 - a * GOLD_HI / 255.0)

        # פס אור עדין על הבקבוקים
        s2 = smooth((t - 2.5) / 1.9)
        if 0 < s2 < 1:
            c = -400 + s2 * 2300
            d = (self.xx + 0.35 * self.yy) - c
            band = np.exp(-(d / 70) ** 2)
            a = np.clip(band * self.high * 0.55, 0, 1)[..., None]
            f = 255 - (255 - f) * (1 - a)

        for x, y, size, start, dur in self.sparkles:
            k = pulse(t, start, dur)
            if k > 0:
                add_sprite(f, self.star[size], x, y, GOLD_HI, min(1.0, k * 1.15))
        return f


# ---------- אבק זהב (במרחב הפלט) ----------

class Dust:
    def __init__(self, W, H, count, seed, scale=1.0):
        rng = np.random.default_rng(seed)
        self.W, self.H = W, H
        self.p = []
        for _ in range(count):
            big = rng.random() < 0.18
            radius = (rng.uniform(6, 13) if big else rng.uniform(1.2, 3.2)) * scale
            self.p.append(dict(
                x=rng.uniform(0, W), y=rng.uniform(H * 0.25, H * 1.05),
                rise=rng.uniform(40, 120) * scale, sway=rng.uniform(4, 16) * scale,
                phase=rng.uniform(0, 1), sprite=soft_disc(radius),
                alpha=rng.uniform(0.12, 0.28) if big else rng.uniform(0.45, 0.95),
                color=np.array([255, rng.uniform(200, 235), rng.uniform(120, 170)], np.float32),
            ))

    def draw(self, canvas, t):
        for q in self.p:
            age = ((t / SECONDS) + q["phase"]) % 1.0      # כל חלקיק חי בדיוק לולאה אחת
            a = math.sin(math.pi * age) ** 1.5 * q["alpha"]
            x = q["x"] + q["sway"] * math.sin(2 * math.pi * (age * 2 + q["phase"]))
            y = q["y"] - q["rise"] * age * SECONDS
            add_sprite(canvas, q["sprite"], x, y, q["color"], a)


def zoom_crop(img: Image.Image, box, out_size, t, amount, focus=(0.5, 0.5)):
    """חיתוך עם זום הלוך-חזור (t=0 ו-t=5 זהים)."""
    z = 1 + amount * (1 - math.cos(2 * math.pi * t / SECONDS)) / 2
    x0, y0, x1, y1 = box
    w, h = (x1 - x0) / z, (y1 - y0) / z
    fx, fy = x0 + (x1 - x0) * focus[0], y0 + (y1 - y0) * focus[1]
    nx0 = fx - (fx - x0) / z
    ny0 = fy - (fy - y0) / z
    return img.resize(out_size, Image.LANCZOS, box=(nx0, ny0, nx0 + w, ny0 + h))


def vignette(W, H, strength):
    y, x = np.mgrid[0:H, 0:W].astype(np.float32)
    d = np.sqrt(((x - W / 2) / (W / 2)) ** 2 + ((y - H / 2) / (H / 2)) ** 2)
    return (1 - strength * smooth((d - 0.55) / 0.9))[..., None]


def gold_text(text, size):
    """טקסט עברי בגרדיאנט זהב עם צל, מחזיר RGBA."""
    font = ImageFont.truetype(FONT, size, layout_engine=ImageFont.Layout.RAQM)
    l, t_, r, b = font.getbbox(text, direction="rtl")
    pad = 24
    W, H = r - l + pad * 2, b - t_ + pad * 2
    mask = Image.new("L", (W, H))
    ImageDraw.Draw(mask).text((pad - l, pad - t_), text, font=font, fill=255, direction="rtl")
    m = np.asarray(mask, np.float32) / 255
    ys = np.linspace(0, 1, H, dtype=np.float32)[:, None]
    top, mid, bot = np.array([255, 240, 180]), np.array([232, 190, 92]), np.array([170, 118, 40])
    g = np.where(ys[..., None] < 0.5,
                 top + (mid - top) * (ys[..., None] / 0.5),
                 mid + (bot - mid) * ((ys[..., None] - 0.5) / 0.5))
    g = np.broadcast_to(g, (H, W, 3))
    shadow = np.asarray(mask.filter(ImageFilter.GaussianBlur(6)), np.float32) / 255
    out = np.zeros((H, W, 4), np.float32)
    out[..., :3] = g * m[..., None]
    out[..., 3] = np.clip(m + shadow * 0.75, 0, 1)
    # צבע טרום-כפול: רקע הצל שחור
    return out


def blend_premult(canvas, layer, x, y, opacity=1.0):
    h, w = layer.shape[:2]
    region = canvas[y:y + h, x:x + w]
    a = layer[..., 3:4] * opacity
    region[:] = layer[..., :3] * opacity + region * (1 - a)


def open_encoder(path, W, H):
    return subprocess.Popen(
        ["ffmpeg", "-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgb24",
         "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-",
         "-c:v", "libx264", "-preset", "slow", "-crf", "18", "-pix_fmt", "yuv420p",
         "-profile:v", "high", "-movflags", "+faststart", "-an", str(path)],
        stdin=subprocess.PIPE)


def main(src_path):
    OUT.mkdir(exist_ok=True)
    src = Image.open(src_path).convert("RGB")
    assert src.size == (1536, 1024), src.size
    fx = SourceFX(src)

    # ----- מחשב 1920×600 -----
    DW, DH = 1920, 600
    # רקע: הבר המטושטש מהתמונה עצמה
    bg = src.resize((1920, 1280), Image.LANCZOS).crop((0, 0, 1920, 1280)).filter(
        ImageFilter.GaussianBlur(38)).resize((1920, 600), Image.LANCZOS, box=(0, 80, 1920, 680))
    bg = np.asarray(bg, np.float32) * 0.42 * vignette(DW, DH, 0.5)
    # גרדיאנט חם מאחורי הכותרת
    yy, xx = np.mgrid[0:DH, 0:DW].astype(np.float32)
    warm = np.exp(-(((xx - 1490) / 520) ** 2 + ((yy - 250) / 300) ** 2))[..., None]
    bg = bg + warm * np.array([70, 38, 10], np.float32)

    # שכבת הבקבוקים: הכותרת המקורית מטושטשת (היא מוצגת בנפרד מימין)
    blur_src = np.asarray(src.filter(ImageFilter.GaussianBlur(22)), np.float32) * 0.7
    tm = Image.new("L", src.size)
    ImageDraw.Draw(tm).rectangle((410, 0, 1140, 276), fill=255)
    tm = np.asarray(tm.filter(ImageFilter.GaussianBlur(10)), np.float32)[..., None] / 255
    BOT_BOX = (0, 165, 1536, 1024)
    BW = round(1536 * DH / (1024 - 165))
    fade = np.ones((DH, BW, 1), np.float32)
    ramp = 150
    fade[:, BW - ramp:, 0] = np.linspace(1, 0, ramp) ** 1.4

    # שכבת הכותרת
    tx0, ty0, tx1, ty1 = TITLE_BOX
    TW, TH = tx1 - tx0, ty1 - ty0
    T_X, T_Y = 1490 - TW // 2, 62
    rect = Image.new("L", (TW, TH))
    ImageDraw.Draw(rect).rectangle((28, 22, TW - 28, TH - 14), fill=255)
    rect = np.asarray(rect.filter(ImageFilter.GaussianBlur(16)), np.float32) / 255
    # רק האותיות והכתר נכנסים במלואם; הבוקה שמאחוריהם בשקיפות נמוכה — בלי "קופסה" נראית
    trgb = np.asarray(src.crop(TITLE_BOX), np.float32) / 255
    tmx, tmn = trgb.max(2), trgb.min(2)
    tsat = (tmx - tmn) / np.maximum(tmx, 1e-6)
    letters = smooth((tmx - 0.4) / 0.25) * smooth((tsat - 0.3) / 0.25)
    letters = np.asarray(Image.fromarray((letters * 255).astype(np.uint8)).filter(
        ImageFilter.MaxFilter(3)).filter(ImageFilter.GaussianBlur(1.2)), np.float32) / 255
    tmask = (np.maximum(letters, 0.12) * rect)[..., None]

    tagline = gold_text("אלכוהול בסטנדרט מלכותי", 56)
    subline = gold_text("יין  •  אלכוהול  •  בירות  •  משקאות קלים", 30)
    tag_x = 1490 - tagline.shape[1] // 2
    sub_x = 1490 - subline.shape[1] // 2
    tag_mask = (tagline[..., :3].max(2) > 1).astype(np.float32)  # האותיות בלבד, בלי הצל
    tag_xx = np.arange(tagline.shape[1], dtype=np.float32)[None, :]

    dust_d = Dust(DW, DH, 70, seed=7)

    # ----- נייד 800×800 -----
    MW = 800
    MOB_BOX = (256, 0, 1280, 1024)
    vig_m = vignette(MW, MW, 0.45)
    dust_m = Dust(MW, MW, 45, seed=11, scale=0.9)

    enc_d = open_encoder(OUT / "banner-desktop-1920x600.mp4", DW, DH)
    enc_m = open_encoder(OUT / "banner-mobile-800x800.mp4", MW, MW)

    for i in range(N):
        t = i / FPS
        f = fx.frame(t)
        f_img = Image.fromarray(np.clip(f, 0, 255).astype(np.uint8))

        # --- מחשב ---
        canvas = bg.copy()
        bot_src = Image.fromarray(np.clip(f * (1 - tm) + blur_src * tm, 0, 255).astype(np.uint8))
        bottles = np.asarray(zoom_crop(bot_src, BOT_BOX, (BW, DH), t, 0.035, (0.5, 0.62)), np.float32)
        canvas[:, :BW] = bottles * fade + canvas[:, :BW] * (1 - fade)

        title = np.asarray(f_img.crop(TITLE_BOX), np.float32)
        breathe = 1 + 0.06 * math.sin(2 * math.pi * t / SECONDS)  # הכותרת "נושמת" אור
        region = canvas[T_Y:T_Y + TH, T_X:T_X + TW]
        region[:] = np.clip(title * breathe, 0, 255) * tmask + region * (1 - tmask)

        tag = tagline.copy()
        s = smooth((t - 1.7) / 1.1)
        if 0 < s < 1:
            c = tagline.shape[1] * (1.1 - 1.2 * s)
            band = np.exp(-((tag_xx - c) / 38) ** 2)[..., None] * tag_mask[..., None]
            tag[..., :3] = 255 - (255 - tag[..., :3]) * (1 - band * 0.9)
        blend_premult(canvas, tag, tag_x, 352)
        blend_premult(canvas, subline, sub_x, 440, 0.92)

        dust_d.draw(canvas, t)
        enc_d.stdin.write(np.clip(canvas, 0, 255).astype(np.uint8).tobytes())

        # --- נייד ---
        mob = np.asarray(zoom_crop(f_img, MOB_BOX, (MW, MW), t, 0.045, (0.5, 0.45)), np.float32)
        mob = mob * vig_m
        dust_m.draw(mob, t)
        enc_m.stdin.write(np.clip(mob, 0, 255).astype(np.uint8).tobytes())

        if i % 25 == 0:
            print(f"frame {i}/{N}", flush=True)

    for e in (enc_d, enc_m):
        e.stdin.close()
        e.wait()

    # GIF מוקטן כדי לעמוד במגבלת 8MB של האתר
    for name, gif_w, gif_fps, colors in (("banner-desktop-1920x600", 960, 15, 192),
                                         ("banner-mobile-800x800", 480, 12, 160)):
        mp4 = OUT / f"{name}.mp4"
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(mp4),
                        "-c:v", "libvpx-vp9", "-b:v", "0", "-crf", "32", "-row-mt", "1",
                        "-an", str(OUT / f"{name}.webm")], check=True)
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(mp4), "-vf",
                        f"fps={gif_fps},scale={gif_w}:-1:flags=lanczos,split[a][b];"
                        f"[a]palettegen=max_colors={colors}:stats_mode=diff[p];"
                        "[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle",
                        "-loop", "0", str(OUT / f"{name}.gif")], check=True)
    print("done")


if __name__ == "__main__":
    main(sys.argv[1])
