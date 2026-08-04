import type { TenantLogEvent } from '@repo/protocol';

const NEWLINE = new TextEncoder().encode('\n');

type WaitingReader = {
  token: symbol;
  resolve: (chunk: Uint8Array | undefined) => void;
};

export class TenantLogQueue {
  readonly #maxBytes: number;
  readonly #maxInFlightBytes: number;
  readonly #encoder = new TextEncoder();
  #chunks: Uint8Array[] = [];
  #inFlight: Uint8Array[] = [];
  #inFlightBytes = 0;
  #retainedBytes = 0;
  #waiting: WaitingReader | undefined;
  #activeToken: symbol | undefined;
  #endingStream = false;
  #closed = false;

  constructor({ maxBytes, maxInFlightBytes }: { maxBytes: number; maxInFlightBytes: number }) {
    this.#maxBytes = maxBytes;
    this.#maxInFlightBytes = maxInFlightBytes;
  }

  push(event: TenantLogEvent): boolean {
    if (this.#closed) {
      return false;
    }
    const json = this.#encoder.encode(JSON.stringify(event));
    const chunk = new Uint8Array(json.byteLength + NEWLINE.byteLength);
    chunk.set(json);
    chunk.set(NEWLINE, json.byteLength);
    return this.#offer(chunk);
  }

  /**
   * An empty line: NDJSON framing carrying no event, which the control plane skips.
   *
   * A host whose apps are quiet sends nothing for as long as they stay quiet, and every timeout
   * between here and the control plane reads that silence as a dead connection. This is what
   * makes the request outlive the tenant's own talkativeness.
   */
  keepalive(): boolean {
    if (this.#closed) {
      return false;
    }
    return this.#offer(NEWLINE);
  }

  /**
   * End the current request's body once it has taken everything queued, leaving the queue itself
   * open for the request that replaces it.
   *
   * An upload cannot be cut without losing whatever the request had already taken, and HTTP has
   * no per-chunk acknowledgement to work out how much that was. A drained queue is the one
   * boundary where the agent knows exactly what the control plane received, so it is the only
   * place a stream can end for free.
   */
  endStream(): void {
    if (this.#waiting) {
      const waiting = this.#waiting;
      this.#waiting = undefined;
      waiting.resolve(undefined);
      return;
    }
    this.#endingStream = true;
  }

  /**
   * The control plane answered, so what this request carried is somewhere other than here and the
   * copies held for it can go.
   *
   * Only ever called for a request that ran long enough to have been read. A reply that arrives
   * too quickly to have consumed a body is the one success that proves nothing, and keeping the
   * copies through it costs a duplicate where believing it would cost the events.
   */
  acknowledge(): void {
    this.#retainedBytes -= this.#inFlightBytes;
    this.#inFlight = [];
    this.#inFlightBytes = 0;
  }

  #offer(chunk: Uint8Array): boolean {
    // In-flight bytes are counted here too. They are copies this host is holding until they are
    // confirmed, which is the same memory as a queued event and has to answer to the same limit —
    // a budget that only counted what had not been sent yet would be a budget for half the bytes.
    if (this.#retainedBytes + chunk.byteLength > this.#maxBytes) {
      return false;
    }
    this.#retainedBytes += chunk.byteLength;
    if (this.#waiting) {
      const waiting = this.#waiting;
      this.#waiting = undefined;
      if (this.#inFlightBytes >= this.#maxInFlightBytes) {
        this.#chunks.push(chunk);
        waiting.resolve(undefined);
        return true;
      }
      this.#holdInFlight(chunk);
      waiting.resolve(chunk);
      return true;
    }
    this.#chunks.push(chunk);
    return true;
  }

  readable(): ReadableStream<Uint8Array> {
    const token = Symbol('tenant log reader');
    // Whatever the request this replaces had taken was never confirmed, so it is still owed. A
    // new stream superseding an old one is exactly the case where those bytes have to go back.
    this.#recover();
    // A control plane that answers before the body ends completes the fetch without cancelling
    // the stream it was reading, so the request this one replaces can still be holding a pending
    // read. Handing the next event to that reader would deliver it nowhere.
    this.#waiting = undefined;
    this.#activeToken = token;
    this.#endingStream = false;
    let active = true;
    return new ReadableStream<Uint8Array>({
      pull: async (controller) => {
        const chunk = await this.#take(token);
        if (!active) {
          return;
        }
        if (chunk) {
          controller.enqueue(chunk);
        } else {
          controller.close();
        }
      },
      cancel: () => {
        active = false;
        this.#cancel(token);
      },
    });
  }

  close(): void {
    this.#closed = true;
    this.#waiting?.resolve(undefined);
    this.#waiting = undefined;
  }

  #holdInFlight(chunk: Uint8Array): void {
    this.#inFlight.push(chunk);
    this.#inFlightBytes += chunk.byteLength;
  }

  #recover(): void {
    if (this.#inFlightBytes === 0) {
      return;
    }
    this.#chunks = this.#inFlight.concat(this.#chunks);
    this.#inFlight = [];
    this.#inFlightBytes = 0;
  }

  #take(token: symbol): Promise<Uint8Array | undefined> {
    // Checked before the queue is touched: a superseded reader whose pull lands late would
    // otherwise take a chunk into a request nothing is sending any more.
    if (token !== this.#activeToken) {
      return Promise.resolve(undefined);
    }
    // A window ends on what it is carrying as well as on how long it has been open. Held copies
    // are only released by an answer, so how much one request may take is how much this host is
    // willing to hold — and a talkative tenant reaches that long before thirty seconds.
    if (this.#inFlightBytes >= this.#maxInFlightBytes) {
      return Promise.resolve(undefined);
    }
    const chunk = this.#chunks.shift();
    if (chunk) {
      this.#holdInFlight(chunk);
      return Promise.resolve(chunk);
    }
    if (this.#closed || this.#endingStream) {
      return Promise.resolve(undefined);
    }
    return new Promise((resolve) => {
      this.#waiting = { token, resolve };
    });
  }

  #cancel(token: symbol): void {
    if (this.#waiting?.token !== token) {
      return;
    }
    this.#waiting.resolve(undefined);
    this.#waiting = undefined;
  }
}
