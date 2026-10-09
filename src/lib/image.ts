/**
 * Image processing utilities ported from the Python notebook.
 * All operate on Float64Array matrices (row-major, rows*cols).
 */

/** Apply a 3x3 convolution kernel to an image. */
function convolve3x3(
  img: Float64Array,
  rows: number,
  cols: number,
  kernel: number[],
): Float64Array {
  const out = new Float64Array(rows * cols);
  for (let r = 1; r < rows - 1; r++) {
    for (let c = 1; c < cols - 1; c++) {
      let sum = 0;
      let ki = 0;
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          sum += img[(r + dr) * cols + (c + dc)] * kernel[ki++];
        }
      }
      out[r * cols + c] = sum;
    }
  }
  return out;
}

/** Sobel gradient magnitude. Returns per-pixel gradient. */
export function sobelMagnitude(
  img: Float64Array,
  rows: number,
  cols: number,
): Float64Array {
  const gx = convolve3x3(img, rows, cols, [
    -1, 0, 1,
    -2, 0, 2,
    -1, 0, 1,
  ]);
  const gy = convolve3x3(img, rows, cols, [
    -1, -2, -1,
    0, 0, 0,
    1, 2, 1,
  ]);
  const out = new Float64Array(rows * cols);
  for (let i = 0; i < rows * cols; i++) {
    out[i] = Math.sqrt(gx[i] * gx[i] + gy[i] * gy[i]);
  }
  return out;
}

/** Laplacian using 4-connected kernel. */
export function laplacian(
  img: Float64Array,
  rows: number,
  cols: number,
): Float64Array {
  return convolve3x3(img, rows, cols, [
    0, 1, 0,
    1, -4, 1,
    0, 1, 0,
  ]);
}

/** Variance of an array. */
export function variance(arr: Float64Array): number {
  const n = arr.length;
  if (n === 0) return 0;
  let sum = 0;
  for (let i = 0; i < n; i++) sum += arr[i];
  const mean = sum / n;
  let sqSum = 0;
  for (let i = 0; i < n; i++) {
    const d = arr[i] - mean;
    sqSum += d * d;
  }
  return sqSum / n;
}

/** Mean of an array. */
export function mean(arr: Float64Array): number {
  if (arr.length === 0) return 0;
  let s = 0;
  for (let i = 0; i < arr.length; i++) s += arr[i];
  return s / arr.length;
}

/** Standard deviation of an array. */
export function std(arr: Float64Array): number {
  return Math.sqrt(variance(arr));
}

/** Shannon entropy (in bits) of integer-valued image. */
export function shannonEntropy(img: Float64Array): number {
  const hist = new Map<number, number>();
  for (let i = 0; i < img.length; i++) {
    const v = Math.round(img[i]);
    hist.set(v, (hist.get(v) || 0) + 1);
  }
  const n = img.length;
  let entropy = 0;
  for (const count of hist.values()) {
    const p = count / n;
    if (p > 0) entropy -= p * Math.log2(p);
  }
  return entropy;
}

/** Histogram with nBins bins over [min, max]. Returns counts and bin edges. */
export function histogram(
  img: Float64Array,
  nBins: number,
): { counts: number[]; binEdges: number[]; binCenters: number[] } {
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < img.length; i++) {
    if (img[i] < min) min = img[i];
    if (img[i] > max) max = img[i];
  }
  if (max === min) max = min + 1;
  const binWidth = (max - min) / nBins;
  const counts = new Array(nBins).fill(0);
  const binEdges: number[] = [];
  const binCenters: number[] = [];
  for (let i = 0; i <= nBins; i++) binEdges.push(min + i * binWidth);
  for (let i = 0; i < nBins; i++) binCenters.push(min + (i + 0.5) * binWidth);
  for (let i = 0; i < img.length; i++) {
    let bin = Math.floor((img[i] - min) / binWidth);
    if (bin >= nBins) bin = nBins - 1;
    if (bin < 0) bin = 0;
    counts[bin]++;
  }
  return { counts, binEdges, binCenters };
}

/** Separable Gaussian filter (1D kernel applied along rows then columns). */
export function gaussianFilter(
  img: Float64Array,
  rows: number,
  cols: number,
  sigma: number,
): Float64Array {
  const radius = Math.max(1, Math.ceil(3 * sigma));
  const kernelSize = 2 * radius + 1;
  const kernel = new Float64Array(kernelSize);
  let kSum = 0;
  for (let i = 0; i < kernelSize; i++) {
    const x = i - radius;
    kernel[i] = Math.exp(-(x * x) / (2 * sigma * sigma));
    kSum += kernel[i];
  }
  for (let i = 0; i < kernelSize; i++) kernel[i] /= kSum;

  // Horizontal pass
  const temp = new Float64Array(rows * cols);
  for (let r = 0; r < rows; r++) {
    const rowOff = r * cols;
    for (let c = 0; c < cols; c++) {
      let sum = 0;
      for (let k = 0; k < kernelSize; k++) {
        const cc = c + k - radius;
        const clamped = Math.max(0, Math.min(cols - 1, cc));
        sum += img[rowOff + clamped] * kernel[k];
      }
      temp[rowOff + c] = sum;
    }
  }

  // Vertical pass
  const out = new Float64Array(rows * cols);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      let sum = 0;
      for (let k = 0; k < kernelSize; k++) {
        const rr = r + k - radius;
        const clamped = Math.max(0, Math.min(rows - 1, rr));
        sum += temp[clamped * cols + c] * kernel[k];
      }
      out[r * cols + c] = sum;
    }
  }
  return out;
}

/** Median of an array (sorts a copy). */
export function median(arr: Float64Array): number {
  if (arr.length === 0) return 0;
  const sorted = Float64Array.from(arr).sort();
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

/**
 * Detect the strongest Bragg peak for a given d-spacing.
 * Searches an annular ring around the expected frequency, half-plane only.
 */
export function detectFamilyPeak(
  mag: Float64Array,
  rows: number,
  cols: number,
  nmPerPxNominal: number,
  dRef: number,
  tol = 0.12,
): {
  dRef: number;
  px: number;
  py: number;
  rPx: number;
  snrDb: number;
  nmPerPx: number;
} | null {
  const cy = Math.floor(rows / 2);
  const cx = Math.floor(cols / 2);
  const n = Math.min(rows, cols);

  // Compute flat spectrum (log-magnitude minus radial background)
  const logm = new Float64Array(rows * cols);
  const rInt = new Int32Array(rows * cols);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const dy = r - cy;
      const dx = c - cx;
      const rr = Math.sqrt(dx * dx + dy * dy);
      rInt[r * cols + c] = Math.floor(rr);
      logm[r * cols + c] = Math.log(mag[r * cols + c] + 1e-12);
    }
  }

  let maxR = 0;
  for (let i = 0; i < rInt.length; i++) {
    if (rInt[i] > maxR) maxR = rInt[i];
  }
  const bgSum = new Float64Array(maxR + 1);
  const bgCount = new Float64Array(maxR + 1);
  for (let i = 0; i < rows * cols; i++) {
    bgSum[rInt[i]] += logm[i];
    bgCount[rInt[i]] += 1;
  }
  const bg = new Float64Array(maxR + 1);
  for (let i = 0; i <= maxR; i++) bg[i] = bgCount[i] > 0 ? bgSum[i] / bgCount[i] : 0;

  const flat = new Float64Array(rows * cols);
  for (let i = 0; i < rows * cols; i++) flat[i] = logm[i] - bg[rInt[i]];

  const rExp = (n * nmPerPxNominal) / dRef;
  const ringLo = rExp * (1 - tol);
  const ringHi = rExp * (1 + tol);

  let bestVal = -Infinity;
  let bestPx = cx;
  let bestPy = cy;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const dy = r - cy;
      const dx = c - cx;
      const rr = Math.sqrt(dx * dx + dy * dy);
      if (rr < ringLo || rr > ringHi) continue;
      // Half-plane: upper half (y < cy) or (y == cy && x > cx)
      if (r > cy || (r === cy && c <= cx)) continue;
      const val = flat[r * cols + c];
      if (val > bestVal) {
        bestVal = val;
        bestPx = c;
        bestPy = r;
      }
    }
  }

  // Subpixel refinement via parabolic interpolation
  function parab(a: number, b: number, c: number): number {
    const den = a - 2 * b + c;
    return den === 0 ? 0 : 0.5 * (a - c) / den;
  }

  const ox =
    bestPx > 0 && bestPx < cols - 1
      ? parab(
          logm[bestPy * cols + bestPx - 1],
          logm[bestPy * cols + bestPx],
          logm[bestPy * cols + bestPx + 1],
        )
      : 0;
  const oy =
    bestPy > 0 && bestPy < rows - 1
      ? parab(
          logm[(bestPy - 1) * cols + bestPx],
          logm[bestPy * cols + bestPx],
          logm[(bestPy + 1) * cols + bestPx],
        )
      : 0;

  const subPx = bestPx + ox;
  const subPy = bestPy + oy;
  const rPk = Math.sqrt((subPx - cx) ** 2 + (subPy - cy) ** 2);

  // SNR: peak magnitude vs median of ring (excluding peak and mirror)
  const cx2 = 2 * cx - bestPx;
  const cy2 = 2 * cy - bestPy;
  const refMags: number[] = [];
  const ringLoSNR = rExp * 0.75;
  const ringHiSNR = rExp * 1.25;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const dy = r - cy;
      const dx = c - cx;
      const rr = Math.sqrt(dx * dx + dy * dy);
      if (rr < ringLoSNR || rr > ringHiSNR) continue;
      const dPeak = Math.sqrt((c - bestPx) ** 2 + (r - bestPy) ** 2);
      const dMirror = Math.sqrt((c - cx2) ** 2 + (r - cy2) ** 2);
      if (dPeak < 8 || dMirror < 8) continue;
      refMags.push(mag[r * cols + c]);
    }
  }
  const refMedian = refMags.length > 0 ? median(new Float64Array(refMags)) : 1;
  const snrDb = refMedian > 0 ? 20 * Math.log10(mag[bestPy * cols + bestPx] / refMedian) : 0;

  return {
    dRef,
    px: subPx,
    py: subPy,
    rPx: rPk,
    snrDb,
    nmPerPx: (rPk * dRef) / n,
  };
}

/** Frequency axes in nm^-1 after fftshift. */
export function freqAxes(
  shape: [number, number],
  nmPerPx: number,
): { fx: Float64Array; fy: Float64Array } {
  const [rows, cols] = shape;
  const fx = new Float64Array(cols);
  const fy = new Float64Array(rows);
  for (let i = 0; i < cols; i++) {
    const f = (i - Math.floor(cols / 2)) / (cols * nmPerPx);
    fx[i] = f;
  }
  for (let i = 0; i < rows; i++) {
    const f = (i - Math.floor(rows / 2)) / (rows * nmPerPx);
    fy[i] = f;
  }
  return { fx, fy };
}
