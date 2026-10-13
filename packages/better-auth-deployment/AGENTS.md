# @repo/better-auth-deployment

Internal Better Auth integration for short-lived, app-scoped deployment credentials.

Use the API Key plugin's supported endpoint APIs for credential creation and verification.
The package owns credential configuration, scope checks and Bearer parsing. It has no API,
GitHub, database-repository or environment imports. GitHub OIDC verification, workflow trust,
replay protection and live grant authorization belong to the API.

Keep API-key session impersonation disabled. Issuance and authentication are server-only
Better Auth endpoints; they do not expose public HTTP routes. Tests use a real Better Auth
instance and memory adapter to verify the native credential behavior.

The host registers one native `apiKey` plugin explicitly with this package's deployment
configuration and `deploymentTokenApiKeySchema`. The schema names the physical table
`deploymentToken`; Better Auth still owns the logical `apikey` model. Additional key purposes
use configurations on the same native plugin, never a second `apiKey` registration. Protect
only deployment creation and updates; do not disable native API-key routes globally.
