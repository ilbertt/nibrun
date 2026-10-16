ALTER TABLE nibrun.deployments
  ADD COLUMN mcp_client_id text;

COMMENT ON COLUMN nibrun.deployments.mcp_client_id IS
  $c$OAuth client that initiated this deployment; CIMD clients need not have a local registration row. @type import('#lib/api/identifiers.ts').OAuthClientId$c$;
