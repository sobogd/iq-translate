// Taskbar copy & account-copy shapes, in a server-safe module (no "use
// client"), so server pages can build the merged header texts and pass them to
// the client Taskbar as props. English defaults keep the bar working until a
// locale's chrome carries the translated keys.
export type TaskbarTexts = {
  logo: string;
  /** Trigger for the language-pairs menu (ex-footer feature links). */
  features: string;
  pricing: string;
  /** The right-edge CTA: scrolls the content window back to the widget. */
  translate: string;
  menu: string;
  languages: string;
  legal: string;
  theme: string;
  themeSystem: string;
  themeLight: string;
  themeDark: string;
  legalPrivacy: string;
  legalTerms: string;
  account: string;
  signIn: string;
  logOut: string;
  anyLanguageHint: string;
  /** Sign-in flow copy (email OTP + social buttons). */
  signInEmail: string;
  signInGoogle: string;
  signInApple: string;
  emailTitle: string;
  emailHint: string;
  codeHint: string;
  emailPlaceholder: string;
  codePlaceholder: string;
  sendCode: string;
  verifyCode: string;
  errEmailInvalid: string;
  errCodeInvalid: string;
  errCodeExpired: string;
  errTooMany: string;
  errNotAllowed: string;
  errGeneric: string;
};

// Label of the signed-in account dropdown. The service is free and has no
// plan, quota or subscription, so the only thing left to render is the heading.
export type AccountTexts = {
  title: string;
};

export const DEFAULT_TEXTS: TaskbarTexts = {
  logo: "Translate",
  features: "Features",
  pricing: "Pricing",
  translate: "Translate",
  menu: "Menu",
  languages: "Languages",
  legal: "Legal",
  theme: "Theme",
  themeSystem: "System",
  themeLight: "Light",
  themeDark: "Dark",
  legalPrivacy: "Privacy",
  legalTerms: "Terms",
  account: "Account",
  signIn: "Sign in",
  logOut: "Log out",
  anyLanguageHint: "Translate to any language",
  signInEmail: "Email",
  signInGoogle: "Google",
  signInApple: "Apple",
  emailTitle: "Sign in with email",
  emailHint: "We'll email you a one-time code to finish signing in.",
  codeHint: "Enter the 6-digit code we emailed you.",
  emailPlaceholder: "you@example.com",
  codePlaceholder: "Code",
  sendCode: "Send code",
  verifyCode: "Verify code",
  errEmailInvalid: "Enter a valid email address.",
  errCodeInvalid: "That code is not right — check it and try again.",
  errCodeExpired: "That code expired — request a new one.",
  errTooMany: "Too many requests — try again in a few minutes.",
  errNotAllowed: "This email is not allowed to sign in.",
  errGeneric: "Something went wrong. Try again.",
};

export const DEFAULT_ACCOUNT_TEXTS: AccountTexts = {
  title: "Account",
};

/** Merges a locale's header copy over the English fallbacks, so the taskbar
 *  keeps working (English menu labels) until every locale carries the new
 *  header keys (menu / languages / legal / theme / translate…). */
export const mergeTaskbarTexts = (header: Partial<TaskbarTexts> | undefined): TaskbarTexts => ({
  ...DEFAULT_TEXTS,
  ...header,
});
