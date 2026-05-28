import { getJson, postJson } from "./client";
import type { ImageSource } from "./vision";

export interface FaceMatch {
  name: string | null;
  confidence: number;
  isKnown: boolean;
}

export interface MultiFaceResult {
  faces: FaceMatch[];
  totalDetected: number;
}

export interface EnrollResult {
  faceId: string;
  name: string;
  enrolledAt: string;
}

export interface EnrolledFace {
  name: string;
  faceId: string;
  hasPhoto: boolean;
  enrolledAt: string | null;
}

export function recognizeFace(source: ImageSource, signal?: AbortSignal) {
  return postJson<FaceMatch>("/api/faces/recognize", { ...source }, { signal });
}

export function recognizeAllFaces(source: ImageSource, signal?: AbortSignal) {
  return postJson<MultiFaceResult>("/api/faces/recognize-all", { ...source }, { signal });
}

export function enrollFace(source: ImageSource, name: string, signal?: AbortSignal) {
  return postJson<EnrollResult>("/api/faces/enroll", { ...source, name }, { signal });
}

/** Lists all enrolled faces (uses the existing open /api/faces GET endpoint). */
export function listFaces(signal?: AbortSignal) {
  return getJson<{ faces: EnrolledFace[]; count: number }>("/api/faces", { signal });
}
