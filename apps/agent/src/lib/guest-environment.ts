import type { TenantEnvironment } from '@repo/protocol';
import { namesExtraPublicPortValues } from '@repo/protocol/runtime-values';

export function withoutPublicPortReferences(environment: TenantEnvironment): TenantEnvironment {
  return Object.fromEntries(
    Object.entries(environment).filter(([, value]) => !namesExtraPublicPortValues(value)),
  );
}
