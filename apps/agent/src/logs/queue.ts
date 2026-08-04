import type { TenantLogEvent } from '@repo/protocol';

const NEWLINE = new TextEncoder().encode('\n');

type WaitingReader = {
  token: symbol;
  resolve: (chunk: Uint8Array | undefined) => void;
};

export class TenantLogQueue {
  readonly #maxBytes: number;
  readonly #encoder = new TextEncoder();
  readonly #chunks: Uint8Array[] = [];
  #queuedBytes = 0;
  #waiting: WaitingReader | undefined;
  #closed = false;

  constructor({ maxBytes }: { maxBytes: number }) {
    this.#maxBytes = maxBytes;
  }

  push(event: TenantLogEvent): boolean {
    if (this.#closed) {
      return false;
    }
    const json = this.#encoder.encode(JSON.stringify(event));
    const chunk = new Uint8Array(json.byteLength + NEWLINE.byteLength);
    chunk.set(json);
    chunk.set(NEWLINE, json.byteLength);

    if (this.#waiting) {
      const waiting = this.#waiting;
      this.#waiting = undefined;
      waiting.resolve(chunk);
      return true;
    }
    if (this.#queuedBytes + chunk.byteLength > this.#maxBytes) {
      return false;
    }
    this.#chunks.push(chunk);
    this.#queuedBytes += chunk.byteLength;
    return true;
  }

  readable(): ReadableStream<Uint8Array> {
    const token = Symbol('tenant log reader');
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

  #take(token: symbol): Promise<Uint8Array | undefined> {
    const chunk = this.#chunks.shift();
    if (chunk) {
      this.#queuedBytes -= chunk.byteLength;
      return Promise.resolve(chunk);
    }
    if (this.#closed) {
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
