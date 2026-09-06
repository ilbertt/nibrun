import { ApiError } from '@repo/api-client/unwrap';

const SIZE_DECIMALS = 1;
const BYTES_PER_MEBIBYTE = 1_048_576;

export type UploadProgress = {
  sentBytes: number;
  totalBytes: number;
};

/**
 * The wait around the upload, given what the upload is doing rather than a line to print: how far
 * along it is reads as a spinner in one place and a meter in another, and neither belongs here.
 */
export type UploadWait = (input: {
  message: string;
  task: (report: (progress: UploadProgress) => void) => Promise<void>;
}) => Promise<void>;

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

/**
 * The whole file as the body, never held here: something that has to hold a file to send it is
 * something that cannot send a large one.
 *
 * The url was signed for this exact length, so the store refuses anything else — which is also
 * why a file that changed since it was measured comes back as a signature that does not match.
 */
export async function putObject({
  url,
  body,
  upload,
  onProgress,
}: {
  url: string;
  body: Blob;
  upload: UploadTransport;
  onProgress: (progress: UploadProgress) => void;
}): Promise<void> {
  const response = await upload({ url, body, onProgress });
  if (!response.ok) {
    throw new ApiError(
      `The store refused the upload: ${response.status} ${await storeError(response)}`,
    );
  }
}

// S3 answers in XML, and the one part of it worth repeating is the sentence it puts in Message.
async function storeError(response: Response): Promise<string> {
  const body = await response.text();
  return /<Message>(?<message>[^<]*)<\/Message>/.exec(body)?.groups?.message ?? response.statusText;
}

export function unwatched({
  task,
}: {
  message: string;
  task: (report: (progress: UploadProgress) => void) => Promise<void>;
}): Promise<void> {
  return task(() => {});
}

export function mebibytes(bytes: number): string {
  return `${(bytes / BYTES_PER_MEBIBYTE).toFixed(SIZE_DECIMALS)} MB`;
}
