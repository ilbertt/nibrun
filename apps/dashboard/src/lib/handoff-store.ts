// Where a binary dropped on the landing page waits. IndexedDB rather than localStorage
// because it holds a `File` as it is — localStorage stores strings, so a binary would have to
// be base64'd into a quota measured in single megabytes.

const DB_NAME = 'nibrun-handoff';
const DB_VERSION = 1;
const STORE_NAME = 'binaries';
const BINARY_KEY = 'dropped';

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
 * landing page navigates the instant this is acknowledged, which unloads the document holding
 * the frame — so acknowledging at `onsuccess` promises a binary that the teardown then throws
 * away. Strict durability is what makes the commit outlive that, since the default lets the
 * browser keep it in memory and write it whenever it likes.
 */
export async function storeHandedOffBinary(binary: File): Promise<void> {
  const database = await openDatabase();
  const { promise, resolve, reject } = Promise.withResolvers<void>();

  try {
    const write = database.transaction(STORE_NAME, 'readwrite', { durability: 'strict' });

    write.oncomplete = () => resolve();
    write.onabort = () => reject(write.error ?? new Error('The browser refused the write.'));
    write.objectStore(STORE_NAME).put(binary, BINARY_KEY);

    await promise;
  } finally {
    database.close();
  }
}

export async function readHandedOffBinary(): Promise<File | undefined> {
  const database = await openDatabase();
  const { promise, resolve, reject } = Promise.withResolvers<unknown>();

  try {
    const read = database
      .transaction(STORE_NAME, 'readonly')
      .objectStore(STORE_NAME)
      .get(BINARY_KEY);

    read.onsuccess = () => resolve(read.result);
    read.onerror = () => reject(read.error ?? new Error('The browser refused the read.'));

    const stored = await promise;
    return stored instanceof File ? stored : undefined;
  } finally {
    database.close();
  }
}
