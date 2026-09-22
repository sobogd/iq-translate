export type FaqItem = { q: string; a: string };

const DEFAULT_ITEMS: FaqItem[] = [
  {
    q: "How does voice translation work?",
    a: "Tap the mic and speak — your voice is transcribed and translated in a few seconds, shown as text and available to hear read aloud. No typing needed.",
  },
  {
    q: "How many languages are supported?",
    a: "186 languages. Pick your own language once, then start a conversation thread with anyone else's.",
  },
  {
    q: "Do I need to create an account?",
    a: "No. Try it right on this page with no sign-up. Sign in with email, Google or Apple only if you want your history attached to an account instead of just this browser.",
  },
  {
    q: "Is my translation history saved?",
    a: "Yes, one history per language pair — even without signing in, your browser is remembered. Clear a pair's history anytime from the trash button above the chat.",
  },
  {
    q: "Can I use text instead of voice?",
    a: "Yes. Switch to keyboard mode anytime and type your message instead of speaking.",
  },
  {
    q: "Does it work for two-way conversation?",
    a: "Yes. Tap or swipe a translated line to flip between the original and the translation, so both sides can follow along on one screen.",
  },
];

// FAQ as one full-width column of type: the heading block on top, then every
// question and its answer beneath it. No sticky side column, no grid
// (mirrors iq-mermaid's Faq).
export function Faq({
  heading = "Frequently asked",
  headingAccent = "questions",
  sub = "What people ask before trying it. No sign-up needed — scroll up and try it yourself.",
  items = DEFAULT_ITEMS,
}: {
  heading?: string;
  headingAccent?: string;
  sub?: string;
  items?: FaqItem[];
}) {
  return (
    <div className="flex flex-col gap-y-12">
      <div className="flex flex-col items-start gap-3">
        <h2 className="text-2xl font-semibold leading-[1.15] tracking-tight text-text sm:text-3xl">
          {heading} {headingAccent}
        </h2>
        <p className="max-w-[62ch] text-[15px] leading-relaxed text-text/75">{sub}</p>
      </div>

      <div className="flex flex-col gap-y-8">
        {items.map((item) => (
          <section key={item.q} className="flex flex-col gap-2">
            <h3 className="text-lg font-semibold leading-snug tracking-tight text-text">{item.q}</h3>
            <p className="text-[15px] leading-relaxed text-text/75">{item.a}</p>
          </section>
        ))}
      </div>
    </div>
  );
}
