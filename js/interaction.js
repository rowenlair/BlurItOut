import { BlurShape, getVisibleHandles } from "./shapes.js";
import { clamp } from "./mathUtils.js";

/** CSS-pixel hit tolerance around a resize handle. Coarse (touch/stylus)
 * pointers get a much larger target — 22px roughly matches a 44px touch
 * target, the usual minimum recommended finger-hittable size. */
const HANDLE_TOLERANCE_CSS_PX = { coarse: 22, fine: 10 };

/** How far (in CSS pixels) the pointer must move after a tap before a
 * "create shape" gesture is treated as "drag to size" instead of a
 * plain tap-to-place. */
const CREATE_DRAG_SLOP_CSS_PX = 4;

const CURSOR_BY_HANDLE_ID = {
  nw: "nwse-resize",
  se: "nwse-resize",
  ne: "nesw-resize",
  sw: "nesw-resize",
  n: "ns-resize",
  s: "ns-resize",
  e: "ew-resize",
  w: "ew-resize",
};

/**
 * Owns every pointer (mouse, touch, stylus) interaction with the canvas:
 * creating a shape, selecting one, dragging it, and resizing it via its
 * handles. Built entirely on the Pointer Events API so mouse and touch
 * share one code path instead of two.
 */
export class InteractionController {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {import("./canvasRenderer.js").CanvasRenderer} renderer
   * @param {import("./shapeManager.js").ShapeManager} shapeManager
   * @param {object} callbacks
   * @param {(x: number, y: number) => import("./shapes.js").BlurShape|null} callbacks.onCreateShape -
   *   called on an empty-canvas press; should create and return a new shape (using the
   *   app's current shape-type/size settings), or return null/undefined to place nothing.
   * @param {() => void} callbacks.onGeometryChanged - called after any shape mutation; re-render.
   * @param {() => void} callbacks.onSelectionChanged - called whenever the selection changes.
   * @param {() => void} callbacks.onChanged - called once a gesture (drag/resize/create) ends.
   * @param {(x: number, y: number) => void} [callbacks.onHoverMove] - cursor moved with nothing selected/dragging.
   * @param {() => void} [callbacks.onHoverEnd] - cursor left the canvas, or a hover preview should be hidden.
   */
  constructor(canvas, renderer, shapeManager, callbacks) {
    this.canvas = canvas;
    this.renderer = renderer;
    this.shapeManager = shapeManager;
    this.callbacks = callbacks;

    /** @type {{width: number, height: number}|null} */
    this.imageBounds = null;

    this.mode = "idle"; // "idle" | "moving" | "resizing" | "creating"
    this.activePointerId = null;
    this.activeHandleId = null;
    this.moveOffset = null;
    this.createAnchor = null;
    this._createDragStartClient = null;
    this._createHasDragged = false;

    this._bindEvents();
  }

  /**
   * Set (or update) the image's dimensions, in image pixels. Interaction
   * is a no-op until this has been called at least once.
   * @param {number} width
   * @param {number} height
   */
  setImageBounds(width, height) {
    this.imageBounds = { width, height };
  }

  /** Disable interaction, e.g. when no image is loaded. */
  clearImageBounds() {
    this.imageBounds = null;
    this._endGesture(false);
  }

  _bindEvents() {
    this.canvas.style.touchAction = "none";
    this.canvas.addEventListener("pointerdown", (event) => this._onPointerDown(event));
    this.canvas.addEventListener("pointermove", (event) => this._onPointerMove(event));
    this.canvas.addEventListener("pointerup", (event) => this._onPointerUp(event));
    this.canvas.addEventListener("pointercancel", (event) => this._onPointerCancel(event));
    this.canvas.addEventListener("pointerleave", (event) => this._onPointerLeave(event));
    this.canvas.addEventListener("keydown", (event) => this._onKeyDown(event));
  }

  _onPointerDown(event) {
    if (!this.imageBounds || this.mode !== "idle") {
      return;
    }
    // Only the primary mouse button should place/select/drag shapes —
    // right-click and middle-click-drag should be left alone (context
    // menu, etc). Touch and pen report button 0 while pressed, so this
    // only actually filters mouse input.
    if (event.pointerType === "mouse" && event.button !== 0) {
      return;
    }
    event.preventDefault();
    this.canvas.setPointerCapture(event.pointerId);
    this.activePointerId = event.pointerId;

    const point = this.renderer.eventToImageCoordinates(event);
    const tolerance = this._getHandleTolerance();

    const selected = this.shapeManager.getSelected();
    const handle = selected ? this._hitTestHandles(selected, point, tolerance) : null;
    if (handle) {
      this.mode = "resizing";
      this.activeHandleId = handle.id;
      this._setDragging(true);
      return;
    }

    const hit = this.shapeManager.hitTest(point.x, point.y);
    if (hit) {
      this.shapeManager.select(hit);
      this.shapeManager.bringToFront(hit);
      this.mode = "moving";
      this.moveOffset = { dx: point.x - hit.centerX, dy: point.y - hit.centerY };
      this._setDragging(true);
      this.callbacks.onSelectionChanged();
      this.callbacks.onGeometryChanged();
      return;
    }

    const created = this.callbacks.onCreateShape(point.x, point.y);
    if (created) {
      this.shapeManager.select(created);
      this.mode = "creating";
      this.createAnchor = { x: point.x, y: point.y };
      this._createDragStartClient = { x: event.clientX, y: event.clientY };
      this._createHasDragged = false;
      this._setDragging(true);
      this.callbacks.onSelectionChanged();
    } else {
      this.shapeManager.select(null);
      this.callbacks.onSelectionChanged();
    }
    this.callbacks.onGeometryChanged();
  }

  _onPointerMove(event) {
    if (!this.imageBounds) {
      return;
    }
    if (this.mode === "idle") {
      this._updateHoverState(event);
      return;
    }
    if (event.pointerId !== this.activePointerId) {
      return;
    }

    const point = this.renderer.eventToImageCoordinates(event);
    const selected = this.shapeManager.getSelected();

    if (this.mode === "moving" && selected) {
      selected.moveTo(point.x - this.moveOffset.dx, point.y - this.moveOffset.dy, this.imageBounds);
    } else if (this.mode === "resizing" && selected) {
      selected.resizeFromHandle(this.activeHandleId, point.x, point.y, this.imageBounds);
    } else if (this.mode === "creating" && selected) {
      this._advanceCreateDrag(event, point, selected);
    }

    this.callbacks.onGeometryChanged();
  }

  /**
   * While placing a new shape: once the pointer has moved beyond a small
   * slop threshold, grow the shape symmetrically from the initial press
   * point to track the pointer (a "drag to size" gesture). Below the
   * threshold the shape stays at its default size, so a plain tap still
   * places a normal default-sized shape.
   */
  _advanceCreateDrag(event, point, shape) {
    if (!this._createHasDragged) {
      const dx = event.clientX - this._createDragStartClient.x;
      const dy = event.clientY - this._createDragStartClient.y;
      if (Math.hypot(dx, dy) < CREATE_DRAG_SLOP_CSS_PX) {
        return;
      }
      this._createHasDragged = true;
    }
    // Pointer capture keeps delivering moves even once the cursor leaves
    // the canvas; clamp to the image so a drag past the edge can't
    // inflate the shape without bound.
    const clampedX = clamp(point.x, 0, this.imageBounds.width);
    const clampedY = clamp(point.y, 0, this.imageBounds.height);
    const halfWidth = Math.abs(clampedX - this.createAnchor.x);
    const halfHeight = Math.abs(clampedY - this.createAnchor.y);
    shape.centerX = this.createAnchor.x;
    shape.centerY = this.createAnchor.y;
    shape.width = Math.max(BlurShape.MIN_SIZE, halfWidth * 2);
    shape.height = Math.max(BlurShape.MIN_SIZE, halfHeight * 2);
  }

  _onPointerUp(event) {
    if (event.pointerId !== this.activePointerId) {
      return;
    }
    this._endGesture(true);
  }

  _onPointerCancel(event) {
    if (event.pointerId !== this.activePointerId) {
      return;
    }
    this._endGesture(true);
  }

  _onPointerLeave() {
    if (this.mode === "idle") {
      this.canvas.style.cursor = "crosshair";
      this.callbacks.onHoverEnd?.();
    }
  }

  /**
   * @param {boolean} fireChanged - whether to invoke `onChanged` (skipped
   *   when bounds are cleared entirely, e.g. on image unload).
   */
  _endGesture(fireChanged) {
    if (this.activePointerId !== null) {
      try {
        this.canvas.releasePointerCapture(this.activePointerId);
      } catch {
        // Capture may already be gone (e.g. after pointercancel); harmless.
      }
    }
    const wasActive = this.mode !== "idle";
    this.mode = "idle";
    this.activePointerId = null;
    this.activeHandleId = null;
    this.moveOffset = null;
    this.createAnchor = null;
    this._createDragStartClient = null;
    this._createHasDragged = false;
    this._setDragging(false);
    if (wasActive && fireChanged) {
      this.callbacks.onChanged();
    }
  }

  _updateHoverState(event) {
    const point = this.renderer.eventToImageCoordinates(event);
    const selected = this.shapeManager.getSelected();
    const tolerance = this._getHandleTolerance();

    let cursor = "crosshair";
    const hoveredHandle = selected ? this._hitTestHandles(selected, point, tolerance) : null;
    if (hoveredHandle) {
      cursor = CURSOR_BY_HANDLE_ID[hoveredHandle.id] ?? "pointer";
    } else if (this.shapeManager.hitTest(point.x, point.y)) {
      cursor = "move";
    }
    this.canvas.style.cursor = cursor;

    // Touch devices synthesize bogus hover states, and the preview ghost
    // gets stuck on screen after a tap; only show it on devices that
    // have real hover, and never while something is selected or a drag
    // is already in progress (mode !== "idle" is already guaranteed here).
    const supportsHover = window.matchMedia("(hover: hover)").matches;
    if (supportsHover && !selected) {
      this.callbacks.onHoverMove?.(point.x, point.y);
    } else {
      this.callbacks.onHoverEnd?.();
    }
  }

  /**
   * @param {import("./shapes.js").BlurShape} shape
   * @param {{x: number, y: number}} point
   * @param {number} tolerance - in image pixels
   * @returns {{id: string, x: number, y: number}|null}
   */
  _hitTestHandles(shape, point, tolerance) {
    const handles = getVisibleHandles(shape, this.renderer.getImagePixelsPerCssPixel());
    let closest = null;
    let closestDistance = Infinity;
    for (const handle of handles) {
      const distance = Math.hypot(point.x - handle.x, point.y - handle.y);
      if (distance <= tolerance && distance < closestDistance) {
        closest = handle;
        closestDistance = distance;
      }
    }
    return closest;
  }

  /** @returns {number} the current handle hit-tolerance, in image pixels. */
  _getHandleTolerance() {
    const isCoarse = window.matchMedia("(pointer: coarse)").matches;
    const toleranceCssPx = isCoarse ? HANDLE_TOLERANCE_CSS_PX.coarse : HANDLE_TOLERANCE_CSS_PX.fine;
    return toleranceCssPx * this.renderer.getImagePixelsPerCssPixel();
  }

  /** @param {boolean} isDragging */
  _setDragging(isDragging) {
    document.body.classList.toggle("is-dragging", isDragging);
  }

  _onKeyDown(event) {
    const selected = this.shapeManager.getSelected();
    if (!selected) {
      return;
    }

    const step = event.shiftKey ? 10 : 1;
    let handled = true;
    switch (event.key) {
      case "ArrowUp":
        selected.moveTo(selected.centerX, selected.centerY - step, this.imageBounds);
        break;
      case "ArrowDown":
        selected.moveTo(selected.centerX, selected.centerY + step, this.imageBounds);
        break;
      case "ArrowLeft":
        selected.moveTo(selected.centerX - step, selected.centerY, this.imageBounds);
        break;
      case "ArrowRight":
        selected.moveTo(selected.centerX + step, selected.centerY, this.imageBounds);
        break;
      case "Delete":
      case "Backspace":
        this.shapeManager.remove(selected);
        this.callbacks.onSelectionChanged();
        break;
      case "Escape":
        this.shapeManager.select(null);
        this.callbacks.onSelectionChanged();
        break;
      default:
        handled = false;
    }

    if (handled) {
      event.preventDefault();
      this.callbacks.onGeometryChanged();
      this.callbacks.onChanged();
    }
  }
}
