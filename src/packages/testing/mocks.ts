/**
 * Generic in-memory repository fake.
 *
 * `mockRepository<T>()` returns a fully-typed fake implementing the standard
 * `findById` / `save` / `list` repository contract, backed by a `Map`. It
 * also exposes the underlying `store` and a `reset()` for direct
 * manipulation/reset between tests.
 *
 * The entity type `T` must carry a string `id` field — that's the only
 * structural requirement. The fake is intentionally agnostic about the rest
 * of the entity shape so it works for any aggregate.
 */

export interface Repository<T extends { id: string }> {
  findById(id: string): Promise<T | null>;
  save(entity: T): Promise<T>;
  list(): Promise<T[]>;
}

export interface MockRepository<T extends { id: string }>
  extends Repository<T> {
  /** Direct access to the backing Map for assertions/setup. */
  readonly store: Map<string, T>;
  /** Drop every stored entity. */
  reset(): void;
}

export function mockRepository<T extends { id: string }>(): MockRepository<T> {
  const store = new Map<string, T>();

  const fake: MockRepository<T> = {
    store,
    async findById(id: string): Promise<T | null> {
      const stored = store.get(id);
      return stored === undefined ? null : { ...stored };
    },
    async save(entity: T): Promise<T> {
      // Store a shallow copy so callers can't mutate stored state by reference.
      const snapshot: T = { ...entity };
      store.set(entity.id, snapshot);
      return { ...snapshot };
    },
    async list(): Promise<T[]> {
      return Array.from(store.values()).map((entity) => ({ ...entity }));
    },
    reset(): void {
      store.clear();
    },
  };

  return fake;
}
