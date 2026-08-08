import { AppError } from '@/errors/AppError';
import { err, ok } from '@/errors/ResultFactory';
import type { Result } from '@/errors/types';
import type { ICacheWithStats, CacheStats, CacheEntry } from './types';

export class DiskCache implements ICacheWithStats {
  readonly name = 'disk';
  private prefix: string;
  private hits = 0;
  private misses = 0;

  constructor(prefix = 'aios-cache-') {
    this.prefix = prefix;
  }

  private key(k: string): string {
    return this.prefix + k;
  }

  async get<T>(key: string): Promise<Result<T>> {
    try {
      const raw = localStorage.getItem(this.key(key));
      if (!raw) {
        this.misses++;
        return err<T>('Disk cache miss');
      }
      const parsed = JSON.parse(raw) as CacheEntry<T>;
      if (parsed.expiresAt && parsed.expiresAt < Date.now()) {
        localStorage.removeItem(this.key(key));
        this.misses++;
        return err<T>('Disk cache expired');
      }
      this.hits++;
      return ok(parsed.value);
    } catch (e) {
      return err<T>(AppError.from(e));
    }
  }

  async set<T>(key: string, value: T, ttlMs?: number): Promise<Result<void>> {
    try {
      const entry: CacheEntry<T> = { value, expiresAt: ttlMs ? Date.now() + ttlMs : undefined };
      localStorage.setItem(this.key(key), JSON.stringify(entry));
      return ok(undefined);
    } catch (e) {
      return err(AppError.from(e));
    }
  }

  async delete(key: string): Promise<Result<void>> {
    try {
      localStorage.removeItem(this.key(key));
      return ok(undefined);
    } catch (e) {
      return err(AppError.from(e));
    }
  }

  async clear(): Promise<Result<void>> {
    try {
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const key = localStorage.key(i);
        if (key?.startsWith(this.prefix)) localStorage.removeItem(key);
      }
      this.hits = 0;
      this.misses = 0;
      return ok(undefined);
    } catch (e) {
      return err(AppError.from(e));
    }
  }

  getStats(): CacheStats {
    let entries = 0;
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(this.prefix)) entries++;
    }
    return { hits: this.hits, misses: this.misses, size: entries, entries };
  }
}
