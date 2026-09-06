import { BadRequestException, ForbiddenException } from '@nestjs/common';
import {
  assertCanActOnBill,
  canActOnBill,
  initialStatus,
  needsTable,
  resolveOrderType,
  resolvePayment,
  statusAfterRound,
} from './order-rules';

describe('resolvePayment', () => {
  it('puts the whole total on a single method', () => {
    expect(resolvePayment('card', undefined, 1650)).toEqual({
      paymentMethod: 'card', paidCash: 0, paidCard: 1650, paidOnline: 0,
    });
    expect(resolvePayment(undefined, undefined, 100).paymentMethod).toBe('cash');
  });

  it('records a split that adds up to the total', () => {
    expect(resolvePayment('partial', { cash: 1000, card: 500, online: 150 }, 1650)).toEqual({
      paymentMethod: 'partial', paidCash: 1000, paidCard: 500, paidOnline: 150,
    });
  });

  it('accepts string amounts and blanks', () => {
    expect(resolvePayment('partial', { cash: '1000', card: '', online: 650 }, 1650)).toEqual({
      paymentMethod: 'partial', paidCash: 1000, paidCard: 0, paidOnline: 650,
    });
  });

  it('rejects a split that does not balance', () => {
    expect(() => resolvePayment('partial', { cash: 1000, card: 600 }, 1650)).toThrow(BadRequestException);
    expect(() => resolvePayment('partial', { cash: 1000, card: 600 }, 1650)).toThrow(/1600\.00.*1650\.00/);
    expect(() => resolvePayment('partial', undefined, 1650)).toThrow(BadRequestException);
  });

  it('rejects a negative part', () => {
    expect(() => resolvePayment('partial', { cash: 1700, card: -50 }, 1650)).toThrow(/card amount/);
  });

  it('tolerates rounding noise', () => {
    expect(resolvePayment('partial', { cash: 0.1, card: 0.2 }, 0.3).paymentMethod).toBe('partial');
  });

  it('collapses a split that is really one method', () => {
    expect(resolvePayment('partial', { cash: 0, card: 1650 }, 1650)).toEqual({
      paymentMethod: 'card', paidCash: 0, paidCard: 1650, paidOnline: 0,
    });
  });

  it('treats a zero bill as cash whatever was chosen', () => {
    expect(resolvePayment('partial', {}, 0)).toEqual({
      paymentMethod: 'cash', paidCash: 0, paidCard: 0, paidOnline: 0,
    });
  });
});

describe('needsTable', () => {
  it('is true for the two seated types only', () => {
    expect(needsTable('dine_in')).toBe(true);
    expect(needsTable('dine_out')).toBe(true);
    expect(needsTable('takeaway')).toBe(false);
    expect(needsTable('delivery')).toBe(false);
    expect(needsTable(null)).toBe(false);
  });
});

describe('resolveOrderType', () => {
  it('derives dine_out from any parcel line', () => {
    expect(resolveOrderType('dine_in', [{ isParcel: false }, { isParcel: true }])).toBe('dine_out');
  });

  it('derives dine_in when nothing is packed, even if the client said dine_out', () => {
    expect(resolveOrderType('dine_out', [{ isParcel: false }, {}])).toBe('dine_in');
  });

  it('never touches takeaway or delivery', () => {
    expect(resolveOrderType('takeaway', [{ isParcel: true }])).toBe('takeaway');
    expect(resolveOrderType('delivery', [{ isParcel: false }])).toBe('delivery');
  });
});

describe('initialStatus', () => {
  it('sends an order with kitchen lines to the kitchen', () => {
    expect(initialStatus([{ skipKitchen: true }, { skipKitchen: false }])).toBe('requested');
  });

  it('opens a drinks-only order as already handed over', () => {
    expect(initialStatus([{ skipKitchen: true }, { skipKitchen: true }])).toBe('handed_over');
  });
});

describe('statusAfterRound', () => {
  it('reopens a handed-over order when the round needs cooking', () => {
    expect(statusAfterRound('handed_over', [{ skipKitchen: false }])).toBe('requested');
  });

  it('leaves a handed-over order alone for a round of drinks', () => {
    expect(statusAfterRound('handed_over', [{ skipKitchen: true }])).toBe('handed_over');
  });

  it('does not disturb an order the kitchen is still working on', () => {
    expect(statusAfterRound('preparing', [{ skipKitchen: false }])).toBe('preparing');
    expect(statusAfterRound('requested', [{ skipKitchen: true }])).toBe('requested');
  });
});

describe('canActOnBill', () => {
  const cashierA = { userId: 'a', role: 'cashier' };
  const cashierB = { userId: 'b', role: 'cashier' };
  const owner = { userId: 'o', role: 'restaurant_owner' };

  it('lets any cashier act before a bill is printed', () => {
    expect(canActOnBill({ billPrintedById: null }, cashierA)).toBe(true);
    expect(canActOnBill({}, cashierB)).toBe(true);
  });

  it('locks a printed bill to the cashier who printed it', () => {
    const order = { billPrintedById: 'a' };
    expect(canActOnBill(order, cashierA)).toBe(true);
    expect(canActOnBill(order, cashierB)).toBe(false);
  });

  it('always lets an owner step in', () => {
    expect(canActOnBill({ billPrintedById: 'a' }, owner)).toBe(true);
  });

  it('names the printing cashier in the refusal', () => {
    const order = { billPrintedById: 'a', billPrintedBy: { name: 'Ayesha' } };
    expect(() => assertCanActOnBill(order, cashierB)).toThrow(ForbiddenException);
    expect(() => assertCanActOnBill(order, cashierB)).toThrow(/Ayesha/);
    expect(() => assertCanActOnBill(order, cashierA)).not.toThrow();
  });
});
