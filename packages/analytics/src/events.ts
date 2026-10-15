export type DeploymentContext = {
  identity_state: string;
  operation: 'create' | 'update' | 'retry';
  binary_delivery: string;
  has_initial_data: boolean;
  preset_slug: string | undefined;
};

export const SIGN_IN_REASONS = ['login', 'keep-app', 'mcp'] as const;

export type McpAnalyticsContext = {
  source: 'mcp';
  attempt_id: string;
};

export type SignInAnalyticsContext = Partial<McpAnalyticsContext> & {
  provider?: 'github';
};

export type AnalyticsEventData = {
  mcp_auth_started: McpAnalyticsContext;
  mcp_consent_viewed: McpAnalyticsContext;
  mcp_authorization_denied: McpAnalyticsContext;
  mcp_authorization_completed: McpAnalyticsContext & { duration_ms: number };
  mcp_authorization_failed: McpAnalyticsContext & {
    phase: 'authorization' | 'consent' | 'token';
    error_code: string;
    http_status: number;
  };
  mcp_connected: McpAnalyticsContext & { duration_ms: number };
  sign_up_completed: McpAnalyticsContext & { provider: 'github' };

  pricing_link_clicked: { cta_placement: 'header' };
  pricing_viewed: Record<string, never>;
  pricing_calculated: { app_count: number };
  deploy_cta_clicked: {
    cta_placement: 'header' | 'footer' | 'preset';
    preset_slug: string | undefined;
  };
  agent_prompt_copied: {
    preset_slug: string | undefined;
    purpose: 'create-app' | 'deploy-preset' | 'configure-domain';
  };
  binary_selected: { size_bytes: number };
  binary_handoff_failed: { phase: 'validation' | 'handoff' };
  deploy_form_viewed: {
    identity_state: string;
    operation: Exclude<DeploymentContext['operation'], 'retry'>;
    preset_slug: string | undefined;
  };
  deploy_submitted: DeploymentContext & { attempt_id: string };
  deploy_succeeded: DeploymentContext & {
    attempt_id: string;
    app_id: string;
    deployment_id: string;
    duration_ms: number;
  };
  deploy_failed: DeploymentContext & {
    attempt_id: string;
    app_id: string | undefined;
    duration_ms: number;
    phase: 'authentication' | 'app' | 'binary' | 'initial-data' | 'deployment' | 'settling';
  };
  app_open_clicked: { identity_state: string; app_id: string; placement: 'deployment' | 'app' };
  session_seen: { identity_state: string };
  sign_in_started: SignInAnalyticsContext & {
    identity_state: string;
    reason: (typeof SIGN_IN_REASONS)[number];
  };
  sign_in_completed: SignInAnalyticsContext & {
    account_type?: 'new' | 'existing';
    identity_state: string;
    previous_identity_state: string | undefined;
    reason: (typeof SIGN_IN_REASONS)[number];
  };
  sign_in_failed: SignInAnalyticsContext & {
    phase?: 'start' | 'callback';
    identity_state: string;
    reason: (typeof SIGN_IN_REASONS)[number];
    error_code: string | undefined;
    http_status: number | undefined;
  };
  app_claimed: { identity_state: string; app_id: string };
  app_viewed: { identity_state: string; app_id: string; tab: string };
  app_action_completed: { identity_state: string; app_id: string; action: string };
  app_action_failed: { identity_state: string; app_id: string; action: string };
  app_settings_saved: {
    identity_state: string;
    app_id: string;
    area: 'configuration' | 'domains';
    changed_fields: string;
  };
};

export type AnalyticsEvent = {
  [Name in keyof AnalyticsEventData]: { name: Name; data: AnalyticsEventData[Name] };
}[keyof AnalyticsEventData];
