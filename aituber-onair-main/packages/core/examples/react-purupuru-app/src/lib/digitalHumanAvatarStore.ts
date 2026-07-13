const DB_NAME = 'digital-human-avatar-assets-v1';
const STORE = 'avatarPackages';

function openStore(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const database = await openStore();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE, mode);
    const request = action(transaction.objectStore(STORE));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => database.close();
    transaction.onerror = () => reject(transaction.error);
  });
}

export const digitalHumanAvatarStore = {
  put(profileId: string, file: File) {
    return withStore('readwrite', (store) => store.put(file, profileId));
  },
  get(profileId: string) {
    return withStore<Blob | undefined>('readonly', (store) => store.get(profileId));
  },
  remove(profileId: string) {
    return withStore('readwrite', (store) => store.delete(profileId));
  },
};
