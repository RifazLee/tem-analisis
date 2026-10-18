import { wienerFilterRoi } from './src/lib/wiener.ts';

// Test various sizes including non-power-of-2
const sizes = [16, 17, 64, 100, 128, 200, 256];
const methods = ["conventional", "parametric", "cannon", "random_phase_parametric"];

for (const size of sizes) {
  const roi = new Float64Array(size * size);
  for (let i = 0; i < size * size; i++) roi[i] = Math.sin(i * 0.01) * 100 + 128 + Math.random() * 10;
  
  for (const method of methods) {
    try {
      const result = wienerFilterRoi(roi, size, size, {
        method,
        noiseScale: 1.0,
        regularization: 1.0,
        stabilization: 0.05,
      });
      let hasNaN = false;
      for (let i = 0; i < result.data.length; i++) {
        if (!isFinite(result.data[i])) { hasNaN = true; break; }
      }
      console.log(`${size}x${size} ${method}: OK, NaN=${hasNaN}`);
    } catch (e) {
      console.log(`${size}x${size} ${method}: ERROR - ${e.message}`);
    }
  }
}

// Test uniform image (edge case)
console.log("\n--- Uniform image test ---");
const uni = new Float64Array(64 * 64);
for (let i = 0; i < 64 * 64; i++) uni[i] = 100;
try {
  const result = wienerFilterRoi(uni, 64, 64, {
    method: "conventional",
    noiseScale: 1.0,
    regularization: 1.0,
    stabilization: 0.05,
  });
  console.log("Uniform 64x64 conventional: OK");
} catch (e) {
  console.log("Uniform 64x64 conventional: ERROR -", e.message);
}
