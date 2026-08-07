import type { UploadProgress } from '@repo/app-operations';

/**
 * XMLHttpRequest, for the one thing it can still do that `fetch` cannot: say how much of a request
 * body has gone. The streaming request that would replace it is Chromium-only, and a binary is
 * large enough here that a browser sending one silently is the whole problem.
 *
 * The length is left to the browser, which takes it from the blob — which is the length the api
 * signed the url for, and the one the store checks.
 */
export function browserUpload({
  url,
  body,
  onProgress,
}: {
  url: string;
  body: Blob;
  onProgress: (progress: UploadProgress) => void;
}): Promise<Response> {
  // biome-ignore lint/complexity/useMaxParams: an executor settles two ways
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open('PUT', url);
    request.responseType = 'text';

    request.upload.addEventListener('progress', (event) => {
      onProgress({ sentBytes: event.loaded, totalBytes: body.size });
    });

    // What the store answered, however it answered — a refusal is read for the sentence it puts in
    // the body, so it has to come back as a response rather than as a thrown status.
    request.addEventListener('load', () => {
      resolve(
        new Response(request.responseText, {
          status: request.status,
          statusText: request.statusText,
        }),
      );
    });
    request.addEventListener('error', () => {
      reject(new Error('The upload could not reach the store.'));
    });
    request.addEventListener('abort', () => {
      reject(new Error('The upload was stopped.'));
    });

    request.send(body);
  });
}
