/**
 * Shape definitions used to mark where a blur should be revealed on the
 * canvas. Each shape knows how to trace its own outline as a clip path,
 * hit-test a point against itself, and mutate its own geometry in
 * response to a drag. All coordinates are in the *original image's*
 * pixel space, not the (possibly CSS-scaled, resolution-capped) on-screen
 * canvas space — see canvasRenderer.js for that conversion.
 */

import { clamp } from "./mathUtils.js";

let nextShapeId = 1;

/** Base class for a single blur shape placed on the image. */
export class BlurShape {
  /**
   * @param {number} centerX - horizontal center of the shape, in image pixels
   * @param {number} centerY - vertical center of the shape, in image pixels
   * @param {number} width - shape width, in image pixels
   * @param {number} height - shape height, in image pixels
   */
  constructor(centerX, centerY, width, height) {
    this.id = nextShapeId++;
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
   * Whether the point `(x, y)` (in image pixels) falls inside this
   * shape. Subclasses must override this method — a shared bounding-box
   * test would make a circle's corners falsely grabbable/clickable.
   * @param {number} x
   * @param {number} y
   * @returns {boolean}
   */
  containsPoint(x, y) {
    throw new Error("containsPoint() must be implemented by a subclass");
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

  /**
   * The eight resize handles for this shape, positioned on its bounding
   * box (consistent between circle and rectangle shapes).
   * @returns {{id: string, x: number, y: number}[]}
   */
  getHandles() {
    const box = this.getBoundingBox();
    const left = box.x;
    const top = box.y;
    const right = box.x + box.width;
    const bottom = box.y + box.height;
    const midX = box.x + box.width / 2;
    const midY = box.y + box.height / 2;
    return [
      { id: "nw", x: left, y: top },
      { id: "n", x: midX, y: top },
      { id: "ne", x: right, y: top },
      { id: "e", x: right, y: midY },
      { id: "se", x: right, y: bottom },
      { id: "s", x: midX, y: bottom },
      { id: "sw", x: left, y: bottom },
      { id: "w", x: left, y: midY },
    ];
  }

  /**
   * Resize this shape by dragging one of its handles to `(pointerX,
   * pointerY)`. The edge/corner opposite the dragged handle stays
   * anchored in place. Width/height are clamped to `BlurShape.MIN_SIZE`
   * so the shape can't be dragged through itself into a negative size.
   * @param {string} handleId - one of the ids returned by `getHandles()`
   * @param {number} pointerX - in image pixels
   * @param {number} pointerY - in image pixels
   * @param {{width: number, height: number}} [imageBounds] - clamps the
   *   pointer to the image so a shape can't be resized past its edge
   */
  resizeFromHandle(handleId, pointerX, pointerY, imageBounds) {
    const box = this.getBoundingBox();
    let left = box.x;
    let top = box.y;
    let right = box.x + box.width;
    let bottom = box.y + box.height;

    let px = pointerX;
    let py = pointerY;
    if (imageBounds) {
      px = clamp(px, 0, imageBounds.width);
      py = clamp(py, 0, imageBounds.height);
    }

    const movesLeft = handleId.includes("w");
    const movesRight = handleId.includes("e");
    const movesTop = handleId.includes("n");
    const movesBottom = handleId.includes("s");

    if (movesLeft) left = px;
    if (movesRight) right = px;
    if (movesTop) top = py;
    if (movesBottom) bottom = py;

    // Keep the anchored edge fixed and clamp the moving edge so the box
    // never collapses past MIN_SIZE, even if the pointer is dragged
    // beyond the anchor.
    if (movesLeft && right - left < BlurShape.MIN_SIZE) {
      left = right - BlurShape.MIN_SIZE;
    } else if (movesRight && right - left < BlurShape.MIN_SIZE) {
      right = left + BlurShape.MIN_SIZE;
    }
    if (movesTop && bottom - top < BlurShape.MIN_SIZE) {
      top = bottom - BlurShape.MIN_SIZE;
    } else if (movesBottom && bottom - top < BlurShape.MIN_SIZE) {
      bottom = top + BlurShape.MIN_SIZE;
    }

    this.centerX = (left + right) / 2;
    this.centerY = (top + bottom) / 2;
    this.width = Math.max(BlurShape.MIN_SIZE, right - left);
    this.height = Math.max(BlurShape.MIN_SIZE, bottom - top);
  }

  /**
   * Move this shape so its center is at `(centerX, centerY)`. The center
   * is clamped to stay within the image, but the shape's edges may
   * overhang — that's intentional, so content near the image border can
   * still be covered.
   * @param {number} centerX - in image pixels
   * @param {number} centerY - in image pixels
   * @param {{width: number, height: number}} [imageBounds]
   */
  moveTo(centerX, centerY, imageBounds) {
    if (imageBounds) {
      centerX = clamp(centerX, 0, imageBounds.width);
      centerY = clamp(centerY, 0, imageBounds.height);
    }
    this.centerX = centerX;
    this.centerY = centerY;
  }
}

/** The smallest a shape's width or height may be resized to, in image pixels. */
BlurShape.MIN_SIZE = 8;

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

  /**
   * @param {number} x
   * @param {number} y
   * @returns {boolean}
   */
  containsPoint(x, y) {
    const radiusX = this.width / 2;
    const radiusY = this.height / 2;
    if (radiusX <= 0 || radiusY <= 0) {
      return false;
    }
    const dx = (x - this.centerX) / radiusX;
    const dy = (y - this.centerY) / radiusY;
    return dx * dx + dy * dy <= 1;
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

  /**
   * @param {number} x
   * @param {number} y
   * @returns {boolean}
   */
  containsPoint(x, y) {
    const box = this.getBoundingBox();
    return x >= box.x && x <= box.x + box.width && y >= box.y && y <= box.y + box.height;
  }
}

/** Maps the UI's shape-type identifiers to their shape classes. */
export const SHAPE_CLASSES_BY_TYPE = {
  circle: CircleBlurShape,
  rect: RectBlurShape,
};

/** On-screen diameter of a resize handle, in CSS pixels. Shared between
 * canvasRenderer.js (drawing) and interaction.js (hit-testing) so the
 * handles you can see are exactly the handles you can grab. */
export const HANDLE_CSS_DIAMETER = 12;

const CORNER_HANDLE_IDS = new Set(["nw", "ne", "se", "sw"]);

/**
 * The handles that should actually be shown/hittable for `shape` right
 * now: all 8 normally, but just the 4 corners when the shape is too
 * small on-screen for 8 handles to avoid overlapping into an unusable
 * cluster (a particular problem under a fingertip).
 * @param {BlurShape} shape
 * @param {number} imagePixelsPerCssPixel - from `CanvasRenderer.getImagePixelsPerCssPixel()`
 * @returns {{id: string, x: number, y: number}[]}
 */
export function getVisibleHandles(shape, imagePixelsPerCssPixel) {
  const handleDiameter = imagePixelsPerCssPixel * HANDLE_CSS_DIAMETER;
  const box = shape.getBoundingBox();
  const smallerDimension = Math.min(box.width, box.height);
  const useCornersOnly = smallerDimension < handleDiameter * 3;
  const handles = shape.getHandles();
  return useCornersOnly ? handles.filter((handle) => CORNER_HANDLE_IDS.has(handle.id)) : handles;
}
