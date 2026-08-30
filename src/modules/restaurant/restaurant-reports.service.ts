import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Order } from '../../entities';
import { round2 } from '../../common/discount';

/**
 * Sales and profit for a restaurant owner.
 *
 * Profit uses the `unitCost` snapshot taken when each line was punched, not
 * the product's current cost, so editing a cost today cannot rewrite the
 * margin on last month's orders.
 */
@Injectable()
export class RestaurantReportsService {
  constructor(
    @InjectRepository(Order)
    private ordersRepository: Repository<Order>,
  ) {}

  async sales(storeId: string, from?: string, to?: string) {
    const qb = this.ordersRepository
      .createQueryBuilder('order')
      .leftJoinAndSelect('order.items', 'items')
      /**
       * Users are joined WITHOUT AndSelect: `User.passwordHash` has no
       * `select: false`, so selecting the whole relation pulls every bcrypt
       * hash into memory. Only the two columns the report needs are read.
       */
      .leftJoin('order.createdBy', 'createdBy')
      .addSelect(['createdBy.id', 'createdBy.name'])
      .leftJoin('order.settledBy', 'settledBy')
      .addSelect(['settledBy.id', 'settledBy.name'])
      .where('order.storeId = :storeId', { storeId })
      // Only settled money counts. Drafts, live orders and cancellations are
      // excluded — counting a draft as revenue is how dashboards start lying.
      .andWhere("order.orderStatus = 'completed'");

    /**
     * Windowed on when the money was TAKEN, falling back to creation for rows
     * that predate settledAt. An order opened at 23:50 and paid at 00:10 is
     * the next day's revenue — and belongs to the cashier who was on then.
     */
    if (from) {
      qb.andWhere('COALESCE(order.settledAt, order.createdAt) >= :from', {
        from: new Date(from),
      });
    }
    if (to) {
      qb.andWhere('COALESCE(order.settledAt, order.createdAt) <= :to', { to: new Date(to) });
    }

    const orders = await qb.getMany();

    let revenue = 0;
    let cost = 0;
    let discountTotal = 0;
    let unknownCostLineCount = 0;
    const byProduct = new Map<string, { name: string; quantity: number; revenue: number; profit: number }>();
    const byWaiter = new Map<string, { name: string; orders: number; revenue: number }>();
    /** Who COLLECTED the money, as opposed to who took the order. */
    const byCashier = new Map<string, { name: string; orders: number; revenue: number }>();
    const byType: Record<string, { orders: number; revenue: number }> = {};

    for (const order of orders) {
      // TypeORM returns Postgres decimals as strings; Number() everywhere or
      // these become string concatenations.
      const total = Number(order.total) || 0;
      revenue += total;
      discountTotal += Number(order.discount) || 0;

      const type = order.orderType ?? 'none';
      byType[type] ??= { orders: 0, revenue: 0 };
      byType[type].orders += 1;
      byType[type].revenue += total;

      const waiterId = order.createdById ?? 'unknown';
      const waiterName = (order as any).createdBy?.name ?? 'Unknown';
      const waiter = byWaiter.get(waiterId) ?? { name: waiterName, orders: 0, revenue: 0 };
      waiter.orders += 1;
      waiter.revenue += total;
      byWaiter.set(waiterId, waiter);

      /**
       * Keyed on settledById, never createdById: the waiter opens the order,
       * the cashier takes the money. Orders settled before this column existed
       * bucket as "Unattributed" rather than being credited to the waiter.
       */
      const cashierId = order.settledById ?? 'unattributed';
      const cashierName = (order as any).settledBy?.name ?? 'Unattributed';
      const cashier = byCashier.get(cashierId) ?? { name: cashierName, orders: 0, revenue: 0 };
      cashier.orders += 1;
      cashier.revenue += total;
      byCashier.set(cashierId, cashier);

      for (const line of order.items ?? []) {
        const qty = Number(line.quantity) || 0;
        const lineRevenue = Number(line.total) || 0;

        if (line.unitCost === null || line.unitCost === undefined) {
          unknownCostLineCount += 1;
        }
        const lineCost = (Number(line.unitCost) || 0) * qty;
        cost += lineCost;

        const key = line.productId ?? line.productName ?? 'unknown';
        const entry = byProduct.get(key) ?? {
          name: line.productName ?? 'Unknown',
          quantity: 0,
          revenue: 0,
          profit: 0,
        };
        entry.quantity += qty;
        entry.revenue += lineRevenue;
        entry.profit += lineRevenue - lineCost;
        byProduct.set(key, entry);
      }
    }

    return {
      orderCount: orders.length,
      revenue: round2(revenue),
      cost: round2(cost),
      // Discounts are already reflected in `total`, so profit derives from it.
      profit: round2(revenue - cost),
      discountTotal: round2(discountTotal),
      averageOrderValue: orders.length ? round2(revenue / orders.length) : 0,
      /**
       * Lines whose product had no cost recorded. Surfaced rather than hidden:
       * a profit figure computed over unknown costs is overstated, and the
       * owner should see that instead of trusting it blindly.
       */
      unknownCostLineCount,
      topProducts: [...byProduct.values()]
        .sort((a, b) => b.revenue - a.revenue)
        .slice(0, 10)
        .map((p) => ({ ...p, revenue: round2(p.revenue), profit: round2(p.profit) })),
      byWaiter: [...byWaiter.values()]
        .sort((a, b) => b.revenue - a.revenue)
        .map((w) => ({ ...w, revenue: round2(w.revenue) })),
      byCashier: [...byCashier.values()]
        .sort((a, b) => b.revenue - a.revenue)
        .map((c) => ({ ...c, revenue: round2(c.revenue) })),
      byOrderType: Object.entries(byType).map(([type, v]) => ({
        orderType: type,
        orders: v.orders,
        revenue: round2(v.revenue),
      })),
    };
  }
}
