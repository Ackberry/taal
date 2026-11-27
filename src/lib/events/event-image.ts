import "server-only";

import sharp from "sharp";

const maxUploadMegabytes = 3;
export const eventImageMaxBytes = maxUploadMegabytes * 1024 * 1024;
export const eventImageSizeMessage = `Choose an image no larger than ${maxUploadMegabytes} MB.`;
const maxInputPixels = 24_000_000;
const maxOutputSide = 2400;
const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export class EventImageError extends Error {
  readonly code: "image_too_large" | "unsupported_image" | "invalid_image";

  constructor(code: EventImageError["code"], message: string) {
    super(message);
    this.code = code;
  }
}

function sourceFormat(bytes: Buffer) {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";
  if (bytes.subarray(0, 8).equals(pngSignature)) return "png";
  if (bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") return "webp";
  return null;
}

export async function prepareEventImage(bytes: Buffer) {
  if (bytes.length > eventImageMaxBytes) {
    throw new EventImageError("image_too_large", eventImageSizeMessage);
  }

  const format = sourceFormat(bytes);
  if (!format) throw new EventImageError("unsupported_image", "Choose a JPEG, PNG, or WebP image.");

  try {
    const image = sharp(bytes, { limitInputPixels: maxInputPixels, failOn: "warning" });
    const metadata = await image.metadata();
    if (metadata.format !== format || !metadata.width || !metadata.height) {
      throw new EventImageError("invalid_image", "This image couldn’t be read. Choose a different file.");
    }
    if ((metadata.pages ?? 1) > 1) {
      throw new EventImageError("unsupported_image", "Choose a still image instead of an animation.");
    }
    return await image.autoOrient()
      .resize({ width: maxOutputSide, height: maxOutputSide, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 88 })
      .toBuffer();
  } catch (error) {
    if (error instanceof EventImageError) throw error;
    if (error instanceof Error && error.message === "Input image exceeds pixel limit") {
      throw new EventImageError("image_too_large", "Choose an image with 24 megapixels or fewer.");
    }
    throw new EventImageError("invalid_image", "This image couldn’t be read. Choose a different file.");
  }
}
