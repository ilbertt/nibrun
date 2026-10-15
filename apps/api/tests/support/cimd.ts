import type { CimdOptions } from '@better-auth/cimd';

export const cimdDocuments = new Map<string, Record<string, unknown>>();

export function fetchTestClientMetadataResource(
  ...[input]: Parameters<CimdOptions['fetchClientMetadataResource']>
): Promise<Response> {
  const url = input instanceof Request ? input.url : input.toString();
  const document = cimdDocuments.get(url);
  return Promise.resolve(document ? Response.json(document) : new Response(null, { status: 404 }));
}
