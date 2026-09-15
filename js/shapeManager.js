import { SHAPE_CLASSES_BY_TYPE } from "./shapes.js";

/**
 * Keeps track of every blur shape the user has placed on the image, in
 * the order they were added. Rendering and export code simply read
 * `getShapes()` and draw each one.
 */
export class ShapeManager {
  constructor() {
    /** @type {import("./shapes.js").BlurShape[]} */
    this._shapes = [];
  }

  /**
   * Create a new blur shape and add it to the list.
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
    this._shapes.pop();
  }

  /** Remove every shape, resetting the image to unblurred. */
  clear() {
    this._shapes = [];
  }

  /** @returns {import("./shapes.js").BlurShape[]} every shape currently placed */
  getShapes() {
    return this._shapes;
  }

  /** @returns {boolean} whether any shapes have been placed */
  isEmpty() {
    return this._shapes.length === 0;
  }
}
