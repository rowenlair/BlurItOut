import { stackBlurRGBA } from "./stackBlur.js";
import { clamp } from "./mathUtils.js";

/** Blur bases are never built larger than this on their longer side.
 * Feeding a multi-thousand-pixel original into the blur buys nothing —
 * the result gets upscaled again before it's ever shown — so capping
 * this is what keeps the *whole* pipeline (not just the final adaptive
 * downscale) cheap. */
const BASE_MAX_DIM = 2048;

/** The StackBlur radius the adaptive downscale in `_rebuildBlurCache`
 * aims for. Chosen empirically as a sweet spot: small enough to stay
 * fast, large enough that the triangular kernel still looks smooth
 * rather than boxy. */
const TARGET_STACK_RADIUS = 20;

/** Never shrink the blur cache's shorter side below this many pixels,
 * however extreme the requested blur, so a maxed-out slider still
 * produces a (very smeared, but non-degenerate) image rather than a
 * handful of pixels. */
const MIN_CACHE_SHORT_SIDE = 32;

/**
 * Owns the "blur the whole image once, then let shapes clip into it"
 * pipeline described in the project plan. Two cached canvases:
 *
 * - `_blurBase`  — the source image, downscaled once (per image load) to
 *   at most `BASE_MAX_DIM` on its longer side.
 * - `_blurCache` — `_blurBase`, downscaled *again* by an amount that
 *   adapts to the requested radius, then run through `stackBlurRGBA`.
 *   Rebuilt lazily, only when the requested radius actually changes.
 *
 * The adaptive second downscale is what keeps blurring cheap no matter
 * how large a blur is requested: a bigger requested radius shrinks
 * `_blurCache` further so the *effective* StackBlur radius stays near
 * `TARGET_STACK_RADIUS`, and pixel count (the other cost driver) stays
 * roughly constant too.
 */
export class BlurProcessor {
  constructor() {
    /** @type {HTMLCanvasElement|null} */
    this._blurBase = null;
    /** Scale factor from source image space to `_blurBase` space. */
    this._baseScale = 1;

    this._radiusPx = 0;
    /** @type {HTMLCanvasElement|null} */
    this._blurCache = null;
    this._blurCacheDirty = false;
  }

  /**
   * Build `_blurBase` from a freshly loaded image and invalidate any
   * previous blur cache. Call this once per image load.
   * @param {HTMLImageElement|HTMLCanvasElement} image
   */
  setSource(image) {
    const sourceWidth = image.naturalWidth ?? image.width;
    const sourceHeight = image.naturalHeight ?? image.height;

    this._baseScale = Math.min(1, BASE_MAX_DIM / Math.max(sourceWidth, sourceHeight));
    const baseWidth = Math.max(1, Math.round(sourceWidth * this._baseScale));
    const baseHeight = Math.max(1, Math.round(sourceHeight * this._baseScale));

    this._blurBase = document.createElement("canvas");
    this._blurBase.width = baseWidth;
    this._blurBase.height = baseHeight;
    const ctx = this._blurBase.getContext("2d");
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(image, 0, 0, baseWidth, baseHeight);

    this._blurCache = null;
    this._blurCacheDirty = true;
  }

  /**
   * Set the requested blur radius, in *source image* pixels. A no-op if
   * unchanged. The blur cache is not rebuilt here — only marked dirty —
   * so that a slider firing many `input` events per second costs at
   * most one rebuild, on the next `getBlurredCanvas()` call.
   * @param {number} radiusPx
   */
  setRadius(radiusPx) {
    radiusPx = Math.max(0, radiusPx);
    if (radiusPx === this._radiusPx) {
      return;
    }
    this._radiusPx = radiusPx;
    this._blurCacheDirty = true;
  }

  /** @returns {boolean} whether the current radius produces any blur at all. */
  get isActive() {
    return this._radiusPx > 0 && this._blurBase !== null;
  }

  /**
   * Lazily (re)build the blur cache if needed, and return it.
   * @returns {{canvas: HTMLCanvasElement}|null} the cached blurred canvas
   *   (stretch it over the full image rect to use it), or `null` when the
   *   radius is 0 or no source has been set.
   */
  getBlurredCanvas() {
    if (!this._blurBase || this._radiusPx <= 0) {
      return null;
    }
    if (this._blurCacheDirty || !this._blurCache) {
      this._rebuildBlurCache();
    }
    return { canvas: this._blurCache };
  }

  /** Rebuild `_blurCache` from `_blurBase` for the current `_radiusPx`. */
  _rebuildBlurCache() {
    const baseWidth = this._blurBase.width;
    const baseHeight = this._blurBase.height;

    const radiusBase = this._radiusPx * this._baseScale;
    const minExtraScale = Math.max(0.01, MIN_CACHE_SHORT_SIDE / Math.min(baseWidth, baseHeight));
    const extraScale = clamp(TARGET_STACK_RADIUS / Math.max(radiusBase, 1), minExtraScale, 1);

    this._blurCache = downscaleProgressively(this._blurBase, extraScale);

    const stackRadius = clamp(Math.round(radiusBase * extraScale), 1, 254);
    const ctx = this._blurCache.getContext("2d");
    const imageData = ctx.getImageData(0, 0, this._blurCache.width, this._blurCache.height);
    stackBlurRGBA(imageData.data, this._blurCache.width, this._blurCache.height, stackRadius);
    ctx.putImageData(imageData, 0, 0);

    this._blurCacheDirty = false;
  }
}

/**
 * Downscale `source` to `scale` of its size, halving repeatedly rather
 * than in one `drawImage` call whenever `scale < 0.5`. A single
 * aggressive downscale point-samples in most canvas implementations and
 * can alias real detail back into the output — for a tool whose entire
 * point is an *irreversible* blur, that is a correctness bug, not just a
 * quality one. Halving repeatedly keeps each individual step's scale
 * factor close to 1, staying inside the regime where `imageSmoothingQuality
 * = "high"` behaves like a proper box/area filter.
 * @param {HTMLCanvasElement} source
 * @param {number} scale - final size as a fraction of `source`'s size, in (0, 1]
 * @returns {HTMLCanvasElement}
 */
function downscaleProgressively(source, scale) {
  let currentCanvas = source;
  let currentWidth = source.width;
  let currentHeight = source.height;
  const targetWidth = Math.max(1, Math.round(source.width * scale));
  const targetHeight = Math.max(1, Math.round(source.height * scale));

  while (currentWidth / 2 > targetWidth && currentHeight / 2 > targetHeight) {
    const nextWidth = Math.max(targetWidth, Math.round(currentWidth / 2));
    const nextHeight = Math.max(targetHeight, Math.round(currentHeight / 2));
    currentCanvas = drawScaled(currentCanvas, nextWidth, nextHeight);
    currentWidth = nextWidth;
    currentHeight = nextHeight;
  }

  if (currentWidth !== targetWidth || currentHeight !== targetHeight) {
    currentCanvas = drawScaled(currentCanvas, targetWidth, targetHeight);
  }

  return currentCanvas;
}

/**
 * Draw `source` onto a new canvas of exactly `width` x `height`, with
 * high-quality smoothing enabled.
 * @param {HTMLCanvasElement} source
 * @param {number} width
 * @param {number} height
 * @returns {HTMLCanvasElement}
 */
function drawScaled(source, width, height) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, 0, 0, width, height);
  return canvas;
}
