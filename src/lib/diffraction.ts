/**
 * Physics calculations and image processing for TEM diffraction calibration.
 *
 * All functions are pure and independently testable.
 */

import { loadTiff, type LoadedImage } from "./tiff";

/**
 * Load any supported image format (TIFF, PNG, JPEG, BMP) into a grayscale Float64Array.
 * TIFF uses the existing utif-based loader; other formats use canvas decoding.
 */
export async function loadDiffractionImage(file: File): Promise<LoadedImage> {
  const name = file.name.toLowerCase();
  if (name.endsWith(".tif") || name.endsWith(".tiff")) {
    return loadTiff(file);
  }

  // For PNG/JPEG/BMP, use an Image element + canvas
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("Gagal memuat gambar. Format tidak didukung."));
      el.src = url;
    });

    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas tidak tersedia di browser ini.");
    ctx.drawImage(img, 0, 0);
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

    const w = canvas.width;
    const h = canvas.height;
    const data = new Float64Array(w * h);
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < w * h; i++) {
      const r = imageData.data[i * 4];
      const g = imageData.data[i * 4 + 1];
      const b = imageData.data[i * 4 + 2];
      const gray = (r + g + b) / 3;
      data[i] = gray;
      if (gray < min) min = gray;
      if (gray > max) max = gray;
    }

    return {
      data,
      rows: h,
      cols: w,
      originalRows: h,
      originalCols: w,
      dtype: "8-bit",
      min,
      max,
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}

// Physical constants (SI)
const H = 6.62607015e-34; // Planck constant (J·s)
const ME = 9.1093837139e-31; // electron rest mass (kg)
const E_CHARGE = 1.602176634e-19; // elementary charge (C)
const C = 299792458.0; // speed of light (m/s)

/**
 * Relativistic de Broglie electron wavelength.
 * @param voltageKv accelerating voltage in kV
 * @returns wavelength in Angstrom (Å)
 */
export function electronWavelength(voltageKv: number): number {
  const V = voltageKv * 1000.0;
  if (V <= 0) return NaN;
  const wavelengthM =
    H / Math.sqrt(2 * ME * E_CHARGE * V * (1 + (E_CHARGE * V) / (2 * ME * C * C)));
  return wavelengthM * 1e10; // m → Å
}

/**
 * Camera constant Lλ in mm·Å.
 * @param cameraLengthM camera length in meters
 * @param wavelengthA electron wavelength in Å
 */
export function cameraConstant(cameraLengthM: number, wavelengthA: number): number {
  return cameraLengthM * 1000.0 * wavelengthA;
}

/**
 * Theoretical ring radius in mm for a given d-spacing.
 * R = Lλ / d
 */
export function theoreticalRadiusMm(cameraConst: number, dSpacingA: number): number {
  if (dSpacingA <= 0) return NaN;
  return cameraConst / dSpacingA;
}

// ── Radial profile ──

export interface RadialProfileResult {
  radii: number[]; // pixel radii (bin centers as float indices)
  intensity: number[]; // mean intensity per bin
}

/**
 * Compute the radial intensity profile of an image about a center point.
 * Each pixel is assigned to floor(distance) bin; intensity = mean per bin.
 */
export function radialProfile(
  data: Float64Array,
  rows: number,
  cols: number,
  cx: number,
  cy: number,
): RadialProfileResult {
  const maxR = Math.max(1, Math.floor(Math.min(cx, cy, cols - 1 - cx, rows - 1 - cy)));
  const sums = new Float64Array(maxR + 1);
  const counts = new Float64Array(maxR + 1);

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const dy = r - cy;
      const dx = c - cx;
      const dist = Math.sqrt(dy * dy + dx * dx);
      const bin = Math.floor(dist);
      if (bin >= 0 && bin <= maxR) {
        sums[bin] += data[r * cols + c];
        counts[bin] += 1;
      }
    }
  }

  const radii: number[] = [];
  const intensity: number[] = [];
  for (let i = 0; i <= maxR; i++) {
    radii.push(i);
    intensity.push(counts[i] > 0 ? sums[i] / counts[i] : 0);
  }

  // Light smoothing: [1,2,3,2,1] / 9
  const kernel = [1, 2, 3, 2, 1];
  const kSum = 9;
  const smoothed: number[] = new Array(intensity.length);
  for (let i = 0; i < intensity.length; i++) {
    let acc = 0;
    for (let k = -2; k <= 2; k++) {
      const idx = Math.max(0, Math.min(intensity.length - 1, i + k));
      acc += intensity[idx] * kernel[k + 2];
    }
    smoothed[i] = acc / kSum;
  }

  return { radii, intensity: smoothed };
}

// ── Peak detection ──

export interface RingCandidate {
  index: number; // 1-based candidate number
  radiusPx: number;
  intensity: number;
  prominence: number;
}

/**
 * Detect candidate diffraction ring radii from a radial profile.
 * Finds local maxima with prominence above a threshold, separated by minSeparation.
 */
export function detectRingCandidates(
  radii: number[],
  profile: number[],
  minRadius = 8,
  separation = 5,
  maxCandidates = 30,
): RingCandidate[] {
  const peaks: { prominence: number; radius: number; intensity: number }[] = [];

  for (let i = Math.max(2, minRadius); i < profile.length - 2; i++) {
    if (profile[i] >= profile[i - 1] && profile[i] > profile[i + 1]) {
      const localMin = Math.min(
        ...profile.slice(Math.max(0, i - 4), Math.min(profile.length, i + 5)),
      );
      const prominence = profile[i] - localMin;
      if (prominence > 0) {
        peaks.push({ prominence, radius: radii[i], intensity: profile[i] });
      }
    }
  }

  peaks.sort((a, b) => b.prominence - a.prominence);

  const selected: typeof peaks[] = [];
  for (const p of peaks) {
    if (selected.every((s) => Math.abs(p.radius - s.radius) >= separation)) {
      selected.push(p);
    }
    if (selected.length >= maxCandidates) break;
  }

  selected.sort((a, b) => a.radius - b.radius);

  return selected.map((p, i) => ({
    index: i + 1,
    radiusPx: p.radius,
    intensity: p.intensity,
    prominence: p.prominence,
  }));
}

// ── Calibration ──

export interface RingMatch {
  candidateIndex: number;
  hkl: string;
  dSpacingA: number;
  radiusPx: number; // measured
  theoreticalRadiusMm: number;
  scaleMmPerPx: number;
  scaleNmPerPx: number;
}

export interface CalibrationResult {
  wavelengthA: number;
  wavelengthNm: number;
  cameraConstantMmA: number;
  matches: RingMatch[];
  scaleMmPerPx: number; // median of confirmed rings
  scaleNmPerPx: number;
  pixelPerMm: number;
  ringCount: number;
  hasWarning: boolean;
  warningMessage: string | null;
}

/**
 * Compute calibration from confirmed ring matches.
 * Returns NaN-based result if no valid matches.
 */
export function computeCalibration(
  voltageKv: number,
  cameraLengthM: number,
  matches: { hkl: string; dSpacingA: number; radiusPx: number }[],
): CalibrationResult {
  const wavelengthA = electronWavelength(voltageKv);
  const wavelengthNm = wavelengthA / 10;
  const camConst = cameraConstant(cameraLengthM, wavelengthA);

  const ringMatches: RingMatch[] = matches.map((m) => {
    const R_mm = theoreticalRadiusMm(camConst, m.dSpacingA);
    const scaleMmPx = R_mm / m.radiusPx;
    return {
      candidateIndex: 0,
      hkl: m.hkl,
      dSpacingA: m.dSpacingA,
      radiusPx: m.radiusPx,
      theoreticalRadiusMm: R_mm,
      scaleMmPerPx: scaleMmPx,
      scaleNmPerPx: scaleMmPx * 1e6,
    };
  });

  const scales = ringMatches.map((m) => m.scaleMmPerPx);
  const sortedScales = [...scales].sort((a, b) => a - b);
  const medianScale = sortedScales.length > 0
    ? sortedScales[Math.floor(sortedScales.length / 2)]
    : NaN;

  let hasWarning = false;
  let warningMessage: string | null = null;

  if (ringMatches.length === 0) {
    hasWarning = true;
    warningMessage = "Tidak ada cincin referensi yang dikonfirmasi.";
  } else if (ringMatches.length === 1) {
    hasWarning = true;
    warningMessage =
      "Hanya satu cincin yang digunakan. Hasil kalibrasi kurang andal — tambahkan cincin lain untuk validasi.";
  } else {
    const maxScale = Math.max(...scales);
    const minScale = Math.min(...scales);
    const spread = Math.abs(maxScale - minScale) / medianScale;
    if (spread > 0.05) {
      hasWarning = true;
      warningMessage = `Selisih skala antar cincin cukup besar (${(spread * 100).toFixed(1)}%). Periksa kembali pasangan cincin dengan referensi.`;
    }
  }

  return {
    wavelengthA,
    wavelengthNm,
    cameraConstantMmA: camConst,
    matches: ringMatches,
    scaleMmPerPx: medianScale,
    scaleNmPerPx: medianScale * 1e6,
    pixelPerMm: 1 / medianScale,
    ringCount: ringMatches.length,
    hasWarning,
    warningMessage,
  };
}

/**
 * Predict ring radius in pixels for all reference d-spacings using a calibration scale.
 */
export function predictedRingRadiiPx(
  cameraConst: number,
  scaleMmPerPx: number,
  references: { hkl: string; dSpacingA: number }[],
): { hkl: string; dSpacingA: number; theoreticalRadiusMm: number; radiusPx: number }[] {
  return references.map((ref) => {
    const R_mm = theoreticalRadiusMm(cameraConst, ref.dSpacingA);
    return {
      hkl: ref.hkl,
      dSpacingA: ref.dSpacingA,
      theoreticalRadiusMm: R_mm,
      radiusPx: R_mm / scaleMmPerPx,
    };
  });
}
