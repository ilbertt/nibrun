import type { compile } from 'json-schema-to-typescript';

function referenceIntersections(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(referenceIntersections);
  }
  if (value === null || typeof value !== 'object') {
    return value;
  }
  const properties = Object.fromEntries(
    Object.entries(value).map(function normalizeProperty([name, property]) {
      return [name, referenceIntersections(property)];
    }),
  );
  const { $ref, ...siblings } = properties;
  if (typeof $ref === 'string' && Object.keys(siblings).length > 0) {
    return { allOf: [{ $ref }, siblings] };
  }
  return properties;
}

export function nibrunnerTenantLogSchema(value: unknown) {
  // The compiler otherwise drops the restart fields referenced beside its kind discriminator.
  return referenceIntersections(value) as Parameters<typeof compile>[0];
}
