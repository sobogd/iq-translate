export type SpotlightBullet = { title: string; sub: string };
export type Spotlight = { heading: string; sub: string; bullets: SpotlightBullet[] };
export type StatCard = { title: string; sub: string };
export type ComparisonRow = { title: string; us: string; them: string };
export type FaqItem = { q: string; a: string };

export interface TranslatorTexts {
  meta: {
    title: string;
    description: string;
    ogTitle: string;
    ogDescription: string;
    twitterTitle: string;
    twitterDescription: string;
  };
  header: {
    logo: string;
    features: string;
    pricing: string;
    /** Nav link to the /app workspace (the widget with no marketing page). */
    app: string;
    mobileApp: string;
    signIn: string;
    logOut: string;
    tryItNow: string;
    account: string;
    /** Taskbar menus added with the iq-mermaid desktop-chrome port (the
     *  footer is gone, so navigation moved fully into the header). Kept
     *  optional: mergeTaskbarTexts fills English fallbacks until every
     *  locale's chrome carries the translated keys. */
    menu?: string;
    languages?: string;
    legal?: string;
    theme?: string;
    themeSystem?: string;
    themeLight?: string;
    themeDark?: string;
    legalPrivacy?: string;
    legalTerms?: string;
    /** Right-edge header CTA — scrolls the content window back to the
     *  translator widget at the top. */
    translate?: string;
    /** Sign-in flow copy (email OTP + social buttons). */
    signInEmail?: string;
    signInGoogle?: string;
    signInApple?: string;
    emailTitle?: string;
    emailHint?: string;
    codeHint?: string;
    emailPlaceholder?: string;
    codePlaceholder?: string;
    sendCode?: string;
    verifyCode?: string;
    errEmailInvalid?: string;
    errCodeInvalid?: string;
    errCodeExpired?: string;
    errTooMany?: string;
    errNotAllowed?: string;
    errGeneric?: string;
  };
  // The header's account modal (signed-in) / quota badge labels.
  account: {
    title: string;
    planLabel: string;
    freePlan: string;
    minutesLeft: string;
    charsLeft: string;
    imagesLeft: string;
    manageSubscription: string;
    upgrade: string;
  };
  hero: {
    badgeVoice: string;
    badgeText: string;
    badgeLanguages: string;
    title: string;
    titleAccent: string;
    description: string;
    ctaTry: string;
    ctaSignIn: string;
    mockFromLabel: string;
    mockFromPhrase: string;
    mockToLabel: string;
    mockToPhrase: string;
  };
  statCards: StatCard[];
  spotlights: Spotlight[];
  comparison: {
    title: string;
    titleAccent: string;
    description: string;
    usLabel: string;
    themLabel: string;
    rows: ComparisonRow[];
  };
  faq: {
    heading: string;
    headingAccent: string;
    sub: string;
    items: FaqItem[];
  };
  finalCta: {
    heading: string;
    headingAccent: string;
    sub: string;
    ctaLabel: string;
  };
  footer: {
    tagline: string;
    brand: string;
    featuresHeading: string;
    /** Heading of the in-body related-pairs block on the pair pages. */
    pairsHeading: string;
    featureLinks: { routeKey: string; label: string }[];
  };
  // The /pricing page, localized. Quota numbers live inside the translated
  // feature strings (agents write them from lib/plans.ts facts).
  pricing: {
    meta: { title: string; description: string };
    heading: string;
    headingAccent: string;
    sub: string;
    perMonth: string;
    mostPopular: string;
    cta: string;
    freeNote: { title: string; sub: string };
    plans: { id: string; name: string; features: string[] }[];
    faq: { heading: string; headingAccent: string; sub: string; items: FaqItem[] };
    finalCta: { heading: string; headingAccent: string; sub: string; ctaLabel: string };
  };
  translator: {
    topics: string;
    newTopic: string;
    noTopicsYet: string;
    deleteTopic: string;
    deleteTopicConfirm: string;
    /** Swap button between the two language blocks (the writing direction).
     *  Replaced `autoDetect` in every locale when language detection was
     *  dropped from the product. */
    swapAria: string;
    chooseLanguage: string;
    close: string;
    searchPlaceholder: string;
    clearHistory: string;
    clearHistoryConfirm: string;
    noTranslationsYet: string;
    translating: string;
    typePlaceholder: string;
    translateAria: string;
    micDeniedError: string;
    /** Mic-failure copy, split by cause so a failed getUserMedia can say WHAT
     *  went wrong instead of folding every cause into one "denied" string.
     *  See classifyMicError() in Translator.tsx. */
    micBlockedTitle: string;
    micBlockedDesc: string;
    micBlockedHow: string;
    micNotFound: string;
    micBusy: string;
    micInsecure: string;
    micGeneric: string;
    micRetry: string;
    recording: string;
    recognizing: string;
    recordAria: string;
    stopAria: string;
    pricingLink: string;
    /** "Add" trigger that opens the attachment context menu (composer).
     *  Optional: locales without the translated key fall back to English —
     *  same policy as the taskbar chrome keys. */
    add?: string;
    addImage?: string;
    imageReading?: string;
    errors: {
      insufficientCredits: string;
      textTooLong: string;
      turnstileFailed: string;
      notRecognized: string;
      rateLimited: string;
      /** Fallback for every server code the widget has no copy for. Server
       *  routes answer with opaque codes now, so this is what an unexpected
       *  one renders as — it used to be the raw message. */
      generic: string;
    };
  };
  history: {
    emptyState: string;
    readAloudAria: string;
    copyAria: string;
  };
}

// Per-feature-page content (hero/spotlights/comparison/faq/finalCta copy +
// SEO meta), separate from `TranslatorTexts` chrome (header/footer/translator
// widget) which every feature page imports unchanged from its locale's
// texts.json — mirrors iq-rest's CHROME_JSON + CONTENT_JSON split.
export interface FeatureContent {
  meta: {
    title: string;
    description: string;
    ogTitle: string;
    ogDescription: string;
    canonical: string;
    ogLocale: string;
  };
  hero: {
    badgeVoice: string;
    badgeText: string;
    badgeLanguages: string;
    title: string;
    titleAccent: string;
    description: string;
    ctaTry: string;
    ctaSignIn: string;
    mockFromLabel: string;
    mockFromPhrase: string;
    mockToLabel: string;
    mockToPhrase: string;
  };
  spotlights: Spotlight[];
  comparison: {
    title: string;
    titleAccent: string;
    description: string;
    usLabel: string;
    themLabel: string;
    rows: ComparisonRow[];
  };
  faq: {
    heading: string;
    headingAccent: string;
    sub: string;
    items: FaqItem[];
  };
  finalCta: {
    heading: string;
    headingAccent: string;
    sub: string;
    ctaLabel: string;
  };
}
