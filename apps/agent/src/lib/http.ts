export type HttpRequest = {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs: number;
};

// One narrow shape for every outbound call, so both callers can be handed a stub in a test
// without either of them naming the platform's own fetch signature.
export type HttpClient = (request: HttpRequest) => Promise<Response>;

export const httpFetch: HttpClient = ({ url, method, headers, body, timeoutMs }) =>
  fetch(url, {
    ...(method ? { method } : {}),
    ...(headers ? { headers } : {}),
    ...(body === undefined ? {} : { body }),
    signal: AbortSignal.timeout(timeoutMs),
  });
