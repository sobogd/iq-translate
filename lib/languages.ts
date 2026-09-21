// Languages the translator offers, and the only ones it accepts: the topic
// pair, the language cookie and the widget's picker all validate against this
// list (see app/_landing/Translator.tsx and lib/cookies.ts), so an entry here
// is a promise that the translation model can actually handle the language.
//
// It once carried all 183 ISO 639-1 codes, and that promise was false for the
// tail: measured against the local model, 20 of those languages got answers in
// a different language entirely (Avestan came back in Kazakh, Lao in Thai,
// Sichuan Yi in Chinese) and 16 more were guesswork. Those 36 are gone. The two
// better-known names that also went are only absent for the same reason — the
// model translates them badly, not because they are small.
//
// The list is a superset of lib/locales.ts (the 34 locales with SEO content):
// every locale here is a language the widget can preset, but the widget offers
// more than the site has landing pages for, and that is deliberate — a visitor
// can translate any pair of these languages, and only some of them have their
// own page.
export interface Language {
  code: string;
  nameRu: string;
  nameNative: string;
  flag: string;
}

export const LANGUAGES: Language[] = [
  { code: "av", nameRu: "Аварский", nameNative: "Авар мацӀ", flag: "🇷🇺" },
  { code: "az", nameRu: "Азербайджанский", nameNative: "Azərbaycan dili", flag: "🇦🇿" },
  { code: "ay", nameRu: "Аймарский", nameNative: "Aymar aru", flag: "🇧🇴" },
  { code: "ak", nameRu: "Акан", nameNative: "Akan", flag: "🇬🇭" },
  { code: "sq", nameRu: "Албанский", nameNative: "Shqip", flag: "🇦🇱" },
  { code: "en", nameRu: "Английский", nameNative: "English", flag: "🇬🇧" },
  { code: "ar", nameRu: "Арабский", nameNative: "العربية", flag: "🇸🇦" },
  { code: "an", nameRu: "Арагонский", nameNative: "Aragonés", flag: "🇪🇸" },
  { code: "hy", nameRu: "Армянский", nameNative: "Հայերեն", flag: "🇦🇲" },
  { code: "as", nameRu: "Ассамский", nameNative: "অসমীয়া", flag: "🇮🇳" },
  { code: "aa", nameRu: "Афарский", nameNative: "Afaraf", flag: "🇩🇯" },
  { code: "af", nameRu: "Африкаанс", nameNative: "Afrikaans", flag: "🇿🇦" },
  { code: "bm", nameRu: "Бамбара", nameNative: "Bamanankan", flag: "🇲🇱" },
  { code: "be", nameRu: "Белорусский", nameNative: "Беларуская", flag: "🇧🇾" },
  { code: "bn", nameRu: "Бенгальский", nameNative: "বাংলা", flag: "🇧🇩" },
  { code: "my", nameRu: "Бирманский", nameNative: "မြန်မာဘာသာ", flag: "🇲🇲" },
  { code: "bi", nameRu: "Бислама", nameNative: "Bislama", flag: "🇻🇺" },
  { code: "bg", nameRu: "Болгарский", nameNative: "Български", flag: "🇧🇬" },
  { code: "bs", nameRu: "Боснийский", nameNative: "Bosanski", flag: "🇧🇦" },
  { code: "br", nameRu: "Бретонский", nameNative: "Brezhoneg", flag: "🇫🇷" },
  { code: "cy", nameRu: "Валлийский", nameNative: "Cymraeg", flag: "🇬🇧" },
  { code: "wa", nameRu: "Валлонский", nameNative: "Walon", flag: "🇧🇪" },
  { code: "hu", nameRu: "Венгерский", nameNative: "Magyar", flag: "🇭🇺" },
  { code: "vo", nameRu: "Волапюк", nameNative: "Volapük", flag: "🌐" },
  { code: "wo", nameRu: "Волоф", nameNative: "Wolof", flag: "🇸🇳" },
  { code: "vi", nameRu: "Вьетнамский", nameNative: "Tiếng Việt", flag: "🇻🇳" },
  { code: "ht", nameRu: "Гаитянский креольский", nameNative: "Kreyòl ayisyen", flag: "🇭🇹" },
  { code: "gl", nameRu: "Галисийский", nameNative: "Galego", flag: "🇪🇸" },
  { code: "kl", nameRu: "Гренландский", nameNative: "Kalaallisut", flag: "🇬🇱" },
  { code: "el", nameRu: "Греческий", nameNative: "Ελληνικά", flag: "🇬🇷" },
  { code: "ka", nameRu: "Грузинский", nameNative: "ქართული", flag: "🇬🇪" },
  { code: "gu", nameRu: "Гуджарати", nameNative: "ગુજરાતી", flag: "🇮🇳" },
  { code: "da", nameRu: "Датский", nameNative: "Dansk", flag: "🇩🇰" },
  { code: "fy", nameRu: "Западнофризский", nameNative: "Frysk", flag: "🇳🇱" },
  { code: "zu", nameRu: "Зулу", nameNative: "isiZulu", flag: "🇿🇦" },
  { code: "he", nameRu: "Иврит", nameNative: "עברית", flag: "🇮🇱" },
  { code: "ig", nameRu: "Игбо", nameNative: "Igbo", flag: "🇳🇬" },
  { code: "yi", nameRu: "Идиш", nameNative: "ייִדיש", flag: "🌐" },
  { code: "io", nameRu: "Идо", nameNative: "Ido", flag: "🌐" },
  { code: "id", nameRu: "Индонезийский", nameNative: "Bahasa Indonesia", flag: "🇮🇩" },
  { code: "ia", nameRu: "Интерлингва", nameNative: "Interlingua", flag: "🌐" },
  { code: "ie", nameRu: "Интерлингве", nameNative: "Interlingue", flag: "🌐" },
  { code: "ik", nameRu: "Инупиак", nameNative: "Iñupiaq", flag: "🇺🇸" },
  { code: "ga", nameRu: "Ирландский", nameNative: "Gaeilge", flag: "🇮🇪" },
  { code: "is", nameRu: "Исландский", nameNative: "Íslenska", flag: "🇮🇸" },
  { code: "es", nameRu: "Испанский", nameNative: "Español", flag: "🇪🇸" },
  { code: "it", nameRu: "Итальянский", nameNative: "Italiano", flag: "🇮🇹" },
  { code: "yo", nameRu: "Йоруба", nameNative: "Yorùbá", flag: "🇳🇬" },
  { code: "kk", nameRu: "Казахский", nameNative: "Қазақ тілі", flag: "🇰🇿" },
  { code: "kn", nameRu: "Каннада", nameNative: "ಕನ್ನಡ", flag: "🇮🇳" },
  { code: "ca", nameRu: "Каталанский", nameNative: "Català", flag: "🇪🇸" },
  { code: "ks", nameRu: "Кашмири", nameNative: "كٲشُر", flag: "🇮🇳" },
  { code: "kj", nameRu: "Кванама", nameNative: "Kuanyama", flag: "🇦🇴" },
  { code: "qu", nameRu: "Кечуа", nameNative: "Runa Simi", flag: "🇵🇪" },
  { code: "ki", nameRu: "Кикуйю", nameNative: "Gĩkũyũ", flag: "🇰🇪" },
  { code: "rw", nameRu: "Киньяруанда", nameNative: "Ikinyarwanda", flag: "🇷🇼" },
  { code: "ky", nameRu: "Киргизский", nameNative: "Кыргызча", flag: "🇰🇬" },
  { code: "zh", nameRu: "Китайский", nameNative: "中文", flag: "🇨🇳" },
  { code: "ko", nameRu: "Корейский", nameNative: "한국어", flag: "🇰🇷" },
  { code: "co", nameRu: "Корсиканский", nameNative: "Corsu", flag: "🇫🇷" },
  { code: "ku", nameRu: "Курдский", nameNative: "Kurdî", flag: "🌐" },
  { code: "km", nameRu: "Кхмерский", nameNative: "ខ្មែរ", flag: "🇰🇭" },
  { code: "la", nameRu: "Латинский", nameNative: "Latina", flag: "🌐" },
  { code: "lv", nameRu: "Латышский", nameNative: "Latviešu", flag: "🇱🇻" },
  { code: "li", nameRu: "Лимбургский", nameNative: "Limburgs", flag: "🇳🇱" },
  { code: "lt", nameRu: "Литовский", nameNative: "Lietuvių", flag: "🇱🇹" },
  { code: "lu", nameRu: "Луба-катанга", nameNative: "Kiluba", flag: "🇨🇩" },
  { code: "lb", nameRu: "Люксембургский", nameNative: "Lëtzebuergesch", flag: "🇱🇺" },
  { code: "mk", nameRu: "Македонский", nameNative: "Македонски", flag: "🇲🇰" },
  { code: "mg", nameRu: "Малагасийский", nameNative: "Malagasy", flag: "🇲🇬" },
  { code: "ms", nameRu: "Малайский", nameNative: "Bahasa Melayu", flag: "🇲🇾" },
  { code: "ml", nameRu: "Малаялам", nameNative: "മലയാളം", flag: "🇮🇳" },
  { code: "mt", nameRu: "Мальтийский", nameNative: "Malti", flag: "🇲🇹" },
  { code: "mi", nameRu: "Маори", nameNative: "Māori", flag: "🇳🇿" },
  { code: "mr", nameRu: "Маратхи", nameNative: "मराठी", flag: "🇮🇳" },
  { code: "mn", nameRu: "Монгольский", nameNative: "Монгол хэл", flag: "🇲🇳" },
  { code: "na", nameRu: "Науру", nameNative: "Dorerin Naoero", flag: "🇳🇷" },
  { code: "ng", nameRu: "Ндонга", nameNative: "Owambo", flag: "🇳🇦" },
  { code: "de", nameRu: "Немецкий", nameNative: "Deutsch", flag: "🇩🇪" },
  { code: "ne", nameRu: "Непальский", nameNative: "नेपाली", flag: "🇳🇵" },
  { code: "nl", nameRu: "Нидерландский", nameNative: "Nederlands", flag: "🇳🇱" },
  { code: "no", nameRu: "Норвежский", nameNative: "Norsk", flag: "🇳🇴" },
  { code: "nb", nameRu: "Норвежский букмол", nameNative: "Norsk bokmål", flag: "🇳🇴" },
  { code: "nn", nameRu: "Норвежский нюнорск", nameNative: "Norsk nynorsk", flag: "🇳🇴" },
  { code: "oc", nameRu: "Окситанский", nameNative: "Occitan", flag: "🇫🇷" },
  { code: "or", nameRu: "Ория", nameNative: "ଓଡ଼ିଆ", flag: "🇮🇳" },
  { code: "om", nameRu: "Оромо", nameNative: "Afaan Oromoo", flag: "🇪🇹" },
  { code: "pi", nameRu: "Пали", nameNative: "पाऴि", flag: "🌐" },
  { code: "pa", nameRu: "Панджаби", nameNative: "ਪੰਜਾਬੀ", flag: "🇮🇳" },
  { code: "fa", nameRu: "Персидский", nameNative: "فارسی", flag: "🇮🇷" },
  { code: "pl", nameRu: "Польский", nameNative: "Polski", flag: "🇵🇱" },
  { code: "pt", nameRu: "Португальский", nameNative: "Português", flag: "🇵🇹" },
  { code: "ps", nameRu: "Пушту", nameNative: "پښتو", flag: "🇦🇫" },
  { code: "rm", nameRu: "Романшский", nameNative: "Rumantsch", flag: "🇨🇭" },
  { code: "ro", nameRu: "Румынский", nameNative: "Română", flag: "🇷🇴" },
  { code: "rn", nameRu: "Рунди", nameNative: "Ikirundi", flag: "🇧🇮" },
  { code: "ru", nameRu: "Русский", nameNative: "Русский", flag: "🇷🇺" },
  { code: "sm", nameRu: "Самоанский", nameNative: "Gagana Samoa", flag: "🇼🇸" },
  { code: "sg", nameRu: "Санго", nameNative: "Sängö", flag: "🇨🇫" },
  { code: "ss", nameRu: "Свази", nameNative: "SiSwati", flag: "🇸🇿" },
  { code: "se", nameRu: "Северносаамский", nameNative: "Davvisámegiella", flag: "🇳🇴" },
  { code: "nd", nameRu: "Северный ндебеле", nameNative: "isiNdebele", flag: "🇿🇼" },
  { code: "sr", nameRu: "Сербский", nameNative: "Српски", flag: "🇷🇸" },
  { code: "si", nameRu: "Сингальский", nameNative: "සිංහල", flag: "🇱🇰" },
  { code: "sd", nameRu: "Синдхи", nameNative: "سنڌي", flag: "🇵🇰" },
  { code: "sk", nameRu: "Словацкий", nameNative: "Slovenčina", flag: "🇸🇰" },
  { code: "sl", nameRu: "Словенский", nameNative: "Slovenščina", flag: "🇸🇮" },
  { code: "so", nameRu: "Сомалийский", nameNative: "Soomaaliga", flag: "🇸🇴" },
  { code: "sw", nameRu: "Суахили", nameNative: "Kiswahili", flag: "🇹🇿" },
  { code: "su", nameRu: "Сунданский", nameNative: "Basa Sunda", flag: "🇮🇩" },
  { code: "tl", nameRu: "Тагальский", nameNative: "Tagalog", flag: "🇵🇭" },
  { code: "tg", nameRu: "Таджикский", nameNative: "Тоҷикӣ", flag: "🇹🇯" },
  { code: "th", nameRu: "Тайский", nameNative: "ไทย", flag: "🇹🇭" },
  { code: "ta", nameRu: "Тамильский", nameNative: "தமிழ்", flag: "🇮🇳" },
  { code: "tt", nameRu: "Татарский", nameNative: "Татар теле", flag: "🇷🇺" },
  { code: "tw", nameRu: "Тви", nameNative: "Twi", flag: "🇬🇭" },
  { code: "te", nameRu: "Телугу", nameNative: "తెలుగు", flag: "🇮🇳" },
  { code: "ts", nameRu: "Тсонга", nameNative: "Xitsonga", flag: "🇿🇦" },
  { code: "tr", nameRu: "Турецкий", nameNative: "Türkçe", flag: "🇹🇷" },
  { code: "tk", nameRu: "Туркменский", nameNative: "Türkmençe", flag: "🇹🇲" },
  { code: "uz", nameRu: "Узбекский", nameNative: "Oʻzbek", flag: "🇺🇿" },
  { code: "ug", nameRu: "Уйгурский", nameNative: "ئۇيغۇرچە", flag: "🇨🇳" },
  { code: "uk", nameRu: "Украинский", nameNative: "Українська", flag: "🇺🇦" },
  { code: "ur", nameRu: "Урду", nameNative: "اردو", flag: "🇵🇰" },
  { code: "fo", nameRu: "Фарерский", nameNative: "Føroyskt", flag: "🇫🇴" },
  { code: "fi", nameRu: "Финский", nameNative: "Suomi", flag: "🇫🇮" },
  { code: "fr", nameRu: "Французский", nameNative: "Français", flag: "🇫🇷" },
  { code: "ff", nameRu: "Фула", nameNative: "Fulfulde", flag: "🇸🇳" },
  { code: "ha", nameRu: "Хауса", nameNative: "Hausa", flag: "🇳🇬" },
  { code: "hi", nameRu: "Хинди", nameNative: "हिन्दी", flag: "🇮🇳" },
  { code: "ho", nameRu: "Хиримоту", nameNative: "Hiri Motu", flag: "🇵🇬" },
  { code: "hr", nameRu: "Хорватский", nameNative: "Hrvatski", flag: "🇭🇷" },
  { code: "cu", nameRu: "Церковнославянский", nameNative: "Ѩзыкъ словѣньскъ", flag: "🌐" },
  { code: "ch", nameRu: "Чаморро", nameNative: "Chamoru", flag: "🇬🇺" },
  { code: "ce", nameRu: "Чеченский", nameNative: "Нохчийн мотт", flag: "🇷🇺" },
  { code: "cs", nameRu: "Чешский", nameNative: "Čeština", flag: "🇨🇿" },
  { code: "za", nameRu: "Чжуанский", nameNative: "Vahcuengh", flag: "🇨🇳" },
  { code: "sv", nameRu: "Шведский", nameNative: "Svenska", flag: "🇸🇪" },
  { code: "sn", nameRu: "Шона", nameNative: "ChiShona", flag: "🇿🇼" },
  { code: "gd", nameRu: "Шотландский гэльский", nameNative: "Gàidhlig", flag: "🇬🇧" },
  { code: "ee", nameRu: "Эве", nameNative: "Eʋegbe", flag: "🇬🇭" },
  { code: "eo", nameRu: "Эсперанто", nameNative: "Esperanto", flag: "🌐" },
  { code: "et", nameRu: "Эстонский", nameNative: "Eesti", flag: "🇪🇪" },
  { code: "nr", nameRu: "Южный ндебеле", nameNative: "isiNdebele", flag: "🇿🇦" },
  { code: "st", nameRu: "Южный сото", nameNative: "Sesotho", flag: "🇱🇸" },
  { code: "jv", nameRu: "Яванский", nameNative: "Basa Jawa", flag: "🇮🇩" },
  { code: "ja", nameRu: "Японский", nameNative: "日本語", flag: "🇯🇵" },
];

// ---------------------------------------------------------------------------
// Voice: which of the languages above the speech engine can actually hear.
//
// This mirrors the g_lang table of whisper.cpp (the engine behind
// lib/stt.ts) — 100 codes, verified against the installed 1.9.4 build. It
// lives here rather than in lib/stt.ts on purpose: the widget needs the answer
// to decide whether to draw the mic button at all, and importing the engine
// client into a browser bundle to ask it would drag the whole STT stack along.
//
// The engine is unforgiving about an unknown code: whisper_lang_id() returns
// -1, whisper_token_lang(-1) then hands the decoder the start-of-transcript
// token instead of a language, and the recording comes back as whatever the
// model feels like — usually English, sometimes another language entirely.
// There is no error to catch, so the only safe move is not to offer the mic.
const WHISPER_CODES = new Set([
  "af", "am", "ar", "as", "az", "ba", "be", "bg", "bn", "bo", "br", "bs",
  "ca", "cs", "cy", "da", "de", "el", "en", "es", "et", "eu", "fa", "fi",
  "fo", "fr", "gl", "gu", "ha", "haw", "he", "hi", "hr", "ht", "hu", "hy",
  "id", "is", "it", "ja", "jw", "ka", "kk", "km", "kn", "ko", "la", "lb",
  "ln", "lo", "lt", "lv", "mg", "mi", "mk", "ml", "mn", "mr", "ms", "mt",
  "my", "ne", "nl", "nn", "no", "oc", "pa", "pl", "ps", "pt", "ro", "ru",
  "sa", "sd", "si", "sk", "sl", "sn", "so", "sq", "sr", "su", "sv", "sw",
  "ta", "te", "tg", "th", "tk", "tl", "tr", "tt", "uk", "ur", "uz", "vi",
  "yi", "yo", "yue", "zh",
]);

/** Where our ISO 639-1 code and the engine's differ for the same language.
 *  Both are legacy spellings inside whisper's table, not different languages:
 *  Javanese is filed under `jw` there (its pre-1989 code) and whisper has no
 *  `nb` at all — Norwegian Bokmål is what its `no` means. Sending our own code
 *  verbatim would cost these two languages voice for no reason. */
const WHISPER_ALIASES: Record<string, string> = { jv: "jw", nb: "no" };

/**
 * The language code to send to the speech engine for `code`, or null when the
 * engine does not know the language at all.
 *
 * Callers use null as "voice is not available for this language" — the voice
 * route refuses the request and the widget does not draw the mic.
 */
export function whisperCode(code: string): string | null {
  const alias = WHISPER_ALIASES[code] ?? code;
  return WHISPER_CODES.has(alias) ? alias : null;
}

/** Whether the speech engine can transcribe `code` — the one question the mic
 *  button is gated on. */
export function supportsVoice(code: string): boolean {
  return whisperCode(code) !== null;
}

/** The entry for an ISO code, or undefined when the language is not offered —
 *  which also makes this the single validation point for any code arriving
 *  from a cookie, a topic row or a request. */
export function getLanguage(code: string): Language | undefined {
  return LANGUAGES.find((lang) => lang.code === code);
}

/** Russian display name for a code, falling back to the code itself so a topic
 *  stored before the language list was cut still renders something readable. */
export function languageDisplayName(code: string): string {
  return getLanguage(code)?.nameRu ?? code;
}
