/** Pagination primitives — cursor & offset, shared by every list endpoint. */
import type { UUID } from "./ids";

export interface OffsetPagination {
  readonly limit: number;
  readonly offset: number;
}

export interface CursorPagination {
  readonly limit: number;
  /** Opaque cursor; `null`/`undefined` for the first page. */
  readonly cursor: string | null;
}

export interface PagedResult<T> {
  readonly items: readonly T[];
  readonly total: number;
  readonly limit: number;
  readonly offset: number;
  readonly hasMore: boolean;
}

export interface CursorResult<T> {
  readonly items: readonly T[];
  readonly limit: number;
  readonly nextCursor: string | null;
  readonly hasMore: boolean;
}

/** Encode an id-based cursor. Opaque to clients. */
export function encodeCursor(after: UUID | string, sortKey?: string | number): string {
  const payload = sortKey !== undefined ? { a: after, s: sortKey } : { a: after };
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

/** Decode a cursor; returns null for empty/invalid input. */
export function decodeCursor(cursor: string | null): { a: string; s?: string | number } | null {
  if (!cursor) return null;
  try {
    const json = Buffer.from(cursor, "base64url").toString("utf8");
    return JSON.parse(json) as { a: string; s?: string | number };
  } catch {
    return null;
  }
}

export function clampLimit(requested: number | undefined, max = 100, def = 20): number {
  if (requested === undefined || !Number.isFinite(requested) || requested <= 0) return def;
  return Math.min(Math.floor(requested), max);
}

export function clampOffset(requested: number | undefined): number {
  if (requested === undefined || !Number.isFinite(requested) || requested < 0) return 0;
  return Math.floor(requested);
}

/** Build a PagedResult from a full or pre-sliced list. */
export function toPagedResult<T>(items: readonly T[], params: OffsetPagination, total?: number): PagedResult<T> {
  const totalCount = total ?? items.length;
  const hasMore = params.offset + items.length < totalCount;
  return {
    items,
    total: totalCount,
    limit: params.limit,
    offset: params.offset,
    hasMore,
  };
}

/** Build a CursorResult from a sliced list (limit+1 fetch pattern). */
export function toCursorResult<T extends { id: string }>(fetched: readonly T[], limit: number): CursorResult<T> {
  const hasMore = fetched.length > limit;
  const items = hasMore ? fetched.slice(0, limit) : fetched;
  const nextCursor = hasMore && items.length > 0 ? encodeCursor(items[items.length - 1].id as UUID) : null;
  return { items, limit, nextCursor, hasMore };
}
