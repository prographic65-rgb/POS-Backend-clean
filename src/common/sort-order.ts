/**
 * Menu ordering, shared by categories and products.
 *
 * Both carry a `sortOrder`: an owner-chosen integer, unique within a store,
 * that fixes where the row appears on the till. Every listing is ordered by
 * it ascending, then by name so the order is stable when two rows tie.
 *
 * Unnumbered (legacy, NULL) rows land last without an explicit NULLS LAST:
 * that is Postgres's default for ascending order, and leaving it implicit
 * keeps the clause on the plain code path TypeORM uses when a listing joins
 * a relation and pages at the same time.
 */

/** The `order:` clause for repository `find`/`findAndCount`. */
export const SORT_ORDER_FIND_ORDER = {
  sortOrder: 'ASC',
  name: 'ASC',
} as const;

/** Postgres SQLSTATE for a unique-constraint violation. */
const UNIQUE_VIOLATION = '23505';

/**
 * Whether a save failed on a unique index.
 *
 * TypeORM wraps the driver error in a QueryFailedError and copies the driver
 * fields onto it, but only in some versions — so both places are checked.
 */
export function isUniqueViolation(error: unknown): boolean {
  const candidate = error as { code?: unknown; driverError?: { code?: unknown } } | null;
  return (
    candidate?.code === UNIQUE_VIOLATION || candidate?.driverError?.code === UNIQUE_VIOLATION
  );
}
