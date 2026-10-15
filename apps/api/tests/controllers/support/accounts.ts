import '#tests/controllers/support/api.ts';
import { Value } from '@sinclair/typebox/value';
import { OwnerIdSchema } from '#lib/api/identifiers.ts';

const { auth } = await import('#services/plugins.ts');

export async function registeredAccount() {
  const signup = await auth.api.signInAnonymous({ returnHeaders: true });
  const context = await auth.$context;
  await context.internalAdapter.updateUser(signup.response.user.id, { isAnonymous: false });
  const token = signup.response.token;
  const signedToken = signup.headers.get('set-auth-token');
  if (!token || !signedToken) {
    throw new Error('The registered account fixture requires a Bearer session token.');
  }
  const cookie = signup.headers
    .getSetCookie()
    .map(function cookieValue(value) {
      return value.split(';')[0];
    })
    .join('; ');
  return {
    ownerId: Value.Parse(OwnerIdSchema, signup.response.user.id),
    token,
    signedToken,
    cookie,
  };
}
