import { expect, test } from 'bun:test';
import type { AnalyticsEvent } from '@repo/analytics';
import { DEPLOY_PRESETS } from '@repo/deploy-link';
import { DeploymentAnalytics, presetForBinary } from '#lib/deployment-analytics.ts';
import { SessionIdentity } from '#lib/session-identity.ts';

test('a visitor can deploy anonymously and only a running result counts as success', () => {
  const events: AnalyticsEvent[] = [];
  const analytics = new DeploymentAnalytics({
    data: {
      identity_state: SessionIdentity.Visitor,
      operation: 'create',
      binary_delivery: 'fetch',
      has_initial_data: false,
      preset_slug: 'pocketbase',
    },
    emit: (event) => events.push(event),
  });
  analytics.authenticating();
  analytics.authenticated(SessionIdentity.Anonymous);
  analytics.step({ kind: 'app', appId: 'app', name: 'private-name' });
  analytics.step({
    kind: 'artifact',
    artifactId: 'artifact',
    digest: 'private-digest',
    reused: false,
  });
  analytics.step({ kind: 'deployment', deploymentId: 'deployment' });
  expect(events.map((event) => event.name)).toEqual(['deploy_submitted']);
  analytics.succeeded({
    appId: 'app',
    deploymentId: 'deployment',
    name: 'private-name',
    url: 'https://private.example',
  });
  analytics.failed();
  expect(events.map((event) => event.name)).toEqual(['deploy_submitted', 'deploy_succeeded']);
  expect(events[0]?.data).toMatchObject({ identity_state: SessionIdentity.Visitor });
  const submitted = events.find((event) => event.name === 'deploy_submitted')!;
  expect(events[1]?.data).toMatchObject({
    identity_state: SessionIdentity.Anonymous,
    app_id: 'app',
    deployment_id: 'deployment',
    attempt_id: submitted.data.attempt_id,
  });
  expect(JSON.stringify(events)).not.toContain('private');
});

test('failed initial data uploads retain their phase and each retry gets a new attempt', () => {
  const events: AnalyticsEvent[] = [];
  function emit(event: AnalyticsEvent): void {
    events.push(event);
  }
  const data = {
    identity_state: SessionIdentity.WithAccount,
    operation: 'update' as const,
    binary_delivery: 'upload',
    has_initial_data: true,
    preset_slug: undefined,
  };
  const first = new DeploymentAnalytics({ data, emit });
  first.step({ kind: 'app', appId: 'app', name: 'private-name' });
  first.step({ kind: 'artifact', artifactId: 'artifact', digest: 'digest', reused: false });
  first.failed();
  expect(events.at(-1)?.data).toMatchObject({ phase: 'initial-data', app_id: 'app' });
  const retry = new DeploymentAnalytics({ data, emit });
  retry.authenticating();
  retry.failed();
  expect(events.at(-1)?.data).toMatchObject({ phase: 'authentication' });
  const attempts = events
    .filter((event) => event.name === 'deploy_submitted')
    .map((event) => (event.data as { attempt_id: string }).attempt_id);
  expect(new Set(attempts).size).toBe(attempts.length);
});

test('only known catalog binaries receive a preset label', () => {
  expect(presetForBinary(DEPLOY_PRESETS.pocketbase.deployLink.binary)).toBe('pocketbase');
  expect(presetForBinary('https://private.example/binary?token=secret')).toBeUndefined();
  expect(presetForBinary(undefined)).toBeUndefined();
});
