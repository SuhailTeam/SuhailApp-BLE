import type { Language } from "../i18n/messages";
import { postJson } from "./client";

/**
 * Vision/face endpoints accept EITHER a base64 image directly OR a photoToken
 * (minted via /api/photo/upload-url, populated by the glasses BLE upload).
 * For BLE-flow commands always pass `{ photoToken }` — no base64 hop on phone.
 */
export type ImageSource = { image: string } | { photoToken: string };

export interface VisionResponse {
  description: string;
  confidence: number;
}

export interface CurrencyBill {
  denomination: number;
  count: number;
}

export interface CurrencyResult {
  bills: CurrencyBill[];
  total: number;
  currency: string;
  otherCurrencies?: Array<{ currency: string; bills: CurrencyBill[]; total: number }>;
  confidence: number;
}

export interface ObjectResult {
  found: boolean;
  location: string;
  confidence: number;
}

export interface ColorResult {
  colorName: string;
  hex: string;
}

export function describeScene(source: ImageSource, language: Language, signal?: AbortSignal) {
  return postJson<VisionResponse>("/api/vision/scene", { ...source, language }, { signal });
}

export function ocr(source: ImageSource, language: Language, context?: string, signal?: AbortSignal) {
  return postJson<{ text: string }>("/api/vision/ocr", { ...source, language, context }, { signal });
}

export function recognizeCurrency(source: ImageSource, signal?: AbortSignal) {
  return postJson<CurrencyResult>("/api/vision/currency", { ...source }, { signal });
}

export function detectObject(source: ImageSource, target: string, language: Language, signal?: AbortSignal) {
  return postJson<ObjectResult>("/api/vision/object", { ...source, target, language }, { signal });
}

export function detectColor(source: ImageSource, language: Language, signal?: AbortSignal) {
  return postJson<ColorResult>("/api/vision/color", { ...source, language }, { signal });
}

export function answerVisualQuestion(source: ImageSource, question: string, language: Language, signal?: AbortSignal) {
  return postJson<VisionResponse>("/api/vision/vqa", { ...source, question, language }, { signal });
}
