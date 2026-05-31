import type { Language } from "../types";

export const OCR_MAX_CHARS = 400;

const TRUNCATION_SUFFIX = {
  ar: " وغيره. اسحب للأمام للإيقاف.",
  en: " ...and more. Swipe forward to stop.",
} as const;

export function normalizeOcrText(text: string): string {
  return text.replace(/\n+/g, " ").replace(/\s{2,}/g, " ").trim();
}

export function formatOcrSpeech(text: string, language: Language): string {
  const cleaned = normalizeOcrText(text);
  return cleaned.length > OCR_MAX_CHARS
    ? cleaned.slice(0, OCR_MAX_CHARS).trim() + TRUNCATION_SUFFIX[language]
    : cleaned;
}
