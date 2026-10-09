/**
 * Canvas rendering helpers for grayscale images and charts.
 * Avoids Math.max/min spread on large arrays (stack overflow risk).
 */

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

  // Keep a large bitmap so fine diffraction rings and angle guides remain visible.
  const displaySize = 400;
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

/** Draw a histogram on a canvas with axis labels (probability density vs intensity). */
export function renderHistogram(
  canvas: HTMLCanvasElement,
  counts: number[],
  binCenters: number[],
  color: string,
): void {
  const ctx = canvas.getContext("2d");
  if (!ctx || counts.length === 0) return;

  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  const padLeft = 48;
  const padBottom = 28;
  const padTop = 8;
  const padRight = 8;
  const plotW = w - padLeft - padRight;
  const plotH = h - padBottom - padTop;

  let maxCount = 0;
  let totalCount = 0;
  for (let i = 0; i < counts.length; i++) {
    if (counts[i] > maxCount) maxCount = counts[i];
    totalCount += counts[i];
  }
  if (maxCount === 0) return;

  // Convert counts to probability density: P(x) = count / (N * binWidth)
  // binCenters[i] are evenly spaced; compute binWidth from them
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

  // Draw bars (probability density on Y)
  const barWidth = plotW / counts.length;
  ctx.fillStyle = color;
  for (let i = 0; i < counts.length; i++) {
    const barH = (densities[i] / maxDensity) * plotH;
    const x = padLeft + i * barWidth;
    const y = padTop + plotH - barH;
    ctx.fillRect(x, y, barWidth + 0.5, barH);
  }

  // Axis lines
  ctx.strokeStyle = "#cbd5e1";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(padLeft, padTop);
  ctx.lineTo(padLeft, padTop + plotH);
  ctx.lineTo(padLeft + plotW, padTop + plotH);
  ctx.stroke();

  // Y-axis ticks (probability density)
  ctx.font = "9px sans-serif";
  ctx.fillStyle = "#64748b";
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  const yTicks = 4;
  for (let i = 0; i <= yTicks; i++) {
    const val = (maxDensity * i) / yTicks;
    const y = padTop + plotH - (i / yTicks) * plotH;
    ctx.fillText(val.toExponential(1), padLeft - 4, y);
    if (i > 0) {
      ctx.strokeStyle = "#e2e8f0";
      ctx.beginPath();
      ctx.moveTo(padLeft, y);
      ctx.lineTo(padLeft + plotW, y);
      ctx.stroke();
    }
  }

  // X-axis ticks (intensity values)
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  const xTicks = 5;
  const minVal = binCenters[0];
  const maxVal = binCenters[binCenters.length - 1];
  for (let i = 0; i <= xTicks; i++) {
    const val = minVal + ((maxVal - minVal) * i) / xTicks;
    const x = padLeft + (i / xTicks) * plotW;
    ctx.fillText(val.toFixed(0), x, padTop + plotH + 4);
  }

  // Axis labels
  ctx.font = "bold 10px sans-serif";
  ctx.fillStyle = "#475569";
  ctx.textAlign = "center";
  // Y label (rotated)
  ctx.save();
  ctx.translate(12, padTop + plotH / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText("Probability Density", 0, 0);
  ctx.restore();
  // X label
  ctx.fillText("Intensitas Asli (Level Detektor)", padLeft + plotW / 2, h - 4);
}

/** Draw a radial profile (log-y) on a canvas with axis labels. */
export function renderRadialProfile(
  canvas: HTMLCanvasElement,
  freq: number[],
  mag: number[],
  refLines: { freq: number; color: string; label: string }[],
): void {
  const ctx = canvas.getContext("2d");
  if (!ctx || freq.length === 0) return;

  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  const padLeft = 48;
  const padBottom = 28;
  const padTop = 8;
  const padRight = 8;
  const plotW = w - padLeft - padRight;
  const plotH = h - padBottom - padTop;

  let maxFreq = 0;
  for (let i = 0; i < freq.length; i++) if (freq[i] > maxFreq) maxFreq = freq[i];
  if (maxFreq === 0) return;

  // Find positive-mag range for log scale
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

  // Reference lines
  for (const ref of refLines) {
    if (ref.freq > maxFreq) continue;
    const x = padLeft + (ref.freq / maxFreq) * plotW;
    ctx.strokeStyle = ref.color;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 4]);
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
    ctx.font = "9px sans-serif";
    ctx.fillStyle = ref.color;
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    ctx.fillText(ref.label, x, padTop + plotH - 2);
  }

  // Profile curve
  ctx.strokeStyle = "#3b82f6";
  ctx.lineWidth = 1.5;
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
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(padLeft, padTop);
  ctx.lineTo(padLeft, padTop + plotH);
  ctx.lineTo(padLeft + plotW, padTop + plotH);
  ctx.stroke();

  // Y-axis ticks (log magnitude)
  ctx.font = "9px sans-serif";
  ctx.fillStyle = "#64748b";
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  const yTicks = 4;
  for (let i = 0; i <= yTicks; i++) {
    const logVal = logMin + (logRange * i) / yTicks;
    const y = padTop + plotH - (i / yTicks) * plotH;
    ctx.fillText(`10^${logVal.toFixed(1)}`, padLeft - 4, y);
    if (i > 0) {
      ctx.strokeStyle = "#e2e8f0";
      ctx.beginPath();
      ctx.moveTo(padLeft, y);
      ctx.lineTo(padLeft + plotW, y);
      ctx.stroke();
    }
  }

  // X-axis ticks (spatial frequency nm^-1)
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  const xTicks = 5;
  for (let i = 0; i <= xTicks; i++) {
    const val = (maxFreq * i) / xTicks;
    const x = padLeft + (i / xTicks) * plotW;
    ctx.fillText(val.toFixed(2), x, padTop + plotH + 4);
  }

  // Axis labels
  ctx.font = "bold 10px sans-serif";
  ctx.fillStyle = "#475569";
  ctx.textAlign = "center";
  // Y label (rotated)
  ctx.save();
  ctx.translate(12, padTop + plotH / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText("Rata-rata Magnitude (log)", 0, 0);
  ctx.restore();
  // X label
  ctx.fillText("Frekuensi Spasial (nm⁻¹)", padLeft + plotW / 2, h - 4);
}

/**
 * Overlay reference rings and detected peaks on the FFT canvas.
 * Must be called after renderFftToCanvas so canvas size is set correctly.
 */
export function overlayFftAnnotations(
  canvas: HTMLCanvasElement,
  fft: { fx: Float64Array; fy: Float64Array; rows: number; cols: number; df: number },
  peaks: { detected: boolean; pf: [number, number]; dMeasured: number; angleDeg: number; plane: string }[],
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

  // The visible frequency window after zoom:
  // renderFftToCanvas shows halfR = rows/(2*zoomFactor) pixels, each pixel = df nm^-1
  const halfR = zoomFactor <= 1
    ? Math.max(cy, rows - 1 - cy)
    : Math.max(1, Math.floor(rows / (2 * zoomFactor)));
  const halfC = zoomFactor <= 1
    ? Math.max(cx, cols - 1 - cx)
    : Math.max(1, Math.floor(cols / (2 * zoomFactor)));
  const visFreqY = halfR * df; // max visible fy in nm^-1
  const visFreqX = halfC * df; // max visible fx in nm^-1

  // Map frequency (nm^-1) to canvas pixel coordinate
  const f2x = (f: number) => ((f + visFreqX) / (2 * visFreqX)) * displaySize;
  const f2y = (f: number) => ((f + visFreqY) / (2 * visFreqY)) * displaySize;

  // Center crosshair makes the origin and radial geometry unambiguous.
  const centerX = f2x(0);
  const centerY = f2y(0);
  ctx.strokeStyle = "rgba(255,255,255,0.9)";
  ctx.lineWidth = 1;
  ctx.setLineDash([5, 5]);
  ctx.beginPath();
  ctx.moveTo(centerX, 0);
  ctx.lineTo(centerX, displaySize);
  ctx.moveTo(0, centerY);
  ctx.lineTo(displaySize, centerY);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(centerX, centerY, 3, 0, 2 * Math.PI);
  ctx.fill();

  // Reference rings
  const refRings = [
    latticeReferences.d1 !== null
      ? { freq: 1.0 / latticeReferences.d1, color: "#ff3b30", label: `${latticeReferences.d1.toFixed(3)} nm` }
      : null,
    latticeReferences.d2 !== null
      ? { freq: 1.0 / latticeReferences.d2, color: "#00e5ff", label: `${latticeReferences.d2.toFixed(3)} nm` }
      : null,
  ].filter((ring): ring is { freq: number; color: string; label: string } => ring !== null);

  for (const ring of refRings) {
    if (ring.freq > Math.min(visFreqX, visFreqY)) continue;
    ctx.strokeStyle = ring.color;
    ctx.lineWidth = 3;
    ctx.setLineDash([10, 6]);
    ctx.beginPath();
    for (let a = 0; a <= 360; a += 2) {
      const rad = (a * Math.PI) / 180;
      const px = f2x(ring.freq * Math.cos(rad));
      const py = f2y(ring.freq * Math.sin(rad));
      if (a === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();
    ctx.setLineDash([]);

    const labelX = Math.min(displaySize - 8, Math.max(8, centerX + ring.freq * (displaySize / (2 * visFreqX))));
    ctx.font = "bold 12px sans-serif";
    ctx.textAlign = "left";
    ctx.fillStyle = ring.color;
    ctx.strokeStyle = "rgba(0,0,0,0.8)";
    ctx.lineWidth = 3;
    ctx.strokeText(`d=${ring.label}`, labelX - 46, centerY - 8);
    ctx.fillText(`d=${ring.label}`, labelX - 46, centerY - 8);
  }

  // Detected peaks
  for (const peak of peaks) {
    if (!peak.detected) continue;
    const px = f2x(peak.pf[0]);
    const py = f2y(peak.pf[1]);
    const pxM = f2x(-peak.pf[0]);
    const pyM = f2y(-peak.pf[1]);

    // Draw the reflector as a high-contrast diameter through the origin.
    ctx.strokeStyle = "#ffe600";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(pxM, pyM);
    ctx.lineTo(px, py);
    ctx.stroke();

    // Angle guide from the positive horizontal axis to the detected reflector.
    const angle = Math.atan2(py - centerY, px - centerX);
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(centerX, centerY, 30, 0, angle, angle < 0);
    ctx.stroke();

    for (const [ax, ay] of [[px, py], [pxM, pyM]]) {
      ctx.strokeStyle = "#8dff2f";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(ax, ay, 11, 0, 2 * Math.PI);
      ctx.stroke();
      ctx.fillStyle = "#8dff2f";
      ctx.beginPath();
      ctx.arc(ax, ay, 3, 0, 2 * Math.PI);
      ctx.fill();
    }

    ctx.font = "bold 13px sans-serif";
    ctx.textAlign = "center";
    const labelY = py > 32 ? py - 16 : py + 30;
    const label = `d=${peak.dMeasured.toFixed(3)} nm | ${peak.angleDeg.toFixed(0)}°`;
    ctx.lineWidth = 4;
    ctx.strokeStyle = "rgba(0,0,0,0.85)";
    ctx.strokeText(label, px, labelY);
    ctx.fillStyle = "#8dff2f";
    ctx.fillText(label, px, labelY);
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

  // Axis label text
  ctx.font = "bold 13px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";

  // fx label (bottom center)
  ctx.fillStyle = "#e2e8f0";
  ctx.fillText(`fx (nm⁻¹)`, displaySize / 2, displaySize - 6);

  // fy label (left side, rotated)
  ctx.save();
  ctx.translate(14, displaySize / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText(`fy (nm⁻¹)`, 0, 0);
  ctx.restore();

  // Tick labels at the edges
  ctx.font = "10px sans-serif";
  ctx.fillStyle = "#94a3b8";
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  // x-axis ticks
  const xTickVals = [-visFreqX, 0, visFreqX];
  const xTickPos = [0, displaySize / 2, displaySize - 1];
  for (let i = 0; i < xTickVals.length; i++) {
    if (i === 0) { ctx.textAlign = "left"; }
    else if (i === 2) { ctx.textAlign = "right"; }
    else { ctx.textAlign = "center"; }
    ctx.fillText(xTickVals[i].toFixed(2), xTickPos[i], displaySize - 20);
  }
  // y-axis ticks
  ctx.textBaseline = "middle";
  const yTickVals = [visFreqY, 0, -visFreqY];
  const yTickPos = [0, displaySize / 2, displaySize - 1];
  for (let i = 0; i < yTickVals.length; i++) {
    if (i === 0) { ctx.textBaseline = "top"; }
    else if (i === 2) { ctx.textBaseline = "bottom"; }
    else { ctx.textBaseline = "middle"; }
    ctx.textAlign = "right";
    ctx.fillText(yTickVals[i].toFixed(2), 24, yTickPos[i]);
  }
}

/** Draw a bar chart for band energy. */
export function renderBandEnergy(
  canvas: HTMLCanvasElement,
  bands: { label: string; value: number; color: string }[],
): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  const pad = 30;
  const barWidth = (w - pad * 2) / bands.length;

  for (let i = 0; i < bands.length; i++) {
    const barH = Math.max(0, (bands[i].value / 100) * (h - pad - 20));
    const x = pad + i * barWidth;
    const y = h - pad - barH;

    ctx.fillStyle = bands[i].color;
    ctx.fillRect(x + 8, y, barWidth - 16, barH);

    ctx.fillStyle = "#1e293b";
    ctx.font = "bold 12px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(`${bands[i].value.toFixed(1)}%`, x + barWidth / 2, Math.max(12, y - 4));

    ctx.font = "10px sans-serif";
    ctx.fillStyle = "#64748b";
    ctx.fillText(bands[i].label, x + barWidth / 2, h - 8);
  }

  ctx.strokeStyle = "#e2e8f0";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(pad, h - pad);
  ctx.lineTo(w - pad, h - pad);
  ctx.stroke();
}
