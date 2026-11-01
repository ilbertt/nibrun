import { join } from 'node:path';
import { requireMainWorkflow } from '#shared/actions.ts';
import { requiredEnv } from '#shared/env.ts';
import { repoRoot } from '#shared/paths.ts';
import { runCommand } from '#shared/ssm.ts';

requireMainWorkflow();

await runCommand({
  instanceId: requiredEnv('NIBRUNNER_HOST_INSTANCE_ID'),
  comment: 'Remove empty nibrunner commissioning state before CI reinstalls it',
  script: [
    "bash -se <<'NIBRUNNER_RESET'",
    await Bun.file(join(repoRoot, 'infra/nibrunner-host/deploy/reset_empty_host.sh')).text(),
    'NIBRUNNER_RESET',
  ].join('\n'),
});
