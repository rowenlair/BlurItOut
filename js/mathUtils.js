/** @returns {number} `value` clamped to `[min, max]`. */
export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
