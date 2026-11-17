import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { $ } from 'bun';
import { repoRoot } from '#shared/paths.ts';

const work = await mkdtemp(join(tmpdir(), 'nibrun-metrics-check-'));
try {
  const configuration = (await $`docker compose --env-file .env.example config --format json`
    .cwd(repoRoot)
    .quiet()
    .json()) as { services: { prometheus: { image: string } } };
  const prometheusImage = configuration.services.prometheus.image;
  const collectorConfiguration = (
    await Bun.file(join(repoRoot, 'infra/nibrunner-host/metrics.alloy.template')).text()
  ).replaceAll('{{METRICS_REMOTE_WRITE_URL}}', JSON.stringify('http://control-plane/api/v1/write'));
  await Bun.write(join(work, 'config.alloy'), collectorConfiguration);
  const metricsDirectory = `${join(repoRoot, 'infra/prometheus')}:/etc/prometheus:ro`;
  const collectorDirectory = `${work}:/etc/alloy:ro`;
  await $`docker run --rm --entrypoint promtool -v ${metricsDirectory} ${prometheusImage} check config /etc/prometheus/prometheus.yml`;
  await $`docker run --rm --entrypoint promtool -v ${metricsDirectory} ${prometheusImage} test rules /etc/prometheus/tests/public-rules.yml`;
  await $`docker run --rm -v ${collectorDirectory} grafana/alloy:latest validate /etc/alloy/config.alloy`;
} finally {
  await rm(work, { recursive: true, force: true });
}
