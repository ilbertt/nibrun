import type { DeployPhase } from '#lib/hooks/use-run-app.ts';

/** What a dialog says of a release it is showing, rather than of the form that asks for one. */
export function describeRelease(phase: DeployPhase): string {
  return phase === 'done'
    ? 'It is live. This stays open until you leave for it.'
    : 'The release is on its way. Closing this does not stop it.';
}
