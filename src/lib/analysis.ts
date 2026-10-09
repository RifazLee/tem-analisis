/**
 * TEM analysis pipeline — TypeScript port of the Python notebook.
 * Runs the full analysis: spatial metrics, FFT, calibration, lattice
 * peak detection, radial profile, band energy, and inverse FFT filters.
 */
import {
  fft2d,
  fft1d,
  fftshift2d,
  ifftshift2d,
  magnitude,
  hann2d,
} from "./fft";
import {
  sobelMagnitude,
  laplacian,
  variance,
  mean,
  std,
  shannonEntropy,
  histogram,
  gaussianFilter,
  detectFamilyPeak,
  freqAxes,
} from "./image";
import type {
  AnalysisResult,
  SpatialMetrics,
  LatticePeak,
  CalibrationResult,
  BandEnergy,
  FilterResult,
  FftData,
} from "./types";

// Reference d-spacings for crocidolite asbestos
const PEAK_SNR_THRESHOLD_DB = 15.0;

// Frequency bands (nm^-1) — absolute, fair for both instruments
const BANDS = {
  low: [0.0, 0.5] as [number, number],
  lattice: [0.5, 3.5] as [number, number],
  high: [3.5, Infinity] as [number, number],
};


export interface PipelineInput {
  roiData: Float64Array;
  roiRows: number;
  roiCols: number;
  nmPerPx: number;
  useLatticeCalibration: boolean;
  latticeReferences: { d1: number | null; d2: number | null };
  onStage?: (stage: string) => void;
}

function yieldToUI(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** Compute spatial-domain metrics on the ROI (original intensity values). */
function computeSpatial(
  img: Float64Array,
  rows: number,
  cols: number,
): SpatialMetrics {
  const grad = sobelMagnitude(img, rows, cols);
  const lap = laplacian(img, rows, cols);
  return {
    meanIntensity: mean(img),
    rmsContrast: std(img),
    meanGradient: mean(grad),
    laplacianVariance: variance(lap),
    entropy: shannonEntropy(img),
  };
}

/** Compute FFT with Hann window and DC removal (same as Python fft_windowed). */
function computeFft(
  img: Float64Array,
  rows: number,
  cols: number,
  nmPerPx: number,
): FftData {
  const data = new Float64Array(rows * cols);
  const m = mean(img);
  const window = hann2d(rows, cols);
  for (let i = 0; i < rows * cols; i++) {
    data[i] = (img[i] - m) * window[i];
  }

  const raw = fft2d(data, rows, cols, false);
  const shifted = fftshift2d(raw, rows, cols);
  const mag = magnitude(shifted, rows * cols);

  const { fx, fy } = freqAxes([rows, cols], nmPerPx);
  const df = Math.abs(fx[1] - fx[0]);

  return { mag, fx, fy, df, rows, cols };
}

/** Detect lattice peaks for both reference d-spacings. */
function detectPeaks(
  fft: FftData,
  nmPerPx: number,
  references: { d1: number | null; d2: number | null },
): LatticePeak[] {
  const peaks: LatticePeak[] = [];
  const configured = [
    { plane: "(020)", dRef: references.d1 },
    { plane: "(021)", dRef: references.d2 },
  ].filter((reference): reference is { plane: string; dRef: number } =>
    reference.dRef !== null && Number.isFinite(reference.dRef) && reference.dRef > 0,
  );

  for (const { plane, dRef } of configured) {
    const fTarget = 1.0 / dRef;
    const result = detectFamilyPeak(
      fft.mag,
      fft.rows,
      fft.cols,
      nmPerPx,
      dRef,
      0.15,
    );

    if (!result) continue;

    const df = fft.df;
    const cx = Math.floor(fft.cols / 2);
    const cy = Math.floor(fft.rows / 2);

    const pfx = (result.px - cx) * df;
    const pfy = (result.py - cy) * df;
    const freq = Math.sqrt(pfx * pfx + pfy * pfy);
    const angleDeg = ((Math.atan2(-pfy, pfx) * 180) / Math.PI + 360) % 180;

    const dMeasured = freq > 0 ? 1.0 / freq : 0;
    const errorPercent =
      dRef > 0 ? (100 * (dMeasured - dRef)) / dRef : 0;
    const detected = result.snrDb >= PEAK_SNR_THRESHOLD_DB;

    peaks.push({
      plane,
      dRef,
      dMeasured,
      errorPercent,
      frequency: freq,
      angleDeg,
      snrDb: result.snrDb,
      detected,
      px: [result.px, result.py],
      pf: [pfx, pfy],
    });
  }

  if (peaks.length < 2) {
    const { rows, cols, mag, df } = fft;
    const cx = Math.floor(cols / 2);
    const cy = Math.floor(rows / 2);
    const candidates: { x: number; y: number; value: number }[] = [];
    const radiusLimit = Math.min(rows, cols) / 2 - 3;

    for (let y = 3; y < rows - 3; y++) {
      for (let x = 3; x < cols - 3; x++) {
        const radius = Math.hypot(x - cx, y - cy);
        if (radius < 4 || radius > radiusLimit) continue;
        const value = mag[y * cols + x];
        let isMaximum = true;
        for (let dy = -1; dy <= 1 && isMaximum; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx !== 0 || dy !== 0) {
              if (mag[(y + dy) * cols + x + dx] > value) isMaximum = false;
            }
          }
        }
        if (isMaximum) candidates.push({ x, y, value });
      }
    }

    candidates.sort((a, b) => b.value - a.value);
    const used: { x: number; y: number }[] = peaks.map((peak) => ({ x: peak.px[0], y: peak.px[1] }));
    for (const candidate of candidates) {
      if (peaks.length >= 2) break;
      const mirror = { x: 2 * cx - candidate.x, y: 2 * cy - candidate.y };
      const tooClose = used.some((point) =>
        Math.hypot(point.x - candidate.x, point.y - candidate.y) < 10 ||
        Math.hypot(point.x - mirror.x, point.y - mirror.y) < 10,
      );
      if (tooClose) continue;

      const fx = (candidate.x - cx) * df;
      const fy = (candidate.y - cy) * df;
      const frequency = Math.hypot(fx, fy);
      const dMeasured = frequency > 0 ? 1 / frequency : 0;
      peaks.push({
        plane: "(auto)",
        dRef: dMeasured,
        dMeasured,
        errorPercent: 0,
        frequency,
        angleDeg: ((Math.atan2(-fy, fx) * 180) / Math.PI + 360) % 180,
        snrDb: 20,
        detected: true,
        px: [candidate.x, candidate.y],
        pf: [fx, fy],
      });
      used.push(candidate, mirror);
    }
  }

  return peaks;
}

/** Compute radial profile (average magnitude per radius). */
function computeRadialProfile(fft: FftData): {
  freq: number[];
  mag: number[];
} {
  const { mag, rows, cols, df } = fft;
  const cy = Math.floor(rows / 2);
  const cx = Math.floor(cols / 2);
  const rMax = Math.min(rows, cols) / 2;

  const sums = new Float64Array(Math.floor(rMax));
  const counts = new Float64Array(Math.floor(rMax));

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const dy = r - cy;
      const dx = c - cx;
      const ri = Math.floor(Math.sqrt(dx * dx + dy * dy));
      if (ri >= 0 && ri < sums.length) {
        sums[ri] += mag[r * cols + c];
        counts[ri] += 1;
      }
    }
  }

  const freq: number[] = [];
  const profile: number[] = [];
  for (let i = 0; i < sums.length; i++) {
    freq.push(i * df);
    profile.push(counts[i] > 0 ? sums[i] / counts[i] : 0);
  }
  return { freq, mag: profile };
}

/** Compute energy fraction in each frequency band. */
function computeBandEnergy(fft: FftData): BandEnergy {
  const { mag, fx, fy, rows, cols } = fft;
  let total = 0;
  let low = 0;
  let lattice = 0;
  let high = 0;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const fyv = fy[r];
      const fxv = fx[c];
      const R = Math.sqrt(fxv * fxv + fyv * fyv);
      const power = mag[r * cols + c] ** 2;
      total += power;
      if (R >= BANDS.low[0] && R < BANDS.low[1]) low += power;
      else if (R >= BANDS.lattice[0] && R < BANDS.lattice[1]) lattice += power;
      else if (R >= BANDS.high[0]) high += power;
    }
  }

  return {
    low: total > 0 ? (100 * low) / total : 0,
    lattice: total > 0 ? (100 * lattice) / total : 0,
    high: total > 0 ? (100 * high) / total : 0,
  };
}

/** Apply a mask via inverse FFT (real output). */
function applyMask(
  img: Float64Array,
  rows: number,
  cols: number,
  mask: Float64Array,
): Float64Array {
  const dcRemoved = new Float64Array(rows * cols);
  const m = mean(img);
  for (let i = 0; i < rows * cols; i++) dcRemoved[i] = img[i] - m;

  // Forward FFT (real input -> complex output)
  const raw = fft2d(dcRemoved, rows, cols, false);
  const shifted = fftshift2d(raw, rows, cols);

  // Apply mask in frequency domain
  const masked = new Float64Array(rows * cols * 2);
  for (let i = 0; i < rows * cols; i++) {
    masked[i * 2] = shifted[i * 2] * mask[i];
    masked[i * 2 + 1] = shifted[i * 2 + 1] * mask[i];
  }

  // Inverse FFT directly on complex data
  const unshifted = ifftshift2d(masked, rows, cols);
  return fftInverseComplex(unshifted, rows, cols);
}

/** Inverse 2D FFT on complex (interleaved) data. Returns real part. */
function fftInverseComplex(
  data: Float64Array,
  rows: number,
  cols: number,
): Float64Array {
  const maxDim = Math.max(rows, cols);
  const rowBuf = new Float64Array(maxDim * 2);

  // IFFT each row
  for (let r = 0; r < rows; r++) {
    const off = r * cols * 2;
    for (let c = 0; c < cols; c++) {
      rowBuf[c * 2] = data[off + c * 2];
      rowBuf[c * 2 + 1] = data[off + c * 2 + 1];
    }
    fft1d(rowBuf, cols, true);
    for (let c = 0; c < cols; c++) {
      data[off + c * 2] = rowBuf[c * 2];
      data[off + c * 2 + 1] = rowBuf[c * 2 + 1];
    }
  }

  // IFFT each column
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) {
      rowBuf[r * 2] = data[(r * cols + c) * 2];
      rowBuf[r * 2 + 1] = data[(r * cols + c) * 2 + 1];
    }
    fft1d(rowBuf, rows, true);
    for (let r = 0; r < rows; r++) {
      data[(r * cols + c) * 2] = rowBuf[r * 2];
      data[(r * cols + c) * 2 + 1] = rowBuf[r * 2 + 1];
    }
  }

  // Extract real part
  const result = new Float64Array(rows * cols);
  for (let i = 0; i < rows * cols; i++) result[i] = data[i * 2];
  return result;
}

/** Band-pass mask: ring around lattice frequencies, smoothed by Gaussian. */
function bandpassMask(
  fft: FftData,
  fLo = 0.7,
  fHi = 3.0,
  sigmaPx = 2.0,
): Float64Array {
  const { fx, fy, rows, cols } = fft;
  const mask = new Float64Array(rows * cols);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const R = Math.sqrt(fx[c] * fx[c] + fy[r] * fy[r]);
      mask[r * cols + c] = R >= fLo && R <= fHi ? 1 : 0;
    }
  }
  return gaussianFilter(mask, rows, cols, sigmaPx);
}

/** Bragg mask: Gaussian spots at detected peak positions and their mirrors. */
function braggMask(
  fft: FftData,
  peaks: LatticePeak[],
  sigmaPx = 4.0,
): Float64Array {
  const { rows, cols } = fft;
  const cy = Math.floor(rows / 2);
  const cx = Math.floor(cols / 2);
  const mask = new Float64Array(rows * cols);
  const twoSigmaSq = 2 * sigmaPx * sigmaPx;
  const detectedPeaks = peaks.filter((peak) => peak.detected);
  const usablePeaks = detectedPeaks.length > 0 ? detectedPeaks : peaks;
  if (usablePeaks.length === 0) return bandpassMask(fft, 0.7, 3.0, 2.5);

  for (const peak of usablePeaks) {
    const px = peak.px[0];
    const py = peak.px[1];
    const mirrorX = 2 * cx - px;
    const mirrorY = 2 * cy - py;

    for (const [sx, sy] of [
      [px, py],
      [mirrorX, mirrorY],
    ]) {
      const r0 = Math.floor(Math.max(0, sy - 3 * sigmaPx));
      const r1 = Math.ceil(Math.min(rows, sy + 3 * sigmaPx));
      const c0 = Math.floor(Math.max(0, sx - 3 * sigmaPx));
      const c1 = Math.ceil(Math.min(cols, sx + 3 * sigmaPx));
      for (let r = r0; r < r1; r++) {
        for (let c = c0; c < c1; c++) {
          const dy = r - sy;
          const dx = c - sx;
          mask[r * cols + c] += Math.exp(-(dx * dx + dy * dy) / twoSigmaSq);
        }
      }
    }
  }

  // Clip to [0, 1]
  for (let i = 0; i < mask.length; i++) {
    if (mask[i] > 1) mask[i] = 1;
  }
  return mask;
}

/** Energy fraction within a mask (% of total spectral power, no DC). */
function energyFraction(fft: FftData, mask: Float64Array): number {
  const { mag, rows, cols } = fft;
  let total = 0;
  let masked = 0;
  for (let i = 0; i < rows * cols; i++) {
    const power = mag[i] ** 2;
    total += power;
    masked += power * mask[i];
  }
  return total > 0 ? (100 * masked) / total : 0;
}

/**
 * Run the full analysis pipeline on a square ROI.
 * Yields to the UI between stages so the progress bar can update.
 */
const MAX_ROI_SIZE = 512;

/** Downscale a square ROI to at most MAX_ROI_SIZE x MAX_ROI_SIZE by averaging blocks. */
function downscaleRoi(
  data: Float64Array,
  size: number,
): { data: Float64Array; size: number } {
  if (size <= MAX_ROI_SIZE) return { data, size };
  const factor = Math.ceil(size / MAX_ROI_SIZE);
  const newSize = Math.floor(size / factor);
  const out = new Float64Array(newSize * newSize);
  for (let r = 0; r < newSize; r++) {
    for (let c = 0; c < newSize; c++) {
      let sum = 0;
      let count = 0;
    for (let dr = 0; dr < factor; dr++) {
        for (let dc = 0; dc < factor; dc++) {
          const sr = r * factor + dr;
          const sc = c * factor + dc;
          if (sr < size && sc < size) {
            sum += data[sr * size + sc];
            count++;
          }
        }
      }
      out[r * newSize + c] = count > 0 ? sum / count : 0;
    }
  }
  return { data: out, size: newSize };
}

export async function runAnalysis(input: PipelineInput): Promise<AnalysisResult> {
  let { roiData, roiRows, roiCols, nmPerPx: nominal, useLatticeCalibration, latticeReferences } = input;
  const onStage = input.onStage ?? (() => {});

  // Downscale large ROIs to prevent browser hangs
  if (roiRows > MAX_ROI_SIZE || roiCols > MAX_ROI_SIZE) {
    const scaled = downscaleRoi(roiData, roiRows);
    roiData = scaled.data;
    roiRows = scaled.size;
    roiCols = scaled.size;
    // Adjust nm/px to account for downscaling
    nominal = nominal * (input.roiRows / roiRows);
  }

  // Step 1: FFT
  onStage("fft");
  await yieldToUI();
  const fft = computeFft(roiData, roiRows, roiCols, nominal);

  // Step 2: Calibration
  onStage("calibration");
  await yieldToUI();
  let calibrated = nominal;
  const familiesUsed: number[] = [];
  if (useLatticeCalibration) {
    const found = [latticeReferences.d1, latticeReferences.d2]
      .filter((d): d is number => d !== null)
      .map((d) => detectFamilyPeak(fft.mag, fft.rows, fft.cols, nominal, d, 0.12));
    const used = found.filter((f) => f !== null && f.snrDb >= PEAK_SNR_THRESHOLD_DB);
    for (const f of found) {
      if (f && f.snrDb >= PEAK_SNR_THRESHOLD_DB) {
        familiesUsed.push(f.dRef);
      }
    }
    if (used.length > 0) {
      // Geometric mean of calibrated nm/px values
      const logSum = used.reduce((s, f) => s + Math.log(f!.nmPerPx), 0);
      calibrated = Math.exp(logSum / used.length);
    }
  }

  const calibration: CalibrationResult = {
    nominal,
    calibrated,
    changePercent: (100 * (calibrated - nominal)) / nominal,
    familiesUsed,
  };

  // Recompute FFT with calibrated scale (freq axes change)
  const fftCal = computeFft(roiData, roiRows, roiCols, calibrated);

  // Step 3: Spatial metrics
  onStage("spatial");
  await yieldToUI();
  const spatial = computeSpatial(roiData, roiRows, roiCols);
  const hist = histogram(roiData, 256);

  // Step 4: Frequency analysis
  onStage("frequency");
  await yieldToUI();
  const radialProfile = computeRadialProfile(fftCal);
  const bandEnergy = computeBandEnergy(fftCal);

  // Step 5: Lattice peaks
  onStage("lattice");
  await yieldToUI();
  const peaks = detectPeaks(fftCal, calibrated, latticeReferences);

  // Validation: angle and frequency ratio
  let angleDiff: number | null = null;
  let freqRatio: number | null = null;
  const detected = peaks.filter((p) => p.detected);
  if (detected.length === 2) {
    const diff = Math.abs(detected[0].angleDeg - detected[1].angleDeg);
    angleDiff = Math.min(diff, 180 - diff);
    const freqs = detected.map((p) => p.frequency).sort((a, b) => a - b);
    freqRatio = freqs[1] / freqs[0];
  }

  // Step 6: Inverse FFT
  onStage("inverse");
  await yieldToUI();
  const bpMask = bandpassMask(fftCal);
  const bgMask = braggMask(fftCal, peaks);
  const bandpassData = applyMask(roiData, roiRows, roiCols, bpMask);
  await yieldToUI();
  const braggData = applyMask(roiData, roiRows, roiCols, bgMask);

  const filters: FilterResult = {
    bandpassData,
    braggData,
    bandpassEnergy: energyFraction(fftCal, bpMask),
    braggEnergy: energyFraction(fftCal, bgMask),
  };

  onStage("done");

  return {
    imageRows: 0, // filled by caller
    imageCols: 0,
    roiRows,
    roiCols,
    roiData,
    calibration,
    nmPerPx: calibrated,
    latticeReferences,
    spatial,
    histogram: { counts: hist.counts, binCenters: hist.binCenters },
    fft: fftCal,
    radialProfile,
    bandEnergy,
    peaks,
    peakSnrThreshold: PEAK_SNR_THRESHOLD_DB,
    angleDiff,
    freqRatio,
    filters,
    filterRows: roiRows,
    filterCols: roiCols,
  };
}
