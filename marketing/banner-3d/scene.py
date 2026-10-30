"""
באנר תלת-ממדי ל"יין כיד המלך" — בקבוקים מרחפים ומסתובבים, סמל הכתר והענבים בזהב,
ושם החברה בזהב. לולאה של 5 שניות (הפריים האחרון מתחבר לראשון).

הרצה:
  python3 scene.py --layout desktop --out frames/desktop [--samples 64] [--frames 0-124] [--scale 100]
  python3 scene.py --layout mobile  --out frames/mobile
דורש: pip install bpy==4.5.14 numpy pillow
"""

import argparse
import json
import math
import os
import random

import bpy
import numpy as np
from mathutils import Vector
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
FPS = 25
LOOP = 125  # 5 שניות
FONT = os.path.join(HERE, "fonts", "FrankRuhlLibre-Black-hebrew.ttf")
NAME = "יין כיד המלך"
TEX_DIR = os.path.join(HERE, "build", "textures")

BURGUNDY = (92, 7, 14)
GOLD_SRGB = (226, 176, 104)


def srgb(c):
    """sRGB 0..255 → ליניארי (לצבעי חומרים)."""
    def ch(v):
        v /= 255
        return v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4
    return (ch(c[0]), ch(c[1]), ch(c[2]), 1.0)


def smoothstep(x):
    x = min(1.0, max(0.0, x))
    return x * x * (3 - 2 * x)


# ---------------------------------------------------------------- חומרים

def principled(name, **kw):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    mapping = {
        "color": "Base Color", "metallic": "Metallic", "rough": "Roughness",
        "ior": "IOR", "trans": "Transmission Weight", "coat": "Coat Weight",
        "coat_rough": "Coat Roughness", "spec": "Specular IOR Level",
    }
    for k, v in kw.items():
        b.inputs[mapping[k]].default_value = v
    return m


def gold_mat(name="gold", rough=0.2):
    return principled(name, color=(1.0, 0.56, 0.17, 1), metallic=1.0, rough=rough)


def glass_mat(name, color, rough=0.0, ior=1.5):
    return principled(name, color=color, trans=1.0, rough=rough, ior=ior)


def liquid_mat(name, color, density):
    m = principled(name, color=color, trans=1.0, rough=0.0, ior=1.33)
    nt = m.node_tree
    vol = nt.nodes.new("ShaderNodeVolumeAbsorption")
    vol.inputs["Color"].default_value = color
    vol.inputs["Density"].default_value = density
    nt.links.new(vol.outputs[0], nt.nodes["Material Output"].inputs["Volume"])
    return m


def emission_mat(name, color, strength):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    e = nt.nodes.new("ShaderNodeEmission")
    e.inputs["Color"].default_value = color
    e.inputs["Strength"].default_value = strength
    o = nt.nodes.new("ShaderNodeOutputMaterial")
    nt.links.new(e.outputs[0], o.inputs["Surface"])
    return m


def label_mat(name, base_png, mask_png):
    """תווית: נייר בצבע + סמל/פסים בזהב מוטבע (לפי מסכה)."""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    paper = nt.nodes.new("ShaderNodeBsdfPrincipled")
    paper.inputs["Roughness"].default_value = 0.55
    gold = nt.nodes.new("ShaderNodeBsdfPrincipled")
    gold.inputs["Base Color"].default_value = (1.0, 0.56, 0.17, 1)
    gold.inputs["Metallic"].default_value = 1.0
    gold.inputs["Roughness"].default_value = 0.22
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = bpy.data.images.load(base_png)
    msk = nt.nodes.new("ShaderNodeTexImage")
    msk.image = bpy.data.images.load(mask_png)
    msk.image.colorspace_settings.name = "Non-Color"
    bump = nt.nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.35
    bump.inputs["Distance"].default_value = 0.0004
    mix = nt.nodes.new("ShaderNodeMixShader")
    L = nt.links.new
    L(tex.outputs["Color"], paper.inputs["Base Color"])
    L(msk.outputs["Color"], bump.inputs["Height"])
    L(bump.outputs["Normal"], paper.inputs["Normal"])
    L(bump.outputs["Normal"], gold.inputs["Normal"])
    L(msk.outputs["Color"], mix.inputs["Fac"])
    L(paper.outputs[0], mix.inputs[1])
    L(gold.outputs[0], mix.inputs[2])
    L(mix.outputs[0], out.inputs["Surface"])
    return m


# ---------------------------------------------------------------- טקסטורות תוויות

def emblem_image():
    return Image.open(os.path.join(HERE, "emblem.png")).convert("L")


def make_label(name, circumference, height, paper, border=True, emblem_scale=0.68):
    """תווית שעוטפת את הבקבוק: הסמל פעמיים (חזית וגב) + פסי זהב דקים."""
    os.makedirs(TEX_DIR, exist_ok=True)
    W = 2048
    H = max(256, int(W * height / circumference))
    base = Image.new("RGB", (W, H), paper)
    mask = Image.new("L", (W, H), 0)
    em = emblem_image()
    eh = int(H * emblem_scale)
    ew = int(em.width * eh / em.height)
    em = em.resize((ew, eh), Image.LANCZOS)
    for u in (0.25, 0.75):
        mask.paste(em, (int(W * u - ew / 2), (H - eh) // 2), em)
    if border:
        d = ImageDraw.Draw(mask)
        t = max(3, H // 70)
        for y in (H * 0.06, H * 0.94 - t):
            d.rectangle((0, int(y), W, int(y) + t), fill=255)
    # נייר: מעט גרעיניות כדי שלא ייראה "פלסטיק"
    noise = (np.random.default_rng(1).normal(0, 3, (H, W, 1))).astype(np.int16)
    base = Image.fromarray(np.clip(np.asarray(base, np.int16) + noise, 0, 255).astype(np.uint8))
    bp = os.path.join(TEX_DIR, f"{name}_base.png")
    mp = os.path.join(TEX_DIR, f"{name}_mask.png")
    base.save(bp)
    mask.save(mp)
    return bp, mp


# ---------------------------------------------------------------- גאומטריה

def catmull(points, per=10):
    """פרופיל חלק מנקודות בקרה (r, z)."""
    p = [points[0]] + list(points) + [points[-1]]
    out = []
    for i in range(1, len(p) - 2):
        p0, p1, p2, p3 = (np.array(x, float) for x in p[i - 1:i + 3])
        for s in range(per):
            t = s / per
            out.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t
                              + (-p0 + 3 * p1 - 3 * p2 + p3) * t ** 3))
    out.append(np.array(points[-1], float))
    return out


def superellipse(r, n, a):
    c, s = math.cos(a), math.sin(a)
    e = 2.0 / n
    return (r * math.copysign(abs(c) ** e, c), r * math.copysign(abs(s) ** e, s))


def lathe(name, profile, seg=96, square=None, cap_bottom=True, cap_top=True, uv=False):
    """מסובב פרופיל סביב ציר Z. square(z) מחזיר מעריך חתך (2=עיגול, 5≈ריבוע מעוגל)."""
    verts, faces, uvs = [], [], []
    ring = seg + 1 if uv else seg
    z0, z1 = profile[0][1], profile[-1][1]
    for r, z in profile:
        n = square(z) if square else 2.0
        for i in range(ring):
            a = 2 * math.pi * i / seg - math.pi  # u=0.25 ו-0.75 = חזית וגב
            x, y = superellipse(r, n, a)
            verts.append((x, y, z))
    rows = len(profile)
    for j in range(rows - 1):
        for i in range(seg):
            a = j * ring + i
            b = j * ring + (i + 1) % ring if not uv else j * ring + i + 1
            c, d = b + ring, a + ring
            faces.append((a, b, c, d))
            if uv:
                uvs.append([(i / seg, (profile[j][1] - z0) / (z1 - z0)),
                            ((i + 1) / seg, (profile[j][1] - z0) / (z1 - z0)),
                            ((i + 1) / seg, (profile[j + 1][1] - z0) / (z1 - z0)),
                            (i / seg, (profile[j + 1][1] - z0) / (z1 - z0))])
    if cap_bottom:
        verts.append((0, 0, z0))
        c = len(verts) - 1
        for i in range(seg):
            faces.append((c, (i + 1) % ring if not uv else i + 1, i))
    if cap_top:
        verts.append((0, 0, z1))
        c = len(verts) - 1
        base = (rows - 1) * ring
        for i in range(seg):
            faces.append((c, base + i, base + ((i + 1) % ring if not uv else i + 1)))
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    if uv:
        layer = me.uv_layers.new()
        k = 0
        for poly, quad in zip(me.polygons[:len(uvs)], uvs):
            for li, coord in zip(poly.loop_indices, quad):
                layer.data[li].uv = coord
                k += 1
    me.validate()
    me.update()
    for p in me.polygons:
        p.use_smooth = True
    ob = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(ob)
    return ob


def scaled_profile(profile, dr, zmax=None):
    out = []
    for r, z in profile:
        if zmax is not None and z > zmax:
            break
        out.append((max(0.001, r - dr), z))
    if zmax is not None and out[-1][1] < zmax:
        r_top = np.interp(zmax, [p[1] for p in profile], [p[0] for p in profile]) - dr
        out.append((r_top, zmax))
    return out


def radius_at(profile, z):
    return float(np.interp(z, [p[1] for p in profile], [p[0] for p in profile]))


# ---------------------------------------------------------------- בקבוקים

BOTTLES = {
    # פרופילים במטרים: (רדיוס, גובה)
    "wine": dict(
        ctrl=[(0.0345, 0), (0.0368, 0.006), (0.0368, 0.19), (0.035, 0.205), (0.028, 0.222),
              (0.018, 0.237), (0.0146, 0.252), (0.0141, 0.287), (0.0156, 0.291), (0.0156, 0.300)],
        glass=("glass_wine", srgb((14, 22, 12)), 0.02),
        label=(0.055, 0.145, (238, 226, 200)), cap="foil_burgundy", cap_from=0.245),
    "champagne": dict(
        ctrl=[(0.040, 0), (0.0425, 0.008), (0.0425, 0.15), (0.040, 0.175), (0.032, 0.2),
              (0.022, 0.226), (0.0166, 0.246), (0.0156, 0.28), (0.0176, 0.285), (0.0176, 0.298)],
        glass=("glass_champ", srgb((20, 42, 22)), 0.02),
        label=(0.045, 0.125, (18, 14, 14)), cap="foil_gold", cap_from=0.215),
    "whiskey": dict(
        ctrl=[(0.041, 0), (0.0435, 0.006), (0.0435, 0.178), (0.040, 0.194), (0.027, 0.205),
              (0.0165, 0.212), (0.0148, 0.238), (0.0162, 0.241), (0.0162, 0.248)],
        square=lambda z: 5.0 if z < 0.19 else 5.0 - 3.0 * smoothstep((z - 0.19) / 0.02),
        glass=("glass_clear", srgb((250, 250, 250)), 0.0), hollow=True,
        liquid=("whiskey", srgb((200, 90, 18)), 18.0, 0.17),
        label=(0.05, 0.14, (20, 16, 14)), cap="stopper", cap_from=0.248),
    "vodka": dict(
        ctrl=[(0.0355, 0), (0.0378, 0.006), (0.0378, 0.24), (0.035, 0.262), (0.025, 0.278),
              (0.0166, 0.29), (0.015, 0.33)],
        glass=("glass_frost", srgb((236, 242, 250)), 0.12),
        label=(0.075, 0.165, BURGUNDY), cap="silver", cap_from=0.292),
    "white": dict(
        ctrl=[(0.0335, 0), (0.0358, 0.006), (0.0358, 0.15), (0.033, 0.18), (0.024, 0.215),
              (0.0166, 0.245), (0.0146, 0.27), (0.0146, 0.31)],
        glass=("glass_clear", srgb((250, 250, 250)), 0.0), hollow=True,
        liquid=("white_wine", srgb((240, 190, 60)), 14.0, 0.235),
        label=(0.045, 0.125, BURGUNDY), cap="screw_gold", cap_from=0.262),
    "beer": dict(
        ctrl=[(0.0295, 0), (0.0318, 0.005), (0.0318, 0.125), (0.030, 0.14), (0.022, 0.16),
              (0.0146, 0.185), (0.0128, 0.224), (0.0145, 0.227), (0.0145, 0.235)],
        glass=("glass_amber", srgb((120, 50, 10)), 0.02),
        label=(0.04, 0.1, BURGUNDY), cap="crown", cap_from=0.229),
}

_mats = {}


def mat(key, factory):
    if key not in _mats:
        _mats[key] = factory()
    return _mats[key]


def parent(child, par):
    child.parent = par


def build_bottle(kind):
    spec = BOTTLES[kind]
    prof = [tuple(p) for p in catmull(spec["ctrl"])]
    root = bpy.data.objects.new(f"{kind}_root", None)
    bpy.context.collection.objects.link(root)

    body = lathe(f"{kind}_glass", prof, square=spec.get("square"))
    gname, gcol, grough = spec["glass"]
    body.data.materials.append(mat(gname, lambda: glass_mat(gname, gcol, grough)))
    if spec.get("hollow"):
        sol = body.modifiers.new("shell", "SOLIDIFY")
        sol.thickness = 0.0028
        sol.offset = -1
    parent(body, root)

    if "liquid" in spec:
        lname, lcol, dens, fill = spec["liquid"]
        lp = scaled_profile(prof, 0.0034, zmax=fill)
        lp[0] = (lp[0][0], 0.004)
        liq = lathe(f"{kind}_liquid", lp, square=spec.get("square"))
        liq.data.materials.append(mat(lname, lambda: liquid_mat(lname, lcol, dens)))
        parent(liq, root)

    z1, z2, paper = spec["label"]
    r = radius_at(prof, (z1 + z2) / 2) + 0.0007
    n = spec["square"](0.1) if spec.get("square") else 2.0
    circ = 2 * math.pi * r * (1.0 if n == 2.0 else 1.12)
    bp, mp = make_label(kind, circ, z2 - z1, paper)
    lab_prof = [(radius_at(prof, z) + 0.0007, z) for z in np.linspace(z1, z2, 12)]
    label = lathe(f"{kind}_label", lab_prof, square=spec.get("square"),
                  cap_bottom=False, cap_top=False, uv=True)
    label.data.materials.append(label_mat(f"label_{kind}", bp, mp))
    parent(label, root)

    top = prof[-1][1]
    cap = spec["cap"]
    zc = spec["cap_from"]
    if cap in ("foil_burgundy", "foil_gold"):
        fp = [(radius_at(prof, z) + 0.0009, z) for z in np.linspace(zc, top, 16)]
        fp.append((fp[-1][0], top + 0.002))
        o = lathe(f"{kind}_foil", fp, cap_bottom=False)
        if cap == "foil_gold":
            o.data.materials.append(mat("foil_gold", lambda: gold_mat("foil_gold", 0.28)))
        else:
            o.data.materials.append(mat("foil_burg", lambda: principled(
                "foil_burg", color=srgb((120, 10, 22)), metallic=0.85, rough=0.32,
                coat=0.6, coat_rough=0.1)))
        parent(o, root)
    elif cap == "stopper":
        wood = lathe(f"{kind}_cork", [(0.0172, zc), (0.0172, zc + 0.012)])
        wood.data.materials.append(mat("wood", lambda: principled(
            "wood", color=srgb((110, 66, 34)), rough=0.6)))
        head = lathe(f"{kind}_head", catmull([(0.0235, zc + 0.012), (0.0235, zc + 0.026),
                                               (0.020, zc + 0.03), (0.001, zc + 0.031)], per=6))
        head.data.materials.append(mat("gold_cap", lambda: gold_mat("gold_cap", 0.25)))
        parent(wood, root)
        parent(head, root)
    elif cap in ("silver", "screw_gold"):
        cp = [(radius_at(prof, zc) + 0.0012, zc), (radius_at(prof, top) + 0.0012, top),
              (radius_at(prof, top) + 0.0012, top + 0.006)]
        o = lathe(f"{kind}_cap", cp)
        if cap == "silver":
            o.data.materials.append(mat("silver", lambda: principled(
                "silver", color=(0.92, 0.92, 0.93, 1), metallic=1.0, rough=0.18)))
        else:
            o.data.materials.append(mat("gold_cap", lambda: gold_mat("gold_cap", 0.25)))
        parent(o, root)
    elif cap == "crown":
        o = lathe(f"{kind}_cap", [(0.0158, zc), (0.0158, top + 0.002), (0.0145, top + 0.004)])
        o.data.materials.append(mat("gold_cap", lambda: gold_mat("gold_cap", 0.25)))
        parent(o, root)
    return root


# ---------------------------------------------------------------- סמל + שם

def build_emblem(height):
    data = json.load(open(os.path.join(HERE, "emblem.json")))
    W, H = data["width"], data["height"]
    s = height / H

    def P(p):
        return Vector(((p[0] - W / 2) * s, (H / 2 - p[1]) * s, 0))

    cu = bpy.data.curves.new("emblem", "CURVE")
    cu.dimensions = "2D"
    cu.fill_mode = "BOTH"
    cu.extrude = height * 0.035
    cu.bevel_depth = height * 0.012
    cu.bevel_resolution = 3
    cu.resolution_u = 12
    for c in data["curves"]:
        segs = []
        cur = P(c["start"])
        for sg in c["segments"]:
            end = P(sg["end"])
            if sg["corner"]:
                mid = P(sg["c"])
                segs.append((cur, cur.lerp(mid, 1 / 3), cur.lerp(mid, 2 / 3), mid))
                segs.append((mid, mid.lerp(end, 1 / 3), mid.lerp(end, 2 / 3), end))
            else:
                segs.append((cur, P(sg["c1"]), P(sg["c2"]), end))
            cur = end
        sp = cu.splines.new("BEZIER")
        sp.bezier_points.add(len(segs) - 1)
        sp.use_cyclic_u = True
        for k, (p0, c1, c2, p3) in enumerate(segs):
            bpnt = sp.bezier_points[k]
            bpnt.co = p0
            bpnt.handle_left_type = bpnt.handle_right_type = "FREE"
            bpnt.handle_right = c1
            bpnt.handle_left = segs[k - 1][2]
    ob = bpy.data.objects.new("emblem", cu)
    bpy.context.collection.objects.link(ob)
    ob.data.materials.append(mat("gold", gold_mat))
    ob.rotation_euler = (math.pi / 2, 0, 0)
    return ob


def build_name(size):
    font = bpy.data.fonts.load(FONT)
    cu = bpy.data.curves.new("name", "FONT")
    cu.body = NAME[::-1]  # בלנדר לא הופך כיוון — כותבים בסדר חזותי
    cu.font = font
    cu.size = size
    cu.align_x = "CENTER"
    cu.align_y = "CENTER"
    cu.extrude = size * 0.06
    cu.bevel_depth = size * 0.022
    cu.bevel_resolution = 4
    cu.resolution_u = 16
    ob = bpy.data.objects.new("name", cu)
    bpy.context.collection.objects.link(ob)
    ob.data.materials.append(mat("gold", gold_mat))
    ob.rotation_euler = (math.pi / 2, 0, 0)
    return ob


# ---------------------------------------------------------------- סביבה

def plane(name, size, loc, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_plane_add(size=1, location=loc, rotation=rot)
    ob = bpy.context.active_object
    ob.name = name
    ob.scale = (size[0], size[1], 1)
    return ob


def area_light(name, loc, target, power, size, color=(1, 1, 1), shape="RECTANGLE", size_y=None):
    ld = bpy.data.lights.new(name, "AREA")
    ld.energy = power
    ld.color = color
    ld.shape = shape
    ld.size = size
    ld.size_y = size_y or size
    ob = bpy.data.objects.new(name, ld)
    bpy.context.collection.objects.link(ob)
    ob.location = loc
    ob.visible_camera = False
    d = Vector(target) - Vector(loc)
    ob.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
    return ob


def build_environment(cam_dist, width):
    # רצפה מבריקה כהה — משקפת את הבקבוקים
    floor = plane("floor", (40, 40), (0, 0, 0))
    floor.data.materials.append(principled(
        "floor", color=srgb((14, 4, 6)), rough=0.14, coat=1.0, coat_rough=0.04))

    # רקע: בורדו של הלוגו עם הילה חמה במרכז
    back = plane("backdrop", (60, 30), (0, 6.0, 4), rot=(math.pi / 2, 0, 0))
    m = bpy.data.materials.new("backdrop")
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    em = nt.nodes.new("ShaderNodeEmission")
    tc = nt.nodes.new("ShaderNodeTexCoord")
    mp = nt.nodes.new("ShaderNodeMapping")
    mp.inputs["Scale"].default_value = (0.09, 0.22, 1)
    mp.inputs["Location"].default_value = (0, 0.1, 0)
    grad = nt.nodes.new("ShaderNodeTexGradient")
    grad.gradient_type = "SPHERICAL"
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].color = srgb((6, 1, 2))
    ramp.color_ramp.elements[1].color = srgb((96, 16, 22))
    ramp.color_ramp.elements[1].position = 0.85
    ramp.color_ramp.elements.new(0.5).color = srgb((40, 4, 9))
    L = nt.links.new
    L(tc.outputs["Object"], mp.inputs["Vector"])
    L(mp.outputs[0], grad.inputs["Vector"])
    L(grad.outputs["Fac"], ramp.inputs["Fac"])
    L(ramp.outputs["Color"], em.inputs["Color"])
    em.inputs["Strength"].default_value = 0.85
    L(em.outputs[0], out.inputs["Surface"])
    back.data.materials.append(m)

    # אורות בוקה רחוקים (יוצאים מפוקוס)
    rng = random.Random(4)
    bpy.ops.mesh.primitive_uv_sphere_add(radius=1, segments=16, ring_count=8)
    proto = bpy.context.active_object
    proto.name = "bokeh_proto"
    proto.hide_render = True
    bokeh_mats = [emission_mat(f"bokeh{i}", srgb(c), s) for i, (c, s) in enumerate(
        [((255, 180, 90), 5), ((255, 150, 70), 4), ((255, 205, 140), 6), ((240, 110, 60), 3)])]
    for i in range(30):
        ob = proto.copy()
        ob.data = proto.data.copy()
        ob.data.materials.append(rng.choice(bokeh_mats))
        y = rng.uniform(2.5, 4.5)
        spread = width * (cam_dist + y) / cam_dist * 0.62
        ob.location = (rng.uniform(-spread, spread), y, rng.uniform(-0.1, 0.25 + 0.5 * (cam_dist + y) / cam_dist * width * 0.45))
        r = rng.uniform(0.008, 0.02)
        ob.scale = (r, r, r)
        ob.hide_render = False
        ob.visible_shadow = False
        bpy.context.collection.objects.link(ob)

    # תאורה
    area_light("key", (-1.3, -1.6, 1.5), (0, 0, 0.2), 260, 1.2, (1.0, 0.92, 0.82))
    area_light("fill", (1.5, -1.4, 0.7), (0, 0, 0.2), 90, 1.0, (0.95, 0.95, 1.0))
    area_light("top", (0, 0.2, 1.6), (0, 0, 0.1), 70, 1.5, (1.0, 0.9, 0.8))
    # אורות אחוריים צרים — מציירים קווי מתאר על הזכוכית
    area_light("rimL", (-1.2, 0.8, 0.45), (0, 0, 0.18), 520, 0.25, (1.0, 0.78, 0.5), size_y=1.6)
    area_light("rimR", (1.2, 0.8, 0.45), (0, 0, 0.18), 520, 0.25, (1.0, 0.78, 0.5), size_y=1.6)

    # משטח אור גדול מאחורי המצלמה — הזהב "רואה" אותו ומבריק (לא נראה בצילום)
    soft = plane("softbox", (4.5, 1.4), (0, -3.6, 0.15), rot=(math.pi / 2, 0, 0))
    soft.data.materials.append(emission_mat("softbox", (1.0, 0.72, 0.42, 1), 0.9))
    soft.visible_camera = False
    soft.visible_shadow = False

    # סביבה עמומה להשתקפויות בזהב
    world = bpy.data.worlds.new("world")
    bpy.context.scene.world = world
    world.use_nodes = True
    nt = world.node_tree
    env = nt.nodes.new("ShaderNodeTexEnvironment")
    env.image = bpy.data.images.load(
        os.path.join(bpy.utils.resource_path("LOCAL"), "datafiles", "studiolights", "world", "interior.exr"))
    bg = nt.nodes["Background"]
    bg.inputs["Strength"].default_value = 0.35
    nt.links.new(env.outputs["Color"], bg.inputs["Color"])


def glint_strip(z):
    """פס אור שלא נראה במצלמה — רק בהשתקפות על הזהב. זז לרוחב פעם אחת בכל לולאה."""
    ob = plane("glint", (0.12, 1.6), (0, -1.0, z), rot=(math.pi / 2, 0, 0))
    ob.data.materials.append(emission_mat("glint", (1.0, 0.93, 0.8, 1), 22))
    ob.visible_camera = False
    ob.visible_diffuse = False
    ob.visible_shadow = False
    return ob


class Dust:
    """אבק זהב עולה — כל חלקיק חי בדיוק לולאה אחת, כך שהמעבר חלק."""

    def __init__(self, n, xr, yr, zr, seed):
        rng = random.Random(seed)
        bpy.ops.mesh.primitive_ico_sphere_add(radius=1, subdivisions=2)
        proto = bpy.context.active_object
        proto.hide_render = True
        m = emission_mat("dust", srgb((255, 205, 130)), 30)
        self.p = []
        for _ in range(n):
            ob = proto.copy()
            ob.data = proto.data
            if not ob.data.materials:
                ob.data.materials.append(m)
            ob.hide_render = False
            ob.visible_shadow = False
            bpy.context.collection.objects.link(ob)
            self.p.append(dict(ob=ob, x=rng.uniform(*xr), y=rng.uniform(*yr), z=rng.uniform(*zr),
                               rise=rng.uniform(0.08, 0.2), sway=rng.uniform(0.005, 0.02),
                               phase=rng.random(), r=rng.uniform(0.0012, 0.0032)))

    def update(self, f):
        for q in self.p:
            age = (f / LOOP + q["phase"]) % 1.0
            k = math.sin(math.pi * age) ** 1.5
            q["ob"].location = (q["x"] + q["sway"] * math.sin(2 * math.pi * (2 * age + q["phase"])),
                                q["y"], q["z"] + q["rise"] * age)
            s = q["r"] * max(k, 0.001)
            q["ob"].scale = (s, s, s)


# ---------------------------------------------------------------- פריסות

LAYOUTS = {
    "desktop": dict(
        res=(1920, 600), lens=45, cam=(0, -1.88, 0.245), look=(0, 0, 0.2), fstop=1.6,
        width=1.5,
        name_size=0.15, name_pos=(0, -0.02, 0.15),
        emblem_h=0.165, emblem_pos=(0, 0.0, 0.335),
        bottles=[("whiskey", -0.645, 0.07), ("wine", -0.51, -0.03), ("champagne", -0.375, 0.07),
                 ("vodka", 0.375, 0.07), ("white", 0.51, -0.03), ("beer", 0.645, 0.07)],
        glint_z=0.3,
        dust=dict(n=70, xr=(-0.75, 0.75), yr=(-0.3, 0.5), zr=(-0.02, 0.35)),
    ),
    "mobile": dict(
        res=(800, 800), lens=45, cam=(0, -0.93, 0.37), look=(0, 0, 0.335), fstop=1.8,
        width=0.72,
        name_size=0.125, name_pos=(0, -0.06, 0.462),
        emblem_h=0.13, emblem_pos=(0, -0.04, 0.578),
        bottles=[("beer", -0.272, 0.07), ("whiskey", -0.137, 0.0), ("wine", 0.0, -0.04),
                 ("vodka", 0.137, 0.0), ("champagne", 0.272, 0.07)],
        glint_z=0.5,
        dust=dict(n=45, xr=(-0.36, 0.36), yr=(-0.2, 0.3), zr=(-0.02, 0.55)),
    ),
}


def setup_render(L, samples, scale):
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    sc.cycles.device = "CPU"
    sc.cycles.samples = samples
    sc.cycles.use_adaptive_sampling = True
    sc.cycles.adaptive_threshold = 0.02
    sc.cycles.use_denoising = True
    sc.cycles.denoiser = "OPENIMAGEDENOISE"
    sc.cycles.max_bounces = 10
    sc.cycles.transmission_bounces = 10
    sc.cycles.glossy_bounces = 4
    sc.cycles.transparent_max_bounces = 8
    sc.cycles.caustics_reflective = False
    sc.cycles.caustics_refractive = False
    sc.cycles.blur_glossy = 1.0
    sc.render.use_persistent_data = True
    sc.render.resolution_x, sc.render.resolution_y = L["res"]
    sc.render.resolution_percentage = scale
    sc.render.image_settings.file_format = "PNG"
    sc.render.image_settings.color_mode = "RGB"
    sc.view_settings.view_transform = "AgX"
    sc.view_settings.look = "AgX - Punchy"
    sc.view_settings.exposure = 0.0
    sc.render.film_transparent = False


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--layout", default="desktop", choices=LAYOUTS)
    ap.add_argument("--out", required=True)
    ap.add_argument("--samples", type=int, default=64)
    ap.add_argument("--frames", default=f"0-{LOOP - 1}")
    ap.add_argument("--scale", type=int, default=100)
    ap.add_argument("--save-blend", action="store_true")
    ap.add_argument("--force", action="store_true", help="לרנדר מחדש גם פריימים קיימים")
    a = ap.parse_args()
    L = LAYOUTS[a.layout]

    bpy.ops.wm.read_factory_settings(use_empty=True)
    setup_render(L, a.samples, a.scale)
    sc = bpy.context.scene

    cam_d = bpy.data.cameras.new("cam")
    cam_d.lens = L["lens"]
    cam_d.sensor_width = 36
    cam_d.sensor_fit = "HORIZONTAL"
    cam_d.dof.use_dof = True
    cam_d.dof.aperture_fstop = L["fstop"]
    cam_d.dof.aperture_blades = 7
    cam = bpy.data.objects.new("cam", cam_d)
    sc.collection.objects.link(cam)
    sc.camera = cam
    cam_base = Vector(L["cam"])
    look = Vector(L["look"])
    cam_d.dof.focus_distance = (look - cam_base).length

    build_environment((look - cam_base).length, L["width"])

    name = build_name(L["name_size"])
    name.location = L["name_pos"]
    emblem = build_emblem(L["emblem_h"])
    emblem.location = L["emblem_pos"]
    glint = glint_strip(L["glint_z"])

    bottles = []
    for i, (kind, x, y) in enumerate(L["bottles"]):
        root = build_bottle(kind)
        bottles.append(dict(root=root, x=x, y=y, phase=i * 0.37 + (0.15 if x > 0 else 0),
                            spin=(1 if i % 2 == 0 else -1), base_rot=math.radians(rng_rot(i))))

    dust = Dust(**L["dust"], seed=9)

    if a.save_blend:
        bpy.ops.wm.save_as_mainfile(filepath=os.path.join(HERE, "build", f"{a.layout}.blend"))

    os.makedirs(a.out, exist_ok=True)
    f0, f1 = (int(v) for v in a.frames.split("-"))
    for f in range(f0, f1 + 1):
        path = os.path.join(a.out, f"f{f:04d}.png")
        if os.path.exists(path) and not a.force:
            continue  # המשך מהיכן שעצרנו
        t = f / LOOP  # 0..1 לאורך הלולאה
        w = 2 * math.pi * t
        for b in bottles:
            ph = 2 * math.pi * b["phase"]
            b["root"].location = (b["x"], b["y"], 0.04 + 0.014 * math.sin(w + ph))
            b["root"].rotation_euler = (math.radians(2.2) * math.sin(w + ph + 1.1),
                                        math.radians(1.6) * math.sin(w + ph + 2.3),
                                        b["base_rot"] + b["spin"] * math.pi * t)
        # הסמל מתנדנד קלות כדי שהזהב יתפוס אור
        emblem.rotation_euler = (math.pi / 2, 0, math.radians(14) * math.sin(w))
        emblem.location = (L["emblem_pos"][0], L["emblem_pos"][1],
                           L["emblem_pos"][2] + 0.004 * math.sin(w + 0.6))
        # ברק שעובר על השם — מימין לשמאל, פעם אחת בכל לולאה
        s = smoothstep((t - 0.12) / 0.45)
        glint.location.x = 2.2 - 4.4 * s
        # מצלמה: תנועה איטית הלוך-חזור
        cam.location = cam_base + Vector((0.05 * math.sin(w), 0.03 * (1 - math.cos(w)), 0.012 * math.sin(w)))
        cam.rotation_euler = (look - cam.location).to_track_quat("-Z", "Y").to_euler()
        dust.update(f)
        sc.frame_current = f
        sc.render.filepath = path
        bpy.ops.render.render(write_still=True)
        print(f"rendered {f}", flush=True)


def rng_rot(i):
    return [10, -25, 40, -15, 30, -35][i % 6]


if __name__ == "__main__":
    main()
