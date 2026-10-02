import { DASHBOARD_SITE, WWW_SITE } from '@repo/global-constants';

const API_URL = 'http://127.0.0.1:3000';
const REQUEST_TIMEOUT_MS = 30_000;
const UNAUTHORIZED = 401;
const NOT_FOUND = 404;
const FACTORY_ADMIN = { username: 'admin', password: 'umami' };

type Credentials = { username: string; password: string };
type Session = { token: string; user: { id: string; isAdmin: boolean } };
type Website = { id: string; name: string; domain: string };

function requiredConfig(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing ${name}`);
  }
  return value;
}

function requireSuccess(response: Response): void {
  if (!response.ok) {
    throw new Error(`Umami API returned ${response.status} for ${new URL(response.url).pathname}`);
  }
}

async function login(credentials: Credentials): Promise<Session | null> {
  const response = await fetch(`${API_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(credentials),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (response.status === UNAUTHORIZED) {
    return null;
  }
  requireSuccess(response);
  const session = (await response.json()) as Session;
  if (!session.token) {
    throw new Error('Complete Umami bootstrap before enabling two-factor authentication.');
  }
  if (!session.user.isAdmin) {
    throw new Error('Umami bootstrap requires an administrator.');
  }
  return session;
}

async function request(options: {
  path: string;
  token: string;
  body: Credentials | Website | undefined;
}): Promise<Response> {
  return await fetch(`${API_URL}${options.path}`, {
    method: options.body ? 'POST' : 'GET',
    headers: {
      Authorization: `Bearer ${options.token}`,
      'Content-Type': 'application/json',
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
}

async function bootstrapAdmin(credentials: Credentials): Promise<Session> {
  const existing = await login(credentials);
  if (existing) {
    return existing;
  }
  const factory = await login(FACTORY_ADMIN);
  if (!factory) {
    throw new Error('Neither configured nor factory Umami credentials work; bootstrap stopped.');
  }
  requireSuccess(
    await request({
      path: `/api/users/${factory.user.id}`,
      token: factory.token,
      body: credentials,
    }),
  );
  // Changing the password invalidates the factory login token.
  const updated = await login(credentials);
  if (!updated) {
    throw new Error('Unable to sign in after updating the Umami administrator.');
  }
  return updated;
}

async function seedWebsite(options: { website: Website; token: string }): Promise<void> {
  const response = await request({
    path: `/api/websites/${options.website.id}`,
    token: options.token,
    body: undefined,
  });
  if (response.status !== NOT_FOUND) {
    requireSuccess(response);
    if (await response.json()) {
      return;
    }
  }
  requireSuccess(
    await request({ path: '/api/websites', token: options.token, body: options.website }),
  );
}

const credentials = {
  username: requiredConfig('UMAMI_ADMIN_USERNAME').toLowerCase(),
  password: requiredConfig('UMAMI_ADMIN_PASSWORD'),
};
const websites = [
  { id: requiredConfig('UMAMI_WWW_WEBSITE_ID'), site: WWW_SITE },
  { id: requiredConfig('UMAMI_DASHBOARD_WEBSITE_ID'), site: DASHBOARD_SITE },
];
const session = await bootstrapAdmin(credentials);
for (const { id, site } of websites) {
  await seedWebsite({
    website: { id, name: site.title, domain: new URL(site.url).hostname },
    token: session.token,
  });
}
console.info('Umami administrator and both websites are ready.');
