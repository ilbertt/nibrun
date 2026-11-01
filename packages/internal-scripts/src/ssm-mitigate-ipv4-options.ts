import { join } from 'node:path';
import { repoRoot } from '#shared/paths.ts';
import { runCommand } from '#shared/ssm.ts';

const instanceIds = process.argv.slice(2);
if (instanceIds.length === 0 || instanceIds.some((id) => !/^i-[a-f0-9]{17}$/.test(id))) {
  throw new Error('Pass explicit EC2 instance IDs; this command never discovers mutation targets.');
}

const installer = await Bun.file(
  join(repoRoot, 'infra/security/install_ipv4_options_filter.sh'),
).text();
for (const instanceId of new Set(instanceIds)) {
  await runCommand({
    instanceId,
    script: `bash -se <<'NIBRUN_IPV4_OPTIONS'\n${installer}\nNIBRUN_IPV4_OPTIONS`,
    comment: 'Mitigate CVE-2026-98432 IPv4 TCP options exposure',
  });
}
