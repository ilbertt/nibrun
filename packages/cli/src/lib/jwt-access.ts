import type { InferOptions } from '@parshjs/core';
import type { App } from '@repo/api-client/models';
import { DEFAULT_APP_ACCESS } from '@repo/api-constants';
import { z } from 'zod';
import { UsageError } from '#lib/errors.ts';

export const ACCESS_OPTIONS = {
  access: {
    schema: z.enum(['public', 'jwt']).optional(),
    description:
      'Set HTTP access for this deployment. Cloudflare Access requires a custom domain. Use public to remove JWT protection.',
  },
  'jwt-issuer': {
    schema: z.string().trim().min(1).optional(),
    description: 'Expected JWT issuer (iss).',
  },
  'jwt-audience': {
    schema: z.array(z.string().trim().min(1)).optional(),
    description: 'Accepted JWT audience (aud). Repeat for multiple audiences.',
  },
  'jwks-url': {
    schema: z.url({ protocol: /^https$/ }).optional(),
    description: 'Public HTTPS URL of the issuer’s JSON Web Key Set.',
  },
  'jwt-header': {
    schema: z.string().min(1).optional(),
    description: 'Request header carrying the JWT. Defaults to Authorization.',
  },
  'jwt-format': {
    schema: z.enum(['bearer', 'raw']).optional(),
    description: 'Token format in the header. Defaults to bearer.',
  },
} as const;

export function accessFrom(
  options: Partial<InferOptions<typeof ACCESS_OPTIONS>>,
): App['config']['access'] | undefined {
  const {
    access,
    'jwt-issuer': issuer,
    'jwt-audience': audiences,
    'jwks-url': url,
    'jwt-header': header,
    'jwt-format': format,
  } = options;
  const hasJwtOptions = [issuer, audiences, url, header, format].some(
    (value) => value !== undefined,
  );
  if (access === 'public') {
    if (hasJwtOptions) {
      throw new UsageError('--access public cannot be combined with JWT options.');
    }
    return DEFAULT_APP_ACCESS;
  }
  if (!access && !hasJwtOptions) {
    return undefined;
  }
  if (!issuer || !audiences?.length || !url) {
    throw new UsageError('JWT access requires --jwt-issuer, --jwt-audience, and --jwks-url.');
  }
  return {
    kind: 'jwt',
    issuer,
    audiences,
    publicKeys: { url },
    token: { header: header ?? 'Authorization', format: format ?? 'bearer' },
  };
}
