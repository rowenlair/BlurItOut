import { test } from "node:test";
import assert from "node:assert/strict";
import { stackBlurRGBA } from "../js/stackBlur.js";

function makeUniformImage(width, height, r, g, b, a) {
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    pixels[i * 4] = r;
    pixels[i * 4 + 1] = g;
    pixels[i * 4 + 2] = b;
    pixels[i * 4 + 3] = a;
  }
  return pixels;
}

test("a uniform-colour buffer is unchanged by any radius", () => {
  for (const radius of [1, 8, 40, 254]) {
    const pixels = makeUniformImage(30, 30, 100, 150, 200, 255);
    const before = pixels.slice();
    stackBlurRGBA(pixels, 30, 30, radius);
    for (let i = 0; i < pixels.length; i++) {
      assert.ok(
        Math.abs(pixels[i] - before[i]) <= 1,
        `byte ${i} changed at radius ${radius}: ${before[i]} -> ${pixels[i]}`
      );
    }
  }
});

test("a single bright pixel spreads symmetrically and conserves total energy", () => {
  const width = 41;
  const height = 41;
  const cx = 20;
  const cy = 20;
  const pixels = new Uint8ClampedArray(width * height * 4);
  const centerIndex = (cy * width + cx) * 4;
  pixels[centerIndex] = 255;
  pixels[centerIndex + 1] = 255;
  pixels[centerIndex + 2] = 255;
  pixels[centerIndex + 3] = 255;

  let sumBefore = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    sumBefore += pixels[i];
  }

  stackBlurRGBA(pixels, width, height, 8);

  let sumAfter = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    sumAfter += pixels[i];
  }

  // 8-bit rounding of many near-zero tail pixels loses a little energy;
  // a real indexing bug would be off by a much larger factor than this.
  assert.ok(sumAfter > sumBefore * 0.5, `energy not roughly conserved: ${sumBefore} -> ${sumAfter}`);
  assert.ok(sumAfter <= sumBefore, `blur must not create energy: ${sumBefore} -> ${sumAfter}`);

  const at = (x, y, channel) => pixels[(y * width + x) * 4 + channel];
  assert.equal(at(cx - 5, cy, 0), at(cx + 5, cy, 0), "not symmetric left/right");
  assert.equal(at(cx, cy - 5, 0), at(cx, cy + 5, 0), "not symmetric up/down");
  assert.ok(at(cx, cy, 0) > at(cx + 15, cy, 0), "center should be brighter than the far edge");
});

test("alpha is blurred, not dropped or forced opaque", () => {
  const width = 21;
  const height = 21;
  const pixels = new Uint8ClampedArray(width * height * 4);
  // Left half fully opaque, right half fully transparent.
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      pixels[i] = 200;
      pixels[i + 1] = 100;
      pixels[i + 2] = 50;
      pixels[i + 3] = x < width / 2 ? 255 : 0;
    }
  }

  stackBlurRGBA(pixels, width, height, 6);

  const alphaAt = (x, y) => pixels[(y * width + x) * 4 + 3];
  // Right at the boundary the alpha should now be somewhere strictly
  // between 0 and 255 -- proof the alpha channel actually got blurred.
  const boundaryAlpha = alphaAt(Math.floor(width / 2), Math.floor(height / 2));
  assert.ok(boundaryAlpha > 0 && boundaryAlpha < 255, `alpha not blurred at boundary: ${boundaryAlpha}`);
  // Far from the boundary the alpha should stay close to its original value.
  assert.ok(alphaAt(1, 10) > 200, "alpha near the opaque edge collapsed");
  assert.ok(alphaAt(width - 2, 10) < 50, "alpha near the transparent edge collapsed");
});

test("radius 0 and radius 1 do not throw and radius 0 is a no-op", () => {
  const pixels = makeUniformImage(5, 5, 10, 20, 30, 40);
  const before = pixels.slice();
  assert.doesNotThrow(() => stackBlurRGBA(pixels, 5, 5, 0));
  assert.deepEqual(pixels, before, "radius 0 must not modify pixels");
  assert.doesNotThrow(() => stackBlurRGBA(pixels, 5, 5, 1));
});

test("zero-area input does not throw", () => {
  const pixels = new Uint8ClampedArray(0);
  assert.doesNotThrow(() => stackBlurRGBA(pixels, 0, 0, 10));
});

test("radius 4 and radius 64 cost about the same (O(n), not O(radius * n))", () => {
  const width = 400;
  const height = 400;

  function timeBlur(radius) {
    const pixels = makeUniformImage(width, height, 0, 0, 0, 255);
    // Add some noise so the blur has real work to do, not a trivially
    // uniform fast path.
    for (let i = 0; i < pixels.length; i += 97) {
      pixels[i] = (i * 7) % 255;
    }
    const start = performance.now();
    stackBlurRGBA(pixels, width, height, radius);
    return performance.now() - start;
  }

  // Warm up the JIT so timing reflects steady-state cost, not compilation.
  timeBlur(4);
  timeBlur(64);

  const trials = 3;
  let total4 = 0;
  let total64 = 0;
  for (let i = 0; i < trials; i++) {
    total4 += timeBlur(4);
    total64 += timeBlur(64);
  }
  const avg4 = total4 / trials;
  const avg64 = total64 / trials;

  // Generous bound to avoid CI flakiness: a correct O(n) implementation
  // should cost about the same regardless of radius. A O(radius * n)
  // implementation (a box-blur loop mistake) would be ~16x slower here.
  const ratio = avg64 / Math.max(avg4, 0.001);
  assert.ok(ratio < 3, `radius 64 (${avg64.toFixed(2)}ms) should not be much slower than radius 4 (${avg4.toFixed(2)}ms); ratio=${ratio.toFixed(2)}`);
});
