// Hardcoded English legal text for /privacy and /terms.
//
// Ported from iq-rest (apps/landing/components/cookie-consent/legal-text.tsx):
// same operator, same hosting, same jurisdiction and the same section
// structure — only the product-specific parts (what data this service
// actually processes, how it is billed) are rewritten for IQ Translate.
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
export const LEGAL_LAST_UPDATED = "September 20, 2026";

export const PRIVACY_SECTIONS: LegalSection[] = [
  {
    paragraphs: [
      `Last updated: ${LEGAL_LAST_UPDATED}`,
      `This Privacy Policy explains how ${OPERATOR.brand} — a service operated by ${OPERATOR.legalName}, ${OPERATOR.status}, with fiscal address at ${OPERATOR.fiscalAddress} (Tax ID: ${OPERATOR.taxId}) ("${OPERATOR.brand}", "we", "us") — collects, uses, stores and protects your personal data when you use the translator at ${OPERATOR.domain}.`,
      `The short version: your conversations live in our own database on our own server in the European Union, the audio you record is never stored — it is transcribed and immediately discarded — and the only usage measurement we run is our own, cookieless one: no third-party analytics, no advertising trackers, and nothing stored on your device.`,
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
      `Account data — if you sign in: the email address of the Google account you use. Sign-in is passwordless; we never receive your Google password and request nothing beyond your email address and its verified status.`,
      `Authentication data — hashed session tokens. The raw token exists only in your browser cookie.`,
      `Anonymous usage identifier — if you use the Service without signing in, we derive a technical fingerprint from your request (IP address, browser user agent, language header), store it as a hash, and count characters and voice seconds against it. This exists solely to stop the free allowance from being reset endlessly; it is not linked to a name or an email.`,
      `Translation content — the text you submit, the transcript of what you dictate, the resulting translation, the source and target language, and the conversation ("topic") each of them belongs to.`,
      `Voice recordings — audio is transmitted for speech recognition and discarded as soon as the transcript comes back. We do not store audio files.`,
      `Billing data — if you subscribe: your plan, its status, the renewal date and your Stripe customer and subscription identifiers. Payment cards are handled entirely by Stripe; we never see or store card details.`,
      `Support — the content of messages you exchange with us by email.`,
      `Usage measurement — our own, cookieless. For each visit we store which pages were opened and which actions were taken (an event is a page, an action and a short English label such as "Home / Click / Header pricing"), the interface language, the device type and operating system, the browser's language header, the approximate location (country, region, city) derived from the IP address, and where the visit came from (a "?from=" campaign tag or the search engine that referred it). This is handled by a separate analytics service we also operate in the European Union, which your browser talks to directly rather than through this site's own server. The visit itself is identified by a salted hash of your IP address, browser user agent and language header, computed by that service. The raw IP address and the raw user agent are never stored, and the salt is replaced every day and the old one destroyed — which makes visits from different days impossible to link back together. Because your browser reaches that service directly, ordinary page views and clicks are not linked to your signed-in account; only the one-time sign-in event itself, recorded by our own server, is attributed to your email address.`,
    ],
  },
  {
    heading: "3. Legal basis for processing",
    paragraphs: [
      `Each category is processed under one of the legal bases in GDPR Article 6:`,
      `Contract performance (Art. 6(1)(b)) — account data, authentication data, translation content, billing data, support messages. Required to provide the Service you asked for.`,
      `Legitimate interest (Art. 6(1)(f)) — the anonymous usage identifier, the anti-abuse check, short-term operational logs, and the cookieless usage measurement described above, which protect the free allowance and the availability of the Service and tell us which parts of it people actually use. Balanced against your rights: the measurement stores no direct identifier of a signed-out visitor, builds no cross-site profile and is never shared or sold. You can object at any time by emailing ${OPERATOR.contactEmail}, and we will delete the visits concerned.`,
      `Legal obligation (Art. 6(1)(c)) — invoicing data we are required to retain by Spanish tax law.`,
    ],
  },
  {
    heading: "4. How we use your data",
    paragraphs: [
      `Provide the Service: transcribe what you say, translate what you submit, and keep the result in your conversation history so you can come back to it.`,
      `Authenticate you: validate Google sign-in and manage sessions.`,
      `Enforce quotas: count characters and voice seconds against your account or, without an account, against the anonymous identifier described above.`,
      `Prevent abuse: an anti-abuse check (Cloudflare Turnstile) is shown to visitors without an account, so automated traffic cannot drain the free allowance.`,
      `Bill you: process subscription payments through Stripe.`,
      `Communicate with you: service notices and support replies. We do not send marketing emails without your separate consent.`,
      `Comply with legal obligations: tax records and regulatory reporting when required.`,
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
      `• iqt_session — keeps you signed in`,
      `• iqt_signed_in — a yes/no flag, readable by the page so the header renders in the right state; it carries no credential`,
      `• NEXT_LOCALE — remembers the language you used`,
      `• iqt_ts_pass — a short-lived pass issued after a successful anti-abuse check, so you are not challenged on every message`,
      `Your browser additionally stores your last chosen target language and the last conversation you had open, so the widget reopens where you left it. That stays on your device.`,
    ],
  },
  {
    heading: "7. Where data is stored",
    paragraphs: [
      `All data — your account, conversations, translations, quota counters — is stored in one place: our own database on a server operated for us by ${OPERATOR.hostingProvider}, under our direct control. Primary storage does not leave the European Union.`,
      `Data is encrypted in transit using TLS, and backups are kept in the same EU region.`,
    ],
  },
  {
    heading: "8. Service providers",
    paragraphs: [
      `A small number of providers are technically necessary to deliver the Service:`,
      `No provider receives your text or your audio: translation and speech recognition both run on our own machine (self-hosted language and speech models, reached over an encrypted private channel from our server). Your content is not sent to any external AI service and is not used to train anything.`,
      `Google (Sign-In) — only if you choose to sign in (standard OAuth: your email address and its verified status).`,
      `Stripe — payment processing for paid plans. Receives your billing email and the amount and product of each transaction. Privacy: https://stripe.com/privacy`,
      `Cloudflare — the Turnstile anti-abuse check shown to visitors without an account, and DNS for the domain. Turnstile is designed to work without profiling visitors.`,
      `${OPERATOR.hostingProvider} — hosts our server. A data processor under a Data Processing Agreement; cannot access database contents in normal operation.`,
    ],
  },
  {
    heading: "9. International data transfers",
    paragraphs: [
      `Our own storage stays within the European Union. The speech recognition and translation performed by Google, and the payment processing performed by Stripe, may involve processing outside the EU; those transfers are covered by the EU-US Data Privacy Framework or by Standard Contractual Clauses.`,
      `Because the content you submit is processed by an external AI provider, do not submit material you are not permitted to share with a third-party processor.`,
    ],
  },
  {
    heading: "10. How long we keep your data",
    paragraphs: [
      `Conversations and translations — until you delete them. You can delete a single conversation or clear your whole history from the widget at any time; they are also removed when your account is deleted.`,
      `Voice recordings — not retained at all: discarded as soon as the transcript is produced.`,
      `Account data — for as long as your account exists. Within 30 days of account deletion all personal data is permanently removed from our database, and backups are overwritten within 90 days.`,
      `Anonymous quota counters — kept for as long as the lifetime free allowance they track applies. They contain no name or email.`,
      `Usage measurement (visits and events) — kept for 12 months, then deleted. The daily salt that produced a visit's hash is destroyed after a day, so older visits cannot be traced back to a device even by us.`,
      `Invoicing data — retained for 6 years as required by Spanish tax law (Ley General Tributaria).`,
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
      `To exercise any of these rights, email ${OPERATOR.contactEmail}. We respond within 30 days.`,
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
      `We apply technical and organizational measures appropriate to the risk: TLS for all traffic, hashed session tokens, quota and rate limiting, an anti-abuse check in front of the endpoints that cost money, automated backups, restricted server access, and regular dependency updates. No system is 100% secure; if we become aware of a personal-data breach affecting you, we will notify you and the AEPD within 72 hours as required by GDPR Article 33.`,
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
      `${OPERATOR.brand} is an online translator that turns speech and text into another language, reads the translation aloud, and keeps each exchange as a saved conversation ("the Service"). It is provided through the website at ${OPERATOR.domain} and operated by ${OPERATOR.legalName}, ${OPERATOR.status}, with fiscal address at ${OPERATOR.fiscalAddress} (Tax ID: ${OPERATOR.taxId}) ("${OPERATOR.brand}", "we", "us").`,
      `By visiting our site or using the Service, you accept these Terms of Service ("Terms"). If you do not agree to all of these Terms, please do not use the site or the Service.`,
      `These Terms apply to everyone who uses the Service, with or without an account.`,
      `If you use the Service as a consumer, nothing in these Terms limits or excludes any rights you have under mandatory consumer-protection law that cannot be waived by contract.`,
    ],
  },
  {
    heading: "1. Eligibility and accounts",
    paragraphs: [
      `You must be at least 18 years old (or the age of majority in your jurisdiction) to create an account. You can use the free allowance without an account.`,
      `You are responsible for safeguarding access to the Google account you sign in with and for any activity that takes place under your account. Notify us immediately at ${OPERATOR.contactEmail} if you suspect unauthorized access.`,
    ],
  },
  {
    heading: "2. Acceptable use",
    paragraphs: [
      `You agree not to use the Service for any unlawful purpose; not to submit content you have no right to share with a third-party processor; not to attempt to circumvent quotas, rate limits, the anti-abuse check, security controls or billing; not to resell the output as a certified translation; and not to run automated or bulk traffic against the Service.`,
      `Violation of these rules may result in immediate suspension or termination of your access.`,
    ],
  },
  {
    heading: "3. Free allowance, subscription and billing",
    paragraphs: [
      `Free allowance. The Service can be used without an account within a limited lifetime allowance of translated characters and voice seconds. An anti-abuse check may be shown before a translation runs. No payment card is required.`,
      `Plans. Paid plans (Starter, Pro, Ultimate) each include a monthly allowance of translated characters and voice minutes. The exact price, allowance and billing currency are shown on the pricing page before you confirm the purchase.`,
      `Billing. Subscriptions are billed monthly in advance and renew automatically until cancelled. Payments are processed securely by our payment provider (Stripe); we never receive or store your full card details.`,
      `Allowances. The monthly allowance resets at the start of each billing period and does not roll over. A dictated message consumes both voice seconds (for the transcription) and characters (for the translation of that transcript).`,
      `Cancellation. You may cancel at any time from the account modal. Cancellation takes effect at the end of the current billing period; the Service remains available until then. We do not refund the unused portion of a billing period, except where mandatory consumer law provides otherwise.`,
      `Right of withdrawal. If you are a consumer in the EU or the UK, you have a 14-day right of withdrawal for digital services. By starting to use paid quota you ask us to begin performance immediately and accept that the right lapses once the service has been fully performed.`,
      `Price changes. We may change pricing with at least 30 days' notice; the new price applies from your next renewal. If you do not agree with a price change, you may cancel before it takes effect.`,
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
      `The content you submit is processed by our own self-hosted models to produce the transcript and translation — it is not sent to any external AI service — and payments are processed by Stripe. Audio is never stored.`,
      `For full details, see our Privacy Policy, which forms part of these Terms.`,
    ],
  },
  {
    heading: "7. Service availability and modifications",
    paragraphs: [
      `We aim for high availability but make no guarantee of uninterrupted, error-free operation. We may perform maintenance with prior notice when possible.`,
      `We reserve the right to modify, suspend, or discontinue any part of the Service at any time, with reasonable notice for material changes affecting paid plans.`,
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
      `To the maximum extent permitted by law, ${OPERATOR.legalName} shall not be liable for any indirect, incidental, special, consequential or punitive damages, lost profits, lost revenue, lost data, or business interruption arising out of or in connection with the Service, including any consequence of relying on an automated translation. Total liability for any claim arising under these Terms is limited to the amount you paid in the 12 months preceding the claim, or EUR 100, whichever is greater.`,
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
      `Either party may terminate this agreement at any time. You may terminate by deleting your history and asking us to close your account. We may terminate immediately and without notice for breach of these Terms, suspected fraud, abuse, or illegal activity.`,
      `Upon termination, your right to access the Service ends immediately. We will retain a backup of your data for up to 30 days, after which it is permanently deleted, except for records we are required to retain by law (such as invoicing data under Spanish tax law).`,
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
