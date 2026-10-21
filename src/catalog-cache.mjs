export const COACUS_CATALOG_URL = 'https://raw.githubusercontent.com/dandgabr/Coacus/main/catalog/catalog.json';
export const CATALOG_CACHE_TTL_MS = 5 * 60 * 1000;
export const CATALOG_STALE_LIMIT_MS = 7 * 24 * 60 * 60 * 1000;

export const CATALOG_COUNT_KEYS = Object.freeze(['agents', 'skills', 'mcps']);
const COUNTS = CATALOG_COUNT_KEYS;
const storeMutationQueues = new WeakMap();

function queueStoreMutation(store, method, value, isCurrent) {
  if (!store || typeof store[method] !== 'function') return Promise.resolve();
  const previous = storeMutationQueues.get(store) || Promise.resolve();
  const mutation = previous.catch(() => {}).then(() => {
    if (!isCurrent()) return;
    return store[method](value);
  });
  storeMutationQueues.set(store, mutation);
  return mutation;
}

export function createCatalogLoadSequence() {
  let current = 0;
  return {
    next: () => ++current,
    isCurrent: (sequence) => sequence === current,
  };
}

export function validateCoacusCatalog(payload) {
  if (!payload || typeof payload !== 'object' || payload.schema !== 1) {
    throw new TypeError('Unsupported Coacus catalog schema.');
  }

  if (!payload.counts || typeof payload.counts !== 'object'
      || Object.keys(payload.counts).length !== COUNTS.length
      || COUNTS.some((key) => !Object.hasOwn(payload.counts, key))) {
    throw new TypeError('Invalid Coacus catalog counts.');
  }
  for (const key of COUNTS) {
    if (!Array.isArray(payload[key])) throw new TypeError(`Invalid Coacus ${key} catalog.`);
    if (!Number.isInteger(payload.counts?.[key]) || payload.counts[key] < 0 || payload.counts[key] !== payload[key].length) {
      throw new TypeError(`Coacus catalog ${key} count does not match its entries.`);
    }
  }

  const isNonEmptyString = (value) => typeof value === 'string' && Boolean(value.trim());
  for (const agent of payload.agents) {
    if (!['name', 'category', 'description', 'source'].every((key) => isNonEmptyString(agent?.[key]))) {
      throw new TypeError('Invalid Coacus agent entry.');
    }
  }
  for (const kind of ['skills', 'mcps']) {
    for (const entry of payload[kind]) {
      if (!isNonEmptyString(entry?.name) || !isNonEmptyString(entry?.path)) {
        throw new TypeError(`Invalid Coacus ${kind} entry.`);
      }
    }
  }
  return payload;
}

function pathCategory(path, kind) {
  const parts = path.split('/');
  const root = kind === 'skill'
    ? Math.max(parts.indexOf('skills'), parts.indexOf('workflows'))
    : parts.indexOf('mcps');
  if (root < 0) return '';
  const category = parts.slice(root + 1, -2).join('/');
  if (category) return category;
  return parts[root] === 'workflows' ? 'methodology/workflows' : '';
}

export function normalizeCoacusCatalog(payload) {
  validateCoacusCatalog(payload);
  return [
    ...payload.skills.map((entry) => ({ ...entry, kind: 'skill', category: pathCategory(entry.path, 'skill') })),
    ...payload.agents.map((entry) => ({ ...entry, path: entry.source, kind: 'agent' })),
    ...payload.mcps.map((entry) => ({ ...entry, category: pathCategory(entry.path, 'mcp'), kind: 'mcp' })),
  ];
}

export function catalogCacheFreshness(record, now = Date.now()) {
  if (!record || !Number.isFinite(record.savedAt) || record.savedAt > now) return 'invalid';
  try {
    validateCoacusCatalog(record.payload);
  } catch {
    return 'invalid';
  }
  const age = now - record.savedAt;
  if (age <= CATALOG_CACHE_TTL_MS) return 'fresh';
  if (age <= CATALOG_STALE_LIMIT_MS) return 'stale';
  return 'expired';
}

export async function startCatalogLoad({ store, fetcher = fetch, onState, now = Date.now, isCurrent = () => true }) {
  let record = null;
  try {
    record = await store?.get?.();
  } catch { /* Storage is an optimization; the network path remains available. */ }
  if (!isCurrent()) return;

  let freshness = catalogCacheFreshness(record, now());
  if (freshness === 'invalid' || freshness === 'expired') {
    try { await queueStoreMutation(store, 'deleteIfUnchanged', record, isCurrent); } catch { /* Ignore unavailable browser storage. */ }
    if (!isCurrent()) return;
    record = null;
    freshness = 'empty';
  }

  if (freshness === 'fresh') {
    if (isCurrent()) onState?.({ status: 'fresh', source: 'browser', payload: record.payload, savedAt: record.savedAt });
    return;
  }

  if (freshness === 'stale') onState?.({ status: 'refreshing', source: 'browser', payload: record.payload, savedAt: record.savedAt });

  try {
    const response = await fetcher({ cache: freshness === 'stale' ? 'no-cache' : 'default' });
    if (!response?.ok) throw new Error(`Catalog request failed${response?.status ? ` (${response.status})` : ''}.`);
    const payload = validateCoacusCatalog(await response.json());
    if (!isCurrent()) return;
    const savedAt = now();
    try { await queueStoreMutation(store, 'set', { payload, savedAt }, isCurrent); } catch { /* The current page can still use this response. */ }
    if (isCurrent()) onState?.({ status: 'fresh', source: 'network', payload, savedAt });
  } catch (error) {
    if (!isCurrent()) return;
    if (freshness === 'stale') {
      onState?.({ status: 'stale', source: 'browser', payload: record.payload, savedAt: record.savedAt, error });
    } else {
      onState?.({ status: 'unavailable', error });
    }
  }
}

export function createIndexedDbCatalogStore(indexedDB = globalThis.indexedDB) {
  let databasePromise;
  const database = () => {
    if (!indexedDB) return Promise.reject(new Error('IndexedDB is unavailable.'));
    if (!databasePromise) {
      databasePromise = new Promise((resolve, reject) => {
        const request = indexedDB.open('coacus-showcase-cache', 1);
        request.onupgradeneeded = () => {
          if (!request.result.objectStoreNames.contains('catalog')) request.result.createObjectStore('catalog');
        };
        request.onsuccess = () => {
          request.result.onversionchange = () => request.result.close();
          resolve(request.result);
        };
        request.onerror = () => reject(request.error || new Error('Could not open IndexedDB.'));
        request.onblocked = () => {
          request.onsuccess = () => request.result.close();
          reject(new Error('IndexedDB upgrade is blocked.'));
        };
      }).catch((error) => {
        databasePromise = null;
        throw error;
      });
    }
    return databasePromise;
  };

  const requestResult = (request) => new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('IndexedDB request failed.'));
  });
  const transact = async (mode, action) => {
    const db = await database();
    const transaction = db.transaction('catalog', mode);
    const result = await requestResult(action(transaction.objectStore('catalog')));
    await new Promise((resolve, reject) => {
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error || new Error('IndexedDB transaction failed.'));
      transaction.onabort = () => reject(transaction.error || new Error('IndexedDB transaction was aborted.'));
    });
    return result;
  };

  const deleteIfUnchanged = async (expected) => {
    const db = await database();
    const transaction = db.transaction('catalog', 'readwrite');
    const objectStore = transaction.objectStore('catalog');
    const read = objectStore.get('main');
    read.onsuccess = () => {
      const current = read.result;
      if (current && expected && current.savedAt === expected.savedAt
          && JSON.stringify(current.payload) === JSON.stringify(expected?.payload)) {
        objectStore.delete('main');
      }
    };
    await new Promise((resolve, reject) => {
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error || new Error('IndexedDB transaction failed.'));
      transaction.onabort = () => reject(transaction.error || new Error('IndexedDB transaction was aborted.'));
    });
  };

  return {
    get: () => transact('readonly', (store) => store.get('main')),
    set: (record) => transact('readwrite', (store) => store.put(record, 'main')),
    deleteIfUnchanged,
  };
}
