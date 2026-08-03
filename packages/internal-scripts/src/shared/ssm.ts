import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { aws } from '#shared/aws.ts';

const SSM_REGISTRATION_ATTEMPTS = 60;
const DEPLOY_ATTEMPTS = 90;
const POLL_MS = 10_000;
const MS_PER_SECOND = 1000;
const TERMINAL_STATUSES = new Set(['Success', 'Failed', 'Cancelled', 'TimedOut']);

export type SsmInvocation = {
  Status: string;
  StandardOutputContent: string;
  StandardErrorContent: string;
};

// POSIX single quoting: the one form with no metacharacters inside it, so a
// value can never break out of the export line it lands in.
export const quote = (value: string) => `'${value.replaceAll("'", `'\\''`)}'`;

export const exportLine = (env: Record<string, string>) =>
  Object.entries(env)
    .map(([name, value]) => `${name}=${quote(value)}`)
    .join(' ');

export async function findInstanceIds({ deployGroup }: { deployGroup: string }) {
  const output = await aws([
    'ec2',
    'describe-instances',
    '--filters',
    `Name=tag:DeployGroup,Values=${deployGroup}`,
    'Name=instance-state-name,Values=running',
    '--query',
    'Reservations[].Instances[].InstanceId',
    '--output',
    'text',
  ]).text();

  return output.split(/\s+/).filter((id) => id && id !== 'None');
}

// A freshly-created box isn't registered with SSM yet; wait so send-command lands.
export async function waitForSsmRegistration({ instanceId }: { instanceId: string }) {
  for (let attempt = 0; attempt < SSM_REGISTRATION_ATTEMPTS; attempt++) {
    const ping = (
      await aws([
        'ssm',
        'describe-instance-information',
        '--filters',
        `Key=InstanceIds,Values=${instanceId}`,
        '--query',
        'InstanceInformationList[0].PingStatus',
        '--output',
        'text',
      ])
        .nothrow()
        .quiet()
        .text()
    ).trim();

    if (ping === 'Online') {
      return true;
    }
    console.log(`  ${instanceId} ssm ping: ${ping || 'none'}`);
    await Bun.sleep(POLL_MS);
  }
  return false;
}

export async function sendCommand({
  instanceIds,
  script,
  comment,
}: {
  instanceIds: string[];
  script: string;
  comment: string;
}) {
  const parametersPath = join(tmpdir(), `ssm-params-${instanceIds.join('-')}.json`);
  await Bun.write(parametersPath, JSON.stringify({ commands: [script] }));

  return (
    await aws([
      'ssm',
      'send-command',
      '--document-name',
      'AWS-RunShellScript',
      '--comment',
      comment,
      '--instance-ids',
      ...instanceIds,
      '--parameters',
      `file://${parametersPath}`,
      '--query',
      'Command.CommandId',
      '--output',
      'text',
    ]).text()
  ).trim();
}

async function readInvocation({
  commandId,
  instanceId,
}: {
  commandId: string;
  instanceId: string;
}) {
  const result = await aws([
    'ssm',
    'get-command-invocation',
    '--command-id',
    commandId,
    '--instance-id',
    instanceId,
  ])
    .nothrow()
    .quiet();

  return result.exitCode === 0 ? ((await result.json()) as SsmInvocation) : null;
}

// RunCommand is async, and a full deploy can run for several minutes — longer
// than the built-in `ssm wait command-executed` allows (~100s) — so poll until
// the invocation reaches a terminal state.
export async function waitForInvocation({
  commandId,
  instanceId,
}: {
  commandId: string;
  instanceId: string;
}) {
  let invocation = await readInvocation({ commandId, instanceId });
  for (let attempt = 0; attempt < DEPLOY_ATTEMPTS; attempt++) {
    if (invocation && TERMINAL_STATUSES.has(invocation.Status)) {
      break;
    }
    // RunCommand withholds the box's output until the command ends, so without
    // this the log is blank for as long as the deploy runs and a wedged host is
    // indistinguishable from a busy one.
    console.log(
      `  [${instanceId}] ${invocation?.Status ?? 'Pending'} after ${(attempt * POLL_MS) / MS_PER_SECOND}s`,
    );
    await Bun.sleep(POLL_MS);
    invocation = await readInvocation({ commandId, instanceId });
  }
  return invocation;
}
