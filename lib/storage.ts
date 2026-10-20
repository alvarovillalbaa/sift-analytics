import type { Workspace } from './types';

const WORKSPACE_KEY = 'sift.workspace.v1';
const DATABASE_NAME = 'sift.local-data.v1';
const STORE_NAME = 'files';

export type StoredFile = {
  id: string;
  name: string;
  bytes: ArrayBuffer;
  sheet?: string;
  updatedAt: string;
};

/** Metadata stays on this browser. Query results are deliberately not persisted. */
export function saveWorkspace(workspace: Workspace): void {
  if (typeof window === 'undefined') return;
  const metadata = {
    ...workspace,
    views: workspace.views.map((view) => ({
      ...view,
      panels: view.panels.map(({ result: _result, error: _error, ...panel }) => panel),
    })),
  };
  window.localStorage.setItem(WORKSPACE_KEY, JSON.stringify(metadata));
}

export function loadWorkspace(): Workspace | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(WORKSPACE_KEY);
    if (!raw) return null;
    const workspace: unknown = JSON.parse(raw);
    if (!workspace || typeof workspace !== 'object') return null;
    const candidate = workspace as Partial<Workspace>;
    if (!Array.isArray(candidate.datasets) || !Array.isArray(candidate.views)
      || !Array.isArray(candidate.metrics) || typeof candidate.activeViewId !== 'string'
      || typeof candidate.shareSchema !== 'boolean' || typeof candidate.shareResults !== 'boolean') return null;
    if (!candidate.views.every((view) => view && typeof view.id === 'string'
      && typeof view.name === 'string' && Array.isArray(view.panels)
      && view.panels.every((panel) => panel && typeof panel.id === 'string'
        && typeof panel.sql === 'string' && Array.isArray(panel.datasetIds)))) return null;
    if (!candidate.datasets.every((dataset) => dataset && typeof dataset.id === 'string'
      && typeof dataset.table === 'string' && Array.isArray(dataset.columns))) return null;
    return candidate as Workspace;
  } catch {
    return null;
  }
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('This browser does not support local file storage.'));
      return;
    }
    const request = indexedDB.open(DATABASE_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Could not open local file storage.'));
    request.onblocked = () => reject(new Error('Close other Sift tabs and retry local file storage.'));
  });
}

async function transact<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const database = await openDatabase();
  return new Promise<T>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, mode);
    const request = action(transaction.objectStore(STORE_NAME));
    let value: T;
    request.onsuccess = () => { value = request.result; };
    transaction.oncomplete = () => { database.close(); resolve(value); };
    transaction.onerror = () => { database.close(); reject(transaction.error ?? request.error ?? new Error('Local file storage failed.')); };
    transaction.onabort = () => { database.close(); reject(transaction.error ?? new Error('Local file storage was interrupted.')); };
  });
}

export async function storeFile(file: StoredFile): Promise<void> {
  await transact('readwrite', (store) => store.put(file));
}

export function loadFiles(): Promise<StoredFile[]> {
  return transact('readonly', (store) => store.getAll());
}

export async function removeStoredFile(id: string): Promise<void> {
  await transact('readwrite', (store) => store.delete(id));
}

/** Clear only Sift's local metadata and uploaded files, never another app's storage. */
export async function resetWorkspace(): Promise<void> {
  await transact('readwrite', (store) => store.clear());
  if (typeof window !== 'undefined') window.localStorage.removeItem(WORKSPACE_KEY);
}
