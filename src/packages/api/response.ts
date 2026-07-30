/** Standard success responses with the Eks-Food envelope. */
export interface ApiResponse<T> {
  readonly data: T;
  readonly meta?: {
    readonly requestId?: string;
    readonly pagination?: { readonly limit: number; readonly offset: number; readonly total: number; readonly hasMore: boolean };
    readonly cursor?: { readonly limit: number; readonly nextCursor: string | null; readonly hasMore: boolean };
  };
}

export function success<T>(data: T, init?: ResponseInit): Response {
  return Response.json({ data } satisfies ApiResponse<T>, init);
}

export function created<T>(data: T): Response {
  return success(data, { status: 201 });
}

export function noContent(): Response {
  return new Response(null, { status: 204 });
}

export function paginated<T>(items: readonly T[], opts: { limit: number; offset: number; total: number; hasMore: boolean }): Response {
  return Response.json({
    data: [...items],
    meta: { pagination: { limit: opts.limit, offset: opts.offset, total: opts.total, hasMore: opts.hasMore } },
  } satisfies ApiResponse<T[]>);
}
