import { isPublicRoutableHost } from '@better-auth/core/utils/host';
import { isCloudflareAccessHeader } from '@repo/app-ui';
import type { AppAccessPolicy } from '@repo/protocol';
import { BadRequestError } from '#lib/errors.ts';
import { hostnameOf } from '#lib/public-address.ts';

export function validatedAppAccess(access: AppAccessPolicy): AppAccessPolicy {
  if (access.kind === 'public') {
    return access;
  }
  const url = URL.parse(access.publicKeys.url);
  if (
    url?.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.hash ||
    !isPublicRoutableHost(hostnameOf(url))
  ) {
    throw new BadRequestError('Specify a public HTTPS JWKS URL without credentials or a fragment.');
  }
  return access;
}

export function requiresCustomDomain(access: AppAccessPolicy | undefined): boolean {
  return access?.kind === 'jwt' && isCloudflareAccessHeader(access.token.header);
}
