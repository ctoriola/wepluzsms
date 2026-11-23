// Resize an image in the browser and convert it to WebP before upload.
// Keeps logos small (fast on 3G) and strips any embedded metadata.
export async function resizeImageToWebp(file: File, maxSize = 512, quality = 0.9): Promise<Blob> {
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
    throw new Error("Please choose a PNG, JPG or WebP image.");
  }
  if (file.size > 10 * 1024 * 1024) throw new Error("That image is too large. Please choose one under 10 MB.");

  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSize / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Your browser could not process this image.");
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", quality));
  if (!blob) throw new Error("Your browser could not process this image.");
  if (blob.size > 2 * 1024 * 1024) throw new Error("The processed image is still over 2 MB. Try a simpler image.");
  return blob;
}
