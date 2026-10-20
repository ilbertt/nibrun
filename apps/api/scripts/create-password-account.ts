import { sql } from '#db/client.ts';
import { createPasswordAccount } from '#lib/auth/create-password-account.ts';
import { auth } from '#services/plugins.ts';

const email = process.env.PASSWORD_ACCOUNT_EMAIL;
const name = process.env.PASSWORD_ACCOUNT_NAME;
if (!email || !name) {
  throw new Error(
    'Set PASSWORD_ACCOUNT_EMAIL and PASSWORD_ACCOUNT_NAME; supply the password on stdin.',
  );
}

try {
  const password = (await Bun.stdin.text()).replace(/\r?\n$/, '');
  const ownerId = await createPasswordAccount({ auth, email, name, password });
  console.log(`Created password account ${ownerId}.`);
} finally {
  await sql.close();
}
