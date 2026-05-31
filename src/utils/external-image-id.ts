/** Encode a display name to an AWS Rekognition-safe ExternalImageId. */
export function encodeExternalImageId(name: string): string {
  return Buffer.from(name, "utf8").toString("hex");
}

/** Decode a hex-encoded ExternalImageId back to the original display name. */
export function decodeExternalImageId(encoded: string): string {
  return Buffer.from(encoded, "hex").toString("utf8");
}
