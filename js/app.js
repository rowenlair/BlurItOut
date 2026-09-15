import { ShapeManager } from "./shapeManager.js";
import { BlurProcessor } from "./blurProcessor.js";
import { CanvasRenderer } from "./canvasRenderer.js";
import { ImageExporter } from "./imageExporter.js";

/**
 * Top-level controller that wires the DOM controls to the shape,
 * blurring, rendering, and export logic. This is the only class that
 * touches the DOM directly.
 */
class App {
  constructor() {
    this._sourceImage = null; // HTMLImageElement holding the sharp, unblurred image
    this._blurredCanvas = null; // last blurred render, reused until settings change

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

    this.shapeWidthInput.addEventListener("input", () => {
      this.shapeWidthValue.textContent = this.shapeWidthInput.value;
    });
    this.shapeHeightInput.addEventListener("input", () => {
      this.shapeHeightValue.textContent = this.shapeHeightInput.value;
    });
    this.blurStrengthInput.addEventListener("input", () => {
      this.blurStrengthValue.textContent = this.blurStrengthInput.value;
    });
    this.blurStrengthInput.addEventListener("change", () => this._recomputeBlurAndRender());

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
   * Load the file the user picked into an `<img>` element, size the
   * canvas to match, and run the initial blur pass.
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
      this._renderer.setCanvasSize(image.naturalWidth, image.naturalHeight);
      this.canvas.style.display = "block";
      this.emptyState.style.display = "none";
      this._recomputeBlurAndRender();
    };
    image.src = objectUrl;
  }

  /**
   * Handle a click on the canvas: place a new blur shape at the click
   * location, using whatever shape type/size is currently selected.
   * @param {MouseEvent} event
   */
  _handleCanvasClick(event) {
    if (!this._sourceImage) {
      return;
    }
    const { x, y } = this._renderer.eventToImageCoordinates(event);
    this._shapeManager.addShape(
      this.shapeTypeSelect.value,
      x,
      y,
      Number(this.shapeWidthInput.value),
      Number(this.shapeHeightInput.value)
    );
    this._render();
  }

  /**
   * Re-run the gaussian blur over the current source image (used when
   * a new image is loaded or the blur strength changes) and redraw.
   */
  _recomputeBlurAndRender() {
    if (!this._sourceImage) {
      return;
    }
    // Draw the source image onto a plain canvas first, since image-js
    // reads pixels from a canvas rather than an <img> element directly.
    const sourceCanvas = document.createElement("canvas");
    sourceCanvas.width = this._sourceImage.naturalWidth;
    sourceCanvas.height = this._sourceImage.naturalHeight;
    sourceCanvas.getContext("2d").drawImage(this._sourceImage, 0, 0);

    const sigma = Number(this.blurStrengthInput.value);
    this._blurredCanvas = this._blurProcessor.computeBlurredCanvas(sourceCanvas, sigma);
    this._render();
  }

  /** Redraw the canvas with the current image, blur, and shapes. */
  _render() {
    if (!this._sourceImage || !this._blurredCanvas) {
      return;
    }
    this._renderer.render(this._sourceImage, this._blurredCanvas, this._shapeManager.getShapes());
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
