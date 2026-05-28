import * as fs from "node:fs/promises";
import path from "node:path";
import {
  CreateCollectionCommand,
  DeleteFacesCommand,
  DescribeCollectionCommand,
  DetectFacesCommand,
  IndexFacesCommand,
  ListFacesCommand,
  RekognitionClient,
  ResourceAlreadyExistsException,
  SearchFacesByImageCommand,
} from "@aws-sdk/client-rekognition";
import { config } from "../utils/config";
import { Logger } from "../utils/logger";
import { cropFace } from "../utils/image-utils";
import type { FaceRecognitionResult, MultiFaceResult, FaceMatch } from "../types";

const logger = new Logger("FaceService");

const collectionId = config.awsRekognitionCollectionId;
const region = config.awsRegion;
const rekognition = new RekognitionClient({ region });
let collectionReadyPromise: Promise<void> | null = null;

/** Encode a name to an ASCII-safe ExternalImageId (hex of UTF-8 bytes).
 *  Exported (with decodeName) for the GP2 round-trip property test
 *  (testing/unit/external-image-id.test.ts, §4.11). Backward-compatible —
 *  no behaviour change; rationale in the results-doc methodology notes. */
export function encodeName(name: string): string {
  return Buffer.from(name, "utf8").toString("hex");
}

/** Decode a hex-encoded ExternalImageId back to the original name. */
export function decodeName(encoded: string): string {
  return Buffer.from(encoded, "hex").toString("utf8");
}

function getSimilarityThreshold(): number {
  const threshold = Number.isFinite(config.confidenceThreshold) ? config.confidenceThreshold : 0.5;
  return threshold <= 1 ? threshold * 100 : threshold;
}

async function ensureCollectionReady(): Promise<void> {
  if (collectionReadyPromise) {
    try {
      await collectionReadyPromise;
      return;
    } catch {
      // Previous attempt failed — reset and retry
      collectionReadyPromise = null;
    }
  }

  collectionReadyPromise = (async () => {
    try {
      await rekognition.send(new DescribeCollectionCommand({ CollectionId: collectionId }));
      logger.info(`Rekognition collection "${collectionId}" is ready`);
    } catch (error: any) {
      if (error?.name === "ResourceNotFoundException") {
        logger.warn(`Rekognition collection "${collectionId}" not found. Creating it now...`);
        try {
          await rekognition.send(new CreateCollectionCommand({ CollectionId: collectionId }));
          logger.info(`Rekognition collection "${collectionId}" created`);
        } catch (createError: any) {
          if (!(createError instanceof ResourceAlreadyExistsException)) {
            throw createError;
          }
        }
        return;
      }
      throw error;
    }
  })();

  await collectionReadyPromise;
}

/* ── Local photo & metadata storage ────────────────────── */

const facesDir = path.resolve(process.cwd(), "data", "faces");
const metadataPath = path.join(facesDir, "metadata.json");

interface FaceMetadata {
  [faceId: string]: { name: string; enrolledAt: string };
}

async function ensureFacesDir(): Promise<void> {
  await fs.mkdir(facesDir, { recursive: true });
}

async function readMetadata(): Promise<FaceMetadata> {
  try {
    const raw = await fs.readFile(metadataPath, "utf8");
    return JSON.parse(raw) as FaceMetadata;
  } catch {
    return {};
  }
}

async function writeMetadata(meta: FaceMetadata): Promise<void> {
  await ensureFacesDir();
  await fs.writeFile(metadataPath, JSON.stringify(meta, null, 2), "utf8");
}

async function saveFacePhoto(faceId: string, imageBase64: string): Promise<void> {
  await ensureFacesDir();
  const filePath = path.join(facesDir, `${faceId}.jpg`);
  await fs.writeFile(filePath, Buffer.from(imageBase64, "base64"));
  logger.info(`Saved enrollment photo to ${filePath}`);
}

/** Returns the absolute path to a face photo, or null if it doesn't exist. */
export function getFacePhotoPath(faceId: string): string {
  return path.join(facesDir, `${faceId}.jpg`);
}

/**
 * Ensures the Rekognition collection exists and is reachable.
 */
export async function loadPersistedFaces(): Promise<void> {
  try {
    await ensureCollectionReady();
  } catch (error) {
    logger.error("Failed to initialize Rekognition collection:", error);
    logger.warn("Face recognition will be unavailable until AWS credentials are configured correctly");
  }
}

/**
 * Recognizes a face in the given image by searching the Rekognition collection.
 */
export async function recognizeFace(imageBase64: string): Promise<FaceRecognitionResult> {
  await ensureCollectionReady();
  const threshold = getSimilarityThreshold();

  try {
    const response = await rekognition.send(new SearchFacesByImageCommand({
      CollectionId: collectionId,
      Image: { Bytes: Buffer.from(imageBase64, "base64") },
      MaxFaces: 1,
      FaceMatchThreshold: threshold,
    }));

    const bestMatch = response.FaceMatches?.[0];
    if (!bestMatch || !bestMatch.Face) {
      logger.info("No matching face found in Rekognition");
      return { name: null, confidence: 0, isKnown: false };
    }

    const confidence = (bestMatch.Similarity ?? 0) / 100;
    const faceId = bestMatch.Face.FaceId;
    const rawId = bestMatch.Face.ExternalImageId || null;

    // Prefer local metadata name (supports renames) over Rekognition's hex-encoded name
    let name: string | null = null;
    if (faceId) {
      const meta = await readMetadata();
      name = meta[faceId]?.name ?? (rawId ? decodeName(rawId) : null);
    } else {
      name = rawId ? decodeName(rawId) : null;
    }

    logger.info(`Matched ${name ?? "unknown"} with similarity=${(bestMatch.Similarity ?? 0).toFixed(2)}%`);
    return { name, confidence, isKnown: Boolean(name) };
  } catch (error: any) {
    // InvalidParameterException = no searchable face in image; other errors also non-fatal
    logger.warn(`Face search failed: ${error?.name ?? error?.message ?? error}`);
    return { name: null, confidence: 0, isKnown: false };
  }
}

/**
 * Enrolls a new face into the Rekognition collection with the provided name.
 * Saves the enrollment photo and metadata locally.
 * Returns the faceId on success, or null on failure.
 */
export async function enrollFace(name: string, imageBase64: string): Promise<string | null> {
  await ensureCollectionReady();
  const cleanedName = name.trim();
  if (!cleanedName) throw new Error("Name is required for face enrollment");

  logger.info(`Enrolling face for "${cleanedName}" into Rekognition collection "${collectionId}"`);

  const response = await rekognition.send(new IndexFacesCommand({
    CollectionId: collectionId,
    Image: { Bytes: Buffer.from(imageBase64, "base64") },
    ExternalImageId: encodeName(cleanedName),
    DetectionAttributes: [],
  }));

  const indexed = response.FaceRecords?.length ?? 0;
  if (indexed === 0) {
    const reasons = (response.UnindexedFaces ?? [])
      .flatMap((face) => face.Reasons ?? [])
      .join(", ");
    throw new Error(reasons ? `Face could not be indexed: ${reasons}` : "No face detected in the provided image");
  }

  const faceId = response.FaceRecords![0].Face?.FaceId;
  if (!faceId) {
    logger.warn("Face indexed but no FaceId returned");
    return null;
  }

  // Save photo and metadata locally
  await saveFacePhoto(faceId, imageBase64);
  const meta = await readMetadata();
  meta[faceId] = { name: cleanedName, enrolledAt: new Date().toISOString() };
  await writeMetadata(meta);

  logger.info(`Face enrolled successfully. FaceId=${faceId}`);
  return faceId;
}

/**
 * Lists all enrolled faces from the Rekognition collection.
 * Merges with local metadata for display names and photo availability.
 */
export async function listFaces(): Promise<Array<{ name: string; faceId: string; hasPhoto: boolean; enrolledAt: string | null }>> {
  await ensureCollectionReady();

  const meta = await readMetadata();
  const faces: Array<{ name: string; faceId: string; hasPhoto: boolean; enrolledAt: string | null }> = [];
  let nextToken: string | undefined;

  do {
    const response = await rekognition.send(
      new ListFacesCommand({
        CollectionId: collectionId,
        MaxResults: 100,
        NextToken: nextToken,
      })
    );

    for (const face of response.Faces ?? []) {
      if (face.FaceId && face.ExternalImageId) {
        // Local metadata name takes priority over Rekognition's hex-encoded name
        const localEntry = meta[face.FaceId];
        const name = localEntry?.name ?? decodeName(face.ExternalImageId);
        let hasPhoto = false;
        try {
          await fs.access(path.join(facesDir, `${face.FaceId}.jpg`));
          hasPhoto = true;
        } catch {}

        faces.push({ name, faceId: face.FaceId, hasPhoto, enrolledAt: localEntry?.enrolledAt ?? null });
      }
    }

    nextToken = response.NextToken;
  } while (nextToken);

  logger.info(`Listed ${faces.length} enrolled faces`);
  return faces;
}

/**
 * Renames an enrolled face in the local metadata.
 */
/**
 * Deletes a face from the Rekognition collection and removes local photo/metadata.
 */
export async function deleteFace(faceId: string): Promise<void> {
  await ensureCollectionReady();

  await rekognition.send(new DeleteFacesCommand({
    CollectionId: collectionId,
    FaceIds: [faceId],
  }));
  logger.info(`Deleted face ${faceId} from Rekognition`);

  // Remove local photo
  try {
    await fs.unlink(path.join(facesDir, `${faceId}.jpg`));
  } catch {}

  // Remove from metadata
  const meta = await readMetadata();
  delete meta[faceId];
  await writeMetadata(meta);
}

/**
 * Recognizes ALL faces in an image using DetectFaces + per-face SearchFacesByImage.
 * Returns an array of matches and the total number of faces detected.
 */
export async function recognizeAllFaces(imageBase64: string): Promise<MultiFaceResult> {
  await ensureCollectionReady();

  const imageBytes = Buffer.from(imageBase64, "base64");

  // Step 1: Detect all faces in the image
  let detectResponse;
  try {
    detectResponse = await rekognition.send(new DetectFacesCommand({
      Image: { Bytes: imageBytes },
      Attributes: ["DEFAULT"],
    }));
  } catch (error: any) {
    if (error?.name === "AccessDeniedException") {
      logger.warn("DetectFaces not permitted — falling back to single-face search");
      const result = await recognizeFace(imageBase64);
      return { faces: [result], totalDetected: 1 };
    }
    throw error;
  }

  const detectedFaces = detectResponse.FaceDetails ?? [];
  if (detectedFaces.length === 0) {
    logger.info("No faces detected in image");
    return { faces: [], totalDetected: 0 };
  }

  logger.info(`Detected ${detectedFaces.length} face(s) in image`);

  // Step 2: If single face, use the existing optimized path (no cropping needed)
  if (detectedFaces.length === 1) {
    try {
      const result = await recognizeFace(imageBase64);
      return {
        faces: [{ name: result.name, confidence: result.confidence, isKnown: result.isKnown }],
        totalDetected: 1,
      };
    } catch (error) {
      logger.warn("Single-face recognition failed:", error);
      return { faces: [{ name: null, confidence: 0, isKnown: false }], totalDetected: 1 };
    }
  }

  // Step 3: Multiple faces — crop each and search individually (cap at 10)
  const threshold = getSimilarityThreshold();
  const meta = await readMetadata();
  const facesToProcess = detectedFaces.slice(0, 10);

  const results = await Promise.allSettled(
    facesToProcess.map(async (face): Promise<FaceMatch> => {
      const box = face.BoundingBox;
      if (!box || !box.Left || !box.Top || !box.Width || !box.Height) {
        return { name: null, confidence: 0, isKnown: false };
      }

      // Skip faces with bounding boxes too small for Rekognition (< 40px estimated)
      if (box.Width < 0.03 || box.Height < 0.03) {
        logger.info("Skipping face with very small bounding box");
        return { name: null, confidence: 0, isKnown: false };
      }

      try {
        const croppedBase64 = await cropFace(imageBase64, {
          Left: box.Left, Top: box.Top, Width: box.Width, Height: box.Height,
        });

        const searchResponse = await rekognition.send(new SearchFacesByImageCommand({
          CollectionId: collectionId,
          Image: { Bytes: Buffer.from(croppedBase64, "base64") },
          MaxFaces: 1,
          FaceMatchThreshold: threshold,
        }));

        const bestMatch = searchResponse.FaceMatches?.[0];
        if (!bestMatch?.Face) {
          return { name: null, confidence: 0, isKnown: false };
        }

        const confidence = (bestMatch.Similarity ?? 0) / 100;
        const faceId = bestMatch.Face.FaceId;
        const rawId = bestMatch.Face.ExternalImageId || null;
        const name = faceId
          ? (meta[faceId]?.name ?? (rawId ? decodeName(rawId) : null))
          : (rawId ? decodeName(rawId) : null);

        return { name, confidence, isKnown: Boolean(name) };
      } catch (err) {
        logger.warn("Failed to search face in crop:", err);
        return { name: null, confidence: 0, isKnown: false };
      }
    })
  );

  const faces: FaceMatch[] = results.map(r =>
    r.status === "fulfilled" ? r.value : { name: null, confidence: 0, isKnown: false }
  );

  logger.info(`Multi-face recognition complete: ${faces.filter(f => f.isKnown).length} known, ${faces.filter(f => !f.isKnown).length} unknown`);
  return { faces, totalDetected: detectedFaces.length };
}

export async function renameFace(faceId: string, newName: string): Promise<void> {
  const cleanedName = newName.trim();
  if (!cleanedName) throw new Error("Name cannot be empty");

  const meta = await readMetadata();
  if (!meta[faceId]) {
    meta[faceId] = { name: cleanedName, enrolledAt: new Date().toISOString() };
  } else {
    meta[faceId].name = cleanedName;
  }
  await writeMetadata(meta);
  logger.info(`Renamed face ${faceId} to "${cleanedName}"`);
}
