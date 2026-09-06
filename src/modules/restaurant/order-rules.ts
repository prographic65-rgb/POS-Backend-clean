import { BadRequestException, ForbiddenException } from '@nestjs/common';
import type { OrderType, RestaurantOrderStatus } from '../../entities';
import { kitchenLines } from '../../common/kitchen-routing';
import { round2 } from '../../common/discount';

/**
 * Pure decisions of the restaurant order flow, kept out of the service so
 * they can be unit-tested without a database. The service owns transactions
 * and events; this file owns the rules.
 */

interface LineLike {
  skipKitchen?: boolean | null;
  isParcel?: boolean | null;
}

/** Order types that sit at a table. `dine_out` claims one exactly like `dine_in`. */
export function needsTable(orderType?: OrderType | string | null): boolean {
  return orderType === 'dine_in' || orderType === 'dine_out';
}

/**
 * Dine-in versus dine-out is no longer something the waiter picks up front:
 * it is DERIVED from the lines. Mark any line as a parcel and the order is a
 * dine-out; mark none and it is a plain dine-in. The clients send whichever
 * they last computed, but the server re-derives so an older build that still
 * sends a type cannot leave a parcel-less "dine_out" or a parcelled "dine_in".
 *
 * Takeaway and delivery are untouched: every line of those is a parcel by
 * definition, and nothing per line flags it.
 */
export function resolveOrderType(
  requested: OrderType | string,
  lines: LineLike[],
): OrderType {
  if (!needsTable(requested)) return requested as OrderType;
  return lines.some((l) => !!l.isParcel) ? 'dine_out' : 'dine_in';
}

/**
 * Where a freshly punched order starts.
 *
 * An order with nothing for the kitchen to cook — drinks only — never goes on
 * the board: it opens directly in the kitchen's terminal state, which is what
 * "ready to bill" means to the cashier.
 */
export function initialStatus(lines: LineLike[]): RestaurantOrderStatus {
  return kitchenLines(lines).length ? 'requested' : 'handed_over';
}

/**
 * Where an order goes after a further round is added.
 *
 * Kitchen lines in the round put a finished order back in front of the chef.
 * A round of drinks on a finished order leaves it where it is. Either way,
 * an order whose bill was already printed is no longer accurately billed —
 * the caller clears the print claim — so the cashier has to print again.
 */
export function statusAfterRound(
  current: RestaurantOrderStatus,
  newLines: LineLike[],
): RestaurantOrderStatus {
  const cooksSomething = kitchenLines(newLines).length > 0;
  if (cooksSomething && current === 'handed_over') return 'requested';
  return current;
}

export interface BillViewer {
  userId: string;
  /** Effective role. Owners are never locked out of a bill. */
  role?: string | null;
}

interface BillClaimable {
  billPrintedById?: string | null;
  billPrintedBy?: { name?: string | null } | null;
}

export function isOwnerRole(role?: string | null): boolean {
  return role === 'restaurant_owner' || role === 'store_owner' || role === 'super_admin';
}

/**
 * Whether this user may act on a bill (reprint it, take its money, cancel it).
 *
 * The first cashier to print a bill CLAIMS the order: two tills must not both
 * be able to collect for the same table. Until a bill is printed the order is
 * open to every cashier; once printed, only the printer — or an owner, who can
 * always step in when that cashier has gone home.
 */
export function canActOnBill(order: BillClaimable, viewer: BillViewer): boolean {
  if (!order.billPrintedById) return true;
  if (isOwnerRole(viewer.role)) return true;
  return order.billPrintedById === viewer.userId;
}

export function assertCanActOnBill(order: BillClaimable, viewer: BillViewer): void {
  if (canActOnBill(order, viewer)) return;
  const who = order.billPrintedBy?.name ? ` by ${order.billPrintedBy.name}` : ' by another cashier';
  throw new ForbiddenException(
    `This bill was printed${who}. Only they can settle it, unless an owner steps in.`,
  );
}

// ------------------------------------------------------------------ payment

export type PaymentMethod = 'cash' | 'card' | 'check' | 'online' | 'partial';

export interface PaymentSplitInput {
  cash?: number | string | null;
  card?: number | string | null;
  online?: number | string | null;
}

/** What gets written on the order: the method, and the money by method. */
export interface ResolvedPayment {
  paymentMethod: PaymentMethod;
  paidCash: number;
  paidCard: number;
  paidOnline: number;
}

/**
 * Turns what the cashier chose into per-method amounts.
 *
 * A single method takes the whole total. 'partial' takes the split the
 * cashier typed, which MUST add up to the total to the cent — the point of
 * recording it is that the shift handover accounts for every rupee, and a
 * split that does not balance would silently create or lose money. A
 * "partial" payment that turns out to be one method is stored as that method,
 * so reports never show a split of one.
 */
export function resolvePayment(
  method: string | null | undefined,
  split: PaymentSplitInput | null | undefined,
  total: number,
): ResolvedPayment {
  const due = round2(Number(total) || 0);
  const chosen = (method ?? 'cash') as PaymentMethod;

  if (chosen !== 'partial') {
    return {
      paymentMethod: chosen,
      paidCash: chosen === 'cash' ? due : 0,
      paidCard: chosen === 'card' ? due : 0,
      paidOnline: chosen === 'online' ? due : 0,
    };
  }

  const part = (value: number | string | null | undefined, name: string) => {
    if (value === null || value === undefined || value === '') return 0;
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0) {
      throw new BadRequestException(`The ${name} amount must be a number of zero or more`);
    }
    return round2(n);
  };
  const cash = part(split?.cash, 'cash');
  const card = part(split?.card, 'card');
  const online = part(split?.online, 'online');
  const sum = round2(cash + card + online);

  if (Math.abs(sum - due) > 0.009) {
    throw new BadRequestException(
      `The split adds up to ${sum.toFixed(2)}, but the bill is ${due.toFixed(2)}`,
    );
  }

  const used = [cash > 0, card > 0, online > 0].filter(Boolean).length;
  if (used <= 1) {
    // Nothing split after all: one method, or a fully discounted zero bill.
    const only: PaymentMethod = card > 0 ? 'card' : online > 0 ? 'online' : 'cash';
    return resolvePayment(only, undefined, due);
  }

  return { paymentMethod: 'partial', paidCash: cash, paidCard: card, paidOnline: online };
}
