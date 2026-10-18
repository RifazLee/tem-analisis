/**
 * Wiener filter implementation for HREM image enhancement.
 * Reference: Marks, L. D. (1996), Wiener-filter enhancement of noisy HREM images.
 *            Ultramicroscopy 62, 43-52.
 *
 * Methods (paper section):
 *   - conventional:            Eq. (4)-(5)  F = |Se|^2 / |I|^2, |Se|^2 = |I|^2 - |n|^2 (if |I| > n, else 0)
 *   - cannon:                  Eq. (6)      square root of the conventional Wiener filter
 *   - parametric:              Eq. (8)      F = |Se|^2 / (|Se|^2 + lambda |n|^2)
 *   - parametric_cannon:       Sec. 2.3     square root of the parametric filter
 *   - random_phase_parametric: Eq. (9)      parametric filter + stabilization (APPROXIMATION,
 *                                           the paper gives no closed form for lambda2)
 *
 * For the parametric methods, lambda is by default determined automatically so that the
 * Lagrangian constraint  sum|n|^2 = sum|I - S|^2  (Eq. 10) holds, as in the paper
 * (the paper uses Newton-Raphson; here a bracketed bisection is used, which is more robust).
 */

import { fft2d, fft2dComplex, fftshift2d, ifftshift2d } from "./fft";

export type WienerMethod =
  | "conventional"
  | "parametric"
  | "cannon"
  | "parametric_cannon"
  | "random_phase_parametric";

export interface WienerParams {
  method: WienerMethod;
  /** Multiplier on the estimated noise level (1 = estimated level). */
  noiseScale: number;
  /** Lambda for parametric methods. Ignored when autoLambda is true. */
  regularization: number;
  /** Extra stabilization (not from the paper), only for random_phase_parametric. */
  stabilization: number;
  /** Solve lambda from the constraint of Eq. (10). Default: true for parametric methods. */
  autoLambda?: boolean;
}

export interface WienerResult {
  data: Float64Array;
  rows: number;
  cols: number;
  /** Lambda actually used (parametric methods only). */
  lambda?: number;
}

const EPS = 2.220446049250313e-16; // np.finfo(float64).eps
const EDGE_MIN_WINDOW = 0.1; // below this window value, blend back to the original pixel

function isParametric(method: WienerMethod): boolean {
  return (
    method === "parametric" ||
    method === "parametric_cannon" ||
    method === "random_phase_parametric"
  );
}

function hanning(n: number): Float64Array {
  if (n <= 1) {
    const w = new Float64Array(n);
    if (n === 1) w[0] = 1;
    return w;
  }
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
 * Estimate the noise PSD (radially averaged, as in the paper, Sec. 5) from an
 * already-computed shifted power spectrum.
 *
 * A low percentile of the power in each radial bin is used so that strong
 * signal peaks do not contaminate the estimate. For pure noise the power in a
 * bin is exponentially distributed (chi-square, 2 d.o.f.), so the p-quantile
 * equals  -ln(1-p) * mean.  The quantile is divided by -ln(1-p) so the result
 * is the expected noise power (otherwise noise is underestimated ~3.5x at p=25%).
 */
function estimateNoisePsdFromPower(
  power: Float64Array,
  rows: number,
  cols: number,
  smoothSigma = 1.0,
  noisePercentile = 25,
): Float64Array {
  const cy = Math.floor(rows / 2);
  const cx = Math.floor(cols / 2);
  const maxBinInt = Math.max(1, Math.floor(Math.min(rows, cols) / 2));
  const quantileToMean = -Math.log(1 - noisePercentile / 100);

  const binValues: number[][] = [];
  for (let r = 0; r <= maxBinInt; r++) binValues.push([]);

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const dy = row - cy;
      const dx = col - cx;
      const bin = Math.floor(Math.sqrt(dy * dy + dx * dx));
      if (bin <= maxBinInt) {
        binValues[bin].push(power[row * cols + col]);
      }
    }
  }

  const radialProfile = new Float64Array(maxBinInt + 1);
  for (let r = 0; r <= maxBinInt; r++) {
    const vals = binValues[r];
    if (vals.length > 0) {
      vals.sort((a, b) => a - b);
      const idx = Math.floor((noisePercentile / 100) * vals.length);
      radialProfile[r] = vals[Math.min(idx, vals.length - 1)] / quantileToMean;
    }
  }

  const validBins: number[] = [];
  const validVals: number[] = [];
  for (let r = 0; r <= maxBinInt; r++) {
    if (radialProfile[r] > 0) {
      validBins.push(r);
      validVals.push(radialProfile[r]);
    }
  }

  if (validBins.length < 2) {
    const allPower: number[] = [];
    for (let i = 0; i < rows * cols; i++) {
      if (power[i] > 0) allPower.push(power[i]);
    }
    const fallback = new Float64Array(rows * cols);
    if (allPower.length === 0) {
      fallback.fill(EPS);
      return fallback;
    }
    allPower.sort((a, b) => a - b);
    const idx = Math.floor((noisePercentile / 100) * allPower.length);
    const globalNoise = Math.max(
      allPower[Math.min(idx, allPower.length - 1)] / quantileToMean,
      EPS,
    );
    fallback.fill(globalNoise);
    return fallback;
  }

  for (let r = 0; r <= maxBinInt; r++) {
    radialProfile[r] = interpLinear(validBins, validVals, r);
  }

  gaussianSmooth1d(radialProfile, smoothSigma);

  const noisePsd = new Float64Array(rows * cols);
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const dy = row - cy;
      const dx = col - cx;
      const dist = Math.min(Math.sqrt(dy * dy + dx * dx), maxBinInt);
      noisePsd[row * cols + col] = radialProfile[Math.floor(dist)];
    }
  }

  for (let i = 0; i < rows * cols; i++) {
    if (noisePsd[i] <= 0) noisePsd[i] = EPS;
  }

  return noisePsd;
}

/**
 * Solve lambda from the Lagrangian constraint of Eq. (10):
 *   sum |n|^2 = sum |I - S|^2 = sum (1 - F)^2 |I|^2,   F = Se / (Se + lambda*n + s)
 * The residual is monotonically increasing in lambda, so bisection (log scale) is used.
 */
function solveLambda(
  observed: Float64Array,
  signal: Float64Array,
  noise: Float64Array,
  extra: number,
): number {
  const N = observed.length;
  let target = 0;
  for (let i = 0; i < N; i++) target += noise[i];

  const residual = (lambda: number): number => {
    let acc = 0;
    for (let i = 0; i < N; i++) {
      const f = signal[i] / (signal[i] + lambda * noise[i] + extra + EPS);
      const e = 1 - f;
      acc += e * e * observed[i];
    }
    return acc - target;
  };

  let lo = -6; // log10(lambda)
  let hi = 6;
  if (residual(Math.pow(10, lo)) >= 0) return Math.pow(10, lo);
  if (residual(Math.pow(10, hi)) <= 0) return Math.pow(10, hi);
  for (let it = 0; it < 60; it++) {
    const mid = 0.5 * (lo + hi);
    if (residual(Math.pow(10, mid)) < 0) lo = mid;
    else hi = mid;
  }
  return Math.pow(10, 0.5 * (lo + hi));
}

/**
 * Apply Wiener filtering to a 2D grayscale ROI.
 * Returns filtered data on approximately the original intensity scale.
 * Throws an Error for invalid parameters / ROI size.
 */
export function wienerFilterRoi(
  roi: Float64Array,
  rows: number,
  cols: number,
  params: WienerParams,
): WienerResult {
  const { method, noiseScale, regularization, stabilization } = params;
  const parametric = isParametric(method);
  const autoLambda = params.autoLambda ?? true;

  if (rows < 16 || cols < 16) {
    throw new Error("ROI minimum 16 x 16 piksel.");
  }
  if (noiseScale <= 0) {
    throw new Error("Noise Scale harus > 0.");
  }
  if (parametric && !autoLambda && regularization <= 0) {
    throw new Error("Regularization (λ) harus > 0.");
  }
  if (method === "random_phase_parametric" && stabilization < 0) {
    throw new Error("Stabilization tidak boleh negatif.");
  }

  const N = rows * cols;

  // Remove the mean (slowly varying component; paper Sec. 5 advises this)
  let meanIntensity = 0;
  for (let i = 0; i < N; i++) meanIntensity += roi[i];
  meanIntensity /= N;

  // Hanning window against edge discontinuities (periodic continuation)
  const window = hanning2d(rows, cols);
  for (let i = 0; i < N; i++) window[i] = Math.max(window[i], 1e-6);

  const windowed = new Float64Array(N);
  for (let i = 0; i < N; i++) windowed[i] = (roi[i] - meanIntensity) * window[i];

  const spectrum = fft2d(windowed, rows, cols, false);
  const shifted = fftshift2d(spectrum, rows, cols);

  // Observed power |I|^2
  const observedPower = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const re = shifted[i * 2];
    const im = shifted[i * 2 + 1];
    observedPower[i] = re * re + im * im;
  }

  // Noise PSD |n|^2 (radial average), scaled
  const noisePsd = estimateNoisePsdFromPower(observedPower, rows, cols, 1.0, 25);
  for (let i = 0; i < N; i++) noisePsd[i] *= noiseScale;

  // |Se|^2 = |I|^2 - |n|^2 where |I| > n, else 0  (Eq. 5)
  const signalPower = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    signalPower[i] = Math.max(observedPower[i] - noisePsd[i], 0);
  }

  let meanNoisePsd = 0;
  for (let i = 0; i < N; i++) meanNoisePsd += noisePsd[i];
  meanNoisePsd /= N;
  const extra =
    method === "random_phase_parametric" ? stabilization * meanNoisePsd : 0;

  let lambda = 1;
  if (parametric) {
    lambda = autoLambda
      ? solveLambda(observedPower, signalPower, noisePsd, extra)
      : regularization;
  }

  const gain = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const sp = signalPower[i];
    const np = noisePsd[i];
    let g: number;

    switch (method) {
      case "conventional":
        g = sp / (sp + np + EPS);
        break;
      case "cannon":
        g = Math.sqrt(sp / (sp + np + EPS));
        break;
      case "parametric":
        g = sp / (sp + lambda * np + EPS);
        break;
      case "parametric_cannon":
        g = Math.sqrt(sp / (sp + lambda * np + EPS));
        break;
      case "random_phase_parametric":
        g = sp / (sp + lambda * np + extra + EPS);
        break;
      default:
        g = 1;
    }

    gain[i] = Math.max(0, Math.min(1, g));
  }

  const filteredShifted = new Float64Array(N * 2);
  for (let i = 0; i < N; i++) {
    filteredShifted[i * 2] = shifted[i * 2] * gain[i];
    filteredShifted[i * 2 + 1] = shifted[i * 2 + 1] * gain[i];
  }

  const unshifted = ifftshift2d(filteredShifted, rows, cols);
  const filteredComplex = fft2dComplex(unshifted, rows, cols, true);

  // Undo the window only where it is large enough; near the borders (window ~ 0)
  // dividing would amplify errors by up to 1e6, so blend back to the original pixel.
  const filtered = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const w = window[i];
    const t = Math.min(1, w / EDGE_MIN_WINDOW);
    let val = t * (filteredComplex[i * 2] / w + meanIntensity) + (1 - t) * roi[i];
    if (!isFinite(val)) val = roi[i];
    filtered[i] = val;
  }

  return { data: filtered, rows, cols, lambda: parametric ? lambda : undefined };
}