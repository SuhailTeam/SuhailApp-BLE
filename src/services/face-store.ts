import * as fs from "node:fs/promises";
import path from "node:path";
import { SQL } from "bun";
import { config } from "../utils/config";
import { Logger } from "../utils/logger";

/**
 * Durable storage for face PHOTOS + metadata (name, enrolledAt), keyed by the
 * Rekognition FaceId. The recognition vectors themselves live in AWS
 * Rekognition (see face-service.ts); this module owns only the data the
 * Contacts screen displays.
 *
 * Two backends, picked at runtime by whether DATABASE_URL is set:
 *   • Postgres (Railway) — durable across redeploys; the production path.
 *   • Local filesystem (data/faces/) — the offline/dev + CI fallback, identical
 *     to the original behaviour, so the suite runs with no database.
 *
 * Railway injects DATABASE_URL via a Postgres reference variable. Bun 1.3 ships
 * a native Postgres client (Bun.SQL), so no npm dependency is needed.
 */

const logger = new Logger("FaceStore");

const usePg = Boolean(config.databaseUrl);

export interface FaceRow {
  name: string;
  enrolledAt: string | null;
  hasPhoto: boolean;
}

/* ── Postgres backend ──────────────────────────────────── */

let sqlClient: SQL | null = null;
/** Lazily construct the client so importing this module never opens a socket. */
function db(): SQL {
  if (!sqlClient) sqlClient = new SQL(config.databaseUrl);
  return sqlClient;
}

/* ── Filesystem backend (fallback / local dev) ─────────── */

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
    return JSON.parse(await fs.readFile(metadataPath, "utf8")) as FaceMetadata;
  } catch {
    return {};
  }
}

async function writeMetadata(meta: FaceMetadata): Promise<void> {
  await ensureFacesDir();
  await fs.writeFile(metadataPath, JSON.stringify(meta, null, 2), "utf8");
}

function facePhotoPath(faceId: string): string {
  return path.join(facesDir, `${faceId}.jpg`);
}

/* ── Public API ────────────────────────────────────────── */

/**
 * Prepares the active backend. Never throws — a storage outage should degrade
 * to "no photos", not crash the server (mirrors loadPersistedFaces).
 */
export async function initFaceStore(): Promise<void> {
  try {
    if (usePg) {
      await db()`
        CREATE TABLE IF NOT EXISTS faces (
          face_id     TEXT PRIMARY KEY,
          name        TEXT NOT NULL,
          enrolled_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          photo       BYTEA
        )
      `;
      logger.info("Face store ready (Postgres)");
    } else {
      await ensureFacesDir();
      logger.info("Face store ready (local filesystem — set DATABASE_URL for durable storage)");
    }
  } catch (error) {
    logger.error("Failed to initialize face store:", error);
    logger.warn("Face photo/metadata persistence may be unavailable");
  }
}

/** Insert or update a face's name + photo. Leaves enrolled_at untouched on update. */
export async function upsertFace(faceId: string, name: string, photo: Buffer): Promise<void> {
  if (usePg) {
    await db()`
      INSERT INTO faces (face_id, name, photo)
      VALUES (${faceId}, ${name}, ${photo})
      ON CONFLICT (face_id) DO UPDATE SET name = EXCLUDED.name, photo = EXCLUDED.photo
    `;
    return;
  }
  await ensureFacesDir();
  await fs.writeFile(facePhotoPath(faceId), photo);
  const meta = await readMetadata();
  meta[faceId] = { name, enrolledAt: meta[faceId]?.enrolledAt ?? new Date().toISOString() };
  await writeMetadata(meta);
}

/** Display name for a single faceId, or null if we have no record. */
export async function getName(faceId: string): Promise<string | null> {
  if (usePg) {
    const rows: any[] = await db()`SELECT name FROM faces WHERE face_id = ${faceId}`;
    return rows.length ? (rows[0].name as string) : null;
  }
  const meta = await readMetadata();
  return meta[faceId]?.name ?? null;
}

/** faceId → name for every stored face (one round trip; used by multi-face recognition). */
export async function getNameMap(): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (usePg) {
    const rows: any[] = await db()`SELECT face_id, name FROM faces`;
    for (const r of rows) map.set(r.face_id, r.name);
    return map;
  }
  const meta = await readMetadata();
  for (const [id, v] of Object.entries(meta)) map.set(id, v.name);
  return map;
}

/** faceId → full row (name, enrolledAt, hasPhoto) for the Contacts list merge. */
export async function getRowMap(): Promise<Map<string, FaceRow>> {
  const map = new Map<string, FaceRow>();
  if (usePg) {
    const rows: any[] = await db()`
      SELECT face_id, name, enrolled_at, (photo IS NOT NULL) AS has_photo FROM faces
    `;
    for (const r of rows) {
      map.set(r.face_id, {
        name: r.name,
        enrolledAt: r.enrolled_at ? new Date(r.enrolled_at).toISOString() : null,
        hasPhoto: Boolean(r.has_photo),
      });
    }
    return map;
  }
  const meta = await readMetadata();
  for (const [id, v] of Object.entries(meta)) {
    let hasPhoto = false;
    try {
      await fs.access(facePhotoPath(id));
      hasPhoto = true;
    } catch {}
    map.set(id, { name: v.name, enrolledAt: v.enrolledAt ?? null, hasPhoto });
  }
  return map;
}

/** Raw JPEG bytes for a face, or null if none stored. */
export async function getFacePhoto(faceId: string): Promise<Buffer | null> {
  if (usePg) {
    const rows: any[] = await db()`SELECT photo FROM faces WHERE face_id = ${faceId}`;
    const photo = rows.length ? rows[0].photo : null;
    if (!photo) return null;
    return Buffer.isBuffer(photo) ? photo : Buffer.from(photo);
  }
  try {
    return await fs.readFile(facePhotoPath(faceId));
  } catch {
    return null;
  }
}

/** Rename a face. Upserts so a rename works even on a face that predates the store. */
export async function renameFaceRow(faceId: string, name: string): Promise<void> {
  if (usePg) {
    await db()`
      INSERT INTO faces (face_id, name) VALUES (${faceId}, ${name})
      ON CONFLICT (face_id) DO UPDATE SET name = EXCLUDED.name
    `;
    return;
  }
  const meta = await readMetadata();
  if (!meta[faceId]) meta[faceId] = { name, enrolledAt: new Date().toISOString() };
  else meta[faceId].name = name;
  await writeMetadata(meta);
}

/** Remove a face's metadata + photo. (Rekognition deletion is handled separately.) */
export async function deleteFaceRow(faceId: string): Promise<void> {
  if (usePg) {
    await db()`DELETE FROM faces WHERE face_id = ${faceId}`;
    return;
  }
  try {
    await fs.unlink(facePhotoPath(faceId));
  } catch {}
  const meta = await readMetadata();
  delete meta[faceId];
  await writeMetadata(meta);
}
