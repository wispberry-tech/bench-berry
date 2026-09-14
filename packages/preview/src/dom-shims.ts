// packages/preview/src/dom-shims.ts
// Safe storage shims for the sandboxed preview iframe. The shell embeds the
// canvas in an iframe with sandbox="allow-scripts" (no allow-same-origin), so
// any real localStorage/sessionStorage access throws a SecurityError. Host
// story modules commonly touch these at import time, and one throw aborts the
// whole module graph — leaving a blank canvas. The shims read the real
// Storage objects when accessible and otherwise hand out a private in-memory
// partition, so host code always sees a working Storage API. Files run before
// the story modules (first import in main.ts), which is why the getters are
// installed at module-evaluation time.
function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear() {
      data.clear();
    },
    getItem(key: string) {
      return data.has(key) ? data.get(key)! : null;
    },
    key(index: number) {
      return [...data.keys()][index] ?? null;
    },
    removeItem(key: string) {
      data.delete(key);
    },
    setItem(key: string, value: string) {
      data.set(String(key), String(value));
    },
  } as Storage;
}

function shimStorage(name: "localStorage" | "sessionStorage", real?: Storage) {
  Object.defineProperty(globalThis, name, {
    configurable: true,
    get: () => real ?? memoryStorage(),
  });
}

let realLocal: Storage | undefined;
let realSession: Storage | undefined;
try {
  realLocal = globalThis.localStorage;
} catch {
  // sandboxed (opaque origin): the access above always throws
}
try {
  realSession = globalThis.sessionStorage;
} catch {
  // sandboxed
}
shimStorage("localStorage", realLocal);
shimStorage("sessionStorage", realSession);
