# @repo/deploy-action

Reusable GitHub OIDC deployment client for the
[deployment Action](https://github.com/nibrunhq/deploy-action).

`DeploymentCredentials` exchanges GitHub identity for temporary app-scoped access;
`deployBinary` uploads a compiled binary and requests deployment. Callers provide
identity acquisition and secret masking. API calls use `@repo/api-client/public`
and shared static defaults from `@repo/api-constants`.

Run `bun run test --filter=@repo/deploy-action` from the monorepo root to test the
client. Tests cover token renewal, secret masking, upload completion, and failure
cleanup.
