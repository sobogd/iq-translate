// Human labels for the `data-section` hooks the scroll tracker reads.
//
// The tokens are DOM hooks first ("final_cta", "stats"); the raw slug means
// nothing to whoever reads a visit timeline, so each one gets a label here.
// Ported in spirit from iq-rest's apps/landing/lib/track-keys.ts, shrunk to the
// handful of sections this site actually has.

const SECTION_LABEL: Record<string, string> = {
  widget: "Translator widget",
  stats: "Trust stats",
  features: "Features",
  comparison: "Comparison",
  faq: "FAQ",
  final_cta: "Final CTA",
  legal: "Legal text",
  footer: "Footer",
};

/** Separators to spaces, first letter up — an unmapped token still reads like a
 *  label instead of like a database key. */
function humanize(token: string): string {
  const words = token.replace(/[_-]+/g, " ").trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : "";
}

export function sectionLabel(raw: string): string {
  return SECTION_LABEL[raw] || humanize(raw) || "Section";
}
