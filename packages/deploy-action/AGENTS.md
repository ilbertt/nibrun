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

`src/main.ts` adapts the client to GitHub Actions through `@actions/core`. The
separate Action repository owns `action.yml` and its public usage documentation,
including the default value for the `api-url` input.

Run `bun run --filter @repo/deploy-action emit` from the monorepo root to emit the
standalone Node 24 Action into `dist/index.mjs`. The generated file is committed so
the Action repository can copy it from a reviewed nibrun commit. Emission runs
directly in build CI.
