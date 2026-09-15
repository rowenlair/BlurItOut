/**
 * Shape definitions used to mark where a blur should be revealed on the
 * canvas. Each shape knows only how to trace its own outline as a clip
 * path; the actual blurring is handled elsewhere (see blurProcessor.js).
 */

/**
 * Base class for a single blur shape placed on the image.
 * All coordinates are in the *original image's* pixel space, not the
 * (possibly CSS-scaled) on-screen canvas space.
 */
export class BlurShape {
  /**
   * @param {number} centerX - horizontal center of the shape, in image pixels
   * @param {number} centerY - vertical center of the shape, in image pixels
   * @param {number} width - shape width, in image pixels
   * @param {number} height - shape height, in image pixels
   */
  constructor(centerX, centerY, width, height) {
    this.centerX = centerX;
    this.centerY = centerY;
    this.width = width;
    this.height = height;
  }

  /**
   * Trace this shape's outline onto a canvas 2D context as the current
   * path, ready to be used with `ctx.clip()`. Subclasses must override
   * this method.
   * @param {CanvasRenderingContext2D} ctx
   */
  traceClipPath(ctx) {
    throw new Error("traceClipPath() must be implemented by a subclass");
  }

  /**
   * The axis-aligned bounding box that fully contains this shape.
   * @returns {{x: number, y: number, width: number, height: number}}
   */
  getBoundingBox() {
    return {
      x: this.centerX - this.width / 2,
      y: this.centerY - this.height / 2,
      width: this.width,
      height: this.height,
    };
  }
}

/** A blur shape whose outline is an ellipse (a circle when width === height). */
export class CircleBlurShape extends BlurShape {
  /** @param {CanvasRenderingContext2D} ctx */
  traceClipPath(ctx) {
    const radiusX = this.width / 2;
    const radiusY = this.height / 2;
    ctx.beginPath();
    ctx.ellipse(this.centerX, this.centerY, radiusX, radiusY, 0, 0, Math.PI * 2);
    ctx.closePath();
  }
}

/** A blur shape whose outline is an axis-aligned rectangle. */
export class RectBlurShape extends BlurShape {
  /** @param {CanvasRenderingContext2D} ctx */
  traceClipPath(ctx) {
    const box = this.getBoundingBox();
    ctx.beginPath();
    ctx.rect(box.x, box.y, box.width, box.height);
    ctx.closePath();
  }
}

/** Maps the UI's shape-type identifiers to their shape classes. */
export const SHAPE_CLASSES_BY_TYPE = {
  circle: CircleBlurShape,
  rect: RectBlurShape,
};
