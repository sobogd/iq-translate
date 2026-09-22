-- Photos, quotas/plans/Stripe and topic-sessions all go away.
--
-- What remains: one conversation per (owner, language pair), free for
-- everyone, text and voice only. Ownership is a verified email or the
-- anonymous cookie id; sign-in merges the latter into the former in the app
-- (lib/merge-conversations.ts), which is why the owner column stays a plain
-- string. Sessions and OTP challenges stay — all three sign-in methods remain.

-- 1. Old history has no place in the pair model (a topic was an independent
--    session with a nullable source language and a title); wiped as requested.
DELETE FROM "translations";
DELETE FROM "topics";

-- 2. Billing and quota tables are gone. Anonymous usage is no longer metered.
DROP TABLE IF EXISTS "stripe_events";
DROP TABLE IF EXISTS "anonymous_credits";
DROP TABLE IF EXISTS "accounts";

-- 3. topics -> conversations, one row per pair.
ALTER TABLE "topics" RENAME TO "conversations";
ALTER TABLE "conversations" DROP COLUMN "title";
ALTER TABLE "conversations" ALTER COLUMN "sourceLang" SET NOT NULL;
ALTER TABLE "conversations" ALTER COLUMN "writeLang" SET NOT NULL;

-- 4. translations.topicId -> conversationId, constraint and index included.
ALTER TABLE "translations" RENAME COLUMN "topicId" TO "conversationId";
ALTER TABLE "translations" RENAME CONSTRAINT "translations_topicId_fkey" TO "translations_conversationId_fkey";
DROP INDEX "translations_topicId_idx";
CREATE INDEX "translations_conversationId_idx" ON "translations"("conversationId");

-- 5. Photo translations are gone.
ALTER TABLE "translations" DROP COLUMN "imageUrl";

-- 6. Retention: turns older than a year are pruned (lib/maintenance.ts).
CREATE INDEX "translations_createdAt_idx" ON "translations"("createdAt");

-- 7. One row per (owner, pair); the old non-unique owner index is replaced.
ALTER INDEX "topics_pkey" RENAME TO "conversations_pkey";
DROP INDEX "topics_ownerKey_idx";
CREATE INDEX "conversations_ownerKey_idx" ON "conversations"("ownerKey");
CREATE UNIQUE INDEX "conversations_ownerKey_sourceLang_targetLang_key"
  ON "conversations"("ownerKey", "sourceLang", "targetLang");
