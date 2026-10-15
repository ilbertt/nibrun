import { StatusMap } from 'elysia';
import type { fetchClientMetadataResource } from '#lib/mcp/cimd-transport.ts';

const FETCH_TIMEOUT_MS = 5_000;
const MAX_REDIRECTS = 3;
export const MAX_CLIENT_WEBSITE_HTML_BYTES = 131_072;

export type ClientWebsite = { url: URL; html: string };

export abstract class ClientWebsiteRepositoryContract {
  abstract read(input: { url: string }): Promise<ClientWebsite | null>;
}

export class ClientWebsiteRepository implements ClientWebsiteRepositoryContract {
  private readonly fetchResource: typeof fetchClientMetadataResource;

  constructor({ fetchResource }: { fetchResource: typeof fetchClientMetadataResource }) {
    this.fetchResource = fetchResource;
  }

  async read({ url }: { url: string }): Promise<ClientWebsite | null> {
    const signal = AbortSignal.timeout(FETCH_TIMEOUT_MS);
    let target = new URL(url);
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      if (target.protocol !== 'https:' || target.username || target.password) {
        return null;
      }
      const response = await this.fetchResource(target, {
        signal,
        redirect: 'manual',
        headers: { accept: 'text/html,application/xhtml+xml' },
      });
      const location = response.headers.get('location');
      if (
        response.status >= StatusMap['Multiple Choices'] &&
        response.status < StatusMap['Bad Request'] &&
        location
      ) {
        await response.body?.cancel();
        target = new URL(location, target);
        continue;
      }
      const contentType = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase();
      if (!response.ok || !['text/html', 'application/xhtml+xml'].includes(contentType ?? '')) {
        await response.body?.cancel();
        return null;
      }
      return { url: target, html: await htmlPrefix(response) };
    }
    return null;
  }
}

async function htmlPrefix(response: Response): Promise<string> {
  if (!response.body) {
    return '';
  }
  const decoder = new TextDecoder();
  let bytes = 0;
  let html = '';
  for await (const chunk of response.body) {
    const part = chunk.subarray(0, MAX_CLIENT_WEBSITE_HTML_BYTES - bytes);
    bytes += part.byteLength;
    html += decoder.decode(part, { stream: true });
    if (bytes === MAX_CLIENT_WEBSITE_HTML_BYTES) {
      break;
    }
  }
  return html + decoder.decode();
}
