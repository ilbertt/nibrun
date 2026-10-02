import { type AnalyticsEventData, trackEvent } from '@repo/analytics';
import type { AppOperation } from '@repo/app-operations';
import { useSessionIdentity } from '#lib/hooks/use-session-identity.ts';

type SettingsChange = Pick<AnalyticsEventData['app_settings_saved'], 'area' | 'changed_fields'>;
type TrackedOperation<Result> = { action: AppOperation; task: () => Promise<Result> };
type AppAnalytics = {
  run: <Result>(input: TrackedOperation<Result>) => Promise<Result>;
  failed: (action: AppOperation) => void;
  settingsSaved: (change: SettingsChange) => void;
};

export function useAppAnalytics(appId: string): AppAnalytics {
  const identity = useSessionIdentity();

  async function run<Result>({ action, task }: TrackedOperation<Result>): Promise<Result> {
    try {
      const result = await task();
      trackEvent({
        name: 'app_action_completed',
        data: { identity_state: identity, app_id: appId, action },
      });
      return result;
    } catch (error) {
      failed(action);
      throw error;
    }
  }

  function failed(action: AppOperation): void {
    trackEvent({
      name: 'app_action_failed',
      data: { identity_state: identity, app_id: appId, action },
    });
  }

  function settingsSaved(change: SettingsChange): void {
    trackEvent({
      name: 'app_settings_saved',
      data: { identity_state: identity, app_id: appId, ...change },
    });
  }

  return { run, failed, settingsSaved };
}
