import { setTimeout } from 'node:timers/promises';
import { requiredEnv } from '#shared/env.ts';
import { ensurePublicDashboard, publicDashboardIsProvisioned } from '#shared/grafana.ts';

const PROVISIONING_ATTEMPTS = 60;
const PROVISIONING_DELAY_MS = 1000;
const options = {
  url: 'http://grafana:3000',
  password: requiredEnv('GRAFANA_ADMIN_PASSWORD'),
  publicDashboardToken: requiredEnv('GRAFANA_PUBLIC_DASHBOARD_TOKEN'),
};

let provisioned = false;
for (let attempt = 0; attempt < PROVISIONING_ATTEMPTS; attempt++) {
  if (await publicDashboardIsProvisioned(options)) {
    provisioned = true;
    break;
  }
  await setTimeout(PROVISIONING_DELAY_MS);
}
if (!provisioned) {
  throw new Error(
    'Grafana did not provision the aggregate dashboard before the bootstrap deadline.',
  );
}
await ensurePublicDashboard(options);
console.log('Grafana aggregate dashboard is provisioned and publicly shared.');
