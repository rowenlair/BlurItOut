/**
 * A box-based triangular blur, in the spirit of Mario Klingemann's
 * "Stack Blur" (https://underdestruction.com/2004/02/25/stackblur-2004/,
 * MIT licensed — see js/stackBlur.LICENSE). Stack Blur approximates a
 * gaussian by applying, per scanline, a triangular (Bartlett) kernel —
 * mathematically a box filter convolved with itself. That is exactly what
 * this file computes, via a double summed-area table per line instead of
 * Klingemann's sliding "stack" bookkeeping: for a line of pixels and a
 * radius R, the triangular-weighted sum at position x is
 *
 *   triangularSum(x) = sum_{h=0}^{R} boxSum_h(x)
 *
 * i.e. the sum of R+1 nested box sums centered on x. Each box sum is a
 * difference of two prefix-sum lookups, and — because the same box sum
 * is reused for every h — the sum of box sums is itself a difference of
 * two lookups into the prefix sum *of the prefix sum* ("Q" below). That
 * makes the whole thing O(1) per output pixel, so a full pass over a
 * line is O(length), independent of the radius — the same complexity
 * guarantee Stack Blur is prized for, which is what makes it affordable
 * to re-run the blur over the whole image on every slider tick (see
 * blurProcessor.js) rather than only over small per-shape crops.
 *
 * Two passes (horizontal, then vertical) make it a full 2D triangular
 * blur, applied separately per RGBA channel so alpha blurs along with
 * color instead of being dropped or forced opaque.
 */

// Defensive upper bound on radius. Not a table-indexing limit (this
// implementation has no lookup table) — just a sane ceiling, since
// BlurProcessor's adaptive downscaling (see blurProcessor.js) keeps the
// requested radius near ~20 in practice regardless of how extreme the
// blur-amount slider goes.
const MAX_RADIUS = 254;

/**
 * Triangular-blur a single channel of a single scanline (row or column)
 * in place conceptually — reads from `input`, writes to `output`, so the
 * horizontal and vertical passes can be chained without a channel
 * clobbering itself mid-read.
 * @param {Float64Array|Uint8ClampedArray} input - source pixel buffer
 * @param {Float64Array} output - destination buffer, same length as input
 * @param {number} offset - index of the first sample of this channel/line
 * @param {number} stride - distance between consecutive samples along the line
 * @param {number} length - number of samples along the line
 * @param {number} radius
 */
function blurLineChannel(input, output, offset, stride, length, radius) {
  const pad = radius + 1;
  const extLength = length + 2 * pad;
  const first = input[offset];
  const last = input[offset + (length - 1) * stride];

  // Extended (edge-clamped) line: repeats the first/last sample `pad`
  // times on either side so the sliding window never needs a branch for
  // "off the end of the line" — it just reads the clamped padding.
  const ext = new Float64Array(extLength);
  for (let i = 0; i < pad; i++) {
    ext[i] = first;
  }
  for (let i = 0; i < length; i++) {
    ext[pad + i] = input[offset + i * stride];
  }
  for (let i = 0; i < pad; i++) {
    ext[pad + length + i] = last;
  }

  // P[k] = sum of ext[0..k-1]; Q[k] = sum of P[0..k-1].
  const prefixSum = new Float64Array(extLength + 1);
  for (let k = 1; k <= extLength; k++) {
    prefixSum[k] = prefixSum[k - 1] + ext[k - 1];
  }
  const doublePrefixSum = new Float64Array(extLength + 1);
  for (let k = 1; k <= extLength; k++) {
    doublePrefixSum[k] = doublePrefixSum[k - 1] + prefixSum[k - 1];
  }

  const denom = (radius + 1) * (radius + 1);
  for (let x = 0; x < length; x++) {
    const idx = pad + x;
    const triangularSum =
      doublePrefixSum[idx + radius + 2] -
      2 * doublePrefixSum[idx + 1] +
      doublePrefixSum[idx - radius];
    output[offset + x * stride] = triangularSum / denom;
  }
}

/**
 * Blur `pixels` (RGBA, `width * height * 4` bytes) in place using a
 * triangular (Stack-Blur-equivalent) kernel. Two passes — horizontal
 * then vertical — each O(width * height), independent of `radius`.
 * @param {Uint8ClampedArray} pixels - RGBA pixel buffer, mutated in place
 * @param {number} width
 * @param {number} height
 * @param {number} radius - blur radius in pixels; clamped to [0, 254]
 */
export function stackBlurRGBA(pixels, width, height, radius) {
  radius = Math.floor(radius);
  if (!(radius >= 1) || width <= 0 || height <= 0) {
    return;
  }
  radius = Math.min(radius, MAX_RADIUS);

  const horizontal = new Float64Array(pixels.length);
  for (let y = 0; y < height; y++) {
    const rowOffset = y * width * 4;
    for (let channel = 0; channel < 4; channel++) {
      blurLineChannel(pixels, horizontal, rowOffset + channel, 4, width, radius);
    }
  }

  const vertical = new Float64Array(pixels.length);
  for (let x = 0; x < width; x++) {
    const colOffset = x * 4;
    for (let channel = 0; channel < 4; channel++) {
      blurLineChannel(horizontal, vertical, colOffset + channel, width * 4, height, radius);
    }
  }

  for (let i = 0; i < pixels.length; i++) {
    pixels[i] = Math.round(vertical[i]);
  }
}

/**
 * Browser convenience wrapper: blur a canvas's pixels in place.
 * @param {HTMLCanvasElement} canvas
 * @param {number} radius
 */
export function stackBlurCanvasRGBA(canvas, radius) {
  const ctx = canvas.getContext("2d");
  const { width, height } = canvas;
  if (width <= 0 || height <= 0 || !(radius >= 1)) {
    return;
  }
  const imageData = ctx.getImageData(0, 0, width, height);
  stackBlurRGBA(imageData.data, width, height, radius);
  ctx.putImageData(imageData, 0, 0);
}
