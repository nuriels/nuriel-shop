"""ממיר את סמל הלוגו (כתר + ענב) לקווים וקטוריים — emblem.json + emblem.png (מסכה חדה)."""
import json
import numpy as np
import potrace
from PIL import Image, ImageFilter, ImageDraw

SCALE = 8
logo = Image.open("logo.jpg").convert("RGB").crop((92, 8, 214, 168))
big = logo.resize((logo.width * SCALE, logo.height * SCALE), Image.LANCZOS)
a = np.asarray(big, np.float32)
bg = np.array([92, 7, 14], np.float32)
fg = np.array([200, 135, 95], np.float32)
# כמה הפיקסל קרוב לצבע הסמל לעומת הרקע
t = np.clip(((a - bg) @ (fg - bg)) / ((fg - bg) @ (fg - bg)), 0, 1)
m = Image.fromarray((t * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(SCALE * 1.3))
bw = np.asarray(m) > 110
bmp = potrace.Bitmap(~bw)  # potracer עוקב אחרי הפיקסלים ה"כבויים"
path = bmp.trace(turdsize=200, alphamax=1.1, opticurve=True, opttolerance=0.5)

curves = []
for c in path:
    segs = []
    for s in c.segments:
        if s.is_corner:
            segs.append({"corner": True, "c": [s.c.x, s.c.y], "end": [s.end_point.x, s.end_point.y]})
        else:
            segs.append({"corner": False, "c1": [s.c1.x, s.c1.y], "c2": [s.c2.x, s.c2.y],
                         "end": [s.end_point.x, s.end_point.y]})
    curves.append({"start": [c.start_point.x, c.start_point.y], "segments": segs})
H, W = bw.shape
json.dump({"width": W, "height": H, "curves": curves}, open("emblem.json", "w"))

# תצוגה/מסכה ברזולוציה גבוהה (לתוויות)
def bez(p0, p1, p2, p3, n=24):
    ts = np.linspace(0, 1, n)[:, None]
    return ((1 - ts) ** 3) * p0 + 3 * ((1 - ts) ** 2) * ts * p1 + 3 * (1 - ts) * ts * ts * p2 + ts ** 3 * p3

img = Image.new("L", (W, H), 0)
d = ImageDraw.Draw(img)
for i, c in enumerate(curves):
    pts = [np.array(c["start"])]
    cur = np.array(c["start"])
    for s in c["segments"]:
        if s["corner"]:
            pts += [np.array(s["c"]), np.array(s["end"])]
        else:
            pts += list(bez(cur, np.array(s["c1"]), np.array(s["c2"]), np.array(s["end"]))[1:])
        cur = np.array(s["end"])
    # potrace: הכיוון קובע אם זה חור; נצייר לפי סדר (חיצוני ואז חורים) עם XOR
    poly = Image.new("L", (W, H), 0)
    ImageDraw.Draw(poly).polygon([tuple(p) for p in pts], fill=255)
    img = Image.fromarray(np.asarray(img) ^ np.asarray(poly))
img.save("emblem.png")
print(len(curves), "curves", W, H)
