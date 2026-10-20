"""
Interactive TEM diffraction ring calibration.

Workflow:
1. Choose diffraction image first.
2. Enter accelerating voltage and camera length.
3. Click transmitted-beam center.
4. Script proposes radial-intensity peak candidates.
5. Match candidates to known material reference d-spacings.
6. Computes calibration in nm/px, draws predicted rings and labels R/hkl/d,
   and saves annotated PNG plus CSV.

Install: pip install numpy matplotlib pillow
Use original, un-resized image. Verify ring assignments visually.
"""

import csv
import math
from pathlib import Path
import tkinter as tk
from tkinter import filedialog

import numpy as np
import matplotlib.pyplot as plt
from PIL import Image, ImageDraw, ImageFont

# Reference d-spacings from the supplied aluminium table, in Angstrom.
# Edit this list if using a different standard material.
REFERENCE = [
    ("111", 2.3380),
    ("200", 2.0240),
    ("220", 1.4310),
    ("311", 1.2210),
    ("222", 1.1690),
    ("400", 1.0124),
    ("331", 0.9289),
    ("420", 0.9055),
    ("422", 0.8266),
]


def choose_image():
    root = tk.Tk()
    root.withdraw()
    name = filedialog.askopenfilename(
        title="Pilih citra difraksi TEM",
        filetypes=[("Image files", "*.tif *.tiff *.png *.jpg *.jpeg *.bmp"),
                   ("All files", "*.*")]
    )
    root.destroy()
    if not name:
        raise SystemExit("Tidak ada gambar dipilih.")
    return Path(name)


def wavelength_angstrom(voltage_kv):
    """Relativistic electron wavelength in Angstrom."""
    h = 6.62607015e-34
    me = 9.1093837139e-31
    e = 1.602176634e-19
    c = 299792458.0
    V = voltage_kv * 1000.0
    wavelength_m = h / math.sqrt(2 * me * e * V * (1 + e * V / (2 * me * c**2)))
    return wavelength_m * 1e10


def ask_float(prompt, default):
    value = input(f"{prompt} [{default}]: ").strip()
    return float(value) if value else float(default)


def choose_center(image):
    fig, ax = plt.subplots(figsize=(10, 8))
    ax.imshow(image, cmap="gray", origin="upper")
    ax.set_title("Klik pusat transmitted beam (pusat pola difraksi)")
    ax.set_xlabel("x (piksel)")
    ax.set_ylabel("y (piksel)")
    print("Klik pusat transmitted beam pada jendela gambar.")
    points = plt.ginput(1, timeout=0)
    plt.close(fig)
    if not points:
        raise RuntimeError("Pusat transmitted beam belum dipilih.")
    return float(points[0][0]), float(points[0][1])


def radial_profile(image, cx, cy):
    rows, cols = image.shape
    yy, xx = np.indices(image.shape)
    rr = np.sqrt((xx - cx)**2 + (yy - cy)**2)
    max_r = int(min(cx, cy, cols - 1 - cx, rows - 1 - cy))
    bins = np.floor(rr).astype(np.int32)
    valid = bins <= max_r
    sums = np.bincount(bins[valid].ravel(), weights=image[valid].ravel(),
                       minlength=max_r + 1)
    counts = np.bincount(bins[valid].ravel(), minlength=max_r + 1)
    profile = sums / np.maximum(counts, 1)
    kernel = np.array([1, 2, 3, 2, 1], dtype=float)
    kernel /= kernel.sum()
    return np.arange(len(profile), dtype=float), np.convolve(profile, kernel, mode="same")


def find_candidates(radii, profile, min_radius=8, separation=5, max_candidates=30):
    peaks = []
    for i in range(max(2, min_radius), len(profile) - 2):
        if profile[i] >= profile[i-1] and profile[i] > profile[i+1]:
            local_min = min(profile[max(0, i-4):min(len(profile), i+5)])
            peaks.append((float(profile[i] - local_min, ), float(radii[i]), float(profile[i])))
    peaks.sort(reverse=True)
    selected = []
    for item in peaks:
        if all(abs(item[1] - prev[1]) >= separation for prev in selected):
            selected.append(item)
        if len(selected) >= max_candidates:
            break
    return sorted(selected, key=lambda x: x[1])


def plot_candidates(image, cx, cy, radii, profile, candidates):
    fig, ax = plt.subplots(figsize=(12, 5))
    ax.plot(radii, profile)
    for idx, (_, r, intensity) in enumerate(candidates, 1):
        ax.axvline(r, linestyle="--", alpha=0.5)
        ax.text(r, intensity, str(idx), rotation=90, fontsize=8, va="bottom")
    ax.set_title("Profil radial: nomor = kandidat radius (piksel)")
    ax.set_xlabel("Radius dari pusat (piksel)")
    ax.set_ylabel("Rata-rata intensitas")
    ax.grid(alpha=0.25)
    plt.tight_layout()
    plt.show()

    fig, ax = plt.subplots(figsize=(10, 8))
    ax.imshow(image, cmap="gray", origin="upper")
    ax.plot(cx, cy, "r+", markersize=14, markeredgewidth=2)
    for idx, (_, r, _) in enumerate(candidates, 1):
        ax.add_patch(plt.Circle((cx, cy), r, fill=False, color="yellow", lw=0.8, alpha=0.8))
        tx = cx + r * math.cos(-math.pi / 4)
        ty = cy + r * math.sin(-math.pi / 4)
        ax.text(tx, ty, str(idx), color="black", fontsize=9, weight="bold",
                bbox=dict(facecolor="yellow", edgecolor="none", pad=1))
    ax.set_title("Citra difraksi dengan kandidat radius")
    ax.set_xlabel("x (piksel)")
    ax.set_ylabel("y (piksel)")
    plt.tight_layout()
    plt.show()


def ask_matches(candidates):
    print("\nReferensi standar aluminium:")
    for i, (hkl, d) in enumerate(REFERENCE, 1):
        print(f"{i}. Al ({hkl}), d = {d:.4f} Å")
    print("\nKandidat radius yang ditemukan:")
    for i, (_, r, intensity) in enumerate(candidates, 1):
        print(f"{i}. R = {r:.2f} px; radial intensity = {intensity:.3f}")
    print("\nMasukkan pasangan kandidat,referensi yang cocok, satu per baris.")
    print("Contoh 2,1 berarti kandidat radius #2 dipasangkan dengan Al (111) #1.")
    print("Gunakan hanya cincin yang tampak cocok pada citra. Enter kosong untuk selesai.")
    matches = []
    while True:
        raw = input("Pasangan kandidat,referensi: ").strip()
        if not raw:
            break
        try:
            ci, ri = [int(v.strip()) for v in raw.split(",")]
            if not (1 <= ci <= len(candidates) and 1 <= ri <= len(REFERENCE)):
                print("Nomor di luar rentang.")
                continue
            _, radius, _ = candidates[ci - 1]
            hkl, d = REFERENCE[ri - 1]
            matches.append({"hkl": hkl, "d_A": d, "r_px": radius})
        except ValueError:
            print("Format salah. Contoh: 2,1")
    if not matches:
        raise RuntimeError("Tidak ada cincin referensi yang dipilih.")
    return matches


def main():
    image_path = choose_image()
    pil = Image.open(image_path).convert("L")
    image = np.asarray(pil, dtype=np.float64)
    print(f"\nGambar: {image_path}")
    print(f"Dimensi: {pil.width} x {pil.height} px")

    voltage = ask_float("Tegangan elektron (kV)", 120.0)
    camera_length_m = ask_float("Camera length (m)", 0.2)
    lam_A = wavelength_angstrom(voltage)
    L_mm = camera_length_m * 1000
    K_mm_A = L_mm * lam_A

    print(f"Panjang gelombang = {lam_A:.6f} Å")
    print(f"Konstanta kamera Lλ = {K_mm_A:.6f} mm·Å")

    cx, cy = choose_center(image)
    print(f"Pusat: x={cx:.2f} px, y={cy:.2f} px")

    radii, profile = radial_profile(image, cx, cy)
    candidates = find_candidates(radii, profile)
    if not candidates:
        raise RuntimeError("Tidak ada kandidat cincin. Periksa citra/pusat.")
    plot_candidates(image, cx, cy, radii, profile, candidates)
    matches = ask_matches(candidates)

    # Calibration for each matched ring: R(mm) = L(mm)*lambda(Å)/d(Å).
    # scale(mm/px) = theoretical R(mm) / measured radius(px).
    scales_mm_px = []
    for m in matches:
        m["R_mm"] = K_mm_A / m["d_A"]
        m["scale_mm_px"] = m["R_mm"] / m["r_px"]
        m["scale_nm_px"] = m["scale_mm_px"] * 1e6
        scales_mm_px.append(m["scale_mm_px"])

    # Robust combined calibration from user-confirmed rings.
    scale_mm_px = float(np.median(scales_mm_px))
    scale_nm_px = scale_mm_px * 1e6
    px_per_mm = 1.0 / scale_mm_px

    print("\n=== HASIL KALIBRASI ===")
    print(f"Skala = {scale_mm_px:.9f} mm/px")
    print(f"Skala = {scale_nm_px:.3f} nm/px")
    print(f"Pixel density = {px_per_mm:.4f} px/mm")
    print("\nCincin yang digunakan untuk kalibrasi:")
    print(f"{'hkl':<7}{'d (Å)':>10}{'R teori (mm)':>16}{'R ukur (px)':>14}{'skala (nm/px)':>18}")
    for m in matches:
        print(f'{m["hkl"]:<7}{m["d_A"]:>10.4f}{m["R_mm"]:>16.4f}'
              f'{m["r_px"]:>14.2f}{m["scale_nm_px"]:>18.3f}')

    # Draw all reference rings using the calculated calibration.
    rings = []
    for hkl, d_A in REFERENCE:
        R_mm = K_mm_A / d_A
        r_px = R_mm / scale_mm_px
        rings.append({"hkl": hkl, "d_A": d_A, "R_mm": R_mm, "r_px": r_px})

    annotated = pil.convert("RGB")
    draw = ImageDraw.Draw(annotated)
    try:
        font = ImageFont.truetype("DejaVuSans.ttf", 13)
        small = ImageFont.truetype("DejaVuSans.ttf", 11)
    except OSError:
        font = ImageFont.load_default()
        small = ImageFont.load_default()

    colors = [(255,70,70), (255,165,0), (255,230,0), (70,255,100),
              (0,220,220), (70,150,255), (190,100,255), (255,90,210),
              (255,255,255)]
    draw.line((cx-8, cy, cx+8, cy), fill=(255,255,255), width=2)
    draw.line((cx, cy-8, cx, cy+8), fill=(255,255,255), width=2)

    width, height = pil.size
    for i, ring in enumerate(rings):
        color = colors[i % len(colors)]
        r = ring["r_px"]
        draw.ellipse((cx-r, cy-r, cx+r, cy+r), outline=color, width=2)
        tx = cx + r * math.cos(-math.pi/4) + 4
        ty = cy + r * math.sin(-math.pi/4) - 10
        label = f'{ring["hkl"]}: R={r:.1f}px, d={ring["d_A"]:.4f}A'
        tx = min(max(2, tx), max(2, width-220))
        ty = min(max(2, ty), max(2, height-20))
        draw.rectangle((tx-2, ty-2, tx+215, ty+16), fill=(0,0,0))
        draw.text((tx, ty), label, fill=color, font=small)

    summary = f"Scale={scale_nm_px:.3f} nm/px | V={voltage:g} kV | L={camera_length_m:g} m"
    draw.rectangle((5, 5, min(width-5, 520), 25), fill=(0,0,0))
    draw.text((10, 8), summary, fill=(255,255,255), font=font)

    out_png = image_path.with_name(image_path.stem + "_rings_calibrated.png")
    out_csv = image_path.with_name(image_path.stem + "_ring_calibration.csv")
    annotated.save(out_png)

    with open(out_csv, "w", newline="", encoding="utf-8-sig") as f:
        writer = csv.writer(f)
        writer.writerow(["hkl", "d_reference_A", "R_theory_mm", "R_predicted_px",
                         "scale_nm_per_px", "center_x_px", "center_y_px"])
        for ring in rings:
            writer.writerow([ring["hkl"], ring["d_A"], ring["R_mm"], ring["r_px"],
                             scale_nm_px, cx, cy])

    print(f"\nCitra berlabel disimpan: {out_png}")
    print(f"Tabel CSV disimpan: {out_csv}")
    print("Radius kandidat otomatis harus diverifikasi secara visual.")
    print("Jika menggunakan material selain Al, edit daftar REFERENCE di awal script.")


if __name__ == "__main__":
    main()
