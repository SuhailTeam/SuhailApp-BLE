import sharp from "sharp";

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
