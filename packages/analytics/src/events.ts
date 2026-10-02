export type DeploymentContext = {
  identity_state: string;
  operation: 'create' | 'update' | 'retry';
  binary_delivery: string;
  has_initial_data: boolean;
  preset_slug: string | undefined;
};

export type AnalyticsEventData = {
  deploy_cta_clicked: {
    cta_placement: 'header' | 'footer' | 'preset';
    preset_slug: string | undefined;
  };
  agent_prompt_copied: { preset_slug: string | undefined };
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
};

export type AnalyticsEvent = {
  [Name in keyof AnalyticsEventData]: { name: Name; data: AnalyticsEventData[Name] };
}[keyof AnalyticsEventData];
