import { runWithTransaction } from '@better-auth/core/context';
import { createLocalAccountIssuer } from '@better-auth/core/db';
import type { Auth } from '#lib/auth/better-auth.ts';

export async function createPasswordAccount({
  auth,
  email,
  name,
  password,
}: {
  auth: Auth;
  email: string;
  name: string;
  password: string;
}): Promise<string> {
  const context = await auth.$context;
  const normalizedEmail = email.trim().toLowerCase();
  const { minPasswordLength, maxPasswordLength } = context.password.config;
  if (password.length < minPasswordLength || password.length > maxPasswordLength) {
    throw new Error(`Password must contain ${minPasswordLength}–${maxPasswordLength} characters.`);
  }
  if (await context.internalAdapter.findUserByEmail(normalizedEmail)) {
    throw new Error('An account already exists for this email.');
  }
  const hash = await context.password.hash(password);
  return runWithTransaction(context.adapter, async function createAccount() {
    const user = await context.internalAdapter.createUser(
      { email: normalizedEmail, name, emailVerified: false, isAnonymous: false },
      { method: 'email-password' },
    );
    await context.internalAdapter.linkAccount({
      userId: user.id,
      accountId: user.id,
      providerId: 'credential',
      issuer: createLocalAccountIssuer('credential'),
      password: hash,
    });
    return user.id;
  });
}
