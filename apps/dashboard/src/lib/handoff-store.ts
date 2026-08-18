// Where a binary dropped on the landing page waits. IndexedDB rather than localStorage
// because it holds a `File` as it is — localStorage stores strings, so a binary would have to
// be base64'd into a quota measured in single megabytes.

const DB_NAME = 'nibrun-handoff';
const DB_VERSION = 1;
const STORE_NAME = 'binaries';
const BINARY_KEY = 'dropped';

function request<T>(source: IDBRequest<T>): Promise<T> {
  const { promise, resolve, reject } = Promise.withResolvers<T>();

  source.onsuccess = () => resolve(source.result);
  source.onerror = () => reject(source.error ?? new Error('The browser refused the read.'));

  return promise;
}

function openStore(mode: IDBTransactionMode): Promise<IDBObjectStore> {
  const { promise, resolve, reject } = Promise.withResolvers<IDBObjectStore>();
  const open = indexedDB.open(DB_NAME, DB_VERSION);

  open.onupgradeneeded = () => open.result.createObjectStore(STORE_NAME);
  open.onerror = () => reject(open.error ?? new Error('The browser refused to open storage.'));
  open.onsuccess = () => resolve(open.result.transaction(STORE_NAME, mode).objectStore(STORE_NAME));

  return promise;
}

export async function storeHandedOffBinary(binary: File): Promise<void> {
  const store = await openStore('readwrite');
  await request(store.put(binary, BINARY_KEY));
}

export async function readHandedOffBinary(): Promise<File | undefined> {
  const store = await openStore('readonly');
  const stored = await request<unknown>(store.get(BINARY_KEY));
  return stored instanceof File ? stored : undefined;
}
