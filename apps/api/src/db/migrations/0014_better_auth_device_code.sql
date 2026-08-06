-- Used by better-auth's device-authorization plugin

-- The plugin's own table, carried by its own migration rather than an edit to
-- 0003, which is what that file's note asks for. Emitted verbatim by the
-- adapter's `createSchema` for the same reason: it stays diffable against a
-- regenerated schema.
--
-- A row is a login in progress. It is written when a CLI asks for a code, read
-- on every poll and on the owner's approval, and expires on its own.

create table "auth"."deviceCode" ("id" text not null primary key, "deviceCode" text not null, "userCode" text not null, "userId" text, "expiresAt" timestamptz not null, "status" text not null, "lastPolledAt" timestamptz, "pollingInterval" integer, "clientId" text, "scope" text);
