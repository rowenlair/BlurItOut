import { compositeScene } from "./canvasRenderer.js";

/**
 * Handles saving the finished image to the user's disk. Exports are
 * re-composited from scratch at the source image's *natural* resolution
 * — never from the on-screen display canvas, which is capped at 2048px
 * on its longer side for drag performance (see canvasRenderer.js) and
 * would silently ship everyone a downscaled image.
 */
export class ImageExporter {
  /**
   * Composite the sharp image with every shape's blurred region (using
   * the same shared compositing step the on-screen renderer uses, so the
   * two match pixel-for-pixel) and trigger a browser download. Selection
   * outlines/handles are never included — those are renderer-only chrome.
   * @param {HTMLImageElement} sourceImage - the sharp, unblurred, full-resolution image
   * @param {import("./shapes.js").BlurShape[]} shapes
   * @param {import("./blurProcessor.js").BlurProcessor} blurProcessor
   * @param {"png"|"jpeg"} format - output image format
   * @param {string} [filename] - download filename, without extension
   * @returns {Promise<void>}
   */
  static async download(sourceImage, shapes, blurProcessor, format, filename = "blurred-image") {
    const width = sourceImage.naturalWidth;
    const height = sourceImage.naturalHeight;

    const exportCanvas = document.createElement("canvas");
    exportCanvas.width = width;
    exportCanvas.height = height;
    const ctx = exportCanvas.getContext("2d");

    if (format === "jpeg") {
      // JPEG has no alpha channel. Without an opaque backing, a
      // transparent PNG source would export with black instead of white
      // where it used to be transparent.
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, width, height);
    }

    const blurred = blurProcessor.isActive ? blurProcessor.getBlurredCanvas() : null;
    compositeScene(ctx, sourceImage, shapes, blurred ? blurred.canvas : null, width, height);

    const mimeType = format === "jpeg" ? "image/jpeg" : "image/png";
    const extension = format === "jpeg" ? "jpg" : "png";
    const jpegQuality = 0.92;

    const blob = await new Promise((resolve) => {
      exportCanvas.toBlob(resolve, mimeType, format === "jpeg" ? jpegQuality : undefined);
    });
    if (!blob) {
      return;
    }

    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = `${filename}.${extension}`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(objectUrl);
  }
}
