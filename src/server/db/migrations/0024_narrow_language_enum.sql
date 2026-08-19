-- Narrow the `language` enum to locales that actually have a message file.
--
-- It listed 11 values: en, bg, es, fr, de, it, pt, ja, ko, zh, ar. Only the first
-- five have translations. A user could therefore persist `ja`, and
-- `src/i18n/config.ts` would fail the message import, silently fall back to
-- English, and still hand the stored locale to next-intl — so dates and numbers
-- formatted as Japanese while every string was English.
--
-- Verified before applying: only `en` (16 users) and `bg` (2) were in use, so no
-- row needs rewriting. The USING clause is a safety net, not a data migration.
--
-- Postgres cannot remove values from an enum in place, so the type is rebuilt.

ALTER TABLE "user" ALTER COLUMN "language" DROP DEFAULT;
--> statement-breakpoint
ALTER TYPE "public"."language" RENAME TO "language_old";
--> statement-breakpoint
CREATE TYPE "public"."language" AS ENUM('en', 'bg', 'es', 'fr', 'de');
--> statement-breakpoint
ALTER TABLE "user"
  ALTER COLUMN "language" TYPE "public"."language"
  USING (
    CASE WHEN "language"::text IN ('en','bg','es','fr','de')
         THEN "language"::text::"public"."language"
         ELSE 'en'::"public"."language"
    END
  );
--> statement-breakpoint
ALTER TABLE "user" ALTER COLUMN "language" SET DEFAULT 'en';
--> statement-breakpoint
DROP TYPE "public"."language_old";
