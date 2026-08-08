import type { Result } from '@/errors/types';

export interface CacheEntry<T> {
  value: T;
  expiresAt?: number;
}

export interface ICache {
  name: string;
  get<T>(key: string): Promise<Result<T>>;
  set<T>(key: string, value: T, ttlMs?: number): Promise<Result<void>>;
  delete(key: string): Promise<Result<void>>;
  clear(): Promise<Result<void>>;
}

export interface ICacheWithStats extends ICache {
  getStats(): CacheStats;
}

export interface CacheStats {
  hits: number;
  misses: number;
  size: number;
  entries: number;
}
