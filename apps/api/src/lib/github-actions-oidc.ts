import { type Static, Type } from '@sinclair/typebox';

export const GITHUB_ACTIONS_OIDC_ISSUER = 'https://token.actions.githubusercontent.com';
export const GITHUB_ACTIONS_OIDC_JWKS_URL = `${GITHUB_ACTIONS_OIDC_ISSUER}/.well-known/jwks`;
export const GITHUB_ACTIONS_OIDC_AUDIENCE = 'https://nibrun.com';

const nonemptyString = Type.String({ minLength: 1 });
const identifier = Type.String({ pattern: '^[1-9][0-9]*$' });
const timestamp = Type.Integer({ minimum: 0 });
const commitSha = Type.String({ pattern: '^(?:[0-9a-f]{40}|[0-9a-f]{64})$' });

export const GitHubActionsOidcClaimsSchema = Type.Object({
  iss: Type.Literal(GITHUB_ACTIONS_OIDC_ISSUER),
  aud: Type.Union([nonemptyString, Type.Array(nonemptyString, { minItems: 1 })]),
  sub: nonemptyString,
  jti: nonemptyString,
  iat: timestamp,
  nbf: timestamp,
  exp: timestamp,
  repository: Type.String({ pattern: '^[^/\\s]+/[^/\\s]+$' }),
  repository_id: identifier,
  repository_owner: nonemptyString,
  repository_owner_id: identifier,
  workflow_ref: nonemptyString,
  ref: nonemptyString,
  event_name: nonemptyString,
  sha: commitSha,
  run_id: identifier,
  run_attempt: identifier,
  environment: Type.Optional(nonemptyString),
  job_workflow_ref: Type.Optional(nonemptyString),
  job_workflow_sha: Type.Optional(commitSha),
});

export type GitHubActionsOidcClaims = Static<typeof GitHubActionsOidcClaimsSchema>;
