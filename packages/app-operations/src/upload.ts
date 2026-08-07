export type UploadProgress = {
  sentBytes: number;
  totalBytes: number;
};

/**
 * How the bytes are put where the api said to put them. Injected rather than fixed, because the
 * two ends cannot use the same mechanism: `fetch` reports nothing about a request body it is
 * still sending, and only one of the two runtimes can stream one at all.
 */
export type UploadTransport = (input: {
  url: string;
  body: Blob;
  onProgress: (progress: UploadProgress) => void;
}) => Promise<Response>;

/**
 * The body as a stream counted on its way past, which is what there is to report progress from.
 *
 * `content-length` is set by hand because the signature covers it: a stream body is sent chunked
 * unless the length is already known, and a chunked request carries no `content-length` for the
 * store to match against the one it signed. Setting it also keeps `duplex` honest — the request
 * is a body being sent, not an exchange.
 */
export async function streamedUpload({
  url,
  body,
  onProgress,
}: {
  url: string;
  body: Blob;
  onProgress: (progress: UploadProgress) => void;
}): Promise<Response> {
  const totalBytes = body.size;
  let sentBytes = 0;

  const counted = body.stream().pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      // biome-ignore lint/complexity/useMaxParams: a transform is handed what to pass it on to
      transform(chunk, controller) {
        sentBytes += chunk.byteLength;
        onProgress({ sentBytes, totalBytes });
        controller.enqueue(chunk);
      },
    }),
  );

  const init: RequestInit & { duplex: 'half' } = {
    method: 'PUT',
    body: counted,
    headers: { 'content-length': String(totalBytes) },
    duplex: 'half',
  };

  return await fetch(url, init);
}
