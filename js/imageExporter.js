/**
 * Handles saving the finished canvas to the user's disk.
 */
export class ImageExporter {
  /**
   * Trigger a browser download of the canvas's current contents.
   * @param {HTMLCanvasElement} canvas - the canvas to export
   * @param {"png"|"jpeg"} format - output image format
   * @param {string} [filename] - download filename, without extension
   */
  static download(canvas, format, filename = "blurred-image") {
    const mimeType = format === "jpeg" ? "image/jpeg" : "image/png";
    const extension = format === "jpeg" ? "jpg" : "png";
    const jpegQuality = 0.92;

    canvas.toBlob(
      (blob) => {
        if (!blob) {
          return;
        }
        const objectUrl = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = objectUrl;
        link.download = `${filename}.${extension}`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(objectUrl);
      },
      mimeType,
      format === "jpeg" ? jpegQuality : undefined
    );
  }
}
