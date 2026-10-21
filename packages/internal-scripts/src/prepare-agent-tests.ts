import { $ } from 'bun';

if (process.platform !== 'linux' || process.env.GITHUB_ACTIONS !== 'true') {
  throw new Error('Prepare agent integration tests only on a disposable Linux Actions runner.');
}

await $`sudo apt-get update`;
await $`sudo apt-get install -y nbd-client nbdkit`;
await $`sudo modprobe nbd nbds_max=1`;
