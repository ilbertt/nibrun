-- Used by better-auth's anonymous plugin: a user signed in with no identity, and the row it
-- deletes once that user signs in with one.
--
-- Emitted by the adapter's `createSchema`, as 0003, 0014 and 0034 ask for. The generated
-- schema is whole tables, so what is carried is the one column that appears in `auth."user"`
-- between a run without the plugin and a run with it, spelled as the CLI spelled it. From
-- `apps/api` with its environment set, at the version of better-auth installed:
--
--   bunx --bun auth@1.7.3 generate --config src/lib/auth/better-auth.ts --output <file> -y

ALTER TABLE "auth"."user" ADD COLUMN "isAnonymous" boolean;
