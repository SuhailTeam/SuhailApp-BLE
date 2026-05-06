import type { AppSession } from "@mentra/sdk";
import sharp from "sharp";
import { Logger } from "./logger";

const logger = new Logger("ImageUtils");

/**
 * Strips the data URI prefix from a base64 image string if present.
 * e.g. "data:image/jpeg;base64,/9j/4A..." → "/9j/4A..."
 */
export function stripBase64Prefix(base64: string): string {
  const commaIndex = base64.indexOf(",");
  if (commaIndex !== -1 && commaIndex < 50) {
    return base64.substring(commaIndex + 1);
  }
  return base64;
}

/**
 * Gets the MIME type from a base64 data URI, defaults to image/jpeg.
 */
export function getMimeType(base64: string): string {
  const match = base64.match(/^data:(image\/\w+);base64,/);
  return match ? match[1] : "image/jpeg";
}

/**
 * Crops a face from a base64 image using a Rekognition bounding box (normalized 0-1 coords).
 * Returns the cropped image as a base64 string.
 */
export async function cropFace(
  imageBase64: string,
  boundingBox: { Left: number; Top: number; Width: number; Height: number },
): Promise<string> {
  const buffer = Buffer.from(imageBase64, "base64");
  const metadata = await sharp(buffer).metadata();
  const imgWidth = metadata.width!;
  const imgHeight = metadata.height!;

  const left = Math.max(0, Math.round(boundingBox.Left * imgWidth));
  const top = Math.max(0, Math.round(boundingBox.Top * imgHeight));
  const width = Math.min(Math.round(boundingBox.Width * imgWidth), imgWidth - left);
  const height = Math.min(Math.round(boundingBox.Height * imgHeight), imgHeight - top);

  const cropped = await sharp(buffer).extract({ left, top, width, height }).toBuffer();
  return cropped.toString("base64");
}

/**
 * Captures a photo from the session camera with error handling.
 * Returns the base64-encoded image string or null if capture failed.
 */
export async function capturePhoto(session: AppSession): Promise<string | null> {
  try {
    const size = "large";
    const compress = "none";
    const CAPTURE_TIMEOUT_MS = 10_000;
    logger.info(`Capturing photo from glasses camera (size=${size}, compress=${compress})...`);
    const photoData = await Promise.race([
      session.camera.requestPhoto({ size, compress }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Photo capture timed out")), CAPTURE_TIMEOUT_MS)
      ),
    ]);
    if (!photoData || !photoData.buffer) {
      logger.warn("Captured photo is invalid or empty");
      return null;
    }
    const base64 = photoData.buffer.toString("base64");
    logger.info(`Photo captured successfully (${Math.round(photoData.size / 1024)}KB)`);
    return base64;
  } catch (error) {
    logger.error("Failed to capture photo:", error);
    return null;
  }
}
