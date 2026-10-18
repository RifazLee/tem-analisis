import { wienerFilterRoi } from './src/lib/wiener.ts';

// Test with real ROI dimensions from squareCenterCrop — non-square ROI
// e.g., user selects 300x100 area, squareCenterCrop makes 100x100
// But what if the selected area produces a very small square?

// Test with a realistic TEM-like image (some noise, some structure)
const size = 256;
const roi = new Float64Array(size * size);
for (let r = 0; r < size; r++) {
  for (let c = 0; c < size; c++) {
    // Simulate lattice fringes + noise
    const fringe = Math.sin(2 * Math.PI * c / 8) * 50;
    const noise = (Math.random() - 0.5) * 20;
    roi[r * size + c] = 128 + fringe + noise;
  }
}

// Test with rectangular input (non-square) — this is what squareCenterCrop prevents,
// but let's test anyway
console.log("--- Rectangular ROI 100x200 ---");
try {
  const rect = new Float64Array(100 * 200);
  for (let i = 0; i < 100 * 200; i++) rect[i] = Math.random() * 255;
  const result = wienerFilterRoi(rect, 100, 200, {
    method: "conventional",
    noiseScale: 1.0,
    regularization: 1.0,
    stabilization: 0.05,
  });
  console.log("Rectangular 100x200: OK, rows =", result.rows, "cols =", result.cols);
} catch (e) {
  console.log("Rectangular 100x200: ERROR -", e.message);
}

// Test timing for large ROI
console.log("\n--- Timing 512x512 ---");
const big = new Float64Array(512 * 512);
for (let i = 0; i < 512 * 512; i++) big[i] = Math.sin(i * 0.001) * 100 + 128 + Math.random() * 10;
const t0 = Date.now();
try {
  const result = wienerFilterRoi(big, 512, 512, {
    method: "conventional",
    noiseScale: 1.0,
    regularization: 1.0,
    stabilization: 0.05,
  });
  console.log("512x512: OK in", Date.now() - t0, "ms");
} catch (e) {
  console.log("512x512: ERROR -", e.message);
}
