import { getJson, postJson } from "./client";

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

export function recognizeFace(image: string, signal?: AbortSignal) {
  return postJson<FaceMatch>("/api/faces/recognize", { image }, { signal });
}

export function recognizeAllFaces(image: string, signal?: AbortSignal) {
  return postJson<MultiFaceResult>("/api/faces/recognize-all", { image }, { signal });
}

export function enrollFace(image: string, name: string, signal?: AbortSignal) {
  return postJson<EnrollResult>("/api/faces/enroll", { image, name }, { signal });
}

/** Lists all enrolled faces (uses the existing open /api/faces GET endpoint). */
export function listFaces(signal?: AbortSignal) {
  return getJson<{ faces: EnrolledFace[]; count: number }>("/api/faces", { signal });
}
