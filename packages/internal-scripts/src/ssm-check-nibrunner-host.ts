import { join } from 'node:path';
import { requiredEnv } from '#shared/env.ts';
import { repoRoot } from '#shared/paths.ts';
import { runCommand, writeRemoteFile } from '#shared/ssm.ts';

const hostDirectory = join(repoRoot, 'infra/nibrunner-host');
const script = [
  "bash -se <<'NIBRUNNER_CANARY'",
  'set -euo pipefail',
  'exec 9>/run/nibrunner-commissioning.lock',
  'flock --nonblock 9',
  'cd /opt/nibrun/nibrunner-host',
  'umask 077',
  writeRemoteFile({
    name: 'canary.json',
    content: await Bun.file(join(hostDirectory, 'canary.json')).text(),
  }),
  writeRemoteFile({
    name: 'check_canary.sh',
    content: await Bun.file(join(hostDirectory, 'deploy/check_canary.sh')).text(),
  }),
  'bash check_canary.sh',
  'NIBRUNNER_CANARY',
].join('\n');

await runCommand({
  instanceId: requiredEnv('NIBRUNNER_HOST_INSTANCE_ID'),
  script,
  comment: 'Verify isolated nibrunner VM lifecycle',
});
