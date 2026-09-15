// image-js does the heavy lifting: reading pixels off a canvas and
// running a gaussian blur convolution over them. The library is vendored
// locally (js/vendor/image-js.esm.min.js) so the app works fully offline.
import { readCanvas, writeCanvas } from "./vendor/image-js.esm.min.js";

/**
 * Runs the image-js gaussian blur filter over small crops of an image
 * rather than the whole thing. Blurring a full-resolution photo (many
 * megapixels) on every click would block the main thread for a long
 * time and freeze the page, so this class only ever blurs the pixels
 * near a single shape's bounding box.
 */
export class BlurProcessor {
  /**
   * Blur the region of `sourceCanvas` around `boundingBox`, and return
   * it as a small standalone canvas plus where its top-left corner
   * belongs in the source image.
   *
   * The crop is padded beyond the bounding box (roughly 3x the blur
   * radius) so the convolution has real neighboring pixels to sample
   * instead of reflecting off the edge of the shape itself, which would
   * otherwise show up as a faint seam. The caller is expected to clip
   * to the shape's exact outline when drawing the result, so the extra
   * padding around the edges is simply discarded.
   *
   * @param {HTMLCanvasElement} sourceCanvas - canvas holding the original, unblurred image
   * @param {{x: number, y: number, width: number, height: number}} boundingBox - region to blur, in source canvas pixels
   * @param {number} sigma - gaussian blur standard deviation; higher values blur more
   * @returns {{canvas: HTMLCanvasElement, x: number, y: number}} the blurred crop and its offset in the source image
   */
  blurRegion(sourceCanvas, boundingBox, sigma) {
    const padding = Math.ceil(sigma * 3);
    const cropX = Math.max(0, Math.floor(boundingBox.x - padding));
    const cropY = Math.max(0, Math.floor(boundingBox.y - padding));
    const cropRight = Math.min(sourceCanvas.width, Math.ceil(boundingBox.x + boundingBox.width + padding));
    const cropBottom = Math.min(sourceCanvas.height, Math.ceil(boundingBox.y + boundingBox.height + padding));
    const cropWidth = Math.max(1, cropRight - cropX);
    const cropHeight = Math.max(1, cropBottom - cropY);

    const cropCanvas = document.createElement("canvas");
    cropCanvas.width = cropWidth;
    cropCanvas.height = cropHeight;
    cropCanvas
      .getContext("2d")
      .drawImage(sourceCanvas, cropX, cropY, cropWidth, cropHeight, 0, 0, cropWidth, cropHeight);

    const cropImage = readCanvas(cropCanvas);
    const blurredImage = cropImage.gaussianBlur({ sigma });
    writeCanvas(blurredImage, cropCanvas);

    return { canvas: cropCanvas, x: cropX, y: cropY };
  }
}
