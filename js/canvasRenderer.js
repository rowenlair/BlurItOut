/**
 * Draws the final composited image: the sharp original image, with each
 * placed blur shape's region "punched through" to the fully blurred
 * copy of the image.
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
   * then each shape's region copied over from the blurred image.
   * @param {HTMLCanvasElement|HTMLImageElement} sourceImage - the sharp, unblurred image
   * @param {HTMLCanvasElement} blurredCanvas - a fully blurred copy of the same image
   * @param {import("./shapes.js").BlurShape[]} shapes - shapes to reveal as blurred
   */
  render(sourceImage, blurredCanvas, shapes) {
    const { ctx } = this;
    const { width, height } = this.displayCanvas;

    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(sourceImage, 0, 0, width, height);

    for (const shape of shapes) {
      ctx.save();
      shape.traceClipPath(ctx);
      ctx.clip();
      ctx.drawImage(blurredCanvas, 0, 0, width, height);
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
