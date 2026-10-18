/**
 * Pure-TypeScript FFT implementation.
 * - 1D: radix-2 Cooley-Tukey for power-of-2 sizes, Bluestein for arbitrary sizes.
 * - 2D: separable (rows then columns) using 1D FFT.
 *
 * Conventions:
 *   - Forward: X[k] = sum x[n] exp(-2*pi*i*k*n/N), no scaling.
 *   - Inverse: x[n] = (1/N) sum X[k] exp(+2*pi*i*k*n/N), scaled by 1/N per dimension
 *     (so 2D inverse is scaled by 1/(rows*cols)).
 *   - fftshift puts DC at index floor(n/2); ifftshift is its exact inverse (odd sizes too).
 */

/** Bit-reversal permutation for length n (power of 2). */
function bitReverseTable(n: number): Int32Array {
  const table = new Int32Array(n);
  let j = 0;
  for (let i = 1; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    table[i] = j;
  }
  return table;
}

const bitReverseCache = new Map<number, Int32Array>();

function getBitReverse(n: number): Int32Array {
  let cached = bitReverseCache.get(n);
  if (cached) return cached;
  cached = bitReverseTable(n);
  bitReverseCache.set(n, cached);
  return cached;
}

/**
 * In-place iterative radix-2 Cooley-Tukey FFT on interleaved re/im array.
 * If `inverse`, the result is scaled by 1/n.
 */
function fftRadix2(data: Float64Array, n: number, inverse: boolean): void {
  const br = getBitReverse(n);
  for (let i = 0; i < n; i++) {
    const j = br[i];
    if (j > i) {
      const tr = data[i * 2];
      const ti = data[i * 2 + 1];
      data[i * 2] = data[j * 2];
      data[i * 2 + 1] = data[j * 2 + 1];
      data[j * 2] = tr;
      data[j * 2 + 1] = ti;
    }
  }

  const sign = inverse ? 1 : -1;
  for (let len = 2; len <= n; len <<= 1) {
    const halfLen = len >> 1;
    const ang = (sign * 2 * Math.PI) / len;
    const cosStep = Math.cos(ang);
    const sinStep = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cosK = 1;
      let sinK = 0;
      for (let k = 0; k < halfLen; k++) {
        const re = data[(i + k + halfLen) * 2];
        const im = data[(i + k + halfLen) * 2 + 1];
        const tre = re * cosK - im * sinK;
        const tim = re * sinK + im * cosK;
        data[(i + k + halfLen) * 2] = data[(i + k) * 2] - tre;
        data[(i + k + halfLen) * 2 + 1] = data[(i + k) * 2 + 1] - tim;
        data[(i + k) * 2] += tre;
        data[(i + k) * 2 + 1] += tim;
        const newCos = cosK * cosStep - sinK * sinStep;
        sinK = cosK * sinStep + sinK * cosStep;
        cosK = newCos;
      }
    }
  }

  if (inverse) {
    const inv = 1 / n;
    for (let i = 0; i < n * 2; i++) data[i] *= inv;
  }
}

/** Next power of 2 >= n. */
function nextPow2(n: number): number {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}

interface BluesteinPlan {
  m: number;
  /** chirp a[k] = exp(sign * i*pi*k^2/n), interleaved, length n */
  chirp: Float64Array;
  /** FFT of the (wrapped, conjugated) chirp filter, interleaved, length m */
  fb: Float64Array;
}

const bluesteinCache = new Map<string, BluesteinPlan>();

function getBluesteinPlan(n: number, inverse: boolean): BluesteinPlan {
  const key = `${n}:${inverse ? 1 : 0}`;
  const cached = bluesteinCache.get(key);
  if (cached) return cached;

  const sign = inverse ? 1 : -1;
  const m = nextPow2(2 * n - 1);
  const chirp = new Float64Array(n * 2);
  const b = new Float64Array(m * 2);

  for (let k = 0; k < n; k++) {
    // reduce k^2 mod 2n for accuracy with large k
    const kk = (k * k) % (2 * n);
    const ang = (sign * Math.PI * kk) / n;
    chirp[k * 2] = Math.cos(ang);
    chirp[k * 2 + 1] = Math.sin(ang);
  }

  // b[k] = conj(chirp[k]), symmetric wrap-around: b[m-k] = b[k]
  b[0] = chirp[0];
  b[1] = -chirp[1];
  for (let k = 1; k < n; k++) {
    const cr = chirp[k * 2];
    const ci = -chirp[k * 2 + 1];
    b[k * 2] = cr;
    b[k * 2 + 1] = ci;
    b[(m - k) * 2] = cr;
    b[(m - k) * 2 + 1] = ci;
  }

  fftRadix2(b, m, false);

  const plan = { m, chirp, fb: b };
  bluesteinCache.set(key, plan);
  return plan;
}

/** Bluestein's algorithm for arbitrary-length FFT. Inverse is scaled by 1/n. */
function fftBluestein(data: Float64Array, n: number, inverse: boolean): void {
  const { m, chirp, fb } = getBluesteinPlan(n, inverse);

  // x[k] * chirp[k], zero-padded to m
  const fa = new Float64Array(m * 2);
  for (let k = 0; k < n; k++) {
    const cos = chirp[k * 2];
    const sin = chirp[k * 2 + 1];
    const re = data[k * 2];
    const im = data[k * 2 + 1];
    fa[k * 2] = re * cos - im * sin;
    fa[k * 2 + 1] = re * sin + im * cos;
  }

  fftRadix2(fa, m, false);
  for (let i = 0; i < m; i++) {
    const ar = fa[i * 2];
    const ai = fa[i * 2 + 1];
    const br = fb[i * 2];
    const bi = fb[i * 2 + 1];
    fa[i * 2] = ar * br - ai * bi;
    fa[i * 2 + 1] = ar * bi + ai * br;
  }
  fftRadix2(fa, m, true); // scaled by 1/m (convolution), not by 1/n

  // Multiply by chirp; the inverse transform needs the extra 1/n scaling
  const scale = inverse ? 1 / n : 1;
  for (let k = 0; k < n; k++) {
    const cos = chirp[k * 2];
    const sin = chirp[k * 2 + 1];
    const re = fa[k * 2];
    const im = fa[k * 2 + 1];
    data[k * 2] = (re * cos - im * sin) * scale;
    data[k * 2 + 1] = (re * sin + im * cos) * scale;
  }
}

/**
 * 1D FFT of interleaved Float64Array [re0, im0, re1, im1, ...]. Length n, in place.
 * Inverse is scaled by 1/n.
 */
export function fft1d(data: Float64Array, n: number, inverse = false): void {
  if (n <= 1) return;
  if ((n & (n - 1)) === 0) {
    fftRadix2(data, n, inverse);
  } else {
    fftBluestein(data, n, inverse);
  }
}

/** Separable 2D FFT in place on an interleaved complex array. */
function fft2dInPlace(
  data: Float64Array,
  rows: number,
  cols: number,
  inverse: boolean,
): void {
  const buf = new Float64Array(Math.max(rows, cols) * 2);

  // rows
  for (let r = 0; r < rows; r++) {
    const offset = r * cols * 2;
    for (let i = 0; i < cols * 2; i++) buf[i] = data[offset + i];
    fft1d(buf, cols, inverse);
    for (let i = 0; i < cols * 2; i++) data[offset + i] = buf[i];
  }

  // columns
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) {
      buf[r * 2] = data[(r * cols + c) * 2];
      buf[r * 2 + 1] = data[(r * cols + c) * 2 + 1];
    }
    fft1d(buf, rows, inverse);
    for (let r = 0; r < rows; r++) {
      data[(r * cols + c) * 2] = buf[r * 2];
      data[(r * cols + c) * 2 + 1] = buf[r * 2 + 1];
    }
  }
}

/**
 * 2D FFT of a real-valued matrix (rows x cols).
 * Returns interleaved complex array [re, im, re, im, ...] of length rows*cols*2.
 */
export function fft2d(
  real: Float64Array,
  rows: number,
  cols: number,
  inverse = false,
): Float64Array {
  const data = new Float64Array(rows * cols * 2);
  for (let i = 0; i < rows * cols; i++) {
    data[i * 2] = real[i];
    data[i * 2 + 1] = 0;
  }
  fft2dInPlace(data, rows, cols, inverse);
  return data;
}

/**
 * 2D FFT of an interleaved complex array [re, im, re, im, ...] of length rows*cols*2.
 * Works on a copy and returns the result.
 */
export function fft2dComplex(
  data: Float64Array,
  rows: number,
  cols: number,
  inverse = false,
): Float64Array {
  const result = new Float64Array(rows * cols * 2);
  result.set(data);
  fft2dInPlace(result, rows, cols, inverse);
  return result;
}

/** FFTshift: move DC to index floor(n/2). Works on interleaved complex. */
export function fftshift2d(
  data: Float64Array,
  rows: number,
  cols: number,
): Float64Array {
  const result = new Float64Array(rows * cols * 2);
  const cr = Math.floor((rows + 1) / 2);
  const cc = Math.floor((cols + 1) / 2);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const sr = (r + cr) % rows;
      const sc = (c + cc) % cols;
      result[(r * cols + c) * 2] = data[(sr * cols + sc) * 2];
      result[(r * cols + c) * 2 + 1] = data[(sr * cols + sc) * 2 + 1];
    }
  }
  return result;
}

/** Inverse of fftshift2d (differs from fftshift for odd sizes). */
export function ifftshift2d(
  data: Float64Array,
  rows: number,
  cols: number,
): Float64Array {
  const result = new Float64Array(rows * cols * 2);
  const cr = Math.floor(rows / 2);
  const cc = Math.floor(cols / 2);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const sr = (r + cr) % rows;
      const sc = (c + cc) % cols;
      result[(r * cols + c) * 2] = data[(sr * cols + sc) * 2];
      result[(r * cols + c) * 2 + 1] = data[(sr * cols + sc) * 2 + 1];
    }
  }
  return result;
}

/** Compute magnitude of interleaved complex array. */
export function magnitude(data: Float64Array, n: number): Float64Array {
  const mag = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    mag[i] = Math.sqrt(data[i * 2] * data[i * 2] + data[i * 2 + 1] * data[i * 2 + 1]);
  }
  return mag;
}

/** Hann window of length n. */
export function hannWindow(n: number): Float64Array {
  const w = new Float64Array(n);
  if (n <= 1) {
    if (n === 1) w[0] = 1;
    return w;
  }
  for (let i = 0; i < n; i++) {
    w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
  }
  return w;
}

/** 2D outer product of two 1D windows. */
export function hann2d(rows: number, cols: number): Float64Array {
  const wr = hannWindow(rows);
  const wc = hannWindow(cols);
  const w = new Float64Array(rows * cols);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      w[r * cols + c] = wr[r] * wc[c];
    }
  }
  return w;
}