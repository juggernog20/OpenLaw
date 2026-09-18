// SPDX-License-Identifier: AGPL-3.0-only

// The stored photo stays within the API's 1 MB limit.
export const AVATAR_BYTE_LIMIT = 1024 * 1024;
export const AVATAR_UPLOAD_BYTE_LIMIT = 10 * 1024 * 1024;
export const AVATAR_TYPES = ["image/png", "image/jpeg"];

/** Resize locally, retaining aspect ratio and PNG transparency. */
export async function prepareAvatar(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  try {
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Image processing is unavailable.");
    let scale = Math.min(1, 512 / Math.max(bitmap.width, bitmap.height));
    for (;;) {
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const image = canvas.toDataURL(file.type, 0.85);
      const base64 = image.slice(image.indexOf(",") + 1);
      const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
      if ((base64.length * 3) / 4 - padding <= AVATAR_BYTE_LIMIT) return image;
      scale *= 0.75;
    }
  } finally {
    bitmap.close();
  }
}
