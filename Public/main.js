// Image Blur Tool
// Uses the native Canvas 2D API (ctx.filter = "blur()") to pre-render a
// blurred copy of the image, then clips that blurred copy through circle /
// rectangle shapes drawn on top of the sharp image. This keeps things to a
// single small file with no external image-processing library required.

const fileInput = document.getElementById("fileInput");
const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");
const placeholder = document.getElementById("placeholder");

const circleTool = document.getElementById("circleTool");
const rectTool = document.getElementById("rectTool");
const blurRange = document.getElementById("blurRange");
const removeBtn = document.getElementById("removeBtn");
const clearBtn = document.getElementById("clearBtn");
const downloadBtn = document.getElementById("downloadBtn");
const formatSelect = document.getElementById("formatSelect");

const MAX_DIMENSION = 1000; // cap large images down so the canvas stays manageable
const HANDLE_SIZE = 10;
const MIN_SHAPE = 16;
const DEFAULT_SHAPE = 90;

const img = new Image();
let imgLoaded = false;
let blurCanvas = document.createElement("canvas");
let blurCtx = blurCanvas.getContext("2d");

let shapes = []; // { type: 'circle' | 'rect', x, y, width, height }
let selectedShape = null;
let currentTool = "circle";

let mode = null; // null | 'drag' | 'resize' | 'draw'
let resizeCorner = null;
let dragOffset = { x: 0, y: 0 };

// ---------- Image loading ----------

fileInput.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
        img.onload = () => {
            const scale = Math.min(1, MAX_DIMENSION / Math.max(img.naturalWidth, img.naturalHeight));
            canvas.width = Math.round(img.naturalWidth * scale);
            canvas.height = Math.round(img.naturalHeight * scale);
            blurCanvas.width = canvas.width;
            blurCanvas.height = canvas.height;

            shapes = [];
            selectedShape = null;
            imgLoaded = true;
            placeholder.style.display = "none";

            updateBlurCanvas();
            redraw();
        };
        img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
});

function updateBlurCanvas() {
    blurCtx.clearRect(0, 0, blurCanvas.width, blurCanvas.height);
    blurCtx.filter = `blur(${blurRange.value}px)`;
    blurCtx.drawImage(img, 0, 0, blurCanvas.width, blurCanvas.height);
    blurCtx.filter = "none";
}

blurRange.addEventListener("input", () => {
    if (!imgLoaded) return;
    updateBlurCanvas();
    redraw();
});

// ---------- Tool selection ----------

circleTool.addEventListener("click", () => setTool("circle"));
rectTool.addEventListener("click", () => setTool("rect"));

function setTool(tool) {
    currentTool = tool;
    circleTool.classList.toggle("active", tool === "circle");
    rectTool.classList.toggle("active", tool === "rect");
}

// ---------- Drawing ----------

function redraw() {
    if (!imgLoaded) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    for (const shape of shapes) {
        ctx.save();
        tracePath(shape);
        ctx.clip();
        ctx.drawImage(blurCanvas, 0, 0);
        ctx.restore();

        if (shape === selectedShape) {
            ctx.save();
            ctx.strokeStyle = "#2563eb";
            ctx.lineWidth = 2;
            ctx.setLineDash([6, 4]);
            tracePath(shape);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.restore();
            drawHandles(shape);
        }
    }
}

function tracePath(shape) {
    ctx.beginPath();
    if (shape.type === "rect") {
        ctx.rect(shape.x, shape.y, shape.width, shape.height);
    } else {
        const rx = shape.width / 2;
        const ry = shape.height / 2;
        ctx.ellipse(shape.x + rx, shape.y + ry, Math.abs(rx), Math.abs(ry), 0, 0, Math.PI * 2);
    }
}

function corners(shape) {
    return {
        tl: { x: shape.x, y: shape.y },
        tr: { x: shape.x + shape.width, y: shape.y },
        bl: { x: shape.x, y: shape.y + shape.height },
        br: { x: shape.x + shape.width, y: shape.y + shape.height },
    };
}

function drawHandles(shape) {
    ctx.save();
    ctx.fillStyle = "#2563eb";
    const c = corners(shape);
    for (const key in c) {
        const p = c[key];
        ctx.fillRect(p.x - HANDLE_SIZE / 2, p.y - HANDLE_SIZE / 2, HANDLE_SIZE, HANDLE_SIZE);
    }
    ctx.restore();
}

// ---------- Mouse interaction ----------

function getMousePos(e) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
        x: (e.clientX - rect.left) * scaleX,
        y: (e.clientY - rect.top) * scaleY,
    };
}

function hitHandle(shape, pos) {
    const c = corners(shape);
    const r = HANDLE_SIZE;
    for (const key in c) {
        const p = c[key];
        if (Math.abs(pos.x - p.x) <= r && Math.abs(pos.y - p.y) <= r) return key;
    }
    return null;
}

function hitShape(shape, pos) {
    if (shape.type === "rect") {
        return pos.x >= shape.x && pos.x <= shape.x + shape.width &&
            pos.y >= shape.y && pos.y <= shape.y + shape.height;
    }
    const rx = Math.abs(shape.width / 2);
    const ry = Math.abs(shape.height / 2);
    const cx = shape.x + shape.width / 2;
    const cy = shape.y + shape.height / 2;
    if (rx === 0 || ry === 0) return false;
    const dx = (pos.x - cx) / rx;
    const dy = (pos.y - cy) / ry;
    return dx * dx + dy * dy <= 1;
}

canvas.addEventListener("mousedown", (e) => {
    if (!imgLoaded) return;
    const pos = getMousePos(e);

    if (selectedShape) {
        const handle = hitHandle(selectedShape, pos);
        if (handle) {
            mode = "resize";
            resizeCorner = handle;
            return;
        }
    }

    // check existing shapes, topmost first
    for (let i = shapes.length - 1; i >= 0; i--) {
        if (hitShape(shapes[i], pos)) {
            selectedShape = shapes[i];
            mode = "drag";
            dragOffset = { x: pos.x - selectedShape.x, y: pos.y - selectedShape.y };
            redraw();
            return;
        }
    }

    // clicked empty space: deselect, then create a new shape
    selectedShape = null;
    const shape = {
        type: currentTool,
        x: pos.x - DEFAULT_SHAPE / 2,
        y: pos.y - DEFAULT_SHAPE / 2,
        width: DEFAULT_SHAPE,
        height: DEFAULT_SHAPE,
    };
    shapes.push(shape);
    selectedShape = shape;
    redraw();
});

window.addEventListener("mousemove", (e) => {
    if (!imgLoaded || !selectedShape || !mode) return;
    const pos = getMousePos(e);

    if (mode === "drag") {
        let newX = pos.x - dragOffset.x;
        let newY = pos.y - dragOffset.y;
        newX = clamp(newX, 0, canvas.width - selectedShape.width);
        newY = clamp(newY, 0, canvas.height - selectedShape.height);
        selectedShape.x = newX;
        selectedShape.y = newY;
        redraw();
    } else if (mode === "resize") {
        resizeShape(selectedShape, resizeCorner, pos);
        redraw();
    }
});

window.addEventListener("mouseup", () => {
    mode = null;
    resizeCorner = null;
});

function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
}

function resizeShape(shape, corner, pos) {
    const px = clamp(pos.x, 0, canvas.width);
    const py = clamp(pos.y, 0, canvas.height);

    if (corner === "br") {
        shape.width = Math.max(MIN_SHAPE, px - shape.x);
        shape.height = Math.max(MIN_SHAPE, py - shape.y);
    } else if (corner === "tl") {
        const newX = Math.min(px, shape.x + shape.width - MIN_SHAPE);
        const newY = Math.min(py, shape.y + shape.height - MIN_SHAPE);
        shape.width += shape.x - newX;
        shape.height += shape.y - newY;
        shape.x = newX;
        shape.y = newY;
    } else if (corner === "tr") {
        const newY = Math.min(py, shape.y + shape.height - MIN_SHAPE);
        shape.width = Math.max(MIN_SHAPE, px - shape.x);
        shape.height += shape.y - newY;
        shape.y = newY;
    } else if (corner === "bl") {
        const newX = Math.min(px, shape.x + shape.width - MIN_SHAPE);
        shape.width += shape.x - newX;
        shape.x = newX;
        shape.height = Math.max(MIN_SHAPE, py - shape.y);
    }
}

// ---------- Remove / clear ----------

removeBtn.addEventListener("click", () => {
    if (!selectedShape) return;
    shapes = shapes.filter((s) => s !== selectedShape);
    selectedShape = null;
    redraw();
});

clearBtn.addEventListener("click", () => {
    shapes = [];
    selectedShape = null;
    redraw();
});

window.addEventListener("keydown", (e) => {
    if ((e.key === "Delete" || e.key === "Backspace") && selectedShape &&
        document.activeElement.tagName !== "INPUT") {
        e.preventDefault();
        shapes = shapes.filter((s) => s !== selectedShape);
        selectedShape = null;
        redraw();
    }
});

// ---------- Download ----------

downloadBtn.addEventListener("click", () => {
    if (!imgLoaded) return;
    const format = formatSelect.value;
    const mime = format === "png" ? "image/png" : "image/jpeg";
    const extension = format === "png" ? "png" : "jpg";

    // hide selection handles/outline for the exported image
    const previousSelection = selectedShape;
    selectedShape = null;
    redraw();

    canvas.toBlob((blob) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `blurred-image.${extension}`;
        a.click();
        URL.revokeObjectURL(url);

        selectedShape = previousSelection;
        redraw();
    }, mime, 0.92);
});