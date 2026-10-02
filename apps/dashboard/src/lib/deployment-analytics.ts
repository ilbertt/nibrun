import type { AnalyticsEventData, DeploymentContext, trackEvent } from '@repo/analytics';
import type { Deployed, DeployStep } from '@repo/app-operations';
import { DEPLOY_PRESETS } from '@repo/deploy-link';

export function presetForBinary(binary: string | undefined): string | undefined {
  if (binary === undefined) {
    return undefined;
  }
  const matches = Object.entries(DEPLOY_PRESETS).filter(
    ([, preset]) => preset.deployLink.binary === binary,
  );
  return matches.length === 1 ? matches[0]?.[0] : undefined;
}

export class DeploymentAnalytics {
  private readonly attemptId = crypto.randomUUID();
  private readonly startedAt = performance.now();
  private readonly data: DeploymentContext;
  private readonly emit: typeof trackEvent;
  private phase: AnalyticsEventData['deploy_failed']['phase'] = 'app';
  private appId: string | undefined;
  private finished = false;

  constructor({ data, emit }: { data: DeploymentContext; emit: typeof trackEvent }) {
    this.data = { ...data };
    this.emit = emit;
    this.emit({ name: 'deploy_submitted', data: { ...this.data, attempt_id: this.attemptId } });
  }

  authenticating(): void {
    this.phase = 'authentication';
  }

  authenticated(identity: string): void {
    this.data.identity_state = identity;
    this.phase = 'app';
  }

  step(step: DeployStep): void {
    if (step.kind === 'app') {
      this.appId = step.appId;
      this.phase = this.data.binary_delivery === 'none' ? 'deployment' : 'binary';
    } else if (step.kind === 'artifact') {
      this.phase = this.data.has_initial_data ? 'initial-data' : 'deployment';
    } else {
      this.phase = 'settling';
    }
  }

  succeeded(deployed: Deployed): void {
    if (this.finished) {
      return;
    }
    this.finished = true;
    this.emit({
      name: 'deploy_succeeded',
      data: {
        ...this.data,
        attempt_id: this.attemptId,
        app_id: deployed.appId,
        deployment_id: deployed.deploymentId,
        duration_ms: Math.round(performance.now() - this.startedAt),
      },
    });
  }

  failed(): void {
    if (this.finished) {
      return;
    }
    this.finished = true;
    this.emit({
      name: 'deploy_failed',
      data: {
        ...this.data,
        attempt_id: this.attemptId,
        app_id: this.appId,
        phase: this.phase,
        duration_ms: Math.round(performance.now() - this.startedAt),
      },
    });
  }
}
