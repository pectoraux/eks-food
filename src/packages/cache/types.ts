export interface CacheOptions {
  readonly ttlMs?: number;
  readonly namespace?: string;
}

export interface Cache<V = unknown> {
  get<T = V>(key: string): Promise<T | null>;
  set<T = V>(key: string, value: T, opts?: CacheOptions): Promise<void>;
  delete(key: string): Promise<void>;
  deleteByPrefix(prefix: string): Promise<number>;
  has(key: string): Promise<boolean>;
  clear(): Promise<void>;
  readonly size: number;
}

export interface LockOptions {
  readonly ttlMs?: number;
  readonly retryDelayMs?: number;
  readonly retryCount?: number;
}

export interface Lock {
  readonly key: string;
  readonly acquired: boolean;
  release(): Promise<void>;
  extend(ttlMs: number): Promise<boolean>;
}
