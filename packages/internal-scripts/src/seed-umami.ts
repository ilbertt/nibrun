import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { DASHBOARD_SITE, WWW_SITE } from '@repo/global-constants';
import { compareSync, hashSync } from 'bcryptjs';

const BCRYPT_ROUNDS = 10;
const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_BYTES = 72;
const FACTORY_ADMIN = { username: 'admin', password: 'umami' };

type Database = {
  connect(): Promise<void>;
  end(): Promise<void>;
  query<Row>(query: string | { text: string; values: unknown[] }): Promise<{ rows: Row[] }>;
};
type Administrator = {
  id: string;
  username: string;
  password: string;
  twoFactorEnabled: boolean;
  twoFactorRequired: boolean;
};
type Website = { id: string; name: string; domain: string };

function requiredConfig(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing ${name}`);
  }
  return value;
}

function isUntouchedFactoryAdministrator(administrator: Administrator): boolean {
  return (
    administrator.username === FACTORY_ADMIN.username &&
    !administrator.twoFactorEnabled &&
    !administrator.twoFactorRequired &&
    compareSync(FACTORY_ADMIN.password, administrator.password)
  );
}

async function seedAdministrator(): Promise<string> {
  const { rows } = await database.query<Administrator>({
    text: `SELECT u.user_id AS id, u.username, u.password,
      u.two_factor_required AS "twoFactorRequired",
      COALESCE(t.is_enabled, false) AS "twoFactorEnabled"
      FROM "user" u LEFT JOIN two_factor_auth t ON t.user_id = u.user_id
      WHERE u.role = 'admin' AND u.deleted_at IS NULL
      ORDER BY (u.username = $1) DESC, u.created_at, u.user_id LIMIT 1`,
    values: [credentials.username],
  });
  const existing = rows[0];
  if (existing && !isUntouchedFactoryAdministrator(existing)) {
    return existing.id;
  }
  const id = existing?.id ?? randomUUID();
  const password = hashSync(credentials.password, BCRYPT_ROUNDS);
  if (existing) {
    await database.query({
      text: `UPDATE "user" SET username = $1, password = $2, updated_at = now()
        WHERE user_id = $3`,
      values: [credentials.username, password, id],
    });
  } else {
    await database.query({
      text: `INSERT INTO "user" (user_id, username, password, role, created_at, updated_at)
        VALUES ($1, $2, $3, 'admin', now(), now())`,
      values: [id, credentials.username, password],
    });
  }
  return id;
}

async function seedWebsite(options: { website: Website; administratorId: string }): Promise<void> {
  const { website, administratorId } = options;
  await database.query({
    text: `INSERT INTO website
      (website_id, name, domain, user_id, created_by, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $4, now(), now())
      ON CONFLICT (website_id) DO NOTHING`,
    values: [website.id, website.name, website.domain, administratorId],
  });
}

const credentials = {
  username: requiredConfig('UMAMI_ADMIN_USERNAME').toLowerCase(),
  password: requiredConfig('UMAMI_ADMIN_PASSWORD'),
};
if (
  credentials.password.length < MIN_PASSWORD_LENGTH ||
  Buffer.byteLength(credentials.password) > MAX_PASSWORD_BYTES
) {
  throw new Error('UMAMI_ADMIN_PASSWORD must contain at least 8 characters and at most 72 bytes.');
}
const websites = [
  {
    id: '00000000-0000-4000-8000-000000000001',
    name: WWW_SITE.title,
    domain: new URL(WWW_SITE.url).hostname,
  },
  {
    id: '00000000-0000-4000-8000-000000000002',
    name: DASHBOARD_SITE.title,
    domain: new URL(DASHBOARD_SITE.url).hostname,
  },
];

// Resolve the driver from the pinned Umami image, which already ships it for Prisma.
const imageRequire = createRequire('/app/package.json');
const adapterRequire = createRequire(imageRequire.resolve('@prisma/adapter-pg'));
const { Client } = adapterRequire('pg') as {
  Client: new (options: { connectionString: string }) => Database;
};
const database = new Client({ connectionString: requiredConfig('DATABASE_URL') });
await database.connect();
try {
  await database.query('BEGIN');
  await database.query("SELECT pg_advisory_xact_lock(hashtext('nibrun:umami:bootstrap'))");
  const administratorId = await seedAdministrator();
  for (const website of websites) {
    await seedWebsite({ website, administratorId });
  }
  await database.query('COMMIT');
  console.info('Umami administrator and both websites are ready.');
} catch (error) {
  await database.query('ROLLBACK');
  throw error;
} finally {
  await database.end();
}
