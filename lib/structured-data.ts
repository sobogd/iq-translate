// JSON-LD builders, shared by the home / feature / pricing templates so all
// three describe the same entity instead of three slightly different ones.
import { SITE_URL } from "./site";
import { localeHome } from "./locale-paths";
import { OG_LOCALES } from "./og-locales";

const ORG_ID = `${SITE_URL}/#organization`;
const APP_ID = `${SITE_URL}/#app`;

export function organizationLd() {
  return {
    "@type": "Organization",
    "@id": ORG_ID,
    name: "IQ Translate",
    url: SITE_URL,
    logo: `${SITE_URL}/icon-512.png`,
    image: `${SITE_URL}/og.png`,
  };
}

export function webSiteLd(locale: string) {
  return {
    "@type": "WebSite",
    "@id": `${SITE_URL}/#website`,
    url: SITE_URL,
    name: "IQ Translate",
    inLanguage: (OG_LOCALES[locale] ?? "en_US").replace("_", "-"),
    publisher: { "@id": ORG_ID },
  };
}

// The application, always free. `offers` is a single zero-price Offer — the
// catalogue no longer has plans, so there is nothing to aggregate.
export function softwareApplicationLd(description: string) {
  return {
    "@type": ["SoftwareApplication", "WebApplication"],
    "@id": APP_ID,
    name: "IQ Translate",
    applicationCategory: "UtilitiesApplication",
    applicationSubCategory: "Translation",
    operatingSystem: "Web",
    browserRequirements: "Requires JavaScript and a microphone for voice input",
    url: SITE_URL,
    description,
    publisher: { "@id": ORG_ID },
    offers: {
      "@type": "Offer",
      price: "0",
      priceCurrency: "USD",
      availability: "https://schema.org/InStock",
    },
  };
}

// FAQPage as JSON-LD. The questions used to be marked up with microdata
// attributes inside Faq.tsx; one format in one place is easier to keep valid,
// and it keeps every node of the page in the same @graph.
export function faqPageLd(items: { q: string; a: string }[]) {
  return {
    "@type": "FAQPage",
    mainEntity: items.map((item) => ({
      "@type": "Question",
      name: item.q,
      acceptedAnswer: { "@type": "Answer", text: item.a },
    })),
  };
}

export function breadcrumbLd(locale: string, page: { name: string; url: string }) {
  return {
    "@type": "BreadcrumbList",
    itemListElement: [
      {
        "@type": "ListItem",
        position: 1,
        name: "IQ Translate",
        item: `${SITE_URL}${localeHome(locale)}`,
      },
      { "@type": "ListItem", position: 2, name: page.name, item: page.url },
    ],
  };
}

// One <script> per page: a @graph keeps the nodes cross-referenced by @id
// instead of repeating the organization in every block.
export function graphLd(nodes: object[]) {
  return { "@context": "https://schema.org", "@graph": nodes };
}
