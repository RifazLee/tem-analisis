import { wienerFilterRoi } from './src/lib/wiener.ts';

// Test with very large ROI (realistic TEM image sizes)
for (const size of [512, 768, 1024, 2048]) {
  const roi = new Float64Array(size * size);
  for (let i = 0; i < size * size; i++) roi[i] = Math.sin(i * 0.001) * 100 + 128 + Math.random() * 20;
  
  const t0 = Date.now();
  try {
    const result = wienerFilterRoi(roi, size, size, {
      method: "conventional",
      noiseScale: 1.0,
      regularization: 1.0,
      stabilization: 0.05,
    });
    const elapsed = Date.now() - t0;
    let hasNaN = false;
    for (let i = 0; i < result.data.length; i++) {
      if (!isFinite(result.data[i])) { hasNaN = true; break; }
    }
    console.log(`${size}x${size}: OK in ${elapsed}ms, NaN=${hasNaN}`);
  } catch (e) {
    console.log(`${size}x${size}: ERROR in ${Date.now() - t0}ms - ${e.message}`);
  }
}

// Test with rectangular ROI (what squareCenterCrop actually produces)
console.log("\n--- Rectangular ROI 200x500 (square crop -> 200x200) ---");
const rect = new Float64Array(200 * 500);
for (let i = 0; i < 200 * 500; i++) rect[i] = Math.random() * 255;
try {
  const result = wienerFilterRoi(rect, 200, 500, {
    method: "conventional",
    noiseScale: 1.0,
    regularization: 1.0,
    stabilization: 0.05,
  });
  console.log("200x500: OK, rows =", result.rows, "cols =", result.cols);
} catch (e) {
  console.log("200x500: ERROR -", e.message);
}
