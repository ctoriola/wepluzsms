// Resize a logo in the browser to a small WebP data URL. Logos are stored in
// Firestore this way, so schools do not need Firebase's paid Storage plan.
export async function resizeImageToDataUrl(file: File, maxSize = 256, quality = 0.85): Promise<string> {
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
    throw new Error("Please choose a PNG, JPG or WebP image.");
  }
  if (file.size > 10 * 1024 * 1024) throw new Error("That image is too large. Please choose one under 10 MB.");

  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSize / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Your browser could not process this image.");
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();

  let dataUrl = canvas.toDataURL("image/webp", quality);
  if (!dataUrl.startsWith("data:image/webp")) dataUrl = canvas.toDataURL("image/png"); // older Safari
  if (dataUrl.length > 390_000) throw new Error("The logo is still too large after resizing. Try a simpler image.");
  return dataUrl;
}
