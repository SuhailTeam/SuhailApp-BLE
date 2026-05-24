import type { Language } from "../i18n/messages";
import { postJson } from "./client";

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

interface ImagePayload {
  image: string;       // base64 jpeg
  language?: Language;
}

export function describeScene(image: string, language: Language, signal?: AbortSignal) {
  return postJson<VisionResponse>("/api/vision/scene", { image, language } satisfies ImagePayload, { signal });
}

export function ocr(image: string, language: Language, context?: string, signal?: AbortSignal) {
  return postJson<{ text: string }>("/api/vision/ocr", { image, language, context }, { signal });
}

export function recognizeCurrency(image: string, signal?: AbortSignal) {
  return postJson<CurrencyResult>("/api/vision/currency", { image }, { signal });
}

export function detectObject(image: string, target: string, language: Language, signal?: AbortSignal) {
  return postJson<ObjectResult>("/api/vision/object", { image, target, language }, { signal });
}

export function detectColor(image: string, language: Language, signal?: AbortSignal) {
  return postJson<ColorResult>("/api/vision/color", { image, language }, { signal });
}

export function answerVisualQuestion(image: string, question: string, language: Language, signal?: AbortSignal) {
  return postJson<VisionResponse>("/api/vision/vqa", { image, question, language }, { signal });
}
