/**
 * Wiener filter implementation for HREM image enhancement.
 * Reference: Marks, L. D. (1996), Wiener-filter enhancement of noisy HREM images.
 *
 * Methods:
 *   - conventional: classical power-spectrum Wiener gain
 *   - parametric: parametric Wiener gain with regularization λ
 *   - cannon: Cannon-style square-root gain
 *   - random_phase_parametric: stabilized approximation (experimental)
 */

import { fft2d, fft2dComplex, fftshift2d, ifftshift2d } from "./fft";

export type WienerMethod =
  | "conventional"
  | "parametric"
  | "cannon"
  | "random_phase_parametric";

export interface WienerParams {
  method: WienerMethod;
  noiseScale: number;
  regularization: number;
  stabilization: number;
}

export interface WienerResult {
  data: Float64Array;
  rows: number;
  cols: number;
}

const EPS = 2.220446049250313e-16; // np.finfo(float64).eps

function hanning(n: number): Float64Array {
  const w = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
  }
  return w;
}

function hanning2d(rows: number, cols: number): Float64Array {
  const wr = hanning(rows);
  const wc = hanning(cols);
  const w = new Float64Array(rows * cols);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      w[r * cols + c] = wr[r] * wc[c];
    }
  }
  return w;
}

/**
 * Estimate noise power spectrum using a smoothed radial profile.
 * Uses the lower percentile of power at each radial frequency bin.
 */
function estimateNoisePsd(
  image: Float64Array,
  rows: number,
  cols: number,
  smoothSigma = 1.0,
  noisePercentile = 25,
): Float64Array {
  const centered = new Float64Array(rows * cols);
  let mean = 0;
  for (let i = 0; i < rows * cols; i++) mean += image[i];
  mean /= rows * cols;
  for (let i = 0; i < rows * cols; i++) centered[i] = image[i] - mean;

  const window = hanning2d(rows, cols);
  const windowed = new Float64Array(rows * cols);
  for (let i = 0; i < rows * cols; i++) windowed[i] = centered[i] * window[i];

  // FFT
  const spectrum = fft2d(windowed, rows, cols, false);
  const shifted = fftshift2d(spectrum, rows, cols);

  // Power = |spectrum|^2
  const power = new Float64Array(rows * cols);
  for (let i = 0; i < rows * cols; i++) {
    const re = shifted[i * 2];
    const im = shifted[i * 2 + 1];
    power[i] = re * re + im * im;
  }

  const cy = Math.floor(rows / 2);
  const cx = Math.floor(cols / 2);
  const maxBin = Math.min(rows, cols) / 2;
  const maxBinInt = Math.floor(maxBin);

  // Radial profile via percentile per bin
  const radialProfile = new Float64Array(maxBinInt + 1);
  for (let r = 0; r <= maxBinInt; r++) {
    const values: number[] = [];
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const dy = row - cy;
        const dx = col - cx;
        const dist = Math.sqrt(dy * dy + dx * dx);
        if (Math.floor(dist) === r) {
          values.push(power[row * cols + col]);
        }
      }
    }
    if (values.length > 0) {
      values.sort((a, b) => a - b);
      const idx = Math.floor((noisePercentile / 100) * values.length);
      radialProfile[r] = values[Math.min(idx, values.length - 1)];
    }
  }

  // Interpolate over zero/invalid bins
  const validBins: number[] = [];
  const validVals: number[] = [];
  for (let r = 0; r <= maxBinInt; r++) {
    if (radialProfile[r] > 0) {
      validBins.push(r);
      validVals.push(radialProfile[r]);
    }
  }
  if (validBins.length < 2) {
    throw new Error("Estimasi spektrum noise tidak valid.");
  }

  for (let r = 0; r <= maxBinInt; r++) {
    radialProfile[r] = interpLinear(validBins, validVals, r);
  }

  // Gaussian smoothing of radial profile
  gaussianSmooth1d(radialProfile, smoothSigma);

  // Extend radially over full frequency plane
  const noisePsd = new Float64Array(rows * cols);
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const dy = row - cy;
      const dx = col - cx;
      const dist = Math.min(Math.sqrt(dy * dy + dx * dx), maxBin);
      noisePsd[row * cols + col] = radialProfile[Math.floor(dist)];
    }
  }

  // Ensure positive
  for (let i = 0; i < rows * cols; i++) {
    if (noisePsd[i] <= 0) noisePsd[i] = EPS;
  }

  return noisePsd;
}

function interpLinear(xs: number[], ys: number[], x: number): number {
  if (x <= xs[0]) return ys[0];
  if (x >= xs[xs.length - 1]) return ys[ys.length - 1];
  for (let i = 0; i < xs.length - 1; i++) {
    if (x >= xs[i] && x <= xs[i + 1]) {
      const t = (x - xs[i]) / (xs[i + 1] - xs[i]);
      return ys[i] + t * (ys[i + 1] - ys[i]);
    }
  }
  return ys[ys.length - 1];
}

function gaussianSmooth1d(arr: Float64Array, sigma: number): void {
  if (sigma <= 0) return;
  const n = arr.length;
  const radius = Math.max(1, Math.ceil(sigma * 3));
  const kernel: number[] = [];
  let sum = 0;
  for (let i = -radius; i <= radius; i++) {
    const v = Math.exp(-(i * i) / (2 * sigma * sigma));
    kernel.push(v);
    sum += v;
  }
  for (let i = 0; i < kernel.length; i++) kernel[i] /= sum;

  const result = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let acc = 0;
    for (let k = -radius; k <= radius; k++) {
      const idx = Math.max(0, Math.min(n - 1, i + k));
      acc += arr[idx] * kernel[k + radius];
    }
    result[i] = acc;
  }
  for (let i = 0; i < n; i++) arr[i] = result[i];
}

/**
 * Apply Wiener filtering to a 2D grayscale ROI.
 * Returns filtered data on approximately the original intensity scale.
 */
export function wienerFilterRoi(
  roi: Float64Array,
  rows: number,
  cols: number,
  params: WienerParams,
): WienerResult {
  const { method, noiseScale, regularization, stabilization } = params;

  if (rows < 16 || cols < 16) {
    throw new Error("ROI minimum 16 x 16 piksel.");
  }
  if (noiseScale <= 0) {
    throw new Error("Noise Scale harus > 0.");
  }
  if (method === "parametric" || method === "random_phase_parametric") {
    if (regularization <= 0) {
      throw new Error("Regularization (λ) harus > 0.");
    }
  }
  if (method === "random_phase_parametric") {
    if (stabilization < 0) {
      throw new Error("Stabilization tidak boleh negatif.");
    }
  }

  // Center intensity
  let meanIntensity = 0;
  for (let i = 0; i < rows * cols; i++) meanIntensity += roi[i];
  meanIntensity /= rows * cols;
  const centered = new Float64Array(rows * cols);
  for (let i = 0; i < rows * cols; i++) centered[i] = roi[i] - meanIntensity;

  // Hanning window to reduce boundary artifacts
  const window = hanning2d(rows, cols);
  for (let i = 0; i < rows * cols; i++) window[i] = Math.max(window[i], 1e-6);

  const windowed = new Float64Array(rows * cols);
  for (let i = 0; i < rows * cols; i++) windowed[i] = centered[i] * window[i];

  // FFT
  const spectrum = fft2d(windowed, rows, cols, false);
  const shifted = fftshift2d(spectrum, rows, cols);

  // Observed power
  const observedPower = new Float64Array(rows * cols);
  for (let i = 0; i < rows * cols; i++) {
    const re = shifted[i * 2];
    const im = shifted[i * 2 + 1];
    observedPower[i] = re * re + im * im;
  }

  // Estimate noise PSD
  const noisePsd = estimateNoisePsd(centered, rows, cols, 1.0, 25);
  for (let i = 0; i < rows * cols; i++) noisePsd[i] *= noiseScale;

  // Estimated signal power
  const signalPower = new Float64Array(rows * cols);
  for (let i = 0; i < rows * cols; i++) {
    signalPower[i] = Math.max(observedPower[i] - noisePsd[i], 0);
  }

  // Compute gain
  const gain = new Float64Array(rows * cols);
  let meanNoisePsd = 0;
  if (method === "random_phase_parametric") {
    for (let i = 0; i < rows * cols; i++) meanNoisePsd += noisePsd[i];
    meanNoisePsd /= rows * cols;
  }

  for (let i = 0; i < rows * cols; i++) {
    const sp = signalPower[i];
    const np = noisePsd[i];
    let g: number;

    switch (method) {
      case "conventional":
        g = sp / (sp + np + EPS);
        break;
      case "parametric":
        g = sp / (sp + regularization * np + EPS);
        break;
      case "cannon":
        g = Math.sqrt(sp / (sp + np + EPS));
        break;
      case "random_phase_parametric":
        g = sp / (sp + regularization * np + stabilization * meanNoisePsd + EPS);
        break;
      default:
        g = 1;
    }

    gain[i] = Math.max(0, Math.min(1, g));
  }

  // Apply gain to shifted spectrum
  const filteredShifted = new Float64Array(rows * cols * 2);
  for (let i = 0; i < rows * cols; i++) {
    filteredShifted[i * 2] = shifted[i * 2] * gain[i];
    filteredShifted[i * 2 + 1] = shifted[i * 2 + 1] * gain[i];
  }

  // Inverse FFT on interleaved complex data
  const unshifted = ifftshift2d(filteredShifted, rows, cols);
  const filteredComplex = fft2dComplex(unshifted, rows, cols, true);

  // Take real part, compensate for window, restore mean
  const filtered = new Float64Array(rows * cols);
  for (let i = 0; i < rows * cols; i++) {
    const windowedResult = filteredComplex[i * 2]; // real part
    let val = windowedResult / window[i] + meanIntensity;
    if (!isFinite(val)) val = roi[i];
    filtered[i] = val;
  }

  return { data: filtered, rows, cols };
}
