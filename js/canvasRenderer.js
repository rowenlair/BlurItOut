/**
 * Draws the final composited image: the sharp original image, with each
 * placed blur shape's region "punched through" to that shape's own
 * pre-blurred patch (see blurProcessor.js).
 */
export class CanvasRenderer {
  /**
   * @param {HTMLCanvasElement} displayCanvas - the visible canvas the user sees and clicks on
   */
  constructor(displayCanvas) {
    this.displayCanvas = displayCanvas;
    this.ctx = displayCanvas.getContext("2d");
  }

  /**
   * Resize the display canvas to match an image's natural dimensions.
   * The canvas is kept at full resolution internally; CSS scales it
   * down to fit the screen, so exported downloads stay full quality.
   * @param {number} width
   * @param {number} height
   */
  setCanvasSize(width, height) {
    this.displayCanvas.width = width;
    this.displayCanvas.height = height;
  }

  /**
   * Redraw the whole scene: the sharp source image as the base layer,
   * then each shape's own pre-blurred patch drawn in, clipped to that
   * shape's outline. Shapes without a computed patch yet are skipped.
   * @param {HTMLCanvasElement|HTMLImageElement} sourceImage - the sharp, unblurred image
   * @param {import("./shapes.js").BlurShape[]} shapes - shapes to reveal as blurred
   */
  render(sourceImage, shapes) {
    const { ctx } = this;
    const { width, height } = this.displayCanvas;

    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(sourceImage, 0, 0, width, height);

    for (const shape of shapes) {
      if (!shape.blurredPatch) {
        continue;
      }
      const { canvas: patchCanvas, x, y } = shape.blurredPatch;
      ctx.save();
      shape.traceClipPath(ctx);
      ctx.clip();
      ctx.drawImage(patchCanvas, x, y);
      ctx.restore();
    }
  }

  /**
   * Convert a mouse/pointer event's page coordinates into image pixel
   * coordinates, accounting for any CSS scaling of the canvas.
   * @param {MouseEvent} event
   * @returns {{x: number, y: number}}
   */
  eventToImageCoordinates(event) {
    const rect = this.displayCanvas.getBoundingClientRect();
    const scaleX = this.displayCanvas.width / rect.width;
    const scaleY = this.displayCanvas.height / rect.height;
    return {
      x: (event.clientX - rect.left) * scaleX,
      y: (event.clientY - rect.top) * scaleY,
    };
  }
}
