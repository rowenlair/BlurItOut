import { ShapeManager } from "./shapeManager.js";
import { BlurProcessor } from "./blurProcessor.js";
import { CanvasRenderer } from "./canvasRenderer.js";
import { ImageExporter } from "./imageExporter.js";
import { InteractionController } from "./interaction.js";
import { SHAPE_CLASSES_BY_TYPE } from "./shapes.js";

/** However small an image is, a blur-amount of 100% never resolves to a
 * smaller radius than this — otherwise a maxed-out slider on a tiny
 * image would barely blur anything. */
const MIN_MAX_BLUR_RADIUS_PX = 200;

/**
 * Top-level controller that wires the DOM controls to the shape,
 * blurring, rendering, and interaction logic. This is the only class
 * that touches the DOM directly.
 */
class App {
  constructor() {
    this._sourceImage = null; // HTMLImageElement holding the sharp, unblurred image

    this._defaultShapeWidth = 80; // used for shapes created while nothing is selected
    this._defaultShapeHeight = 80;
    this._lastHoverPoint = null; // last known cursor position, in image pixels, or null
    this._previewShape = null; // ephemeral shape (never added to ShapeManager) shown under the cursor

    this._shapeManager = new ShapeManager();
    this._blurProcessor = new BlurProcessor();

    this._cacheDomElements();

    this._renderer = new CanvasRenderer(this.canvas, this._blurProcessor);
    this._interaction = new InteractionController(this.canvas, this._renderer, this._shapeManager, {
      onCreateShape: (x, y) => this._createShapeAt(x, y),
      onGeometryChanged: () => {
        this._syncSelectionControls();
        this._render();
      },
      onSelectionChanged: () => {
        this._syncSelectionControls();
        this._render();
      },
      onChanged: () => this._render(),
      onHoverMove: (x, y) => {
        this._lastHoverPoint = { x, y };
        this._updatePreviewShape();
      },
      onHoverEnd: () => {
        this._lastHoverPoint = null;
        this._updatePreviewShape();
      },
    });

    this._bindEvents();
    this._syncSelectionControls();
    this._handleBlurAmountInput(); // sync the label with the actual mapping, replacing the HTML's static placeholder
  }

  /** Grab and store references to every DOM control the app needs. */
  _cacheDomElements() {
    this.imageInput = document.getElementById("image-input");
    this.shapeTypeSelect = document.getElementById("shape-type");
    this.shapeWidthInput = document.getElementById("shape-width");
    this.shapeHeightInput = document.getElementById("shape-height");
    this.blurAmountInput = document.getElementById("blur-amount");
    this.shapeWidthValue = document.getElementById("shape-width-value");
    this.shapeHeightValue = document.getElementById("shape-height-value");
    this.blurAmountValue = document.getElementById("blur-amount-value");
    this.deleteSelectedButton = document.getElementById("delete-selected-btn");
    this.undoButton = document.getElementById("undo-shape-btn");
    this.clearButton = document.getElementById("clear-shapes-btn");
    this.downloadFormatSelect = document.getElementById("download-format");
    this.downloadButton = document.getElementById("download-btn");
    this.canvas = document.getElementById("editor-canvas");
    this.emptyState = document.getElementById("empty-state");

    this._defaultShapeWidth = Number(this.shapeWidthInput.value);
    this._defaultShapeHeight = Number(this.shapeHeightInput.value);
  }

  /** Attach every event listener the app responds to (excluding pointer/keyboard input on the canvas itself, which InteractionController owns). */
  _bindEvents() {
    this.imageInput.addEventListener("change", (event) => this._handleImageSelected(event));

    this.shapeTypeSelect.addEventListener("change", () => this._updatePreviewShape());

    this.shapeWidthInput.addEventListener("input", () => this._handleShapeSizeInput("width"));
    this.shapeHeightInput.addEventListener("input", () => this._handleShapeSizeInput("height"));

    this.blurAmountInput.addEventListener("input", () => this._handleBlurAmountInput());

    this.deleteSelectedButton.addEventListener("click", () => {
      const selected = this._shapeManager.getSelected();
      if (!selected) {
        return;
      }
      this._shapeManager.remove(selected);
      this._syncSelectionControls();
      this._render();
    });

    this.undoButton.addEventListener("click", () => {
      this._shapeManager.removeLast();
      this._syncSelectionControls();
      this._render();
    });
    this.clearButton.addEventListener("click", () => {
      this._shapeManager.clear();
      this._syncSelectionControls();
      this._render();
    });

    this.downloadButton.addEventListener("click", () => this._handleDownload());
  }

  /**
   * Load the file the user picked into an `<img>` element and reset all
   * per-image state: shapes, selection, the blur base/cache, the
   * display canvas's size, and the width/height/blur-amount controls'
   * dynamic ranges.
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

      this._shapeManager.clear();
      this._lastHoverPoint = null;
      this._previewShape = null;

      this._blurProcessor.setSource(image);
      this._renderer.setImageSize(image.naturalWidth, image.naturalHeight);
      this._interaction.setImageBounds(image.naturalWidth, image.naturalHeight);

      const maxShapeSize = Math.max(image.naturalWidth, image.naturalHeight);
      this.shapeWidthInput.max = String(maxShapeSize);
      this.shapeHeightInput.max = String(maxShapeSize);
      // A default carried over from a larger image could exceed this
      // image's bounds; clamp it so the slider and the label it drives
      // (and the size newly created shapes actually get) stay in sync.
      this._defaultShapeWidth = Math.min(this._defaultShapeWidth, maxShapeSize);
      this._defaultShapeHeight = Math.min(this._defaultShapeHeight, maxShapeSize);

      this._handleBlurAmountInput();
      this._syncSelectionControls();

      this.canvas.style.display = "block";
      this.emptyState.style.display = "none";
      this._render();
    };
    image.src = objectUrl;
  }

  /**
   * Create a new shape at `(x, y)` (image pixels) using the currently
   * selected shape type and default size. Called by
   * `InteractionController` when the user presses on empty canvas.
   * @param {number} x
   * @param {number} y
   * @returns {import("./shapes.js").BlurShape}
   */
  _createShapeAt(x, y) {
    return this._shapeManager.addShape(
      this.shapeTypeSelect.value,
      x,
      y,
      this._defaultShapeWidth,
      this._defaultShapeHeight
    );
  }

  /**
   * Handle a width/height slider move: resize the selected shape
   * directly if there is one, otherwise update the default size used
   * for shapes created (and previewed) from now on.
   * @param {"width"|"height"} dimension
   */
  _handleShapeSizeInput(dimension) {
    const input = dimension === "width" ? this.shapeWidthInput : this.shapeHeightInput;
    const valueSpan = dimension === "width" ? this.shapeWidthValue : this.shapeHeightValue;
    const value = Number(input.value);
    valueSpan.textContent = String(value);

    const selected = this._shapeManager.getSelected();
    if (selected) {
      selected[dimension] = value;
      this._render();
    } else {
      if (dimension === "width") {
        this._defaultShapeWidth = value;
      } else {
        this._defaultShapeHeight = value;
      }
      this._updatePreviewShape();
    }
  }

  /**
   * The largest blur radius (in image pixels) the blur-amount slider can
   * resolve to for the current image: half its larger dimension, but
   * never below `MIN_MAX_BLUR_RADIUS_PX` so small images still get a
   * meaningful maximum blur.
   * @returns {number}
   */
  _getMaxBlurRadiusPx() {
    if (!this._sourceImage) {
      return MIN_MAX_BLUR_RADIUS_PX;
    }
    const maxDim = Math.max(this._sourceImage.naturalWidth, this._sourceImage.naturalHeight);
    return Math.max(MIN_MAX_BLUR_RADIUS_PX, Math.round(maxDim / 2));
  }

  /**
   * Map the blur-amount slider's 0-100 percentage to a pixel radius.
   * Squaring keeps the low end of the slider controllable — most of the
   * useful range for everyday blurring is packed into the first half —
   * while still reaching a "flat, unrecoverable smear" at 100%.
   * @param {number} percent - 0-100
   * @returns {number}
   */
  _radiusPxFromPercent(percent) {
    return Math.round((percent / 100) ** 2 * this._getMaxBlurRadiusPx());
  }

  /** Handle the blur-amount slider: update its label and the blur processor's radius. */
  _handleBlurAmountInput() {
    const percent = Number(this.blurAmountInput.value);
    const radiusPx = this._radiusPxFromPercent(percent);
    this.blurAmountValue.textContent = `${percent}% (≈${radiusPx}px)`;
    this._blurProcessor.setRadius(radiusPx);
    this._render();
  }

  /**
   * Rebuild the ephemeral preview shape from the last known hover
   * position and the currently selected shape type/default size, then
   * redraw. The preview is never added to the `ShapeManager` and never
   * blurred — it is only an outline showing where and how big the next
   * placed shape would be. Suppressed while any shape is selected (a
   * selected shape's own handles are the relevant affordance instead).
   */
  _updatePreviewShape() {
    const selected = this._shapeManager.getSelected();
    if (!this._sourceImage || !this._lastHoverPoint || selected) {
      this._previewShape = null;
    } else {
      const ShapeClass = SHAPE_CLASSES_BY_TYPE[this.shapeTypeSelect.value];
      this._previewShape = new ShapeClass(
        this._lastHoverPoint.x,
        this._lastHoverPoint.y,
        this._defaultShapeWidth,
        this._defaultShapeHeight
      );
    }
    this._render();
  }

  /**
   * Keep the "delete selected" button and the width/height sliders in
   * sync with the current selection: enable the button, and make the
   * sliders reflect (and, via `_handleShapeSizeInput`, drive) the
   * selected shape's size, falling back to the stored defaults when
   * nothing is selected.
   */
  _syncSelectionControls() {
    const selected = this._shapeManager.getSelected();
    this.deleteSelectedButton.disabled = !selected;

    const width = selected ? Math.round(selected.width) : this._defaultShapeWidth;
    const height = selected ? Math.round(selected.height) : this._defaultShapeHeight;
    this.shapeWidthInput.value = String(width);
    this.shapeHeightInput.value = String(height);
    this.shapeWidthValue.textContent = String(width);
    this.shapeHeightValue.textContent = String(height);
  }

  /** Redraw the canvas with the current image, shapes, selection, and cursor preview. */
  _render() {
    if (!this._sourceImage) {
      return;
    }
    this._renderer.requestRender(this._sourceImage, this._shapeManager.getShapes(), {
      previewShape: this._previewShape,
      selectedShape: this._shapeManager.getSelected(),
    });
  }

  /** Export the current image (at full resolution) in the selected format. */
  _handleDownload() {
    if (!this._sourceImage) {
      return;
    }
    ImageExporter.download(
      this._sourceImage,
      this._shapeManager.getShapes(),
      this._blurProcessor,
      this.downloadFormatSelect.value
    );
  }
}

document.addEventListener("DOMContentLoaded", () => new App());
