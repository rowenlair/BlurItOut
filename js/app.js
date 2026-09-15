import { ShapeManager } from "./shapeManager.js";
import { BlurProcessor } from "./blurProcessor.js";
import { CanvasRenderer } from "./canvasRenderer.js";
import { ImageExporter } from "./imageExporter.js";
import { SHAPE_CLASSES_BY_TYPE } from "./shapes.js";

/**
 * Top-level controller that wires the DOM controls to the shape,
 * blurring, rendering, and export logic. This is the only class that
 * touches the DOM directly.
 */
class App {
  constructor() {
    this._sourceImage = null; // HTMLImageElement holding the sharp, unblurred image
    this._sourceCanvas = null; // same image drawn onto a canvas, so image-js can read its pixels

    this._isHoveringCanvas = false; // whether the cursor is currently over the canvas
    this._lastCursorImagePosition = null; // last known cursor position, in image pixels
    this._previewShape = null; // ephemeral shape (never added to ShapeManager) shown under the cursor

    this._shapeManager = new ShapeManager();
    this._blurProcessor = new BlurProcessor();
    this._renderer = new CanvasRenderer(document.getElementById("editor-canvas"));

    this._cacheDomElements();
    this._bindEvents();
  }

  /** Grab and store references to every DOM control the app needs. */
  _cacheDomElements() {
    this.imageInput = document.getElementById("image-input");
    this.shapeTypeSelect = document.getElementById("shape-type");
    this.shapeWidthInput = document.getElementById("shape-width");
    this.shapeHeightInput = document.getElementById("shape-height");
    this.blurStrengthInput = document.getElementById("blur-strength");
    this.shapeWidthValue = document.getElementById("shape-width-value");
    this.shapeHeightValue = document.getElementById("shape-height-value");
    this.blurStrengthValue = document.getElementById("blur-strength-value");
    this.undoButton = document.getElementById("undo-shape-btn");
    this.clearButton = document.getElementById("clear-shapes-btn");
    this.downloadFormatSelect = document.getElementById("download-format");
    this.downloadButton = document.getElementById("download-btn");
    this.canvas = document.getElementById("editor-canvas");
    this.emptyState = document.getElementById("empty-state");
  }

  /** Attach every event listener the app responds to. */
  _bindEvents() {
    this.imageInput.addEventListener("change", (event) => this._handleImageSelected(event));
    this.canvas.addEventListener("click", (event) => this._handleCanvasClick(event));
    this.canvas.addEventListener("mousemove", (event) => this._handleCanvasMouseMove(event));
    this.canvas.addEventListener("mouseleave", () => this._handleCanvasMouseLeave());

    this.shapeTypeSelect.addEventListener("change", () => this._updatePreviewShape());
    this.shapeWidthInput.addEventListener("input", () => {
      this.shapeWidthValue.textContent = this.shapeWidthInput.value;
      this._updatePreviewShape();
    });
    this.shapeHeightInput.addEventListener("input", () => {
      this.shapeHeightValue.textContent = this.shapeHeightInput.value;
      this._updatePreviewShape();
    });
    this.blurStrengthInput.addEventListener("input", () => {
      this.blurStrengthValue.textContent = this.blurStrengthInput.value;
    });
    this.blurStrengthInput.addEventListener("change", () => this._reblurAllShapes());

    this.undoButton.addEventListener("click", () => {
      this._shapeManager.removeLast();
      this._render();
    });
    this.clearButton.addEventListener("click", () => {
      this._shapeManager.clear();
      this._render();
    });

    this.downloadButton.addEventListener("click", () => this._handleDownload());
  }

  /**
   * Load the file the user picked into an `<img>` element, draw it onto
   * an offscreen canvas (so image-js can later read its pixels), and
   * size the visible canvas to match. No blurring happens yet — only
   * placed shapes ever get blurred, and only the small region under
   * them, so loading even a large photo stays instant.
   * @param {Event} event - the file input's `change` event
   */
  _handleImageSelected(event) {
    const file = event.target.files[0];
    if (!file) {
      return;
    }

    const objectUrl = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      this._sourceImage = image;

      this._sourceCanvas = document.createElement("canvas");
      this._sourceCanvas.width = image.naturalWidth;
      this._sourceCanvas.height = image.naturalHeight;
      this._sourceCanvas.getContext("2d").drawImage(image, 0, 0);

      this._shapeManager.clear();
      this._isHoveringCanvas = false;
      this._lastCursorImagePosition = null;
      this._previewShape = null;
      this._renderer.setCanvasSize(image.naturalWidth, image.naturalHeight);
      this.canvas.style.display = "block";
      this.emptyState.style.display = "none";
      this._render();
    };
    image.src = objectUrl;
  }

  /**
   * Handle a click on the canvas: place a new blur shape at the click
   * location, using whatever shape type/size is currently selected,
   * blur just that shape's region, and redraw.
   * @param {MouseEvent} event
   */
  _handleCanvasClick(event) {
    if (!this._sourceImage) {
      return;
    }
    const { x, y } = this._renderer.eventToImageCoordinates(event);
    const shape = this._shapeManager.addShape(
      this.shapeTypeSelect.value,
      x,
      y,
      Number(this.shapeWidthInput.value),
      Number(this.shapeHeightInput.value)
    );
    this._blurShape(shape);
    this._render();
  }

  /**
   * Track the cursor while it moves over the canvas and refresh the
   * shape preview to follow it.
   * @param {MouseEvent} event
   */
  _handleCanvasMouseMove(event) {
    if (!this._sourceImage) {
      return;
    }
    this._isHoveringCanvas = true;
    this._lastCursorImagePosition = this._renderer.eventToImageCoordinates(event);
    this._updatePreviewShape();
  }

  /** Hide the shape preview once the cursor leaves the canvas. */
  _handleCanvasMouseLeave() {
    this._isHoveringCanvas = false;
    this._lastCursorImagePosition = null;
    this._updatePreviewShape();
  }

  /**
   * Rebuild the ephemeral preview shape from the current cursor
   * position and the currently selected shape type/width/height, then
   * redraw. The preview is never added to the `ShapeManager` and is
   * never blurred — it's just an outline showing where and how big the
   * next placed shape would be.
   */
  _updatePreviewShape() {
    if (!this._sourceImage || !this._isHoveringCanvas || !this._lastCursorImagePosition) {
      this._previewShape = null;
    } else {
      const ShapeClass = SHAPE_CLASSES_BY_TYPE[this.shapeTypeSelect.value];
      const { x, y } = this._lastCursorImagePosition;
      this._previewShape = new ShapeClass(
        x,
        y,
        Number(this.shapeWidthInput.value),
        Number(this.shapeHeightInput.value)
      );
    }
    this._render();
  }

  /**
   * Compute and attach the blurred patch for a single shape, using the
   * currently selected blur strength.
   * @param {import("./shapes.js").BlurShape} shape
   */
  _blurShape(shape) {
    const sigma = Number(this.blurStrengthInput.value);
    shape.blurredPatch = this._blurProcessor.blurRegion(this._sourceCanvas, shape.getBoundingBox(), sigma);
  }

  /**
   * Re-blur every existing shape's region (used when the blur strength
   * slider changes) and redraw. Each shape's region is small, so this
   * stays fast no matter how large the source image is.
   */
  _reblurAllShapes() {
    if (!this._sourceImage) {
      return;
    }
    for (const shape of this._shapeManager.getShapes()) {
      this._blurShape(shape);
    }
    this._render();
  }

  /** Redraw the canvas with the current image, shapes, and cursor preview. */
  _render() {
    if (!this._sourceImage) {
      return;
    }
    this._renderer.render(this._sourceImage, this._shapeManager.getShapes(), this._previewShape);
  }

  /** Export the current canvas contents in the selected format. */
  _handleDownload() {
    if (!this._sourceImage) {
      return;
    }
    ImageExporter.download(this.canvas, this.downloadFormatSelect.value);
  }
}

document.addEventListener("DOMContentLoaded", () => new App());
