import { SHAPE_CLASSES_BY_TYPE } from "./shapes.js";

/**
 * Keeps track of every blur shape the user has placed on the image, in
 * the order they were added (last added = topmost, both for drawing and
 * for hit-testing), plus which one (if any) is currently selected.
 */
export class ShapeManager {
  constructor() {
    /** @type {import("./shapes.js").BlurShape[]} */
    this._shapes = [];
    /** @type {import("./shapes.js").BlurShape|null} */
    this._selected = null;
  }

  /**
   * Create a new blur shape and add it to the list, on top.
   * @param {"circle"|"rect"} type - which shape class to instantiate
   * @param {number} centerX - horizontal center, in image pixels
   * @param {number} centerY - vertical center, in image pixels
   * @param {number} width - shape width, in image pixels
   * @param {number} height - shape height, in image pixels
   * @returns {import("./shapes.js").BlurShape} the newly created shape
   */
  addShape(type, centerX, centerY, width, height) {
    const ShapeClass = SHAPE_CLASSES_BY_TYPE[type];
    if (!ShapeClass) {
      throw new Error(`Unknown shape type: "${type}"`);
    }
    const shape = new ShapeClass(centerX, centerY, width, height);
    this._shapes.push(shape);
    return shape;
  }

  /** Remove the most recently added shape, if there is one. */
  removeLast() {
    const removed = this._shapes.pop();
    if (removed && this._selected === removed) {
      this._selected = null;
    }
  }

  /**
   * Remove a specific shape.
   * @param {import("./shapes.js").BlurShape} shape
   */
  remove(shape) {
    const index = this._shapes.indexOf(shape);
    if (index === -1) {
      return;
    }
    this._shapes.splice(index, 1);
    if (this._selected === shape) {
      this._selected = null;
    }
  }

  /** Remove every shape, resetting the image to unblurred, and clear the selection. */
  clear() {
    this._shapes = [];
    this._selected = null;
  }

  /** @returns {import("./shapes.js").BlurShape[]} every shape currently placed, back-to-front */
  getShapes() {
    return this._shapes;
  }

  /** @returns {boolean} whether any shapes have been placed */
  isEmpty() {
    return this._shapes.length === 0;
  }

  /**
   * Find the topmost shape containing `(x, y)`, if any. Shapes are
   * tested back-to-front so the last-added (topmost, drawn last) shape
   * wins ties in overlapping regions.
   * @param {number} x - in image pixels
   * @param {number} y - in image pixels
   * @returns {import("./shapes.js").BlurShape|null}
   */
  hitTest(x, y) {
    for (let i = this._shapes.length - 1; i >= 0; i--) {
      if (this._shapes[i].containsPoint(x, y)) {
        return this._shapes[i];
      }
    }
    return null;
  }

  /**
   * Move a shape to the end of the draw order so it renders (and
   * hit-tests) above every other shape.
   * @param {import("./shapes.js").BlurShape} shape
   */
  bringToFront(shape) {
    const index = this._shapes.indexOf(shape);
    if (index === -1 || index === this._shapes.length - 1) {
      return;
    }
    this._shapes.splice(index, 1);
    this._shapes.push(shape);
  }

  /**
   * Select a shape (or clear the selection with `null`). Selecting a
   * shape not currently tracked by this manager clears the selection
   * instead of pointing at a dangling shape.
   * @param {import("./shapes.js").BlurShape|null} shape
   */
  select(shape) {
    this._selected = shape && this._shapes.includes(shape) ? shape : null;
  }

  /** @returns {import("./shapes.js").BlurShape|null} the currently selected shape, if any */
  getSelected() {
    return this._selected;
  }

  /** @returns {number|null} the currently selected shape's id, if any */
  get selectedId() {
    return this._selected ? this._selected.id : null;
  }
}
