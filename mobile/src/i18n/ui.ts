/**
 * Bilingual UI strings for the on-screen companion app (tabs, screens,
 * onboarding, appearance controls, and screen-reader announcements).
 *
 * SEPARATE from `messages.ts` on purpose: `messages.ts` holds the SPOKEN phrases
 * copied verbatim from the server and read by the pre-bundled-phrase generator
 * (`BUNDLED_PHRASE_KEYS = keyof typeof messages`). UI strings must not widen that
 * union, so they live here. Reuse only the `Language` type from messages.
 */
import { useSettings } from "../state/settings";
import type { Language } from "./messages";

export interface Bi {
  ar: string;
  en: string;
}

/** Translate a bilingual leaf with an explicit language. */
export function t(entry: Bi, lang: Language): string {
  return entry[lang];
}

export const ui = {
  tabs: {
    home: { ar: "الرئيسية", en: "Home" },
    contacts: { ar: "الأشخاص", en: "Contacts" },
    activity: { ar: "النشاط", en: "Activity" },
    settings: { ar: "الإعدادات", en: "Settings" },
  },
  home: {
    statusTitle: { ar: "النظارة", en: "Glasses" },
    connected: { ar: "متصل", en: "Connected" },
    disconnected: { ar: "غير متصل", en: "Disconnected" },
    connecting: { ar: "جاري الاتصال...", en: "Connecting…" },
    scan: { ar: "ابحث عن النظارة", en: "Scan for glasses" },
    connect: { ar: "اتصل بالنظارة المحفوظة", en: "Connect to saved glasses" },
    disconnect: { ar: "اقطع الاتصال", en: "Disconnect" },
    forget: { ar: "انسَ النظارة", en: "Forget glasses" },
    battery: { ar: "البطارية", en: "Battery" },
    charging: { ar: "يشحن", en: "Charging" },
    firmware: { ar: "الإصدار", en: "Firmware" },
    device: { ar: "الجهاز", en: "Device" },
    commandsTitle: { ar: "الأوامر الصوتية", en: "Voice commands" },
    commandsBody: {
      ar: "اسحب للأمام على النظارة، ثم تكلم: «صف ما حولي»، «اقرأ»، «من هذا؟»، «ابحث عن مفاتيحي»، «عدّ النقود»، «اللون».",
      en: 'Swipe forward on the glasses, then speak: "describe my surroundings", "read this", "who is this?", "find my keys", "count money", "color".',
    },
    listenTitle: { ar: "حالة الاستماع", en: "Listening status" },
    testListening: { ar: "جرب الاستماع", en: "Test listening" },
    testRepeat: { ar: "كرر آخر رد", en: "Repeat last" },
    listenIdle: { ar: "خامل", en: "Idle" },
    listenActive: { ar: "ينصت", en: "Listening" },
    listenProcessing: { ar: "يعالج", en: "Processing" },
    found: { ar: "النتائج", en: "Found" },
  },
  contacts: {
    empty: {
      ar: "ما فيه أشخاص محفوظين بعد. اطلب من سهيل: «سجل هذا الشخص».",
      en: 'No contacts saved yet. Tell Suhail: "enroll this person".',
    },
    retry: { ar: "أعد المحاولة", en: "Retry" },
    rename: { ar: "إعادة تسمية", en: "Rename" },
    delete: { ar: "حذف", en: "Delete" },
    save: { ar: "حفظ", en: "Save" },
    cancel: { ar: "إلغاء", en: "Cancel" },
    renameTitle: { ar: "إعادة التسمية", en: "Rename contact" },
    namePlaceholder: { ar: "الاسم", en: "Name" },
    deleteTitle: { ar: "حذف الشخص", en: "Delete contact" },
    failed: { ar: "فشلت العملية. حاول مرة ثانية.", en: "That didn't work. Please try again." },
  },
  activity: {
    empty: { ar: "ما فيه نشاط بعد.", en: "No activity yet." },
    title: { ar: "سجل النشاط", en: "Activity log" },
    types: {
      system: { ar: "النظام", en: "System" },
      command: { ar: "أمر", en: "Command" },
      ble: { ar: "بلوتوث", en: "Bluetooth" },
      error: { ar: "خطأ", en: "Error" },
    },
  },
  settings: {
    voiceSection: { ar: "الصوت", en: "Voice output" },
    appearanceSection: { ar: "المظهر وإمكانية الوصول", en: "Appearance & accessibility" },
    language: { ar: "اللغة", en: "Language" },
    arabic: { ar: "العربية", en: "Arabic" },
    english: { ar: "English", en: "English" },
    speechSpeed: { ar: "سرعة الكلام", en: "Speech speed" },
    volume: { ar: "مستوى الصوت", en: "Volume" },
    voice: { ar: "نبرة الصوت", en: "Voice" },
    voiceDefault: { ar: "افتراضي", en: "Default" },
    voiceMale: { ar: "ذكر", en: "Male" },
    voiceFemale: { ar: "أنثى", en: "Female" },
    theme: { ar: "السمة", en: "Theme" },
    themeDark: { ar: "داكن", en: "Dark" },
    themeHighContrast: { ar: "تباين عالٍ", en: "High contrast" },
    textSize: { ar: "حجم النص", en: "Text size" },
    reset: { ar: "إعادة الضبط", en: "Reset to defaults" },
    restartTitle: { ar: "إعادة التشغيل مطلوبة", en: "Restart required" },
    restartMsg: {
      ar: "لتغيير اتجاه التخطيط، أغلق التطبيق وافتحه من جديد.",
      en: "To change the layout direction, fully close and reopen the app.",
    },
    ok: { ar: "حسناً", en: "OK" },
  },
  onboarding: {
    welcomeTitle: { ar: "أهلاً بك في سهيل", en: "Welcome to Suhail" },
    welcomeBody: {
      ar: "مساعدك الذكي الذي يصف لك العالم من خلال نظارة منترا. كل شيء بالصوت.",
      en: "Your AI assistant that describes the world through Mentra glasses — all by voice.",
    },
    getStarted: { ar: "لنبدأ", en: "Get started" },
    permsTitle: { ar: "الأذونات", en: "Permissions" },
    permsBody: {
      ar: "يحتاج سهيل إلى البلوتوث للاتصال بالنظارة، والميكروفون لسماع أوامرك. سيطلب النظام الإذن عند أول استخدام.",
      en: "Suhail needs Bluetooth to connect to your glasses and the microphone to hear your commands. The system will ask for permission on first use.",
    },
    continue: { ar: "متابعة", en: "Continue" },
    pairTitle: { ar: "وصّل نظارتك", en: "Pair your glasses" },
    pairBody: {
      ar: "تأكد أن النظارة مشحونة وقريبة، ثم ابحث عنها.",
      en: "Make sure your glasses are charged and nearby, then scan.",
    },
    pairedTitle: { ar: "تم الاتصال بنجاح", en: "Connected successfully" },
    scanning: { ar: "جاري البحث...", en: "Scanning…" },
    noDevices: {
      ar: "ما لقيت نظارة قريبة. تأكد أنها مشغّلة.",
      en: "No glasses found nearby. Make sure they're powered on.",
    },
    skip: { ar: "تخطَّ الآن", en: "Skip for now" },
    doneTitle: { ar: "كل شيء جاهز", en: "You're all set" },
    doneBody: {
      ar: "اسحب للأمام على النظارة وتكلم لتبدأ. يمكنك تغيير الإعدادات في أي وقت.",
      en: "Swipe forward on the glasses and speak to begin. You can change settings any time.",
    },
    finish: { ar: "ابدأ استخدام سهيل", en: "Start using Suhail" },
    back: { ar: "رجوع", en: "Back" },
    next: { ar: "التالي", en: "Next" },
  },
  a11y: {
    connected: { ar: "تم الاتصال بالنظارة", en: "Connected to glasses" },
    disconnected: { ar: "انقطع الاتصال بالنظارة", en: "Glasses disconnected" },
    listening: { ar: "ينصت", en: "Listening" },
    processing: { ar: "يعالج", en: "Processing" },
    appBusy: { ar: "جارٍ العمل", en: "Working" },
  },
};

/**
 * Interpolated strings (need a runtime value). Kept separate from `ui` so every
 * leaf in `ui` stays a plain `Bi` and `t()` typechecks cleanly. Access as
 * `uiFn.deleteMsg[lang](name)`.
 */
export const uiFn = {
  deleteMsg: {
    ar: (name: string) => `حذف «${name}»؟ لا يمكن التراجع.`,
    en: (name: string) => `Delete "${name}"? This can't be undone.`,
  },
  renameA11y: {
    ar: (name: string) => `إعادة تسمية ${name}`,
    en: (name: string) => `Rename ${name}`,
  },
  deleteA11y: {
    ar: (name: string) => `حذف ${name}`,
    en: (name: string) => `Delete ${name}`,
  },
  stepOf: {
    ar: (n: number, total: number) => `الخطوة ${n} من ${total}`,
    en: (n: number, total: number) => `Step ${n} of ${total}`,
  },
  foundCount: {
    ar: (n: number) => `${n} نتيجة`,
    en: (n: number) => `${n} found`,
  },
  batteryPercent: {
    ar: (pct: string) => `البطارية ${pct} بالمئة`,
    en: (pct: string) => `Battery ${pct} percent`,
  },
};

/**
 * Hook: returns the current language and a bound translator. Screens do:
 *   const { t: tr, lang } = useUi();
 *   tr(ui.home.scan);                 // plain strings
 *   uiFn.deleteMsg[lang](name);       // interpolated strings
 */
export function useUi(): { lang: Language; t: (entry: Bi) => string } {
  const lang = useSettings((s) => s.language);
  return { lang, t: (entry: Bi) => entry[lang] };
}
