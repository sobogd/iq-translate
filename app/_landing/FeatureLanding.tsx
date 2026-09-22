import type { LucideIcon } from "lucide-react";
import { Mic, Volume2, Keyboard, Copy, Globe2, Languages, RefreshCw, History } from "lucide-react";
import { DesktopShell } from "./desktop/DesktopShell";
import { mergeTaskbarTexts } from "./desktop/taskbar-texts";
import { Translator } from "./Translator";
import { Spotlights } from "./Spotlights";
import { Comparison } from "./Comparison";
import { Faq } from "./Faq";
import { Breadcrumbs } from "./Breadcrumbs";
import { RelatedPairs } from "./RelatedPairs";
import { FinalCta } from "./FinalCta";
import { Band } from "./shell";
import { localeHome, localePath } from "@/lib/locale-paths";
import { relatedPairs } from "@/lib/pairs";
import type { Locale } from "@/lib/locales";
import { breadcrumbLd, faqPageLd, graphLd, organizationLd, softwareApplicationLd, webSiteLd } from "@/lib/structured-data";
import { SessionProvider } from "./session";
import type { TranslatorTexts, FeatureContent } from "./types";

// Icon set for a pair page's spotlight sections, keyed by which feature the
// page targets (icon choice lives in code, copy lives in the pair JSON).
const SPOTLIGHT_ICONS: Record<string, LucideIcon[][]> = {
  text: [
    [Keyboard, Copy],
    [Globe2, History],
  ],
  voice: [
    [Mic, Volume2],
    [Globe2, Languages],
  ],
  // Pair pages carry 4 feature sections (vs 3 on the generic feature pages).
  pair: [
    [Mic, Volume2],
    [RefreshCw, History],
    [Globe2, Languages],
    [Keyboard, Copy],
  ],
};

// Shared template for every SEO language-pair page. Like every other page it
// uses the desktop chrome: the SAME fixed translator block on top (seeded with
// the page's own pair, but the pair is always switchable), and below it a
// simple typographic content column — breadcrumbs, the page heading +
// subheading, feature sections, related pairs, FAQ and the closing CTA.
export function FeatureLanding({
  locale,
  chrome,
  content,
  icons,
  pathname,
  presetSource,
  presetTarget,
}: {
  locale: Locale;
  chrome: TranslatorTexts;
  content: FeatureContent;
  icons: "text" | "voice" | "pair";
  pathname: string;
  /** Language-pair preset for the translator widget (pair pages only). */
  presetSource?: string;
  presetTarget?: string;
}) {
  // Anchor text is looked up in the locale's own link list rather than
  // rebuilt from the slug, so it stays translated and stays in sync.
  const labelFor = (slug: string) =>
    chrome.footer.featureLinks.find((l) => l.routeKey.replace(/^\//, "") === slug)?.label;
  const related = relatedPairs(locale, pathname.replace(/^\/([a-z]{2}\/)?/, ""))
    .map((p) => ({ href: localePath(p.locale, p.slug), label: labelFor(p.slug) }))
    .filter((l): l is { href: string; label: string } => Boolean(l.label));

  const jsonLd = graphLd([
    organizationLd(),
    webSiteLd(locale),
    softwareApplicationLd(content.meta.description),
    // Home > this page: the pair pages are one level deep in every locale.
    breadcrumbLd(locale, { name: content.hero.title, url: content.meta.canonical }),
    faqPageLd(content.faq.items),
  ]);

  const pricingHref = localePath(locale, "pricing");
  const homeHref = localeHome(locale);

  return (
    <SessionProvider locale={locale} page="Pair">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <DesktopShell
        locale={locale}
        homeHref={homeHref}
        headerTexts={mergeTaskbarTexts(chrome.header)}
        accountTexts={chrome.account}
        pricingHref={pricingHref}
        featureLinks={chrome.footer.featureLinks}
        product={
          <Translator
            texts={chrome}
            presetSource={presetSource}
            presetTarget={presetTarget}
          />
        }
      >
        {/* The content column below the translator: heading + subheading, then
            one plain typographic column — no cards, no dividers. */}
        <Band section="pair-content" className="px-6 pb-16 pt-8 sm:px-8 sm:pb-24 sm:pt-10">
          <div className="flex w-full max-w-[760px] flex-col">
            <Breadcrumbs
              homeHref={homeHref}
              homeLabel={chrome.footer.brand}
              current={content.hero.title}
            />
            <div className="mt-10 flex flex-col gap-y-14 sm:mt-12">
              <div className="flex flex-col items-start gap-3">
                <h1 className="text-balance text-3xl font-semibold leading-[1.15] tracking-tight text-text sm:text-4xl">
                  {content.hero.title}{" "}
                  <span className="text-button">{content.hero.titleAccent}</span>
                </h1>
                <p className="text-pretty text-[17px] leading-relaxed text-text/80 sm:text-lg">
                  {content.hero.description}
                </p>
              </div>
              <Spotlights items={content.spotlights} icons={SPOTLIGHT_ICONS[icons]} />
              {related.length > 0 && (
                <RelatedPairs heading={chrome.footer.pairsHeading} links={related} />
              )}
              <Comparison texts={content.comparison} />
              <Faq
                heading={content.faq.heading}
                headingAccent={content.faq.headingAccent}
                sub={content.faq.sub}
                items={content.faq.items}
              />
              <FinalCta
                heading={content.finalCta.heading}
                headingAccent={content.finalCta.headingAccent}
                sub={content.finalCta.sub}
                ctaLabel={content.finalCta.ctaLabel}
                ctaHref={homeHref}
              />
            </div>
          </div>
        </Band>
      </DesktopShell>
    </SessionProvider>
  );
}
