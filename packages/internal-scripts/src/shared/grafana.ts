import publicDashboard from '../../../../infra/grafana/dashboards/nibrunner-public.json';

const REQUEST_TIMEOUT_MS = 10_000;
const NOT_FOUND = 404;

type GrafanaBootstrapOptions = {
  url: string;
  password: string;
  publicDashboardToken: string;
};

function grafanaRequest(options: GrafanaBootstrapOptions) {
  return function request({
    path,
    method,
    body,
  }: {
    path: string;
    method: string;
    body: object | undefined;
  }) {
    return fetch(new URL(path, options.url), {
      method,
      headers: {
        Authorization: `Basic ${Buffer.from(`admin:${options.password}`).toString('base64')}`,
        'Content-Type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  };
}

export async function publicDashboardIsProvisioned(options: GrafanaBootstrapOptions) {
  const request = grafanaRequest(options);
  const response = await request({
    path: `/api/dashboards/uid/${publicDashboard.uid}`,
    method: 'GET',
    body: undefined,
  });
  if (response.status === NOT_FOUND) {
    return false;
  }
  if (!response.ok) {
    throw new Error(`Reading the provisioned Grafana dashboard failed (${response.status}).`);
  }
  return true;
}

export async function ensurePublicDashboard(options: GrafanaBootstrapOptions) {
  if (!/^[a-f0-9]{32}$/.test(options.publicDashboardToken)) {
    throw new Error('The public dashboard token must contain 32 lowercase hexadecimal characters.');
  }
  const request = grafanaRequest(options);
  const path = `/api/dashboards/uid/${publicDashboard.uid}/public-dashboards/`;
  const existing = await request({ path, method: 'GET', body: undefined });
  const settings = {
    isEnabled: true,
    timeSelectionEnabled: false,
    annotationsEnabled: false,
    share: 'public',
  };
  if (existing.status === NOT_FOUND) {
    const created = await request({
      path,
      method: 'POST',
      body: { ...settings, accessToken: options.publicDashboardToken },
    });
    if (!created.ok) {
      throw new Error(`Creating the Grafana public dashboard failed (${created.status}).`);
    }
    return;
  }
  if (!existing.ok) {
    throw new Error(`Reading Grafana public sharing failed (${existing.status}).`);
  }
  const shared = (await existing.json()) as { uid: string; accessToken: string };
  if (shared.accessToken !== options.publicDashboardToken) {
    throw new Error(
      'The existing public dashboard token differs from the configured public route.',
    );
  }
  const updated = await request({ path: `${path}${shared.uid}`, method: 'PATCH', body: settings });
  if (!updated.ok) {
    throw new Error(`Updating the Grafana public dashboard failed (${updated.status}).`);
  }
}
