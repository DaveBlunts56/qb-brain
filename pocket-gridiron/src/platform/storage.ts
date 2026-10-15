/**
 * Small key-value store: IndexedDB first, then localStorage, then memory.
 * Every access is guarded: private browsing, sandboxed iframes and storage pressure can all make
 * storage throw or vanish, and the game must still run.
 */
export interface KeyValueStore {
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T): Promise<void>;
  readonly kind: "indexeddb" | "localstorage" | "memory";
}

const DB_NAME = "pocket-gridiron";
const STORE = "kv";
const LS_PREFIX = "pocket-gridiron:";

class MemoryStore implements KeyValueStore {
  readonly kind = "memory" as const;
  private data = new Map<string, unknown>();
  async get<T>(key: string) {
    return this.data.get(key) as T | undefined;
  }
  async set<T>(key: string, value: T) {
    this.data.set(key, value);
  }
}

class LocalStore implements KeyValueStore {
  readonly kind = "localstorage" as const;
  constructor(private ls: Storage) {}
  async get<T>(key: string) {
    try {
      const raw = this.ls.getItem(LS_PREFIX + key);
      return raw === null ? undefined : (JSON.parse(raw) as T);
    } catch {
      return undefined;
    }
  }
  async set<T>(key: string, value: T) {
    try {
      this.ls.setItem(LS_PREFIX + key, JSON.stringify(value));
    } catch {
      /* quota or disabled: ignore */
    }
  }
}

class IdbStore implements KeyValueStore {
  readonly kind = "indexeddb" as const;
  constructor(private db: IDBDatabase, private fallback: KeyValueStore) {}
  get<T>(key: string): Promise<T | undefined> {
    return new Promise((resolve) => {
      try {
        const req = this.db.transaction(STORE, "readonly").objectStore(STORE).get(key);
        req.onsuccess = () => resolve(req.result as T | undefined);
        req.onerror = () => this.fallback.get<T>(key).then(resolve);
      } catch {
        this.fallback.get<T>(key).then(resolve);
      }
    });
  }
  set<T>(key: string, value: T): Promise<void> {
    return new Promise((resolve) => {
      try {
        const tx = this.db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).put(value, key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => this.fallback.set(key, value).then(resolve);
      } catch {
        this.fallback.set(key, value).then(resolve);
      }
    });
  }
}

function openIdb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      if (typeof indexedDB === "undefined") return resolve(null);
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
      // Some browsers never answer in restricted contexts.
      setTimeout(() => resolve(null), 1500);
    } catch {
      resolve(null);
    }
  });
}

function localOrMemory(): KeyValueStore {
  try {
    const ls = globalThis.localStorage;
    const probe = LS_PREFIX + "probe";
    ls.setItem(probe, "1");
    ls.removeItem(probe);
    return new LocalStore(ls);
  } catch {
    return new MemoryStore();
  }
}

export async function openStore(): Promise<KeyValueStore> {
  const fallback = localOrMemory();
  const db = await openIdb();
  return db ? new IdbStore(db, fallback) : fallback;
}

export function memoryStore(): KeyValueStore {
  return new MemoryStore();
}
