/** A page of results, returned when a caller asks for `withCount=true`. */
export interface Page<T> {
  items: T[];
  total: number;
  skip: number;
  take: number;
}

export const DEFAULT_PAGE_SIZE = 20;
/** Upper bound so a caller cannot ask for the whole table in one request. */
export const MAX_PAGE_SIZE = 200;

/**
 * Ceiling for catalogue endpoints (active products, categories).
 *
 * These feed PICKERS — the POS grid and the waiter's menu — which must show
 * the complete catalogue, not a page of it. Capping them at MAX_PAGE_SIZE
 * would silently hide items once a menu passes 200, with no pager to reach
 * them. Still bounded, so a runaway request cannot dump an unbounded table.
 */
export const MAX_CATALOGUE_SIZE = 2000;

/**
 * Normalises `skip`/`take` query params.
 *
 * They arrive as STRINGS: the global ValidationPipe in main.ts is created
 * without `transform`, so a handler typed `skip?: number` actually receives
 * `"20"`. Passing that straight to TypeORM silently misbehaves, which is why
 * every paged endpoint routes through here instead of trusting its own types.
 */
export function parsePaging(
  skip: unknown,
  take: unknown,
  defaultTake = DEFAULT_PAGE_SIZE,
): { skip: number; take: number } {
  const parsedSkip = Number(skip);
  const parsedTake = Number(take);

  return {
    skip: Number.isFinite(parsedSkip) && parsedSkip > 0 ? Math.floor(parsedSkip) : 0,
    take:
      Number.isFinite(parsedTake) && parsedTake > 0
        ? Math.min(Math.floor(parsedTake), MAX_PAGE_SIZE)
        : defaultTake,
  };
}

/**
 * Whether the caller wants the `{ items, total }` envelope.
 *
 * Opt-in on purpose. Existing clients — including mobile builds already in
 * users' hands — expect a bare array from these endpoints, so the shape only
 * changes when a caller explicitly asks for it.
 */
export function wantsCount(flag: unknown): boolean {
  return flag === true || flag === 'true' || flag === '1';
}

export function toPage<T>(items: T[], total: number, skip: number, take: number): Page<T> {
  return { items, total, skip, take };
}

/**
 * Parses `skip`/`take` while preserving "no limit" when they are absent.
 *
 * Used by the legacy, non-paged branches of endpoints that must keep returning
 * everything when no paging is requested. Still parses, because these params
 * arrive as strings and were previously handed to TypeORM unconverted.
 */
export function parseOptionalPaging(
  skip: unknown,
  take: unknown,
  maxTake = MAX_PAGE_SIZE,
): { skip?: number; take?: number } {
  const parsedSkip = Number(skip);
  const parsedTake = Number(take);

  return {
    skip: Number.isFinite(parsedSkip) && parsedSkip > 0 ? Math.floor(parsedSkip) : undefined,
    take:
      Number.isFinite(parsedTake) && parsedTake > 0
        ? Math.min(Math.floor(parsedTake), maxTake)
        : undefined,
  };
}
