-- Used by better-auth's oauth-provider plugin, which is what lets a client
-- nibrun has never seen — an MCP client, an agent — obtain a token for an owner
-- who says yes to it.
--
-- The plugin's own tables, carried by their own migration rather than an edit to
-- 0003, which is what that file's note asks for. Emitted verbatim by the
-- adapter's `createSchema` for the same reason: it stays diffable against a
-- regenerated schema.
--
-- `jwks` belongs to the jwt plugin, which is here because oauth-provider refuses
-- to resolve a request without it: it signs through that plugin and keeps no
-- keys of its own.
--
-- `oauthClient` is written by dynamic client registration, so rows appear here
-- without anyone at nibrun having done anything. `oauthConsent` is what keeps an
-- owner from being asked twice, and is the row they revoke to take access back.

create table "auth"."jwks" ("id" text not null primary key, "publicKey" text not null, "privateKey" text not null, "createdAt" timestamptz not null, "expiresAt" timestamptz, "alg" text, "crv" text);

create table "auth"."oauthClient" ("id" text not null primary key, "clientId" text not null unique, "clientSecret" text, "clientDiscoveryId" text, "disabled" boolean, "skipConsent" boolean, "enableEndSession" boolean, "subjectType" text, "scopes" text, "clientCredentialsScopes" text, "userId" text references "auth"."user" ("id") on delete cascade, "createdAt" timestamptz, "updatedAt" timestamptz, "name" text, "uri" text, "icon" text, "contacts" text, "tos" text, "policy" text, "softwareId" text, "softwareVersion" text, "softwareStatement" text, "redirectUris" text not null, "postLogoutRedirectUris" text, "backchannelLogoutUri" text, "backchannelLogoutSessionRequired" boolean, "tokenEndpointAuthMethod" text, "applicationType" text, "jwks" text, "jwksUri" text, "grantTypes" text, "responseTypes" text, "requirePKCE" boolean, "dpopBoundAccessTokens" boolean, "referenceId" text, "metadata" text);

create table "auth"."oauthResource" ("id" text not null primary key, "identifier" text not null unique, "name" text not null, "accessTokenTtl" integer, "refreshTokenTtl" integer, "signingAlgorithm" text, "signingKeyId" text, "allowedScopes" text, "customClaims" text, "dpopBoundAccessTokensRequired" boolean, "disabled" boolean, "createdAt" timestamptz, "updatedAt" timestamptz, "policyVersion" integer, "metadata" text);

create table "auth"."oauthClientResource" ("id" text not null primary key, "clientId" text not null references "auth"."oauthClient" ("clientId") on delete cascade, "resourceId" text not null references "auth"."oauthResource" ("identifier") on delete cascade, "metadata" text, "createdAt" timestamptz);

create table "auth"."oauthRefreshToken" ("id" text not null primary key, "token" text not null unique, "clientId" text not null references "auth"."oauthClient" ("clientId") on delete cascade, "sessionId" text references "auth"."session" ("id") on delete set null, "userId" text not null references "auth"."user" ("id") on delete cascade, "referenceId" text, "authorizationCodeId" text, "resources" text, "requestedUserInfoClaims" text, "expiresAt" timestamptz not null, "createdAt" timestamptz not null, "revoked" timestamptz, "rotatedAt" timestamptz, "rotationReplayResponse" text, "rotationReplayExpiresAt" timestamptz, "authTime" timestamptz, "confirmation" text, "scopes" text not null);

create table "auth"."oauthAccessToken" ("id" text not null primary key, "token" text not null unique, "clientId" text not null references "auth"."oauthClient" ("clientId") on delete cascade, "sessionId" text references "auth"."session" ("id") on delete set null, "userId" text references "auth"."user" ("id") on delete cascade, "referenceId" text, "authorizationCodeId" text, "resources" text, "requestedUserInfoClaims" text, "refreshId" text references "auth"."oauthRefreshToken" ("id") on delete cascade, "expiresAt" timestamptz not null, "createdAt" timestamptz not null, "revoked" timestamptz, "confirmation" text, "scopes" text not null);

create table "auth"."oauthConsent" ("id" text not null primary key, "clientId" text not null references "auth"."oauthClient" ("clientId") on delete cascade, "userId" text references "auth"."user" ("id") on delete cascade, "referenceId" text, "resources" text, "requestedUserInfoClaims" text, "scopes" text not null, "createdAt" timestamptz not null, "updatedAt" timestamptz not null);

create table "auth"."oauthClientAssertion" ("id" text not null primary key, "expiresAt" timestamptz not null);

create index "oauthClient_userId_idx" on "auth"."oauthClient" ("userId");

create index "oauthClientResource_clientId_idx" on "auth"."oauthClientResource" ("clientId");

create index "oauthClientResource_resourceId_idx" on "auth"."oauthClientResource" ("resourceId");

create index "oauthRefreshToken_clientId_idx" on "auth"."oauthRefreshToken" ("clientId");

create index "oauthRefreshToken_sessionId_idx" on "auth"."oauthRefreshToken" ("sessionId");

create index "oauthRefreshToken_userId_idx" on "auth"."oauthRefreshToken" ("userId");

create index "oauthRefreshToken_authorizationCodeId_idx" on "auth"."oauthRefreshToken" ("authorizationCodeId");

create index "oauthAccessToken_clientId_idx" on "auth"."oauthAccessToken" ("clientId");

create index "oauthAccessToken_sessionId_idx" on "auth"."oauthAccessToken" ("sessionId");

create index "oauthAccessToken_userId_idx" on "auth"."oauthAccessToken" ("userId");

create index "oauthAccessToken_authorizationCodeId_idx" on "auth"."oauthAccessToken" ("authorizationCodeId");

create index "oauthAccessToken_refreshId_idx" on "auth"."oauthAccessToken" ("refreshId");

create index "oauthConsent_clientId_idx" on "auth"."oauthConsent" ("clientId");

create index "oauthConsent_userId_idx" on "auth"."oauthConsent" ("userId");

create unique index "oauthClientResource_clientId_resourceId_uidx" on "auth"."oauthClientResource" ("clientId", "resourceId");
