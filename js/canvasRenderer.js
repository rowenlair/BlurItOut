import { getVisibleHandles, HANDLE_CSS_DIAMETER } from "./shapes.js";

/**
 * Draw the sharp source image, then punch each shape's region through to
 * `blurredCanvas` (stretched to the full `width` x `height` rect).
 * Shared by `CanvasRenderer.render()` and `ImageExporter` so on-screen
 * display and the exported file are composited identically — selection
 * chrome (outline, handles) is deliberately *not* part of this shared
 * step; only the renderer draws that, on top, afterwards.
 * @param {CanvasRenderingContext2D} ctx
 * @param {HTMLCanvasElement|HTMLImageElement} sourceImage
 * @param {import("./shapes.js").BlurShape[]} shapes
 * @param {HTMLCanvasElement|null} blurredCanvas - `null` means no blur is active (radius 0)
 * @param {number} width
 * @param {number} height
 */
export function compositeScene(ctx, sourceImage, shapes, blurredCanvas, width, height) {
  ctx.drawImage(sourceImage, 0, 0, width, height);
  if (!blurredCanvas) {
    return;
  }
  for (const shape of shapes) {
    ctx.save();
    shape.traceClipPath(ctx);
    ctx.clip();
    ctx.drawImage(blurredCanvas, 0, 0, width, height);
    ctx.restore();
  }
}

/** The display canvas's backing store is never larger than this on its
 * longer side, regardless of the source image's resolution. Redrawing a
 * multi-megapixel canvas on every `pointermove` during a drag is the
 * single biggest cost a naive implementation pays; capping this is what
 * keeps dragging smooth on a phone. Coordinates everywhere else in the
 * app stay in *image* pixel space — see `_transformScale` below. */
const DISPLAY_MAX_DIM = 2048;

/**
 * Draws the final composited scene: the sharp original image, with each
 * placed shape's region "punched through" to a single shared blurred
 * bitmap (see blurProcessor.js), plus selection chrome for the currently
 * selected shape and an optional placement preview.
 *
 * The canvas's backing store is capped at `DISPLAY_MAX_DIM` and a single
 * transform is applied so that every drawing call in this class — and
 * every hit-test in interaction.js — can work directly in *image pixel*
 * coordinates, independent of how much the canvas is scaled down to fit
 * the screen.
 */
export class CanvasRenderer {
  /**
   * @param {HTMLCanvasElement} displayCanvas - the visible canvas the user sees and interacts with
   * @param {import("./blurProcessor.js").BlurProcessor} blurProcessor
   */
  constructor(displayCanvas, blurProcessor) {
    this.displayCanvas = displayCanvas;
    this.ctx = displayCanvas.getContext("2d");
    this.blurProcessor = blurProcessor;

    this.imageWidth = 0;
    this.imageHeight = 0;
    this._transformScale = 1;

    this._rafHandle = null;
    this._pendingRenderArgs = null;
  }

  /**
   * Size the display canvas for a newly loaded image: cap the backing
   * store at `DISPLAY_MAX_DIM` (scaled further by devicePixelRatio for a
   * crisp look on high-density screens), set the CSS width to match the
   * capped, uncapped-by-dpr dimensions, and record the transform that
   * maps image-pixel coordinates to backing-store pixels.
   *
   * Only `style.width` is set here — deliberately not `style.height`.
   * An inline height would take precedence over the stylesheet's
   * `#editor-canvas { height: auto }` rule, pinning the rendered height
   * at this moment's value even after `max-width: 100%` shrinks the
   * width to fit a narrower container/viewport, skewing the canvas.
   * Leaving height on `auto` lets the browser derive it from the
   * canvas's intrinsic width/height attributes (set below in the same
   * ratio as `imageWidth`/`imageHeight`), so the on-screen box always
   * keeps the source image's aspect ratio no matter how the container
   * is resized.
   * @param {number} imageWidth
   * @param {number} imageHeight
   */
  setImageSize(imageWidth, imageHeight) {
    this.imageWidth = imageWidth;
    this.imageHeight = imageHeight;

    const maxDim = Math.max(imageWidth, imageHeight);
    const baseScale = Math.min(1, DISPLAY_MAX_DIM / maxDim);
    const cssWidth = Math.max(1, Math.round(imageWidth * baseScale));
    const cssHeight = Math.max(1, Math.round(imageHeight * baseScale));
    const devicePixelRatio = window.devicePixelRatio || 1;

    this.displayCanvas.style.width = `${cssWidth}px`;
    this.displayCanvas.style.removeProperty("height");
    this.displayCanvas.width = Math.max(1, Math.round(cssWidth * devicePixelRatio));
    this.displayCanvas.height = Math.max(1, Math.round(cssHeight * devicePixelRatio));

    this._transformScale = this.displayCanvas.width / imageWidth;
  }

  /**
   * Redraw the whole scene immediately. Prefer `requestRender()` from
   * event handlers that can fire faster than the display refreshes
   * (pointer moves, slider drags).
   * @param {HTMLCanvasElement|HTMLImageElement} sourceImage - the sharp, unblurred image
   * @param {import("./shapes.js").BlurShape[]} shapes - already-placed shapes to reveal as blurred
   * @param {object} [options]
   * @param {import("./shapes.js").BlurShape|null} [options.previewShape] - an unplaced shape to draw as a preview outline
   * @param {import("./shapes.js").BlurShape|null} [options.selectedShape] - the shape to draw selection chrome for
   */
  render(sourceImage, shapes, { previewShape = null, selectedShape = null } = {}) {
    const { ctx } = this;

    // Reset the transform before clearing (and before resizing anything),
    // otherwise clearRect's own rectangle gets scaled by the leftover
    // transform and leaves a ghost trail along the edges every frame.
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.displayCanvas.width, this.displayCanvas.height);
    ctx.setTransform(this._transformScale, 0, 0, this._transformScale, 0, 0);

    const blurred = this.blurProcessor.isActive ? this.blurProcessor.getBlurredCanvas() : null;
    compositeScene(ctx, sourceImage, shapes, blurred ? blurred.canvas : null, this.imageWidth, this.imageHeight);

    // Chrome is drawn last and outside any clip path — inside one, it
    // would simply vanish.
    if (selectedShape) {
      this._drawSelectionChrome(selectedShape);
    }
    if (previewShape) {
      this._drawPreview(previewShape);
    }
  }

  /**
   * Same as `render()`, but coalesced into a single `requestAnimationFrame`
   * — pointer events (and coalesced touch input in particular) can fire
   * faster than the display refreshes, so rendering synchronously on
   * every one of them is wasted work. Calling this repeatedly before a
   * frame fires just updates what will be drawn on the next frame.
   * @param {HTMLCanvasElement|HTMLImageElement} sourceImage
   * @param {import("./shapes.js").BlurShape[]} shapes
   * @param {object} [options]
   */
  requestRender(sourceImage, shapes, options = {}) {
    this._pendingRenderArgs = { sourceImage, shapes, options };
    if (this._rafHandle !== null) {
      return;
    }
    this._rafHandle = requestAnimationFrame(() => {
      this._rafHandle = null;
      const args = this._pendingRenderArgs;
      this._pendingRenderArgs = null;
      if (args) {
        this.render(args.sourceImage, args.shapes, args.options);
      }
    });
  }

  /**
   * Draw a translucent grey preview of a shape that hasn't been placed
   * yet, at its exact size and position, so the user can see what a
   * click would produce before committing to it.
   * @param {import("./shapes.js").BlurShape} previewShape
   */
  _drawPreview(previewShape) {
    const { ctx } = this;
    const outlineWidth = this.getImagePixelsPerCssPixel() * 1.5;

    ctx.save();
    previewShape.traceClipPath(ctx);
    ctx.fillStyle = "rgba(128, 128, 128, 0.45)";
    ctx.fill();
    ctx.lineWidth = outlineWidth;
    ctx.strokeStyle = "rgba(255, 255, 255, 0.85)";
    ctx.stroke();
    ctx.restore();
  }

  /**
   * Draw the dashed selection outline and resize handles for the
   * currently selected shape. Handle count drops from 8 to just the 4
   * corners when the shape is too small on-screen for 8 to be usable.
   * @param {import("./shapes.js").BlurShape} shape
   */
  _drawSelectionChrome(shape) {
    const { ctx } = this;
    const imagePxPerCssPx = this.getImagePixelsPerCssPixel();

    ctx.save();
    shape.traceClipPath(ctx);
    ctx.setLineDash([imagePxPerCssPx * 5, imagePxPerCssPx * 3]);
    ctx.lineWidth = imagePxPerCssPx * 1.5;
    ctx.strokeStyle = "rgba(255, 255, 255, 0.95)";
    ctx.stroke();
    ctx.restore();

    const handleRadius = (imagePxPerCssPx * HANDLE_CSS_DIAMETER) / 2;

    for (const handle of getVisibleHandles(shape, imagePxPerCssPx)) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(handle.x, handle.y, handleRadius, 0, Math.PI * 2);
      ctx.fillStyle = "#ffffff";
      ctx.fill();
      ctx.lineWidth = imagePxPerCssPx * 1.5;
      ctx.strokeStyle = "#1b1d23";
      ctx.stroke();
      ctx.restore();
    }
  }

  /**
   * Convert a pointer event's page coordinates into image pixel
   * coordinates, accounting for however much the canvas is currently
   * scaled down (by CSS/`max-width`) to fit the screen.
   * @param {PointerEvent|MouseEvent} event
   * @returns {{x: number, y: number}}
   */
  eventToImageCoordinates(event) {
    const rect = this.displayCanvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
      return { x: 0, y: 0 };
    }
    const scaleX = this.imageWidth / rect.width;
    const scaleY = this.imageHeight / rect.height;
    return {
      x: (event.clientX - rect.left) * scaleX,
      y: (event.clientY - rect.top) * scaleY,
    };
  }

  /**
   * How many image pixels correspond to one on-screen CSS pixel right
   * now. Used to keep overlay line widths and handle sizes a consistent
   * *visual* thickness no matter how large the source image is, and by
   * interaction.js to convert a CSS-pixel hit tolerance into image
   * pixels.
   * @returns {number}
   */
  getImagePixelsPerCssPixel() {
    const rect = this.displayCanvas.getBoundingClientRect();
    if (rect.width === 0) {
      return 1;
    }
    return this.imageWidth / rect.width;
  }
}
