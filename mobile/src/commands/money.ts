import { resolvePhoto, type CapturedPhoto } from "../ble/camera";
import { recognizeCurrency, type CurrencyBill, type CurrencyResult } from "../relay/vision";
import type { Language } from "../i18n/messages";
import { Logger } from "../utils/logger";

const logger = new Logger("Cmd.Money");

const NO_MONEY_MESSAGE = {
  ar: "ما أشوف فلوس في الصورة.",
  en: "I don't see any money in the image.",
} as const;

const UNKNOWN_CURRENCY_MESSAGE = {
  ar: "أشوف فلوس بس ما قدرت أعرف نوع العملة.",
  en: "I see money but couldn't identify the currency.",
} as const;

/**
 * Currency-recognize command — mirrors src/commands/currency-recognize.ts.
 * Captures a photo, counts every visible bill grouped by denomination, and
 * speaks a per-language summary including totals and any other currencies
 * present in the same photo.
 *
 * Phrasing matches the cloud version byte-for-byte so users hear the same
 * sentences they'd hear from the cloud app — particularly the Arabic plural
 * forms (ورقة / ورقتين / ورقات) and English natural list joining
 * ("X and Y", "X, Y, and Z").
 */
export async function executeMoney(opts: {
  language: Language;
  signal?: AbortSignal;
  preCapture?: Promise<CapturedPhoto> | null;
}): Promise<string> {
  const { language, signal, preCapture } = opts;

  const photo = await resolvePhoto({ preCapture, signal });
  if (signal?.aborted) throw new Error("aborted");

  const result = await recognizeCurrency({ photoToken: photo.photoToken }, signal);
  logger.info(`${result.bills.length} denomination(s), total ${result.total} ${result.currency}`);

  if (result.bills.length === 0) {
    return NO_MONEY_MESSAGE[language];
  }
  if (result.currency === "UNKNOWN") {
    return UNKNOWN_CURRENCY_MESSAGE[language];
  }

  return language === "ar"
    ? composeAr(result.bills, result.total, result.currency, result.otherCurrencies)
    : composeEn(result.bills, result.total, result.currency, result.otherCurrencies);
}

/* ── Per-currency word forms ─────────────────────────────────────────────── */

function unitAr(currency: string): string {
  return currency === "SAR" ? "ريال" : currency === "USD" ? "دولار" : currency;
}
function unitEn(currency: string): string {
  return currency === "SAR" ? "Saudi Riyal" : currency === "USD" ? "dollar" : currency;
}

function describeBillAr(b: CurrencyBill, currency: string): string {
  const u = unitAr(currency);
  if (b.count === 1) return `ورقة ${b.denomination} ${u}`;
  if (b.count === 2) return `ورقتين ${b.denomination} ${u}`;
  return `${b.count} ورقات من فئة ${b.denomination} ${u}`;
}
function describeBillEn(b: CurrencyBill, currency: string): string {
  const u = unitEn(currency);
  const noun = b.count === 1 ? "bill" : "bills";
  return `${b.count} ${b.denomination} ${u} ${noun}`;
}

function joinEn(parts: string[]): string {
  if (parts.length <= 1) return parts.join("");
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}`;
}

/* ── Composition ─────────────────────────────────────────────────────────── */

type OtherCurrencies = NonNullable<CurrencyResult["otherCurrencies"]>;

function composeAr(
  bills: CurrencyBill[],
  total: number,
  currency: string,
  otherCurrencies: OtherCurrencies | undefined,
): string {
  const u = unitAr(currency);
  // Single-bill happy path — preserve the cloud version's phrasing
  if (bills.length === 1 && bills[0]!.count === 1) {
    let text = `هذي ورقة ${bills[0]!.denomination} ${u}`;
    if (otherCurrencies?.length) text += `. ${otherTailAr(otherCurrencies)}`;
    return text;
  }
  const parts = bills.map(b => describeBillAr(b, currency)).join(" و ");
  let text = `معك ${parts}، المجموع ${total} ${u}`;
  if (otherCurrencies?.length) text += `. ${otherTailAr(otherCurrencies)}`;
  return text;
}

function composeEn(
  bills: CurrencyBill[],
  total: number,
  currency: string,
  otherCurrencies: OtherCurrencies | undefined,
): string {
  const u = unitEn(currency);
  if (bills.length === 1 && bills[0]!.count === 1) {
    let text = `This is a ${bills[0]!.denomination} ${u} bill`;
    if (otherCurrencies?.length) text += `. ${otherTailEn(otherCurrencies)}`;
    return text;
  }
  const parts = bills.map(b => describeBillEn(b, currency));
  let text = `You have ${joinEn(parts)}, total ${total} ${u}`;
  if (otherCurrencies?.length) text += `. ${otherTailEn(otherCurrencies)}`;
  return text;
}

function otherTailAr(others: OtherCurrencies): string {
  const phrases = others.map(o => o.bills.map(b => describeBillAr(b, o.currency)).join(" و "));
  return `وأيضًا ${phrases.join(". ")}`;
}
function otherTailEn(others: OtherCurrencies): string {
  const phrases = others.map(o => joinEn(o.bills.map(b => describeBillEn(b, o.currency))));
  return `Also ${phrases.join(". ")}`;
}
