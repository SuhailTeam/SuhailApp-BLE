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
    scan: { ar: "البحث عن النظارة", en: "Scan for glasses" },
    connect: { ar: "الاتصال بالنظارة المحفوظة", en: "Connect to saved glasses" },
    disconnect: { ar: "قطع الاتصال", en: "Disconnect" },
    forget: { ar: "إلغاء حفظ النظارة", en: "Forget glasses" },
    battery: { ar: "البطارية", en: "Battery" },
    charging: { ar: "يشحن", en: "Charging" },
    firmware: { ar: "الإصدار", en: "Firmware" },
    device: { ar: "الجهاز", en: "Device" },
    commandsTitle: { ar: "الأوامر الصوتية", en: "Voice commands" },
    commandsBody: {
      ar: "اسحب للأمام على النظارة، ثم تكلّم: «صف ما حولي»، «اقرأ»، «من هذا؟»، «ابحث عن مفاتيحي»، «عدّ النقود»، «اللون».",
      en: 'Swipe forward on the glasses, then speak: "describe my surroundings", "read this", "who is this?", "find my keys", "count money", "color".',
    },
    listenTitle: { ar: "حالة الاستماع", en: "Listening status" },
    testListening: { ar: "تجربة الاستماع", en: "Test listening" },
    testRepeat: { ar: "تكرار آخر رد", en: "Repeat last" },
    listenIdle: { ar: "خامل", en: "Idle" },
    listenActive: { ar: "ينصت", en: "Listening" },
    listenProcessing: { ar: "يعالج", en: "Processing" },
    found: { ar: "النتائج", en: "Found" },
  },
  contacts: {
    empty: {
      ar: "لا يوجد أشخاص محفوظون بعد. اطلب من سهيل: «سجّل هذا الشخص».",
      en: 'No contacts saved yet. Tell Suhail: "enroll this person".',
    },
    retry: { ar: "إعادة المحاولة", en: "Retry" },
    rename: { ar: "إعادة تسمية", en: "Rename" },
    delete: { ar: "حذف", en: "Delete" },
    save: { ar: "حفظ", en: "Save" },
    cancel: { ar: "إلغاء", en: "Cancel" },
    renameTitle: { ar: "إعادة التسمية", en: "Rename contact" },
    namePlaceholder: { ar: "الاسم", en: "Name" },
    deleteTitle: { ar: "حذف الشخص", en: "Delete contact" },
    failed: { ar: "فشلت العملية. يرجى المحاولة مرة أخرى.", en: "That didn't work. Please try again." },
  },
  activity: {
    empty: { ar: "لا يوجد نشاط مسجل بعد.", en: "No activity yet." },
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
    themeLight: { ar: "فاتح", en: "Light" },
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
    testingSection: { ar: "الاختبار", en: "Testing" },
    usabilityTest: { ar: "وضع اختبار الاستخدام", en: "Usability test mode" },
  },
  usability: {
    title: { ar: "اختبار قابلية الاستخدام", en: "Usability test" },
    intro: {
      ar: "اختر المهمة الحالية قبل كل سيناريو. يسجّل التطبيق تلقائياً زمن «إيقاظ النظارة حتى بدء نطق النتيجة» لكل أمر. صدّر CSV والصقه في جدول البيانات.",
      en: "Pick the active task before each scenario. The app auto-records, per command, the time from wake to the glasses starting to speak. Export the CSV and paste it into the data sheet.",
    },
    activeTask: { ar: "المهمة الحالية", en: "Active task" },
    invocations: { ar: "محاولات هذه المهمة", en: "Invocations this task" },
    recoveries: { ar: "مرات إعادة المحاولة", en: "Error recoveries" },
    lastFirstWord: { ar: "زمن الاستجابة (من نهاية الكلام)", en: "Response time (end of speech)" },
    totalRows: { ar: "إجمالي السجلات", en: "Total rows recorded" },
    export: { ar: "تصدير CSV", en: "Export CSV" },
    clear: { ar: "مسح الجلسة", en: "Clear session" },
    clearTitle: { ar: "مسح بيانات الجلسة", en: "Clear session data" },
    clearMsg: {
      ar: "حذف كل السجلات المسجَّلة؟ افعل هذا بين المشاركين.",
      en: "Delete all recorded rows? Do this between participants.",
    },
    cancel: { ar: "إلغاء", en: "Cancel" },
    nothingToExport: { ar: "لا توجد سجلات للتصدير بعد.", en: "No rows to export yet." },
    shareTitle: { ar: "بيانات اختبار سهيل", en: "Suhail usability data" },
    notice: { ar: "ملاحظة", en: "Notice" },
    // The 8 task scenarios (counterbalance the order per participant). Full
    // verbal prompts live in the Protocol & Scripts doc; these are short labels.
    tasks: [
      { ar: "وصف المكان", en: "Describe the scene" },
      { ar: "قراءة نص", en: "Read text" },
      { ar: "التعرف على شخص", en: "Recognize a person" },
      { ar: "تسجيل شخص", en: "Enroll a person" },
      { ar: "إيجاد غرض", en: "Find an object" },
      { ar: "تمييز العملة", en: "Recognize currency" },
      { ar: "سؤال بصري", en: "Visual question" },
      { ar: "تمييز اللون", en: "Detect a color" },
    ] as Bi[],
  },
  onboarding: {
    welcomeTitle: { ar: "مرحبًا بك في سهيل", en: "Welcome to Suhail" },
    welcomeBody: {
      ar: "رفيقك الذكي الذي يُبصر لك تفاصيل العالم من خلال نظارة منترا. تحكّم بكل شيء بصوتك.",
      en: "Your AI assistant that describes the world through Mentra glasses — all by voice.",
    },
    getStarted: { ar: "ابدأ الآن", en: "Get started" },
    permsTitle: { ar: "صلاحيات الوصول", en: "Permissions" },
    permsBody: {
      ar: "لربط سهيل بنظارتك وتلقّي أوامرك الصوتية، يرجى تفعيل صلاحيات البلوتوث والميكروفون. سنطلب منك الإذن عند أول استخدام.",
      en: "Suhail needs Bluetooth to connect to your glasses and the microphone to hear your commands. The system will ask for permission on first use.",
    },
    continue: { ar: "السماح والمتابعة", en: "Continue" },
    pairTitle: { ar: "ربط النظارة", en: "Pair your glasses" },
    pairBody: {
      ar: "يرجى التأكد من أن النظارة مشحونة وقريبة، ثم ابدأ البحث.",
      en: "Make sure your glasses are charged and nearby, then scan.",
    },
    pairedTitle: { ar: "تم الاتصال بنجاح", en: "Connected successfully" },
    scanning: { ar: "جاري البحث...", en: "Scanning…" },
    noDevices: {
      ar: "لم يتم العثور على أي نظارة قريبة. يرجى التأكد من تشغيلها.",
      en: "No glasses found nearby. Make sure they're powered on.",
    },
    skip: { ar: "التخطي الآن", en: "Skip for now" },
    doneTitle: { ar: "كل شيء جاهز", en: "You're all set" },
    doneBody: {
      ar: "اسحب للأمام على النظارة وتحدّث لتبدأ. يمكنك تغيير الإعدادات في أي وقت.",
      en: "Swipe forward on the glasses and speak to begin. You can change settings any time.",
    },
    finish: { ar: "ابدأ الآن", en: "Start using Suhail" },
    back: { ar: "العودة", en: "Back" },
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
