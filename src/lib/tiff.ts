/**
 * TIFF image loader using utif.js.
 * Parses uploaded .tif files into grayscale Float64Array matrices.
 */
import UTIF from "utif";

export interface LoadedImage {
  data: Float64Array;
  rows: number;
  cols: number;
  originalRows: number;
  originalCols: number;
  dtype: string;
  min: number;
  max: number;
}

/**
 * Load a TIFF file into a grayscale Float64Array.
 * If the image has multiple IFDs, uses the first full-resolution one.
 */
export async function loadTiff(file: File): Promise<LoadedImage> {
  const arrayBuffer = await file.arrayBuffer();
  const ifds = UTIF.decode(arrayBuffer);

  // Find the first IFD that is not a thumbnail (has the largest area)
  let bestIdx = 0;
  let bestArea = 0;
  for (let i = 0; i < ifds.length; i++) {
    UTIF.decodeImage(arrayBuffer, ifds[i]);
    const area = ifds[i].width * ifds[i].height;
    if (area > bestArea) {
      bestArea = area;
      bestIdx = i;
    }
  }

  const ifd = ifds[bestIdx];
  UTIF.decodeImage(arrayBuffer, ifd);

  const rgba = UTIF.toRGBA8(ifd);
  const w = ifd.width;
  const h = ifd.height;

  // Convert RGBA8 to grayscale (Float64)
  const data = new Float64Array(w * h);
  let min = Infinity;
  let max = -Infinity;

  for (let i = 0; i < w * h; i++) {
    const r = rgba[i * 4];
    const g = rgba[i * 4 + 1];
    const b = rgba[i * 4 + 2];
    const gray = (r + g + b) / 3;
    data[i] = gray;
    if (gray < min) min = gray;
    if (gray > max) max = gray;
  }

  // Detect original bit depth from TIFF metadata
  let dtype = "8-bit";
  const t258 = ifd.t258 as unknown;
  if (t258 && typeof t258 === "object" && "length" in (t258 as object)) {
    const arr = t258 as ArrayLike<number>;
    if (arr.length > 0) {
      const bps = arr[0];
      if (bps === 16) dtype = "16-bit";
      else if (bps === 32) dtype = "32-bit";
      else dtype = `${bps}-bit`;
    }
  }

  return {
    data,
    rows: h,
    cols: w,
    originalRows: h,
    originalCols: w,
    dtype,
    min,
    max,
  };
}

/** Remove info bar (bottom rows of the image). */
export function removeInfoBar(
  img: Float64Array,
  rows: number,
  cols: number,
  barRow: number,
): { data: Float64Array; rows: number } {
  if (barRow >= rows) return { data: img, rows };
  const newRows = barRow;
  const newData = new Float64Array(newRows * cols);
  for (let r = 0; r < newRows; r++) {
    for (let c = 0; c < cols; c++) {
      newData[r * cols + c] = img[r * cols + c];
    }
  }
  return { data: newData, rows: newRows };
}

/** Crop a rectangular ROI [x1, y1, x2, y2) from the image. */
export function cropRoi(
  img: Float64Array,
  rows: number,
  cols: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): { data: Float64Array; rows: number; cols: number } {
  const rx1 = Math.max(0, Math.min(cols - 1, Math.floor(x1)));
  const ry1 = Math.max(0, Math.min(rows - 1, Math.floor(y1)));
  const rx2 = Math.max(rx1 + 1, Math.min(cols, Math.ceil(x2)));
  const ry2 = Math.max(ry1 + 1, Math.min(rows, Math.ceil(y2)));
  const newCols = rx2 - rx1;
  const newRows = ry2 - ry1;
  const newData = new Float64Array(newRows * newCols);
  for (let r = 0; r < newRows; r++) {
    for (let c = 0; c < newCols; c++) {
      newData[r * newCols + c] = img[(ry1 + r) * cols + (rx1 + c)];
    }
  }
  return { data: newData, rows: newRows, cols: newCols };
}

/**
 * Crop to a square centered on the center of the given ROI.
 * The Python code uses square_center_crop to ensure x and y frequency axes
 * have equal resolution.
 */
export function squareCenterCrop(
  img: Float64Array,
  rows: number,
  cols: number,
): { data: Float64Array; rows: number; cols: number } {
  const s = Math.min(rows, cols);
  const y0 = Math.floor((rows - s) / 2);
  const x0 = Math.floor((cols - s) / 2);
  const newData = new Float64Array(s * s);
  for (let r = 0; r < s; r++) {
    for (let c = 0; c < s; c++) {
      newData[r * s + c] = img[(y0 + r) * cols + (x0 + c)];
    }
  }
  return { data: newData, rows: s, cols: s };
}
