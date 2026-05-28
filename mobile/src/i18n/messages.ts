/**
 * Bilingual message constants — copied verbatim from
 * SuhailApp/src/services/tts-service.ts so the BLE app speaks the same
 * phrases the cloud app does. When the server version changes, update both.
 */

export type Language = "ar" | "en";

export interface BilingualMessage {
  ar: string;
  en: string;
}

export const messages = {
  welcome: {
    ar: "سهيل جاهز. كيف أقدر أساعدك؟",
    en: "Suhail is ready. How can I help you?",
  },
  processing: {
    ar: "جاري المعالجة...",
    en: "Processing your request...",
  },
  cameraError: {
    ar: "الكاميرا غير متوفرة. حاول مرة ثانية.",
    en: "Camera not available. Please try again.",
  },
  generalError: {
    ar: "عذراً، ما قدرت أعالج طلبك. حاول مرة ثانية.",
    en: "Sorry, I couldn't process that. Please try again.",
  },
  noResult: {
    ar: "ما قدرت ألاقي نتيجة.",
    en: "I couldn't find a result.",
  },
  repeatNoHistory: {
    ar: "ما فيه رد سابق أعيده.",
    en: "There is no previous response to repeat.",
  },
  listening: {
    ar: "تفضل",
    en: "Listening",
  },
  received: {
    ar: "حسناً",
    en: "Got it",
  },
  cancelled: {
    ar: "تم الإلغاء",
    en: "Cancelled",
  },
  didntCatch: {
    ar: "لم أسمع، حاول مرة أخرى",
    en: "I didn't catch that, try again",
  },
  listeningTimeout: {
    ar: "انتهت مهلة الاستماع.",
    en: "Listening timed out.",
  },
  unknownCommand: {
    ar: "لم أفهم طلبك. يمكنني وصف المحيط، قراءة النصوص، التعرف على الوجوه، البحث عن أشياء، معرفة العملات، أو تحديد الألوان.",
    en: "I didn't understand that. I can describe your surroundings, read text, recognize faces, find objects, identify currency, or detect colors.",
  },
  permissionError: {
    ar: "يرجى تفعيل صلاحيات الكاميرا والميكروفون في تطبيق منترا.",
    en: "Please enable camera and microphone permissions in the Mentra app.",
  },
  noMoney: {
    ar: "ما أشوف فلوس في الصورة.",
    en: "I don't see any money in the image.",
  },
  unknownCurrency: {
    ar: "أشوف فلوس بس ما قدرت أعرف نوع العملة.",
    en: "I see money but couldn't identify the currency.",
  },
  // Mobile-only — pairing / connection screens
  scanForGlasses: {
    ar: "ابحث عن نظارة",
    en: "Scan for glasses",
  },
  scanning: {
    ar: "جاري البحث...",
    en: "Scanning...",
  },
  noGlassesFound: {
    ar: "ما لقيت أي نظارة قريبة.",
    en: "No glasses found nearby.",
  },
  connect: {
    ar: "اتصل",
    en: "Connect",
  },
  disconnect: {
    ar: "اقطع الاتصال",
    en: "Disconnect",
  },
  connected: {
    ar: "متصل",
    en: "Connected",
  },
  disconnected: {
    ar: "غير متصل",
    en: "Disconnected",
  },
} satisfies Record<string, BilingualMessage>;

export function localize(message: BilingualMessage, language: Language): string {
  return message[language];
}
