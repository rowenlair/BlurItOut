# BlurItOut

A privacy tool for redacting parts of a photo — faces, license plates,
documents, anything you don't want visible — entirely in your browser.
Nothing is uploaded anywhere: the image never leaves your device.

## Using it

1. **Choose an image** (PNG or JPEG).
2. **Tap or click** anywhere on the image to drop a blur shape there, or
   **press and drag** to size it as you place it.
3. **Drag inside a shape** to move it, or **drag its handles** to resize
   it. The width/height sliders reflect (and can also drive) the
   selected shape's size.
4. Adjust **Blur** any time — 0% leaves the image untouched; 100%
   collapses the covered region to a flat, unrecoverable smear. Every
   shape uses the same blur amount and updates instantly.
5. Select a shape and press **Delete**/**Backspace**, or use the
   **Delete selected** button, to remove it. **Undo last shape** and
   **Clear all shapes** are also available.
6. **Download** the result as PNG or JPEG, at the original image's full
   resolution.

Works with touch, mouse, and keyboard (arrow keys nudge the selected
shape; Escape deselects).

## How it works

Rather than blurring each shape's own small region — which would mean
re-blurring on every drag frame — BlurItOut blurs the **whole image
once**, caches the result, and treats every shape as a pure clipping
mask over that single cached bitmap. Moving or resizing a shape is then
just a clip and a `drawImage`: no blur work at all, which is what keeps
dragging smooth even on a large photo or a phone.

The blur itself is a box-based triangular filter in the spirit of Mario
Klingemann's "Stack Blur" (`js/stackBlur.js`) — an O(pixels) approximation
of a gaussian blur whose cost is *independent of the blur radius*, applied
to a version of the image downscaled just enough to keep the effective
radius small and the cost flat, no matter how extreme the blur slider
goes. The image is genuinely, not just visually, blurred: downscaling
discards real information, so unlike a naive full-resolution blur, the
result isn't something a sharper filter or a bit of luck could reverse.

No build step, no dependencies, no server: it's a handful of ES modules
loaded directly by `index.html`. Open it, or serve the folder with any
static file server.

## Tests

`test/stackBlur.test.mjs` exercises the blur core directly with Node's
built-in test runner (no dependencies, no build step):

```
node --test
```
