const API_BASE = 'https://api.cloudflare.com/client/v4/';

const MAX_ERROR_BODY = 256;
const HTTP_NOT_FOUND = 404;

/**
 * How long the edge has to answer one call. `fetch` has no deadline of its own, so an edge that
 * takes the connection and never answers holds whoever is waiting on it open forever.
 *
 * It has to expire far enough below the ceiling that adding a hostname fits under it twice over:
 * that path makes one call to create the hostname and one to read the zone's delegation uuid,
 * with the owner waiting on the pair, and Bun drops a connection nothing has travelled on for 30s.
 * A deadline that outlived the connection it answers on would leave them the dropped connection
 * and no reason for it.
 *
 * Short is affordable because a call given up on is the case the reconcile pass already finishes:
 * a row written with no `cloudflare_id` is attached to the edge on a later one.
 */
const REQUEST_DEADLINE_MS = 5_000;

/**
 * Where Cloudflare answers the challenge on the owner's behalf. They point `_acme-challenge` at
 * this once and the edge renews against it forever, which is the whole reason to prefer it over
 * handing them a TXT value that changes on every issuance.
 */
const DCV_DELEGATION_SUFFIX = 'dcv.cloudflare.com';

export class CloudflareError extends Error {
  readonly status: number;

  constructor({ status, body }: { status: number; body: string }) {
    super(`cloudflare answered ${status}: ${body}`);
    this.name = 'CloudflareError';
    this.status = status;
  }
}

type CloudflareEnvelope<Result> = {
  success: boolean;
  result: Result;
  errors: ReadonlyArray<{ code: number; message: string }>;
};

export type CustomHostnameSsl = {
  status: string;
  validation_errors?: ReadonlyArray<{ message: string }>;
};

export type CustomHostname = {
  id: string;
  hostname: string;
  status: string;
  ssl: CustomHostnameSsl;
  verification_errors?: ReadonlyArray<string>;
};

/**
 * The zone's custom hostnames, which is the whole of what this end asks Cloudflare for. The
 * certificate is the edge's to issue, renew and serve; nothing here holds key material or is
 * told when a renewal happened.
 *
 * Status is read back rather than pushed: Cloudflare has no callback to register, and a hostname
 * becomes serveable when the owner's DNS says so, which is a moment neither end is told about.
 */
export class CloudflareClient {
  readonly #apiToken: string;
  readonly #zoneId: string;
  // Per zone rather than per hostname, so it is fetched once and every target derived from it.
  #dcvDelegationUuid: string | undefined;

  constructor({ apiToken, zoneId }: { apiToken: string; zoneId: string }) {
    this.#apiToken = apiToken;
    this.#zoneId = zoneId;
  }

  createCustomHostname({ hostname }: { hostname: string }): Promise<CustomHostname> {
    return this.#request<CustomHostname>({
      method: 'POST',
      path: 'custom_hostnames',
      // `txt` is what delegated DCV answers with: the records go to the delegation target the
      // owner already pointed at us, so no value here ever has to reach them.
      body: {
        hostname,
        ssl: { method: 'txt', type: 'dv', settings: { min_tls_version: '1.2' } },
      },
    });
  }

  getCustomHostname({ id }: { id: string }): Promise<CustomHostname> {
    return this.#request<CustomHostname>({ method: 'GET', path: `custom_hostnames/${id}` });
  }

  async deleteCustomHostname({ id }: { id: string }): Promise<void> {
    try {
      await this.#request({ method: 'DELETE', path: `custom_hostnames/${id}` });
    } catch (error) {
      if (!(error instanceof CloudflareError) || error.status !== HTTP_NOT_FOUND) {
        throw error;
      }
    }
  }

  /**
   * What the owner points `_acme-challenge.<hostname>` at. Derived rather than read back per
   * hostname, because the uuid is the zone's and the hostname is already known here.
   */
  async dcvDelegationTarget({ hostname }: { hostname: string }): Promise<string> {
    this.#dcvDelegationUuid ??= (
      await this.#request<{ uuid: string }>({ method: 'GET', path: 'dcv_delegation/uuid' })
    ).uuid;
    return `${hostname}.${this.#dcvDelegationUuid}.${DCV_DELEGATION_SUFFIX}`;
  }

  /**
   * A refused call is an error however it is refused: Cloudflare answers some failures with a
   * non-2xx and others with 200 and `success: false`, so reading only the status code would let
   * the second kind through as a result.
   */
  async #request<Result>({
    method,
    path,
    body,
  }: {
    method: string;
    path: string;
    body?: unknown;
  }): Promise<Result> {
    const response = await fetch(new URL(`zones/${this.#zoneId}/${path}`, API_BASE), {
      method,
      headers: {
        authorization: `Bearer ${this.#apiToken}`,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(REQUEST_DEADLINE_MS),
    });

    const text = await response.text();
    const envelope = parseEnvelope<Result>(text);
    if (!response.ok || envelope?.success !== true) {
      throw new CloudflareError({
        status: response.status,
        body: (envelope?.errors.map((error) => error.message).join('; ') || text).slice(
          0,
          MAX_ERROR_BODY,
        ),
      });
    }
    return envelope.result;
  }
}

function parseEnvelope<Result>(text: string): CloudflareEnvelope<Result> | undefined {
  try {
    return JSON.parse(text) as CloudflareEnvelope<Result>;
  } catch {
    return undefined;
  }
}
