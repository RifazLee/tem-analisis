/**
 * Canvas rendering helpers for grayscale images and charts.
 * Avoids Math.max/min spread on large arrays (stack overflow risk).
 * All chart canvases use 2x resolution for crisp rendering on high-DPI displays.
 */

const DPR = 2;

function arrayMin(arr: Float64Array | number[]): number {
  let m = Infinity;
  for (let i = 0; i < arr.length; i++) if (arr[i] < m) m = arr[i];
  return m;
}

function arrayMax(arr: Float64Array | number[]): number {
  let m = -Infinity;
  for (let i = 0; i < arr.length; i++) if (arr[i] > m) m = arr[i];
  return m;
}

/** Render a Float64Array grayscale image to a canvas. */
export function renderGrayscaleToCanvas(
  canvas: HTMLCanvasElement,
  data: Float64Array,
  rows: number,
  cols: number,
  displayCols?: number,
  displayRows?: number,
): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  let min = arrayMin(data);
  let max = arrayMax(data);
  if (max === min) max = min + 1;
  const range = max - min;

  const w = displayCols ?? cols;
  const h = displayRows ?? rows;
  canvas.width = w;
  canvas.height = h;

  const imgData = ctx.createImageData(w, h);
  const scaleX = cols / w;
  const scaleY = rows / h;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const srcY = Math.min(rows - 1, Math.floor(y * scaleY));
      const srcX = Math.min(cols - 1, Math.floor(x * scaleX));
      const val = data[srcY * cols + srcX];
      const norm = Math.max(0, Math.min(255, ((val - min) / range) * 255));
      const idx = (y * w + x) * 4;
      imgData.data[idx] = norm;
      imgData.data[idx + 1] = norm;
      imgData.data[idx + 2] = norm;
      imgData.data[idx + 3] = 255;
    }
  }
  ctx.putImageData(imgData, 0, 0);
}

/**
 * Render FFT magnitude (log scale) to canvas.
 * zoomFactor: how many times to zoom into the center.
 * e.g. zoomFactor=6 shows 1/6 of full width around DC.
 */
export function renderFftToCanvas(
  canvas: HTMLCanvasElement,
  mag: Float64Array,
  rows: number,
  cols: number,
  zoomFactor: number,
): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const cy = Math.floor(rows / 2);
  const cx = Math.floor(cols / 2);

  // Half-size of the zoomed window in pixels
  const halfR = Math.max(1, Math.floor(rows / (2 * zoomFactor)));
  const halfC = Math.max(1, Math.floor(cols / (2 * zoomFactor)));

  const r0 = zoomFactor <= 1 ? 0 : Math.max(0, cy - halfR);
  const r1 = zoomFactor <= 1 ? rows : Math.min(rows, cy + halfR);
  const c0 = zoomFactor <= 1 ? 0 : Math.max(0, cx - halfC);
  const c1 = zoomFactor <= 1 ? cols : Math.min(cols, cx + halfC);
  const zoomRows = Math.max(1, r1 - r0);
  const zoomCols = Math.max(1, c1 - c0);

  const logMag = new Float64Array(zoomRows * zoomCols);
  let min = Infinity;
  let max = -Infinity;
  for (let r = 0; r < zoomRows; r++) {
    for (let c = 0; c < zoomCols; c++) {
      const idx = (r0 + r) * cols + (c0 + c);
      const v = Math.log1p(mag[idx]);
      logMag[r * zoomCols + c] = v;
      if (v < min) min = v;
      if (v > max) max = v;
    }
  }
  if (max === min) max = min + 1;
  const range = max - min;

  const displaySize = 900;
  canvas.width = displaySize;
  canvas.height = displaySize;

  const imgData = ctx.createImageData(displaySize, displaySize);
  const scaleX = zoomCols / displaySize;
  const scaleY = zoomRows / displaySize;

  for (let y = 0; y < displaySize; y++) {
    for (let x = 0; x < displaySize; x++) {
      const srcY = Math.min(zoomRows - 1, Math.floor(y * scaleY));
      const srcX = Math.min(zoomCols - 1, Math.floor(x * scaleX));
      const val = logMag[srcY * zoomCols + srcX];
      const norm = Math.max(0, Math.min(255, ((val - min) / range) * 255));
      const idx2 = (y * displaySize + x) * 4;
      imgData.data[idx2] = norm;
      imgData.data[idx2 + 1] = norm;
      imgData.data[idx2 + 2] = norm;
      imgData.data[idx2 + 3] = 255;
    }
  }
  ctx.putImageData(imgData, 0, 0);
}

/**
 * Set up a chart canvas at 2x resolution for crisp rendering.
 * Returns the drawing context scaled to CSS pixel space.
 */
function setupChartCanvas(
  canvas: HTMLCanvasElement,
  cssW: number,
  cssH: number,
): CanvasRenderingContext2D | null {
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  canvas.width = cssW * DPR;
  canvas.height = cssH * DPR;
  canvas.style.width = `${cssW}px`;
  canvas.style.height = `${cssH}px`;
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);
  return ctx;
}

/** Draw a histogram on a canvas with axis labels (probability density vs intensity). */
export function renderHistogram(
  canvas: HTMLCanvasElement,
  counts: number[],
  binCenters: number[],
  color: string,
): void {
  const cssW = 560;
  const cssH = 300;
  const ctx = setupChartCanvas(canvas, cssW, cssH);
  if (!ctx || counts.length === 0) return;

  const w = cssW;
  const h = cssH;

  const padLeft = 72;
  const padBottom = 52;
  const padTop = 14;
  const padRight = 16;
  const plotW = w - padLeft - padRight;
  const plotH = h - padBottom - padTop;

  let maxCount = 0;
  let totalCount = 0;
  for (let i = 0; i < counts.length; i++) {
    if (counts[i] > maxCount) maxCount = counts[i];
    totalCount += counts[i];
  }
  if (maxCount === 0) return;

  const binWidth = binCenters.length > 1
    ? Math.abs(binCenters[1] - binCenters[0])
    : 1;
  const N = totalCount > 0 ? totalCount : 1;
  let maxDensity = 0;
  const densities: number[] = [];
  for (let i = 0; i < counts.length; i++) {
    const d = counts[i] / (N * binWidth);
    densities.push(d);
    if (d > maxDensity) maxDensity = d;
  }
  if (maxDensity === 0) maxDensity = 1;

  // Grid lines (light)
  ctx.strokeStyle = "#f1f5f9";
  ctx.lineWidth = 1;
  const yTicks = 5;
  for (let i = 1; i <= yTicks; i++) {
    const y = padTop + plotH - (i / yTicks) * plotH;
    ctx.beginPath();
    ctx.moveTo(padLeft, y);
    ctx.lineTo(padLeft + plotW, y);
    ctx.stroke();
  }

  // Draw bars (probability density on Y) with rounded top
  const barWidth = plotW / counts.length;
  const gradient = ctx.createLinearGradient(0, padTop, 0, padTop + plotH);
  gradient.addColorStop(0, "#3b82f6");
  gradient.addColorStop(1, "#60a5fa");
  ctx.fillStyle = gradient;
  for (let i = 0; i < counts.length; i++) {
    const barH = (densities[i] / maxDensity) * plotH;
    const x = padLeft + i * barWidth;
    const y = padTop + plotH - barH;
    ctx.fillRect(x, y, barWidth + 0.5, barH);
  }

  // Axis lines
  ctx.strokeStyle = "#94a3b8";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(padLeft, padTop);
  ctx.lineTo(padLeft, padTop + plotH);
  ctx.lineTo(padLeft + plotW, padTop + plotH);
  ctx.stroke();

  // Y-axis ticks (probability density)
  ctx.font = "11px sans-serif";
  ctx.fillStyle = "#64748b";
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  for (let i = 0; i <= yTicks; i++) {
    const val = (maxDensity * i) / yTicks;
    const y = padTop + plotH - (i / yTicks) * plotH;
    ctx.fillText(val.toExponential(1), padLeft - 8, y);
  }

  // X-axis ticks (intensity values)
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  const xTicks = 6;
  const minVal = binCenters[0];
  const maxVal = binCenters[binCenters.length - 1];
  for (let i = 0; i <= xTicks; i++) {
    const val = minVal + ((maxVal - minVal) * i) / xTicks;
    const x = padLeft + (i / xTicks) * plotW;
    ctx.fillText(val.toFixed(0), x, padTop + plotH + 8);
  }

  // Axis labels
  ctx.font = "bold 12px sans-serif";
  ctx.fillStyle = "#334155";
  ctx.textAlign = "center";
  ctx.save();
  ctx.translate(18, padTop + plotH / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText("Probability Density", 0, 0);
  ctx.restore();
  ctx.fillText("Intensitas Asli (Level Detektor)", padLeft + plotW / 2, h - 8);
}

/** Draw a radial profile (log-y) on a canvas with axis labels. */
export function renderRadialProfile(
  canvas: HTMLCanvasElement,
  freq: number[],
  mag: number[],
  refLines: { freq: number; color: string; label: string }[],
): void {
  const cssW = 560;
  const cssH = 300;
  const ctx = setupChartCanvas(canvas, cssW, cssH);
  if (!ctx || freq.length === 0) return;

  const w = cssW;
  const h = cssH;

  const padLeft = 72;
  const padBottom = 52;
  const padTop = 14;
  const padRight = 16;
  const plotW = w - padLeft - padRight;
  const plotH = h - padBottom - padTop;

  let maxFreq = 0;
  for (let i = 0; i < freq.length; i++) if (freq[i] > maxFreq) maxFreq = freq[i];
  if (maxFreq === 0) return;

  let minMag = Infinity;
  let maxMag = -Infinity;
  for (let i = 0; i < mag.length; i++) {
    if (mag[i] > 0) {
      if (mag[i] < minMag) minMag = mag[i];
      if (mag[i] > maxMag) maxMag = mag[i];
    }
  }
  if (!isFinite(minMag) || !isFinite(maxMag)) return;
  const logMin = Math.log10(minMag);
  const logMax = Math.log10(maxMag);
  const logRange = logMax - logMin || 1;

  // Grid lines (light)
  ctx.strokeStyle = "#f1f5f9";
  ctx.lineWidth = 1;
  const yTicks = 5;
  for (let i = 1; i <= yTicks; i++) {
    const y = padTop + plotH - (i / yTicks) * plotH;
    ctx.beginPath();
    ctx.moveTo(padLeft, y);
    ctx.lineTo(padLeft + plotW, y);
    ctx.stroke();
  }
  const xTicks = 6;
  for (let i = 1; i <= xTicks; i++) {
    const x = padLeft + (i / xTicks) * plotW;
    ctx.beginPath();
    ctx.moveTo(x, padTop);
    ctx.lineTo(x, padTop + plotH);
    ctx.stroke();
  }

  // Reference lines
  for (const ref of refLines) {
    if (ref.freq > maxFreq) continue;
    const x = padLeft + (ref.freq / maxFreq) * plotW;
    ctx.strokeStyle = ref.color;
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.moveTo(x, padTop);
    ctx.lineTo(x, padTop + plotH);
    ctx.stroke();
  }
  ctx.setLineDash([]);

  // Reference line labels
  for (const ref of refLines) {
    if (ref.freq > maxFreq) continue;
    const x = padLeft + (ref.freq / maxFreq) * plotW;
    ctx.font = "bold 11px sans-serif";
    ctx.fillStyle = ref.color;
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    ctx.fillText(ref.label, x, padTop + plotH - 2);
  }

  // Profile curve — smooth, thicker
  ctx.strokeStyle = "#2563eb";
  ctx.lineWidth = 2;
  ctx.lineJoin = "round";
  ctx.beginPath();
  let started = false;
  for (let i = 0; i < freq.length; i++) {
    const x = padLeft + (freq[i] / maxFreq) * plotW;
    const logMagV = mag[i] > 0 ? Math.log10(mag[i]) : logMin;
    const y = padTop + plotH - ((logMagV - logMin) / logRange) * (plotH - 4);
    if (!started) { ctx.moveTo(x, y); started = true; }
    else ctx.lineTo(x, y);
  }
  ctx.stroke();

  // Axis lines
  ctx.strokeStyle = "#94a3b8";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(padLeft, padTop);
  ctx.lineTo(padLeft, padTop + plotH);
  ctx.lineTo(padLeft + plotW, padTop + plotH);
  ctx.stroke();

  // Y-axis ticks (log magnitude)
  ctx.font = "11px sans-serif";
  ctx.fillStyle = "#64748b";
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  for (let i = 0; i <= yTicks; i++) {
    const logVal = logMin + (logRange * i) / yTicks;
    const y = padTop + plotH - (i / yTicks) * plotH;
    ctx.fillText(`10^${logVal.toFixed(1)}`, padLeft - 8, y);
  }

  // X-axis ticks (spatial frequency nm^-1)
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  for (let i = 0; i <= xTicks; i++) {
    const val = (maxFreq * i) / xTicks;
    const x = padLeft + (i / xTicks) * plotW;
    ctx.fillText(val.toFixed(2), x, padTop + plotH + 8);
  }

  // Axis labels
  ctx.font = "bold 12px sans-serif";
  ctx.fillStyle = "#334155";
  ctx.textAlign = "center";
  ctx.save();
  ctx.translate(18, padTop + plotH / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText("Rata-rata Magnitude (log)", 0, 0);
  ctx.restore();
  ctx.fillText("Frekuensi Spasial (nm⁻¹)", padLeft + plotW / 2, h - 8);
}

/**
 * Overlay reference rings, detected peaks, and axis labels on the FFT canvas.
 * Must be called after renderFftToCanvas so canvas size is set correctly.
 */
export function overlayFftAnnotations(
  canvas: HTMLCanvasElement,
  fft: { fx: Float64Array; fy: Float64Array; rows: number; cols: number; df: number },
  peaks: { detected: boolean; pf: [number, number]; dMeasured: number; angleDeg: number; plane: string; snrDb?: number; frequency?: number }[],
  zoomFactor: number,
  latticeReferences: { d1: number | null; d2: number | null },
): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const { rows, cols, df } = fft;
  const cy = Math.floor(rows / 2);
  const cx = Math.floor(cols / 2);
  const displaySize = canvas.width;
  if (displaySize === 0) return;

  const halfR = zoomFactor <= 1
    ? Math.max(cy, rows - 1 - cy)
    : Math.max(1, Math.floor(rows / (2 * zoomFactor)));
  const halfC = zoomFactor <= 1
    ? Math.max(cx, cols - 1 - cx)
    : Math.max(1, Math.floor(cols / (2 * zoomFactor)));
  const visFreqY = halfR * df;
  const visFreqX = halfC * df;

  const f2x = (f: number) => ((f + visFreqX) / (2 * visFreqX)) * displaySize;
  const f2y = (f: number) => ((f + visFreqY) / (2 * visFreqY)) * displaySize;

  const centerX = f2x(0);
  const centerY = f2y(0);
  const axisMargin = 44;
  const plotSize = displaySize - axisMargin;
  const plotOrigin = axisMargin / 2;

  // ── Axis frame ──
  ctx.strokeStyle = "rgba(200,210,225,0.7)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(plotOrigin, plotOrigin);
  ctx.lineTo(plotOrigin, plotOrigin + plotSize);
  ctx.lineTo(plotOrigin + plotSize, plotOrigin + plotSize);
  ctx.stroke();

  // ── Axis tick marks and labels (fx bottom, fy left) ──
  ctx.font = "13px sans-serif";
  ctx.fillStyle = "#cbd5e1";
  ctx.strokeStyle = "rgba(200,210,225,0.6)";
  ctx.lineWidth = 1;
  const nTicks = 5;

  // X-axis ticks
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  for (let i = 0; i <= nTicks; i++) {
    const t = i / nTicks;
    const fxVal = -visFreqX + 2 * visFreqX * t;
    const px = plotOrigin + t * plotSize;
    ctx.beginPath();
    ctx.moveTo(px, plotOrigin + plotSize);
    ctx.lineTo(px, plotOrigin + plotSize + 5);
    ctx.stroke();
    ctx.fillText(fxVal.toFixed(2), px, plotOrigin + plotSize + 8);
  }

  // Y-axis ticks
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  for (let i = 0; i <= nTicks; i++) {
    const t = i / nTicks;
    const fyVal = visFreqY - 2 * visFreqY * t;
    const py = plotOrigin + t * plotSize;
    ctx.beginPath();
    ctx.moveTo(plotOrigin, py);
    ctx.lineTo(plotOrigin - 5, py);
    ctx.stroke();
    ctx.fillText(fyVal.toFixed(2), plotOrigin - 8, py);
  }

  // Axis titles
  ctx.font = "bold 15px sans-serif";
  ctx.fillStyle = "#e2e8f0";
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";
  ctx.fillText("fx (nm\u207b\u00b9)", plotOrigin + plotSize / 2, displaySize - 4);
  ctx.save();
  ctx.translate(10, plotOrigin + plotSize / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText("fy (nm\u207b\u00b9)", 0, 0);
  ctx.restore();

  // ── Center crosshair ──
  ctx.strokeStyle = "rgba(255,255,255,0.5)";
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(centerX, plotOrigin);
  ctx.lineTo(centerX, plotOrigin + plotSize);
  ctx.moveTo(plotOrigin, centerY);
  ctx.lineTo(plotOrigin + plotSize, centerY);
  ctx.stroke();
  ctx.setLineDash([]);

  // DC marker
  ctx.fillStyle = "rgba(255,255,255,0.8)";
  ctx.beginPath();
  ctx.arc(centerX, centerY, 4, 0, 2 * Math.PI);
  ctx.fill();
  ctx.font = "11px sans-serif";
  ctx.fillStyle = "rgba(255,255,255,0.6)";
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText("DC", centerX + 7, centerY + 5);

  // ── Reference rings ──
  const peakPlaneLabels = peaks.map((p) => p.plane);
  const refRings = [
    latticeReferences.d1 !== null
      ? { freq: 1.0 / latticeReferences.d1, color: "#ff3b30", label: `${peakPlaneLabels[0] ?? "d\u2081"}: ${latticeReferences.d1.toFixed(3)} nm` }
      : null,
    latticeReferences.d2 !== null
      ? { freq: 1.0 / latticeReferences.d2, color: "#00e5ff", label: `${peakPlaneLabels[1] ?? "d\u2082"}: ${latticeReferences.d2.toFixed(3)} nm` }
      : null,
  ].filter((ring): ring is { freq: number; color: string; label: string } => ring !== null);

  for (const ring of refRings) {
    if (ring.freq > Math.min(visFreqX, visFreqY)) continue;
    ctx.strokeStyle = ring.color;
    ctx.lineWidth = 2.5;
    ctx.setLineDash([12, 7]);
    ctx.beginPath();
    for (let a = 0; a <= 360; a += 1.5) {
      const rad = (a * Math.PI) / 180;
      const px = f2x(ring.freq * Math.cos(rad));
      const py = f2y(ring.freq * Math.sin(rad));
      if (a === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();
    ctx.setLineDash([]);

    // Ring label at 45 degrees (upper right)
    const labelAngle = -Math.PI / 4;
    const ringLabelX = f2x(ring.freq * Math.cos(labelAngle));
    const ringLabelY = f2y(ring.freq * Math.sin(labelAngle));
    ctx.font = "bold 14px sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.lineWidth = 4;
    ctx.strokeStyle = "rgba(0,0,0,0.85)";
    ctx.strokeText(ring.label, ringLabelX + 6, ringLabelY - 6);
    ctx.fillStyle = ring.color;
    ctx.fillText(ring.label, ringLabelX + 6, ringLabelY - 6);
  }

  // ── Detected peaks ──
  for (const peak of peaks) {
    if (!peak.detected) continue;
    const px = f2x(peak.pf[0]);
    const py = f2y(peak.pf[1]);
    const pxM = f2x(-peak.pf[0]);
    const pyM = f2y(-peak.pf[1]);

    // Diameter line through center
    ctx.strokeStyle = "rgba(255,230,0,0.6)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(pxM, pyM);
    ctx.lineTo(px, py);
    ctx.stroke();

    // Angle arc from center
    const angle = Math.atan2(py - centerY, px - centerX);
    ctx.strokeStyle = "rgba(255,255,255,0.5)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(centerX, centerY, 45, 0, angle, angle < 0);
    ctx.stroke();

    // Peak markers (both peak and Friedel pair)
    for (const [ax, ay] of [[px, py], [pxM, pyM]]) {
      // Outer glow ring
      ctx.strokeStyle = "rgba(141,255,47,0.3)";
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.arc(ax, ay, 16, 0, 2 * Math.PI);
      ctx.stroke();
      // Main ring
      ctx.strokeStyle = "#8dff2f";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(ax, ay, 12, 0, 2 * Math.PI);
      ctx.stroke();
      // Center dot
      ctx.fillStyle = "#8dff2f";
      ctx.beginPath();
      ctx.arc(ax, ay, 4, 0, 2 * Math.PI);
      ctx.fill();
    }

    // Detailed label box near peak
    const labelLines = [
      peak.plane,
      `d = ${peak.dMeasured.toFixed(4)} nm`,
      `\u03b8 = ${peak.angleDeg.toFixed(1)}\u00b0`,
    ];
    if (peak.frequency !== undefined) {
      labelLines.push(`f = ${peak.frequency.toFixed(4)} nm\u207b\u00b9`);
    }
    if (peak.snrDb !== undefined) {
      labelLines.push(`SNR = ${peak.snrDb.toFixed(1)} dB`);
    }

    const lineH = 17;
    const boxPad = 8;
    const labelW = 200;
    const labelH = labelLines.length * lineH + boxPad * 2;

    let boxX = px + 20;
    let boxY = py - labelH - 10;
    if (boxX + labelW > plotOrigin + plotSize) boxX = px - labelW - 20;
    if (boxY < plotOrigin) boxY = py + 20;

    // Label background
    ctx.fillStyle = "rgba(10,15,25,0.88)";
    ctx.strokeStyle = "#8dff2f";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(boxX, boxY, labelW, labelH, 6);
    ctx.fill();
    ctx.stroke();

    // Label text
    ctx.font = "bold 14px sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillStyle = "#8dff2f";
    ctx.fillText(labelLines[0], boxX + boxPad, boxY + boxPad);

    ctx.font = "13px sans-serif";
    ctx.fillStyle = "#e2e8f0";
    for (let li = 1; li < labelLines.length; li++) {
      ctx.fillText(labelLines[li], boxX + boxPad, boxY + boxPad + li * lineH);
    }
  }
}

/**
 * Draw fx/fy axis labels on a clean (no annotation) FFT canvas.
 * Call after renderFftToCanvas so canvas size is already set.
 */
export function drawFftAxisLabels(
  canvas: HTMLCanvasElement,
  fft: { fx: Float64Array; fy: Float64Array; rows: number; cols: number; df: number },
  zoomFactor: number,
): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const { rows, cols, df } = fft;
  const cy = Math.floor(rows / 2);
  const cx = Math.floor(cols / 2);
  const displaySize = canvas.width;
  if (displaySize === 0) return;

  const halfR = zoomFactor <= 1
    ? Math.max(cy, rows - 1 - cy)
    : Math.max(1, Math.floor(rows / (2 * zoomFactor)));
  const halfC = zoomFactor <= 1
    ? Math.max(cx, cols - 1 - cx)
    : Math.max(1, Math.floor(cols / (2 * zoomFactor)));
  const visFreqY = halfR * df;
  const visFreqX = halfC * df;

  const axisMargin = 44;
  const plotSize = displaySize - axisMargin;
  const plotOrigin = axisMargin / 2;

  // Axis frame
  ctx.strokeStyle = "rgba(200,210,225,0.7)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(plotOrigin, plotOrigin);
  ctx.lineTo(plotOrigin, plotOrigin + plotSize);
  ctx.lineTo(plotOrigin + plotSize, plotOrigin + plotSize);
  ctx.stroke();

  ctx.font = "13px sans-serif";
  ctx.fillStyle = "#cbd5e1";
  ctx.strokeStyle = "rgba(200,210,225,0.6)";
  ctx.lineWidth = 1;
  const nTicks = 5;

  // X-axis ticks
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  for (let i = 0; i <= nTicks; i++) {
    const t = i / nTicks;
    const fxVal = -visFreqX + 2 * visFreqX * t;
    const px = plotOrigin + t * plotSize;
    ctx.beginPath();
    ctx.moveTo(px, plotOrigin + plotSize);
    ctx.lineTo(px, plotOrigin + plotSize + 5);
    ctx.stroke();
    ctx.fillText(fxVal.toFixed(2), px, plotOrigin + plotSize + 8);
  }

  // Y-axis ticks
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  for (let i = 0; i <= nTicks; i++) {
    const t = i / nTicks;
    const fyVal = visFreqY - 2 * visFreqY * t;
    const py = plotOrigin + t * plotSize;
    ctx.beginPath();
    ctx.moveTo(plotOrigin, py);
    ctx.lineTo(plotOrigin - 5, py);
    ctx.stroke();
    ctx.fillText(fyVal.toFixed(2), plotOrigin - 8, py);
  }

  // Axis titles
  ctx.font = "bold 15px sans-serif";
  ctx.fillStyle = "#e2e8f0";
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";
  ctx.fillText("fx (nm\u207b\u00b9)", plotOrigin + plotSize / 2, displaySize - 4);
  ctx.save();
  ctx.translate(10, plotOrigin + plotSize / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText("fy (nm\u207b\u00b9)", 0, 0);
  ctx.restore();
}

/** Draw a bar chart for band energy. */
export function renderBandEnergy(
  canvas: HTMLCanvasElement,
  bands: { label: string; value: number; color: string }[],
): void {
  const cssW = 560;
  const cssH = 220;
  const ctx = setupChartCanvas(canvas, cssW, cssH);
  if (!ctx) return;

  const w = cssW;
  const h = cssH;

  const pad = 40;
  const barWidth = (w - pad * 2) / bands.length;

  for (let i = 0; i < bands.length; i++) {
    const barH = Math.max(0, (bands[i].value / 100) * (h - pad - 24));
    const x = pad + i * barWidth;
    const y = h - pad - barH;

    const gradient = ctx.createLinearGradient(0, y, 0, h - pad);
    gradient.addColorStop(0, bands[i].color);
    gradient.addColorStop(1, bands[i].color + "88");
    ctx.fillStyle = gradient;
    ctx.fillRect(x + 12, y, barWidth - 24, barH);

    ctx.fillStyle = "#1e293b";
    ctx.font = "bold 13px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(`${bands[i].value.toFixed(1)}%`, x + barWidth / 2, Math.max(14, y - 6));

    ctx.font = "11px sans-serif";
    ctx.fillStyle = "#64748b";
    ctx.fillText(bands[i].label, x + barWidth / 2, h - 10);
  }

  ctx.strokeStyle = "#cbd5e1";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(pad, h - pad);
  ctx.lineTo(w - pad, h - pad);
  ctx.stroke();
}
