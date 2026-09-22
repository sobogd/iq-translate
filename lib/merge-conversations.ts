import { prisma } from "./prisma";
import { anonIdFrom } from "./auth";

// Hand a signed-in visitor the history they built before signing in.
//
// Before sign-in a browser owns its conversations through the anonymous id
// cookie ("an:<id>", see lib/auth.ts). All three sign-in methods end here: the
// anonymous rows are re-keyed to the verified email. A pair the account
// already has is *merged* — its turns move into the account's row and the
// anonymous row is dropped — so signing in never splits one language pair into
// two, and never loses a turn.
//
// Runs once per sign-in. A browser without the cookie has nothing to hand over.
export async function mergeAnonymousHistory(req: Request, email: string): Promise<void> {
  const anonId = anonIdFrom(req.headers);
  if (!anonId) return;
  const anonKey = `an:${anonId}`;

  const anonRows = await prisma.conversation.findMany({ where: { ownerKey: anonKey } });
  if (anonRows.length === 0) return;

  for (const anon of anonRows) {
    // Per pair, in its own transaction: a failure on one pair must not leave
    // the others half-moved.
    await prisma.$transaction(async (tx) => {
      const existing = await tx.conversation.findUnique({
        where: {
          ownerKey_sourceLang_targetLang: {
            ownerKey: email,
            sourceLang: anon.sourceLang,
            targetLang: anon.targetLang,
          },
        },
      });

      if (!existing) {
        // No account row for this pair yet — the anonymous one simply becomes
        // the account's.
        await tx.conversation.update({ where: { id: anon.id }, data: { ownerKey: email } });
        return;
      }

      await tx.translation.updateMany({
        where: { conversationId: anon.id },
        data: { conversationId: existing.id },
      });
      await tx.conversation.delete({ where: { id: anon.id } });
      await tx.conversation.update({ where: { id: existing.id }, data: { lastUsedAt: new Date() } });
    });
  }
}
