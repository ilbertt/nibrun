/**
 * A url the api was asked to fetch a binary from, opened but not read. The body is handed over as
 * a stream because a binary is the one thing here too large to hold: whoever asked for it decides
 * where the bytes go, and they go there as they arrive.
 *
 * `declaredSizeBytes` is the source's word about its own length, absent where it gave none — a
 * chunked response, or a host that does not say. It is worth having anyway: it is what lets an
 * object too large to store be refused before a byte of it is fetched.
 */
export type BinarySource =
  | { outcome: 'open'; body: ReadableStream<Uint8Array>; declaredSizeBytes: number | undefined }
  | { outcome: 'unreachable' }
  | { outcome: 'refused'; status: number }
  | { outcome: 'empty' };

export abstract class BinarySourceRepositoryContract {
  abstract open(input: { url: string }): Promise<BinarySource>;
}

export class BinarySourceRepository implements BinarySourceRepositoryContract {
  /**
   * Redirects are followed, which is what makes an ordinary release link work: every store that
   * hosts one answers the address people share with a redirect to where the bytes actually are.
   */
  async open({ url }: { url: string }): Promise<BinarySource> {
    const response = await this.get(url);
    if (response === undefined) {
      return { outcome: 'unreachable' };
    }
    if (!response.ok) {
      return { outcome: 'refused', status: response.status };
    }
    if (response.body === null) {
      return { outcome: 'empty' };
    }
    return {
      outcome: 'open',
      body: response.body,
      declaredSizeBytes: declaredLength(response.headers),
    };
  }

  /**
   * A url that answers nothing is the ordinary failure here rather than a fault of this api: it
   * was typed by whoever wrote the link, and only they can fix it. Undefined rather than the
   * error, because what went wrong at the socket is not something to read back to them.
   */
  private async get(url: string): Promise<Response | undefined> {
    try {
      return await fetch(url, { redirect: 'follow' });
    } catch {
      return undefined;
    }
  }
}

function declaredLength(headers: Headers): number | undefined {
  const declared = Number(headers.get('content-length'));
  return Number.isInteger(declared) && declared >= 0 ? declared : undefined;
}
