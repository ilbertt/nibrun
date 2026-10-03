export type DeploymentContext = {
  identity_state: string;
  operation: 'create' | 'update' | 'retry';
  binary_delivery: string;
  has_initial_data: boolean;
  preset_slug: string | undefined;
};

export const SIGN_IN_REASONS = ['login', 'keep-app'] as const;

export type AnalyticsEventData = {
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
  sign_in_started: { identity_state: string; reason: (typeof SIGN_IN_REASONS)[number] };
  sign_in_completed: {
    identity_state: string;
    previous_identity_state: string | undefined;
    reason: (typeof SIGN_IN_REASONS)[number];
  };
  sign_in_failed: { identity_state: string; reason: (typeof SIGN_IN_REASONS)[number] };
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
