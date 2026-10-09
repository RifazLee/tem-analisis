/**
 * Pure-TypeScript FFT implementation.
 * - 1D: radix-2 Cooley-Tukey for power-of-2 sizes, Bluestein for arbitrary sizes.
 * - 2D: separable (rows then columns) using 1D FFT.
 */

type Complex = { re: number; im: number };

function cMul(a: Complex, b: Complex): Complex {
  return { re: a.re * b.re - a.im * b.im, im: a.re * b.im + a.im * b.re };
}

function cAdd(a: Complex, b: Complex): Complex {
  return { re: a.re + b.re, im: a.im + b.im };
}

function cSub(a: Complex, b: Complex): Complex {
  return { re: a.re - b.re, im: a.im - b.im };
}

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

// Precomputed twiddle factors per size
const twiddleCache = new Map<number, Float64Array>();

function getTwiddles(n: number): Float64Array {
  let cached = twiddleCache.get(n);
  if (cached) return cached;
  cached = new Float64Array(n / 2);
  for (let k = 0; k < n / 2; k++) {
    cached[k * 2] = Math.cos((-2 * Math.PI * k) / n);
    cached[k * 2 + 1] = Math.sin((-2 * Math.PI * k) / n);
  }
  twiddleCache.set(n, cached);
  return cached;
}

const bitReverseCache = new Map<number, Int32Array>();

function getBitReverse(n: number): Int32Array {
  let cached = bitReverseCache.get(n);
  if (cached) return cached;
  cached = bitReverseTable(n);
  bitReverseCache.set(n, cached);
  return cached;
}

/** In-place iterative radix-2 Cooley-Tukey FFT on interleaved re/im array. */
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
    const cosStep = Math.cos((sign * 2 * Math.PI) / len);
    const sinStep = Math.sin((sign * 2 * Math.PI) / len);
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

/** Bluestein's algorithm for arbitrary-length FFT. */
function fftBluestein(data: Float64Array, n: number, inverse: boolean): void {
  const sign = inverse ? 1 : -1;
  const m = nextPow2(2 * n - 1);

  // Chirp signal
  const a = new Float64Array(n * 2);
  const b = new Float64Array(m * 2);
  for (let k = 0; k < n; k++) {
    const ang = (sign * Math.PI * k * k) / n;
    const cos = Math.cos(ang);
    const sin = Math.sin(ang);
    a[k * 2] = cos;
    a[k * 2 + 1] = sin;
    // Complex multiply: data[k] *= (cos + i*sin)
    const re = data[k * 2];
    const im = data[k * 2 + 1];
    data[k * 2] = re * cos - im * sin;
    data[k * 2 + 1] = re * sin + im * cos;
  }

  // b[k] = conj(a[k]) with zero-padding and wrap-around
  b[0] = 1;
  b[1] = 0;
  b[(m - (n - 1)) * 2] = 1;
  b[(m - (n - 1)) * 2 + 1] = 0;
  for (let k = 1; k < n; k++) {
    const idx1 = k * 2;
    const idx2 = (m - k) * 2;
    b[idx1] = a[k * 2];
    b[idx1 + 1] = -a[k * 2 + 1];
    b[idx2] = a[k * 2];
    b[idx2 + 1] = -a[k * 2 + 1];
  }

  // FFT of a (zero-padded) and b
  const fa = new Float64Array(m * 2);
  for (let i = 0; i < n; i++) {
    fa[i * 2] = data[i * 2];
    fa[i * 2 + 1] = data[i * 2 + 1];
  }
  fftRadix2(fa, m, false);
  fftRadix2(b, m, false);

  // Convolve
  for (let i = 0; i < m; i++) {
    const ar = fa[i * 2];
    const ai = fa[i * 2 + 1];
    const br = b[i * 2];
    const bi = b[i * 2 + 1];
    fa[i * 2] = ar * br - ai * bi;
    fa[i * 2 + 1] = ar * bi + ai * br;
  }
  fftRadix2(fa, m, true);

  // Multiply by chirp
  for (let k = 0; k < n; k++) {
    const cos = a[k * 2];
    const sin = a[k * 2 + 1];
    const re = fa[k * 2];
    const im = fa[k * 2 + 1];
    data[k * 2] = re * cos - im * sin;
    data[k * 2 + 1] = re * sin + im * cos;
  }
}

/** 1D FFT of interleaved Float64Array [re0, im0, re1, im1, ...]. Length n. */
export function fft1d(data: Float64Array, n: number, inverse = false): void {
  if (n <= 1) return;
  if ((n & (n - 1)) === 0) {
    fftRadix2(data, n, inverse);
  } else {
    fftBluestein(data, n, inverse);
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

  // FFT each row
  const rowData = new Float64Array(Math.max(rows, cols) * 2);
  for (let r = 0; r < rows; r++) {
    const offset = r * cols * 2;
    for (let c = 0; c < cols; c++) {
      rowData[c * 2] = data[offset + c * 2];
      rowData[c * 2 + 1] = data[offset + c * 2 + 1];
    }
    fft1d(rowData, cols, inverse);
    for (let c = 0; c < cols; c++) {
      data[offset + c * 2] = rowData[c * 2];
      data[offset + c * 2 + 1] = rowData[c * 2 + 1];
    }
  }

  // FFT each column
  const colData = new Float64Array(Math.max(rows, cols) * 2);
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) {
      colData[r * 2] = data[(r * cols + c) * 2];
      colData[r * 2 + 1] = data[(r * cols + c) * 2 + 1];
    }
    fft1d(colData, rows, inverse);
    for (let r = 0; r < rows; r++) {
      data[(r * cols + c) * 2] = colData[r * 2];
      data[(r * cols + c) * 2 + 1] = colData[r * 2 + 1];
    }
  }

  return data;
}

/** FFTshift: swap quadrants so DC is at center. Works on interleaved complex. */
export function fftshift2d(
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

/** Inverse fftshift (same as fftshift for even sizes, differs for odd). */
export function ifftshift2d(
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
