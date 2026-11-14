"""Icone provvisorie della PWA (in attesa del logo). Uso: python3 scripts/make_icons.py"""
from PIL import Image, ImageDraw

BG, BLUE, GREEN = "#0F1115", "#5B9BE6", "#4CC38A"

def icon(size, pad_ratio, path, radius_ratio=0.22):
    s = size * 4                                   # disegno 4x e riduco: bordi puliti
    img = Image.new("RGB", (s, s), BG)
    d = ImageDraw.Draw(img)
    pad = int(s * pad_ratio)
    w = int(s * 0.09)
    d.rounded_rectangle([pad, pad, s - pad, s - pad], radius=int(s * 0.12), outline=BLUE, width=w)
    a, b = s - pad - int(s * 0.19), s - pad + int(s * 0.0)
    d.line([a, a, b, b], fill=GREEN, width=w)
    d.ellipse([b - w // 2, b - w // 2, b + w // 2, b + w // 2], fill=GREEN)
    d.ellipse([a - w // 2, a - w // 2, a + w // 2, a + w // 2], fill=GREEN)
    img = img.resize((size, size), Image.LANCZOS)
    img.save(path)

icon(192, 0.24, "public/icons/icon-192.png")
icon(512, 0.24, "public/icons/icon-512.png")
icon(512, 0.30, "public/icons/icon-maskable-512.png")   # più margine: iOS/Android ritagliano
icon(180, 0.24, "public/icons/apple-touch-icon.png")
