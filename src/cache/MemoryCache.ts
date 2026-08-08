import { err, ok } from '@/errors/ResultFactory';
import type { Result } from '@/errors/types';
import type { ICacheWithStats, CacheStats, CacheEntry } from './types';

export class MemoryCache implements ICacheWithStats {
  readonly name = 'memory';
  private store = new Map<string, CacheEntry<unknown>>();
  private hits = 0;
  private misses = 0;

  async get<T>(key: string): Promise<Result<T>> {
    const entry = this.store.get(key);
    if (!entry) {
      this.misses++;
      return err<T>('Cache miss', false);
    }
    if (entry.expiresAt && entry.expiresAt < Date.now()) {
      this.store.delete(key);
      this.misses++;
      return err<T>('Cache expired', false);
    }
    this.hits++;
    return ok(entry.value as T);
  }

  async set<T>(key: string, value: T, ttlMs?: number): Promise<Result<void>> {
    const expiresAt = ttlMs ? Date.now() + ttlMs : undefined;
    this.store.set(key, { value, expiresAt });
    return ok(undefined);
  }

  async delete(key: string): Promise<Result<void>> {
    this.store.delete(key);
    return ok(undefined);
  }

  async clear(): Promise<Result<void>> {
    this.store.clear();
    this.hits = 0;
    this.misses = 0;
    return ok(undefined);
  }

  getStats(): CacheStats {
    return {
      hits: this.hits,
      misses: this.misses,
      size: this.store.size,
      entries: this.store.size,
    };
  }
}
