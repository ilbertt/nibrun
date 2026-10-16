ALTER TABLE nibrun.deployments
  ADD COLUMN mcp_chat_id text,
  ADD CONSTRAINT deployments_mcp_chat_requires_client
    CHECK (mcp_chat_id IS NULL OR mcp_client_id IS NOT NULL),
  ADD CONSTRAINT deployments_mcp_chat_nonempty
    CHECK (mcp_chat_id IS NULL OR length(mcp_chat_id) > 0);
