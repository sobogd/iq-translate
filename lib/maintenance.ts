import { prisma } from "./prisma";

// Retention-only prune.
//
// Conversation history is anonymous or account-owned and the visitor can clear
// it at any time; this is the safety net that bounds how long a forgotten
// conversation lives, and it is what satisfies GDPR's storage-limitation
// principle. It rides along with a request the app already makes constantly
// (at most once an hour per process) rather than needing a cron on this box.

const EVERY_MS = 3600_000;
/** One year is a deliberate, documented cap — the policy states it. GDPR asks
 *  for a defined retention period, not a short one. */
const KEEP_DAYS = 365;

let nextRunAt = 0;

export function maybePrune(): void {
  const now = Date.now();
  if (now < nextRunAt) return;
  nextRunAt = now + EVERY_MS;
  void (async () => {
    try {
      const cutoff = new Date(now - KEEP_DAYS * 86_400_000);
      // Expired sessions used to be pruned here too; that moved out because
      // they are now the only thing the auth flow writes and the sweep below
      // is no longer the only place that deletes them.
      await prisma.session.deleteMany({ where: { expiresAt: { lt: new Date() } } });
      await prisma.translation.deleteMany({ where: { createdAt: { lt: cutoff } } });
      // The pair row goes too, unless a young turn was added after the last
      // sweep and its lastUsedAt is still inside the window.
      await prisma.conversation.deleteMany({
        where: { lastUsedAt: { lt: cutoff }, translations: { none: {} } },
      });
    } catch (err) {
      console.error("[maintenance] prune failed", err);
    }
  })();
}
