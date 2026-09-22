import { DesktopShell } from "./desktop/DesktopShell";
import { mergeTaskbarTexts } from "./desktop/taskbar-texts";
import { Breadcrumbs } from "./Breadcrumbs";
import { FinalCta } from "./FinalCta";
import { Band } from "./shell";
import { localeHome, localePath } from "@/lib/locale-paths";
import type { Locale } from "@/lib/locales";
import { SITE_URL } from "@/lib/site";
import { breadcrumbLd, graphLd, organizationLd, softwareApplicationLd, webSiteLd } from "@/lib/structured-data";
import { SessionProvider } from "./session";
import type { TranslatorTexts } from "./types";

// The localized /pricing page, dressed in the same desktop chrome as every
// other page. There is nothing to price any more — text and voice translation
// are free for everyone and not metered — so the page states that instead of
// listing plans. Copy comes from the locale's own chrome (texts.pricing).
export function PricingPage({
  locale,
  chrome,
}: {
  locale: Locale;
  chrome: TranslatorTexts;
}) {
  const p = chrome.pricing;
  const pathname = localePath(locale, "pricing");
  const homeHref = localeHome(locale);
  const jsonLd = graphLd([
    organizationLd(),
    webSiteLd(locale),
    softwareApplicationLd(p.meta.description),
    // Same string the visible crumb renders — the nav label, not the hero
    // heading, which reads as a sentence rather than a page name.
    breadcrumbLd(locale, { name: chrome.header.pricing, url: `${SITE_URL}${pathname}` }),
  ]);
  return (
    <SessionProvider locale={locale} page="Pricing">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <DesktopShell
        locale={locale}
        homeHref={homeHref}
        headerTexts={mergeTaskbarTexts(chrome.header)}
        accountTexts={chrome.account}
        pricingHref={pathname}
        featureLinks={chrome.footer.featureLinks}
      >
        <Band section="pricing" className="px-6 pb-16 pt-8 sm:px-8 sm:pb-24 sm:pt-10">
          <div className="flex w-full max-w-[760px] flex-col">
            <Breadcrumbs
              homeHref={homeHref}
              homeLabel={chrome.footer.brand}
              current={chrome.header.pricing}
            />
            <div className="mt-10 flex flex-col gap-y-14 sm:mt-12">
              <div className="flex flex-col gap-3">
                <h1 className="text-balance text-3xl font-semibold leading-[1.15] tracking-tight text-text sm:text-4xl">
                  {p.freeNote.title}
                </h1>
                <p className="max-w-[62ch] text-pretty text-[15px] leading-relaxed text-text/75 sm:text-base">
                  {p.freeNote.sub}
                </p>
              </div>
              <FinalCta
                heading={p.finalCta.heading}
                headingAccent={p.finalCta.headingAccent}
                sub={p.finalCta.sub}
                ctaLabel={p.finalCta.ctaLabel}
                ctaHref={homeHref}
              />
            </div>
          </div>
        </Band>
      </DesktopShell>
    </SessionProvider>
  );
}
