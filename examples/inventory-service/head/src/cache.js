import { createLogger } from './logger.js';

const log = createLogger('cache');

const MAX_ENTRIES = 512;

/**
 * Small time-to-live cache used for read-mostly values such as per-SKU
 * availability. Entries are considered stale once `ttlMs` has elapsed since
 * they were written; writers are expected to call {@link TtlCache#invalidate}
 * whenever they mutate the underlying row.
 */
export class TtlCache {
  /**
   * @param {{ ttlMs?: number, clock?: () => number, name?: string }} [options]
   */
  constructor(options = {}) {
    this.ttlMs = options.ttlMs ?? 5000;
    this.clock = options.clock ?? Date.now;
    this.name = options.name ?? 'anonymous';
    this.entries = new Map();
    this.hits = 0;
    this.misses = 0;
  }

  /**
   * @param {string} key
   * @returns {*} the cached value, or `undefined` when absent or stale
   */
  get(key) {
    const entry = this.entries.get(key);
    if (entry === undefined) {
      this.misses += 1;
      return undefined;
    }
    if (this.clock() - entry.storedAt >= this.ttlMs) {
      this.entries.delete(key);
      this.misses += 1;
      return undefined;
    }
    this.hits += 1;
    return entry.value;
  }

  /**
   * Writes an entry, evicting the least recently written key once the cache
   * grows past {@link MAX_ENTRIES}. Storefront traffic touches a long tail of
   * SKUs, so an unbounded map here shows up as steady heap growth.
   *
   * @param {string} key
   * @param {*} value
   */
  set(key, value) {
    if (this.entries.has(key)) {
      this.entries.delete(key);
    }
    this.entries.set(key, { value, storedAt: this.clock() });

    if (this.entries.size > MAX_ENTRIES) {
      const oldest = this.entries.keys().next().value;
      this.entries.delete(oldest);
    }
  }

  /**
   * Drops a single key so the next read goes back to the source of truth.
   *
   * @param {string} key
   * @returns {boolean} whether an entry was actually present
   */
  invalidate(key) {
    return this.entries.delete(key);
  }

  clear() {
    log.info('cleared', { name: this.name, entries: this.entries.size });
    this.entries.clear();
  }

  get size() {
    return this.entries.size;
  }

  stats() {
    return { name: this.name, size: this.entries.size, hits: this.hits, misses: this.misses };
  }
}
