/**
 * The app used to be called Route Maker and kept its settings under
 * `route-maker:` keys. Moves them to `lapwing:` once, before anything reads
 * them (import this module first in main.ts). The IndexedDB database is
 * migrated separately in data/db.ts.
 */
const LEGACY_PREFIX = 'route-maker:';
const PREFIX = 'lapwing:';

export function migrateLegacyKeys(storage: Storage): void {
  const legacyKeys: string[] = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (key?.startsWith(LEGACY_PREFIX)) legacyKeys.push(key);
  }
  for (const key of legacyKeys) {
    const next = PREFIX + key.slice(LEGACY_PREFIX.length);
    const value = storage.getItem(key);
    if (value !== null && storage.getItem(next) === null) storage.setItem(next, value);
    storage.removeItem(key);
  }
}

for (const get of [() => localStorage, () => sessionStorage]) {
  try {
    migrateLegacyKeys(get());
  } catch {
    // Storage unavailable (private mode, blocked): nothing to migrate.
  }
}
