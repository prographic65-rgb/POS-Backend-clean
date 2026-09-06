/**
 * Which lines of an order the kitchen actually cooks.
 *
 * Drinks are poured at the counter, not prepared in the kitchen, so a line
 * from a drinks category must never appear on a kitchen ticket — and an order
 * made ONLY of such lines must never sit on the kitchen board waiting for a
 * chef to "start preparing" a bottle of water.
 *
 * Two signals decide it, both evaluated at ORDER time and snapshotted onto
 * `OrderItem.skipKitchen`, so that renaming or re-flagging a category later
 * cannot rewrite which lines the kitchen was told to cook on past orders:
 *
 *  1. `Category.skipKitchen`, an explicit owner-set flag.
 *  2. The category NAME matching a drinks pattern. This is the zero-config
 *     path: every restaurant already has a "Drinks" or "Beverages" category,
 *     and the flag above exists so the owner can extend the rule to anything
 *     else served straight from the counter (desserts from a fridge, say) —
 *     or, by naming, avoid it.
 *
 * Both clients mirror this in `lib/kitchen.ts` purely for HINTS (labelling a
 * "Send to kitchen" button "Place order" when nothing needs cooking). The
 * server's stamp on each line is the only thing the kitchen screens read.
 */
export const DRINKS_CATEGORY_PATTERN = /\b(drinks?|beverages?)\b/i;

export interface KitchenRoutableCategory {
  name?: string | null;
  skipKitchen?: boolean | null;
}

/** True when nothing in this category needs the kitchen. */
export function categorySkipsKitchen(
  category: KitchenRoutableCategory | null | undefined,
): boolean {
  if (!category) return false;
  if (category.skipKitchen) return true;
  return DRINKS_CATEGORY_PATTERN.test(category.name ?? '');
}

/** The subset of lines the kitchen has to cook. */
export function kitchenLines<T extends { skipKitchen?: boolean | null }>(lines: T[]): T[] {
  return (lines ?? []).filter((line) => !line.skipKitchen);
}
