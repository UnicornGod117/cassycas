// Local storage of notebooks in IndexedDB (falls back to memory when IndexedDB is unavailable,
// e.g. in a private window):
//   notebooks   the current notebook (key 'current')
//   cells       cell records, content-addressed by a hash of their content
//   versions    version history: each version lists cell hashes, so an unchanged cell is stored
//               once and shared by every version that contains it (a persistent structure)
//   library     the user's saved functions
const DB = 'cassycas', VERSION = 1;
const STORES = { notebooks: {}, cells: {}, versions: { autoIncrement: true, keyPath: 'id' }, library: { keyPath: 'name' } };
let dbp = null;
const memory = Object.fromEntries(Object.keys(STORES).map(k => [k, new Map()]));
let memId = 0;

function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB, VERSION);
      req.onupgradeneeded = () => { for (const [name, opts] of Object.entries(STORES)) if (!req.result.objectStoreNames.contains(name)) req.result.createObjectStore(name, opts); };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch { resolve(null); }
  });
  return dbp;
}
const done = (req) => new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); });

export async function get(store, key) {
  const db = await open();
  if (!db) return memory[store].get(key);
  return done(db.transaction(store).objectStore(store).get(key));
}
export async function put(store, value, key) {
  const db = await open();
  if (!db) {
    const k = key ?? (STORES[store].keyPath ? value[STORES[store].keyPath] ?? ++memId : undefined);
    if (STORES[store].keyPath && value[STORES[store].keyPath] === undefined) value = { ...value, [STORES[store].keyPath]: k };
    memory[store].set(k, value); return k;
  }
  const os = db.transaction(store, 'readwrite').objectStore(store);
  return done(key === undefined ? os.put(value) : os.put(value, key));
}
export async function del(store, key) {
  const db = await open();
  if (!db) { memory[store].delete(key); return; }
  return done(db.transaction(store, 'readwrite').objectStore(store).delete(key));
}
export async function getAll(store) {
  const db = await open();
  if (!db) return [...memory[store].values()];
  return done(db.transaction(store).objectStore(store).getAll());
}
export async function usingIndexedDB() { return !!(await open()); }

// 64-bit FNV-1a of a string, as hex: the address of a cell record.
export function hash(text) {
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 16777619) >>> 0;
    h2 = Math.imul(h2 ^ c, 2246822519) >>> 0;
  }
  return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0') + text.length.toString(16);
}
