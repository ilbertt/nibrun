-- better-auth 1.7 recognizes an account by (issuer, accountId) rather than by
-- providerId, so `issuer` is required and every row written before now predates
-- it. GitHub is the only provider here, and a plain OAuth2 provider has no
-- issuer of its own, which better-auth scopes to the synthetic
-- `local:oauth:github` — the value it would write for the same account today.
-- The default is what fills the rows already there and is dropped again, so the
-- column reads as the one `createSchema` emits.
--
-- The index statements are emitted verbatim by the adapter's `createSchema`, as
-- 0003 and 0014 ask for. The unique ones on `deviceCode` are load-bearing: a
-- generated code that is already taken is a unique violation better-auth catches
-- and retries against.

ALTER TABLE "auth"."account" ADD COLUMN "issuer" text NOT NULL DEFAULT 'local:oauth:github';
ALTER TABLE "auth"."account" ALTER COLUMN "issuer" DROP DEFAULT;

create unique index "account_issuer_accountId_uidx" on "auth"."account" ("issuer", "accountId");

create unique index "deviceCode_deviceCode_uidx" on "auth"."deviceCode" ("deviceCode");

create unique index "deviceCode_userCode_uidx" on "auth"."deviceCode" ("userCode");
