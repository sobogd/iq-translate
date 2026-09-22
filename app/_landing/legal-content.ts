// Hardcoded English legal text for /privacy and /terms.
//
// Ported from iq-rest (apps/landing/components/cookie-consent/legal-text.tsx):
// same operator, same hosting, same jurisdiction and the same section
// structure — only the product-specific parts (what data this service
// actually processes, how it is stored) are rewritten for IQ Translate.
//
// Kept in TypeScript, not in the locale JSONs, for the same reason as there:
// translating legal documents needs lawyer review. The English version is
// canonical and binding.

export const OPERATOR = {
  legalName: "Bogdan Sokolov",
  status: "individual entrepreneur (autónomo) registered in Spain",
  brand: "IQ Translate",
  domain: "iq-translate.com",
  // The operator's support mailbox for this brand (domain bound to Brevo).
  contactEmail: "support@iq-translate.com",
  fiscalAddress: "Calle Boca Del Rio 2, 1A, Oviedo, 33010, Asturias, Spain",
  taxId: "ESZ1894474S",
  hostingProvider: "Hetzner Online GmbH, Nuremberg, Germany",
};

export type LegalSection = { heading?: string; paragraphs: string[] };

export const PRIVACY_TITLE = "Privacy Policy";
export const TERMS_TITLE = "Terms of Service";
export const LEGAL_LAST_UPDATED = "September 21, 2026";

export const PRIVACY_SECTIONS: LegalSection[] = [
  {
    paragraphs: [
      `Last updated: ${LEGAL_LAST_UPDATED}`,
      `This Privacy Policy explains how ${OPERATOR.brand} — a service operated by ${OPERATOR.legalName}, ${OPERATOR.status}, with fiscal address at ${OPERATOR.fiscalAddress} (Tax ID: ${OPERATOR.taxId}) ("${OPERATOR.brand}", "we", "us") — collects, uses, stores and protects your personal data when you use the translator at ${OPERATOR.domain}.`,
      `The short version: the service is free and has no paid plan. You can translate without signing in, in which case your history belongs to your browser; if you sign in, it is attached to your account. Chats are kept for up to twelve months and you can clear them at any time. The audio you record is never stored — it is transcribed and immediately discarded. The only usage measurement we run is our own, cookieless one: no third-party analytics, no advertising trackers.`,
      `We comply with the General Data Protection Regulation (GDPR), the Spanish Organic Law on Data Protection and Guarantee of Digital Rights (LOPDGDD), and the ePrivacy Directive.`,
    ],
  },
  {
    heading: "1. Data Controller",
    paragraphs: [
      `${OPERATOR.brand} is operated by ${OPERATOR.legalName}, ${OPERATOR.status}, who is the data controller responsible for your personal data (Tax ID: ${OPERATOR.taxId}, fiscal address ${OPERATOR.fiscalAddress}).`,
      `For any privacy inquiries, including the exercise of your data subject rights, contact ${OPERATOR.contactEmail}.`,
    ],
  },
  {
    heading: "2. Data we collect",
    paragraphs: [
      `We collect only the data needed to operate the Service. The categories below cover everything stored in our database.`,
      `Account data — if you sign in: your email address. Sign-in is passwordless (an emailed one-time code) or through Google or Apple, which return your email address and its verified status. We never receive your password for any of these providers.`,
      `Authentication data — hashed session tokens. The raw token exists only in your browser cookie.`,
      `Anonymous identifier — if you use the Service without signing in, your history is attached to a random identifier kept in a first-party cookie in your browser. It is not derived from your IP address, your device or any other signal about you, and it is not linked to a name or an email unless you sign in, at which point the anonymous history is merged into your account and the anonymous identifier is retired.`,
      `Translation content — the text you submit, the transcript of what you dictate, the resulting translation, the source and target language, and which language pair each exchange belongs to.`,
      `Voice recordings — audio is transmitted for speech recognition and discarded as soon as the transcript comes back. We do not store audio files.`,
      `Support — the content of messages you exchange with us by email.`,
      `Usage measurement — our own, cookieless. For each visit we store which pages were opened and which actions were taken (an event is a page, an action and a short English label such as "Home / Click / Header pricing"), the interface language, the device type and operating system, the browser's language header, the approximate location (country, region, city) derived from the IP address, and where the visit came from (a "?from=" campaign tag or the search engine that referred it). This is handled by a separate analytics service we also operate in the European Union, which your browser talks to directly rather than through this site's own server. The visit itself is identified by a salted hash of your IP address, browser user agent and language header, computed by that service. The raw IP address and the raw user agent are never stored, and the salt is replaced every day and the old one destroyed — which makes visits from different days impossible to link back together. Because your browser reaches that service directly, ordinary page views and clicks are not linked to your signed-in account; only the one-time sign-in event itself, recorded by our own server, is attributed to your email address.`,
      `We do not collect billing data and we never see payment card details, because there is nothing to pay.`,
    ],
  },
  {
    heading: "3. Legal basis for processing",
    paragraphs: [
      `Each category is processed under one of the legal bases in GDPR Article 6:`,
      `Contract performance (Art. 6(1)(b)) — account data, authentication data, translation content and support messages. Required to provide the Service you asked for.`,
      `Legitimate interest (Art. 6(1)(f)) — the anonymous identifier and its stored history, the rate-limiting and anti-abuse check, short-term operational logs, and the cookieless usage measurement described above, which keep the Service available and tell us which parts of it people actually use. Balanced against your rights: the measurement stores no direct identifier of a signed-out visitor, builds no cross-site profile and is never shared or sold. You can object at any time by emailing ${OPERATOR.contactEmail}, and we will delete the visits concerned.`,
    ],
  },
  {
    heading: "4. How we use your data",
    paragraphs: [
      `Provide the Service: transcribe what you say, translate what you submit, and keep the result in your conversation history so you can come back to it.`,
      `Authenticate you: validate the sign-in method you chose, manage sessions, and merge the history of the browser you signed in from into your account.`,
      `Keep the Service available: rate-limit requests and, for visitors without an account, run a Cloudflare Turnstile anti-abuse check so automated traffic cannot occupy the translation engine.`,
      `Communicate with you: service notices and support replies. We do not send marketing emails without your separate consent.`,
      `Comply with legal obligations when required.`,
    ],
  },
  {
    heading: "5. Analytics: our own, cookieless, no advertising",
    paragraphs: [
      `We do not use Google Analytics, PostHog, Facebook Pixel, Hotjar, session recording, retargeting pixels, or any other third-party analytics or advertising tracker. Nothing about your visit is shared with a third party, and no advertising network is told anything about you.`,
      `What we do run is our own measurement of how the Service is used, described in section 2, on a separate analytics service we also operate in the European Union. It works without cookies and without any identifier stored on your device: a visit is recognised by a hash that service recomputes from the request itself, using a secret that is thrown away and replaced every day. That is also its limit — after a day, visits can no longer be connected to one another. Because it is reached directly rather than through this site's own server, it also cannot connect an ordinary page view to your signed-in account.`,
      `It does not follow you across other websites, it is never used for advertising or for automated decisions about you, and no profile of your behaviour is built anywhere.`,
      `We do not sell, rent or share your personal data with anyone for their own purposes, and your translations are never used to train AI models.`,
    ],
  },
  {
    heading: "6. Cookies and local storage",
    paragraphs: [
      `The Service sets only strictly necessary cookies, which do not require consent under Article 5(3) of the ePrivacy Directive — hence no cookie banner. Our usage measurement deliberately sets none: it stores nothing on your device at all, not a cookie, not a local-storage entry, not a device identifier.`,
      `The cookies we use:`,
      `• translator_session — keeps you signed in`,
      `• iqt_signed_in — a yes/no flag, readable by the page so the header renders in the right state; it carries no credential`,
      `• iqt_anon — the random identifier that owns the history of a browser that has not signed in; it is retired when you sign in`,
      `• iqt_pair — remembers the last language pair you used`,
      `• NEXT_LOCALE — remembers the language you used`,
      `• iqt_ts_pass — a short-lived pass issued after a successful anti-abuse check, so you are not challenged on every message`,
      `Your browser additionally stores your last chosen target language, so the widget reopens where you left it. That stays on your device.`,
    ],
  },
  {
    heading: "7. Where data is stored",
    paragraphs: [
      `All data — your account, conversations and translations — is stored in one place: our own database on a server operated for us by ${OPERATOR.hostingProvider}, under our direct control. Primary storage does not leave the European Union.`,
      `Data is encrypted in transit using TLS, and backups are kept in the same EU region.`,
    ],
  },
  {
    heading: "8. Service providers",
    paragraphs: [
      `A small number of providers are technically necessary to deliver the Service:`,
      `No provider receives your text or your audio: translation and speech recognition both run on our own machine (self-hosted language and speech models, reached over an encrypted private channel from our server). Your content is not sent to any external AI service and is not used to train anything.`,
      `Google and Apple (Sign-In) — only if you choose to sign in that way (standard OAuth: your email address and its verified status).`,
      `Brevo — delivers the one-time sign-in code to your email address when you sign in with email.`,
      `Cloudflare — the Turnstile anti-abuse check shown to visitors without an account, and DNS for the domain. Turnstile is designed to work without profiling visitors.`,
      `${OPERATOR.hostingProvider} — hosts our server. A data processor under a Data Processing Agreement; cannot access database contents in normal operation.`,
    ],
  },
  {
    heading: "9. International data transfers",
    paragraphs: [
      `Our own storage stays within the European Union. If you choose to sign in with Google or Apple, those providers process your email address as part of the sign-in; any transfer outside the EU is covered by the EU-US Data Privacy Framework or by Standard Contractual Clauses.`,
    ],
  },
  {
    heading: "10. How long we keep your data",
    paragraphs: [
      `Conversations and translations — kept for up to twelve months from your last use of that language pair, then automatically deleted. You can also clear any pair's history from the widget at any time, without waiting.`,
      `Voice recordings — not retained at all: discarded as soon as the transcript is produced.`,
      `Account data — for as long as your account exists. You can ask us to delete your account and its data at any time (see section 11); we remove it within 30 days and backups are overwritten within 90 days.`,
      `Usage measurement (visits and events) — kept for 12 months, then deleted. The daily salt that produced a visit's hash is destroyed after a day, so older visits cannot be traced back to a device even by us.`,
      `Support messages — retained for 24 months after the last reply.`,
    ],
  },
  {
    heading: "11. Your rights",
    paragraphs: [
      `Under the GDPR you have the right to:`,
      `Access — request a copy of the personal data we hold about you.`,
      `Rectification — correct inaccurate or incomplete data.`,
      `Erasure ("right to be forgotten") — request deletion of your data; we will comply unless retention is required by law.`,
      `Restriction — pause processing while a complaint is investigated.`,
      `Portability — receive your data in a structured, machine-readable format.`,
      `Object — object to processing based on legitimate interest. Email ${OPERATOR.contactEmail}.`,
      `Lodge a complaint — file a complaint with the Spanish data protection authority, the Agencia Española de Protección de Datos (AEPD), at www.aepd.es, or with the authority of your own country.`,
      `You can clear the history of any language pair yourself in the widget. For access, export or erasure of everything else, email ${OPERATOR.contactEmail}; we respond within 30 days. If you used the Service without signing in, the history is attached to an identifier stored only in your browser, so clearing it from the widget (or clearing your browser storage) removes it for good.`,
    ],
  },
  {
    heading: "12. Children",
    paragraphs: [
      `The Service is not intended for individuals under 18. We do not knowingly collect personal data from children. If you believe a child has provided us data, contact us and we will remove it.`,
    ],
  },
  {
    heading: "13. Security",
    paragraphs: [
      `We apply technical and organizational measures appropriate to the risk: TLS for all traffic, hashed session tokens, rate limiting, an anti-abuse check in front of the translation endpoints, automated backups, restricted server access, and regular dependency updates. No system is 100% secure; if we become aware of a personal-data breach affecting you, we will notify you and the AEPD within 72 hours as required by GDPR Article 33.`,
    ],
  },
  {
    heading: "14. Changes to this policy",
    paragraphs: [
      `We may update this Privacy Policy from time to time. The "Last updated" date at the top reflects the most recent revision. Continued use of the Service after a change constitutes acceptance.`,
    ],
  },
  {
    heading: "15. Contact",
    paragraphs: [
      `Questions, complaints, or requests regarding this Privacy Policy can be sent to ${OPERATOR.contactEmail}. We respond within 30 days.`,
    ],
  },
];

export const TERMS_SECTIONS: LegalSection[] = [
  {
    paragraphs: [`Last updated: ${LEGAL_LAST_UPDATED}`],
  },
  {
    heading: "Overview",
    paragraphs: [
      `${OPERATOR.brand} is a free online translator that turns speech and text into another language, reads the translation aloud, and keeps each exchange in a conversation history ("the Service"). It is provided through the website at ${OPERATOR.domain} and operated by ${OPERATOR.legalName}, ${OPERATOR.status}, with fiscal address at ${OPERATOR.fiscalAddress} (Tax ID: ${OPERATOR.taxId}) ("${OPERATOR.brand}", "we", "us").`,
      `By visiting our site or using the Service, you accept these Terms of Service ("Terms"). If you do not agree to all of these Terms, please do not use the site or the Service.`,
      `These Terms apply to everyone who uses the Service, with or without an account.`,
      `If you use the Service as a consumer, nothing in these Terms limits or excludes any rights you have under mandatory consumer-protection law that cannot be waived by contract.`,
    ],
  },
  {
    heading: "1. Eligibility and accounts",
    paragraphs: [
      `You must be at least 18 years old (or the age of majority in your jurisdiction) to create an account. You can use the Service without an account, but your history then lives only in that browser and is lost if you clear its storage.`,
      `You are responsible for safeguarding access to the email account, Google account or Apple account you sign in with, and for any activity that takes place under your account. Notify us immediately at ${OPERATOR.contactEmail} if you suspect unauthorized access.`,
    ],
  },
  {
    heading: "2. Acceptable use",
    paragraphs: [
      `You agree not to use the Service for any unlawful purpose; not to submit content you have no right to share with a third-party provider; not to attempt to circumvent rate limits, the anti-abuse check or security controls; not to resell the output as a certified translation; and not to run automated or bulk traffic against the Service.`,
      `Violation of these rules may result in immediate suspension or termination of your access.`,
    ],
  },
  {
    heading: "3. Free service",
    paragraphs: [
      `The Service is free of charge. There is no subscription, no paid plan and no payment card involved, and we do not bill you for anything.`,
      `To keep it available for everyone, requests are rate-limited server-side and visitors without an account may be asked to pass an anti-abuse check before a translation runs. These limits protect capacity, not revenue.`,
      `We may change, limit or withdraw the free Service in the future as described in section 7.`,
    ],
  },
  {
    heading: "4. Your content",
    paragraphs: [
      `You retain ownership of everything you submit. By using the Service you grant us a limited, non-exclusive license to transmit, process, store and back up that content for the sole purpose of producing your translation and keeping your history — nothing else.`,
      `Your content is not used to train AI models. You are responsible for ensuring you are entitled to submit it, and that doing so does not breach confidentiality obligations or third-party rights.`,
    ],
  },
  {
    heading: "5. Automated translation — accuracy",
    paragraphs: [
      `Translation and speech recognition are produced by an automated model. The output is not a certified or human translation and can be wrong, incomplete, or wrong in nuance, particularly with dialects, idioms, names and technical terms.`,
      `Do not rely on it alone for medical, legal, financial or safety-critical decisions, for official filings, or for any document that must be certified. You are responsible for checking the output before acting on it.`,
    ],
  },
  {
    heading: "6. Data, privacy and hosting",
    paragraphs: [
      `Your account, conversations and translations are stored in our own database on our own server in the European Union, under our direct control. We run no third-party analytics and no advertising trackers; usage is measured only by our own cookieless system, described in the Privacy Policy.`,
      `The content you submit is processed by our own self-hosted models to produce the transcript and translation — it is not sent to any external AI service. Audio is never stored.`,
      `For full details, see our Privacy Policy, which forms part of these Terms.`,
    ],
  },
  {
    heading: "7. Service availability and modifications",
    paragraphs: [
      `We aim for high availability but make no guarantee of uninterrupted, error-free operation. We may perform maintenance with prior notice when possible.`,
      `Because the Service is free, we may modify, limit, suspend or discontinue any part of it at any time without liability.`,
    ],
  },
  {
    heading: "8. Intellectual property",
    paragraphs: [
      `The ${OPERATOR.brand} name, logo, code, designs, and any other materials provided through the Service (excluding content you submit) are the intellectual property of ${OPERATOR.legalName} and protected by applicable copyright and trademark laws.`,
    ],
  },
  {
    heading: "9. Disclaimer of warranties",
    paragraphs: [
      `The Service is provided "as is" and "as available" without warranties of any kind, express or implied, including any warranty as to the accuracy of a translation. We do not warrant that the Service will be uninterrupted or error-free. Your use of the Service is at your own risk.`,
    ],
  },
  {
    heading: "10. Limitation of liability",
    paragraphs: [
      `To the maximum extent permitted by law, ${OPERATOR.legalName} shall not be liable for any indirect, incidental, special, consequential or punitive damages, lost profits, lost revenue, lost data, or business interruption arising out of or in connection with the Service, including any consequence of relying on an automated translation. Because the Service is free, our total liability for any claim arising under these Terms is limited to EUR 100.`,
      `Nothing in these Terms excludes or limits liability that cannot be excluded or limited under applicable law, including liability for wilful misconduct or gross negligence, or the statutory rights of consumers.`,
    ],
  },
  {
    heading: "11. Indemnification",
    paragraphs: [
      `You agree to indemnify and hold ${OPERATOR.legalName} harmless from any claim or demand made by any third party due to your breach of these Terms or your violation of any law or third-party rights.`,
    ],
  },
  {
    heading: "12. Termination",
    paragraphs: [
      `Either party may terminate this agreement at any time. You may terminate by clearing your history and asking us to delete your account. We may terminate immediately and without notice for breach of these Terms, suspected fraud, abuse, or illegal activity.`,
      `Upon termination, your right to access the Service ends immediately. We will retain a backup of your data for up to 30 days, after which it is permanently deleted, except for records we are required to retain by law.`,
    ],
  },
  {
    heading: "13. Governing law and jurisdiction",
    paragraphs: [
      `These Terms are governed by the laws of the Kingdom of Spain. Any dispute arising from these Terms shall be settled in the competent courts of the city of Oviedo, Spain.`,
      `If you are a consumer resident in the European Union, this clause does not deprive you of the protection of mandatory provisions of the law of your country of residence, nor of your right to bring or defend proceedings in the courts of that country.`,
    ],
  },
  {
    heading: "14. Changes to these Terms",
    paragraphs: [
      `We may update these Terms from time to time. The most current version is always available on this page. Material changes will be communicated by email or in-app notice at least 30 days before they take effect. Continued use of the Service after the change constitutes acceptance of the revised Terms.`,
    ],
  },
  {
    heading: "15. Contact",
    paragraphs: [`Questions about these Terms can be sent to ${OPERATOR.contactEmail}.`],
  },
];
