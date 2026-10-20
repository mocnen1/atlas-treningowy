# Nagranie y4m 1280×720: telefon z kodami QR przed kamerką laptopa (rozmycie, przekrzywienie, szum, lekki ruch).
import sys, glob
import numpy as np
from PIL import Image, ImageFilter
pattern, out, qr_h = sys.argv[1], sys.argv[2], int(sys.argv[3])
mode = sys.argv[4] if len(sys.argv) > 4 else 'phone'   # phone: telefon przed kamerką; screen: ekran laptopa przed aparatem telefonu
frames = sorted(glob.glob(pattern)); rng = np.random.default_rng(3)
W, H, FPS, HOLD, LOOPS = 1280, 720, 10, 7, int(__import__("os").environ.get("LOOPS", "10"))
def compose(qr, t):
    q = Image.open(qr).convert('RGB')
    bg = Image.new('RGB', (W, H), (78, 70, 62) if mode == 'phone' else (40, 42, 45))
    if mode == 'phone':
        dev = Image.new('RGB', (q.width + 80, q.height + 360), (14, 14, 14)); dev.paste(q, (40, 180))
    else:
        dev = Image.new('RGB', (q.width + 600, q.height + 160), (235, 236, 232)); dev.paste(q, (300, 80))
    s = qr_h / q.height; dev = dev.resize((int(dev.width * s), int(dev.height * s)), Image.LANCZOS)
    dev = dev.rotate(6 + 2 * np.sin(t / 4), expand=True, fillcolor=bg.getpixel((0, 0)), resample=Image.BICUBIC)
    w, h = dev.size; d = int(w * 0.07)
    dev = dev.transform((w, h), Image.QUAD, (d, 0, 0, h, w, h, w - d, 0), resample=Image.BICUBIC, fillcolor=bg.getpixel((0, 0)))
    bg.paste(dev, (W // 2 - w // 2 + int(15 * np.sin(t / 3)), H // 2 - h // 2 + int(8 * np.cos(t / 5))))
    img = bg.filter(ImageFilter.GaussianBlur(1.1))
    a = np.asarray(img).astype(np.float32) * 0.85 + rng.normal(0, 7, (H, W, 1))
    return Image.fromarray(np.clip(a, 0, 255).astype(np.uint8))
with open(out, 'wb') as f:
    f.write(f'YUV4MPEG2 W{W} H{H} F{FPS}:1 Ip A1:1 C420jpeg\n'.encode())
    t = 0
    for _ in range(LOOPS):
        for qr in frames:
            yuv = compose(qr, t).convert('YCbCr'); y, cb, cr = [np.asarray(c) for c in yuv.split()]
            cb = cb.reshape(H // 2, 2, W // 2, 2).mean(axis=(1, 3)).astype(np.uint8); cr = cr.reshape(H // 2, 2, W // 2, 2).mean(axis=(1, 3)).astype(np.uint8)
            for _ in range(HOLD):
                f.write(b'FRAME\n'); f.write(y.tobytes()); f.write(cb.tobytes()); f.write(cr.tobytes()); t += 1
print('klatek wideo:', t, 'kodów:', len(frames))
