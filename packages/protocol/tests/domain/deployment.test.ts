import { describe, expect, test } from 'bun:test';
import { describeUnservedDeployment } from '#domain/deployment.ts';

describe('a release that settled without serving accounts for itself', () => {
  test("the host's own words are carried through where it left any", () => {
    expect(
      describeUnservedDeployment({
        id: 'dep-1',
        state: 'failed',
        message: 'No host started this deployment in time.',
      }),
    ).toBe('Deployment dep-1 is failed. No host started this deployment in time.');
  });

  // A release can end without the host having said anything about it, and a trailing separator
  // dangling off the state would read as an account that went missing.
  test('and one that said nothing still names the state it reached', () => {
    expect(describeUnservedDeployment({ id: 'dep-1', state: 'superseded' })).toBe(
      'Deployment dep-1 is superseded.',
    );
  });
});
