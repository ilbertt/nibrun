export type AnalyticsEventData = {
  deploy_cta_clicked: {
    cta_placement: 'header' | 'footer' | 'preset';
    preset_slug: string | undefined;
  };
  agent_prompt_copied: { preset_slug: string | undefined };
  binary_selected: { size_bytes: number };
  binary_handoff_failed: { phase: 'validation' | 'handoff' };
};

export type AnalyticsEvent = {
  [Name in keyof AnalyticsEventData]: { name: Name; data: AnalyticsEventData[Name] };
}[keyof AnalyticsEventData];
