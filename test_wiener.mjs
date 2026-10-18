import { wienerFilterRoi } from './src/lib/wiener.ts';

const size = 32;
const roi = new Float64Array(size * size);
for (let i = 0; i < size * size; i++) roi[i] = Math.sin(i * 0.1) * 100 + 128;

try {
  const result = wienerFilterRoi(roi, size, size, {
    method: "conventional",
    noiseScale: 1.0,
    regularization: 1.0,
    stabilization: 0.05,
  });
  console.log("SUCCESS: rows =", result.rows, "cols =", result.cols);
  let hasNaN = false;
  for (let i = 0; i < result.data.length; i++) {
    if (!isFinite(result.data[i])) { hasNaN = true; break; }
  }
  console.log("Has NaN/Inf:", hasNaN);
} catch (e) {
  console.error("ERROR:", e.message);
  console.error(e.stack);
}
