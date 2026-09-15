// image-js does the heavy lifting: reading pixels off a canvas and
// running a gaussian blur convolution over them. The library is vendored
// locally (js/vendor/image-js.esm.min.js) so the app works fully offline.
import { readCanvas, writeCanvas } from "./vendor/image-js.esm.min.js";

/**
 * Produces and caches a fully blurred copy of an image, using the
 * image-js library's gaussian blur filter. The rest of the app is
 * responsible for only *revealing* parts of this blurred copy through
 * shaped clip paths (see canvasRenderer.js) rather than blurring
 * arbitrary regions directly, which keeps the blur math in one place.
 */
export class BlurProcessor {
  constructor() {
    /** @type {HTMLCanvasElement} cached fully-blurred render of the source image */
    this._blurredCanvas = document.createElement("canvas");
  }

  /**
   * Re-run the gaussian blur filter over the given source canvas and
   * cache the result.
   * @param {HTMLCanvasElement} sourceCanvas - canvas holding the original, unblurred image
   * @param {number} sigma - gaussian blur standard deviation; higher values blur more
   * @returns {HTMLCanvasElement} a canvas the same size as `sourceCanvas`, fully blurred
   */
  computeBlurredCanvas(sourceCanvas, sigma) {
    const sourceImage = readCanvas(sourceCanvas);
    const blurredImage = sourceImage.gaussianBlur({ sigma });

    this._blurredCanvas.width = sourceCanvas.width;
    this._blurredCanvas.height = sourceCanvas.height;
    writeCanvas(blurredImage, this._blurredCanvas);

    return this._blurredCanvas;
  }

  /** @returns {HTMLCanvasElement} the most recently computed blurred canvas */
  getBlurredCanvas() {
    return this._blurredCanvas;
  }
}
