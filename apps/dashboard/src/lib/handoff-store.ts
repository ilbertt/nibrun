// Where a binary dropped on the landing page waits. IndexedDB rather than localStorage
// because it holds a `File` as it is — localStorage stores strings, so a binary would have to
// be base64'd into a quota measured in single megabytes.

const DB_NAME = 'nibrun-handoff';
const DB_VERSION = 1;
const STORE_NAME = 'binaries';
const BINARY_KEY = 'dropped';

const MS_PER_HOUR = 3_600_000;
const HOURS_OFFERED = 12;

/**
 * A drop, and when it happened. Nothing here consumes the binary, so without the second half a
 * visit weeks later would be answered by whatever the last one left behind.
 */
type HandedOff = { binary: File; storedAt: number };

function openDatabase(): Promise<IDBDatabase> {
  const { promise, resolve, reject } = Promise.withResolvers<IDBDatabase>();
  const open = indexedDB.open(DB_NAME, DB_VERSION);

  open.onupgradeneeded = () => open.result.createObjectStore(STORE_NAME);
  open.onerror = () => reject(open.error ?? new Error('The browser refused to open storage.'));
  open.onsuccess = () => resolve(open.result);

  return promise;
}

/**
 * Settles on the transaction, never on the request inside it.
 *
 * A request's `onsuccess` only means the value is staged; `oncomplete` is the commit. The
 * landing page navigates the instant a write is acknowledged, which unloads the document
 * holding the frame — so acknowledging at `onsuccess` promises a binary that the teardown then
 * throws away. Strict durability is what makes the commit outlive that, since the default lets
 * the browser keep it in memory and write it whenever it likes.
 */
async function commitWrite(change: (binaries: IDBObjectStore) => void): Promise<void> {
  const database = await openDatabase();
  const { promise, resolve, reject } = Promise.withResolvers<void>();

  try {
    const write = database.transaction(STORE_NAME, 'readwrite', { durability: 'strict' });

    write.oncomplete = () => resolve();
    write.onabort = () => reject(write.error ?? new Error('The browser refused the write.'));
    change(write.objectStore(STORE_NAME));

    await promise;
  } finally {
    database.close();
  }
}

export function storeHandedOffBinary(binary: File): Promise<void> {
  const handedOff: HandedOff = { binary, storedAt: Date.now() };
  return commitWrite((binaries) => binaries.put(handedOff, BINARY_KEY));
}

/**
 * Throws the drop away without waiting to hear whether it worked.
 *
 * Which is all any caller wants: a binary is spent once it has been deployed, given up once the
 * form holds something else, and beside the point once the link being followed names its own —
 * and in none of the three is there anything to do about a browser that says no.
 */
export function discardHandedOffBinary(): void {
  void forgetHandedOffBinary().catch(ignoreRefusal);
}

/**
 * The drop still waiting, if there is one this visit would have made itself.
 *
 * A browser that will not open storage — a private window, a blocked origin — is answered as
 * none, since there is nothing here that could tell the difference or act on it.
 */
export async function readHandedOffBinary(): Promise<File | undefined> {
  try {
    return await stillWaiting();
  } catch {
    return undefined;
  }
}

async function stillWaiting(): Promise<File | undefined> {
  const stored = await readStored();
  if (stored === undefined) {
    return undefined;
  }

  const offered = offeredBinary(stored);
  if (offered !== undefined) {
    return offered;
  }

  // Nobody is going to be offered it, and it is megabytes of somebody's quota.
  await forgetHandedOffBinary();
  return undefined;
}

function forgetHandedOffBinary(): Promise<void> {
  return commitWrite((binaries) => binaries.delete(BINARY_KEY));
}

function ignoreRefusal(): void {}

/**
 * What a stored record still offers. Nothing where the drop has gone stale, and nothing where it
 * was written in the shape a past release used — which is the same answer for the same reason,
 * since neither is a binary anyone standing here today asked for.
 */
export function offeredBinary(stored: unknown): File | undefined {
  const handedOff = asHandedOff(stored);
  if (handedOff === undefined) {
    return undefined;
  }
  const age = Date.now() - handedOff.storedAt;
  return age < HOURS_OFFERED * MS_PER_HOUR ? handedOff.binary : undefined;
}

function asHandedOff(stored: unknown): HandedOff | undefined {
  if (typeof stored !== 'object' || stored === null) {
    return undefined;
  }
  const { binary, storedAt } = stored as Partial<HandedOff>;
  return binary instanceof File && typeof storedAt === 'number' ? { binary, storedAt } : undefined;
}

async function readStored(): Promise<unknown> {
  const database = await openDatabase();
  const { promise, resolve, reject } = Promise.withResolvers<unknown>();

  try {
    const read = database
      .transaction(STORE_NAME, 'readonly')
      .objectStore(STORE_NAME)
      .get(BINARY_KEY);

    read.onsuccess = () => resolve(read.result);
    read.onerror = () => reject(read.error ?? new Error('The browser refused the read.'));

    return await promise;
  } finally {
    database.close();
  }
}
