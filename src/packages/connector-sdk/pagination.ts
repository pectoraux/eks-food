/** Pagination strategies for connector polling. */
export interface CursorPagination {
  readonly type: "cursor";
  readonly cursorParam: string;
  readonly cursorField: string;
}

export interface OffsetPagination {
  readonly type: "offset";
  readonly offsetParam: string;
  readonly limitParam: string;
  readonly pageSize: number;
}

export interface PagePagination {
  readonly type: "page";
  readonly pageParam: string;
  readonly limitParam: string;
  readonly pageSize: number;
}

export type PaginationStrategy = CursorPagination | OffsetPagination | PagePagination;

/** Build the query params for the next page based on the strategy. */
export function buildPagination(strategy: PaginationStrategy, cursor?: string, page?: number): Record<string, string | number> {
  switch (strategy.type) {
    case "cursor":
      return cursor ? { [strategy.cursorParam]: cursor } : {};
    case "offset": {
      const offset = page ? page * strategy.pageSize : 0;
      return { [strategy.offsetParam]: offset, [strategy.limitParam]: strategy.pageSize };
    }
    case "page":
      return { [strategy.pageParam]: page ?? 1, [strategy.limitParam]: strategy.pageSize };
  }
}
