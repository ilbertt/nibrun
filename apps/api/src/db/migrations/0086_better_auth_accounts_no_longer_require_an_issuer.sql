-- `auth@1.7.25 generate --config scripts/auth-schema.ts` no longer includes issuer.
-- Preserve legacy values using the reversible cleanup in Better Auth's 1.7 upgrade guide:
-- https://better-auth.com/docs/guides/1-7-upgrade-guide#relax-the-constraint
ALTER TABLE "auth"."account" ALTER COLUMN "issuer" DROP NOT NULL;
DROP INDEX "auth"."account_issuer_accountId_uidx";
