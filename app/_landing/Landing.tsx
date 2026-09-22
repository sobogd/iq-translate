import { DesktopShell } from "./desktop/DesktopShell";
import { mergeTaskbarTexts } from "./desktop/taskbar-texts";
import { Translator } from "./Translator";
import { StatCards } from "./StatCards";
import { Spotlights } from "./Spotlights";
import { Comparison } from "./Comparison";
import { Faq } from "./Faq";
import { FinalCta } from "./FinalCta";
import { Band } from "./shell";
import { localePath } from "@/lib/locale-paths";
import type { Locale } from "@/lib/locales";
import { faqPageLd, graphLd, organizationLd, softwareApplicationLd, webSiteLd } from "@/lib/structured-data";
import { SessionProvider } from "./session";
import type { TranslatorTexts } from "./types";

// The locale home. Every page lives in the desktop chrome: the translator is
// the SAME fixed block pinned at the top of the window on every page, and
// below it the content part scrolls — a plain typographic column that opens
// with the page's heading + subheading (the hero copy) and runs through the
// marketing sections with no cards.
export function Landing({
  locale,
  texts,
  homeHref,
}: {
  locale: Locale;
  texts: TranslatorTexts;
  homeHref: string;
}) {
  // The widget defaults its target to the page's own language (a /lv visitor
  // most likely translates INTO Latvian's pair, not Spanish); a previously
  // saved localStorage choice still wins over this soft default.
  const jsonLd = graphLd([
    organizationLd(),
    webSiteLd(locale),
    softwareApplicationLd(texts.meta.description),
    faqPageLd(texts.faq.items),
  ]);

  const pricingHref = localePath(locale, "pricing");

  return (
    <SessionProvider locale={locale} page="Home">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <DesktopShell
        locale={locale}
        homeHref={homeHref}
        headerTexts={mergeTaskbarTexts(texts.header)}
        accountTexts={texts.account}
        pricingHref={pricingHref}
        featureLinks={texts.footer.featureLinks}
        product={
          <Translator texts={texts} initialTarget={locale} />
        }
      >
        {/* Heading + subheading of the page, then the marketing sections — one
            running column of type (no cards, no dividers). */}
        <Band id="hero" section="hero" className="px-6 pb-12 pt-8 sm:px-8 sm:pb-16 sm:pt-10">
          <div className="flex w-full max-w-[760px] flex-col items-start gap-3">
            <h1 className="text-balance text-3xl font-semibold leading-[1.15] tracking-tight text-text sm:text-4xl">
              {texts.hero.title}{" "}
              <span className="text-button">{texts.hero.titleAccent}</span>
            </h1>
            <p className="text-pretty text-[17px] leading-relaxed text-text/80 sm:text-lg">
              {texts.hero.description}
            </p>
          </div>
        </Band>

        <Band section="stats" className="px-6 pb-12 sm:px-8 sm:pb-16">
          <StatCards items={texts.statCards} />
        </Band>

        <Band id="features" section="features" className="px-6 pb-12 sm:px-8 sm:pb-16">
          <Spotlights items={texts.spotlights} />
        </Band>

        <Band id="comparison" section="comparison" className="px-6 pb-12 sm:px-8 sm:pb-16">
          <Comparison texts={texts.comparison} />
        </Band>

        <Band id="faq" section="faq" className="px-6 pb-12 sm:px-8 sm:pb-16">
          <Faq
            heading={texts.faq.heading}
            headingAccent={texts.faq.headingAccent}
            sub={texts.faq.sub}
            items={texts.faq.items}
          />
        </Band>

        <Band section="final_cta" className="px-6 pb-16 sm:px-8 sm:pb-24">
          <FinalCta
            heading={texts.finalCta.heading}
            headingAccent={texts.finalCta.headingAccent}
            sub={texts.finalCta.sub}
          />
        </Band>
      </DesktopShell>
    </SessionProvider>
  );
}
