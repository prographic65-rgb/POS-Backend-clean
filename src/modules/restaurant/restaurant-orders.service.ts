import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import {
  Order,
  OrderItem,
  OrderType,
  Product,
  RestaurantTable,
  RestaurantOrderStatus,
  LIVE_ORDER_STATUSES,
} from '../../entities';
import {
  AddOrderItemsDto,
  CreateRestaurantOrderDto,
  RestaurantOrderItemDto,
  SettleOrderDto,
  UpdateDraftOrderDto,
  UpdateOrderStatusDto,
} from './dto';
import { TablesService } from './tables.service';
import { ShiftsService } from '../shifts/shifts.service';
import { RealtimeGateway, RealtimeEvents } from '../../realtime/realtime.gateway';
import { generateOrderNumber } from '../../common/order-number';
import { resolveDiscount, round2 } from '../../common/discount';
import { toPage, type Page } from '../../common/pagination';

/**
 * Order types that sit at a table.
 *
 * `dine_out` is a dine-in order that also takes a parcel home, so it claims a
 * table exactly like `dine_in`. Every table-related branch below routes through
 * this rather than comparing to 'dine_in' directly — those comparisons used to
 * be scattered, and the two that null out `tableId` would silently strand a
 * dine_out order's table.
 */
function needsTable(orderType?: OrderType | string | null): boolean {
  return orderType === 'dine_in' || orderType === 'dine_out';
}

/**
 * Legal kitchen transitions.
 *
 * The kitchen's job ends at `handed_over`: the food is cooked and on the
 * floor. Only the cashier's settle() may write `completed`, because that is
 * the step that takes money and frees the table. Before this map the kitchen
 * could set `completed` directly, which paid nothing, released no table and
 * still counted as revenue.
 */
const KITCHEN_TRANSITIONS: Record<string, RestaurantOrderStatus[]> = {
  requested: ['preparing', 'handed_over'],
  preparing: ['handed_over'],
};

/**
 * Belt-and-braces translation of the double-booking invariant.
 *
 * The CAS in TablesService is what normally rejects a taken table. This is the
 * backstop for any path that reaches the index anyway: without it a Postgres
 * 23505 surfaces to the waiter as a 500 instead of "pick another table".
 */
function rethrowTableConflict(error: any): never {
  if (error?.code === '23505' && String(error?.constraint).includes('UQ_orders_live_table')) {
    throw new ConflictException(
      'That table was just taken by another order. Pick another table.',
    );
  }
  throw error;
}

/**
 * Restaurant order flow, deliberately separate from OrdersService.
 *
 * Not a stylistic split: OrdersService.create() rejects any line where
 * `product.stock < quantity` and then calls deductStock. Restaurant products
 * carry no stock (defaulting to 0), so every restaurant order would fail
 * through that path. Adding a branch there is also how the general flow would
 * get regressed, so that file is left untouched.
 */
@Injectable()
export class RestaurantOrdersService {
  constructor(
    @InjectRepository(Order)
    private ordersRepository: Repository<Order>,
    @InjectRepository(Product)
    private productsRepository: Repository<Product>,
    @InjectRepository(RestaurantTable)
    private tablesRepository: Repository<RestaurantTable>,
    private tablesService: TablesService,
    private shiftsService: ShiftsService,
    private realtime: RealtimeGateway,
    private dataSource: DataSource,
  ) {}

  // ---------------------------------------------------------------- reads

  private baseQuery(
    storeId: string,
    filters: {
      orderStatus?: string;
      orderType?: string;
      tableId?: string;
      search?: string;
      shiftId?: string;
    } = {},
  ) {
    const qb = this.ordersRepository
      .createQueryBuilder('order')
      .leftJoinAndSelect('order.items', 'items')
      .leftJoinAndSelect('order.table', 'tbl')
      /**
       * Users are joined WITHOUT AndSelect.
       *
       * `User.passwordHash` carries no `select: false`, so leftJoinAndSelect
       * pulled every waiter's bcrypt hash into the eager relation and
       * present() spread it into the response of every order list. Naming the
       * columns is what keeps it out.
       */
      .leftJoin('order.createdBy', 'createdBy')
      .addSelect(['createdBy.id', 'createdBy.name'])
      .leftJoin('order.settledBy', 'settledBy')
      .addSelect(['settledBy.id', 'settledBy.name'])
      .where('order.storeId = :storeId', { storeId })
      // Excludes every general-mode order, which all carry 'none'.
      .andWhere("order.orderStatus <> 'none'")
      .orderBy('order.createdAt', 'DESC');

    if (filters.orderStatus) {
      const statuses = filters.orderStatus.split(',').map((s) => s.trim());

      /**
       * Transitional alias for CASHIER clients that predate `handed_over`.
       *
       * An old till build asks for 'requested,preparing,draft'. Once any
       * kitchen device can hand an order over, that build stops seeing it —
       * a bill nobody can take money for. Mobile releases lag behind the
       * server (app-store review), so this keeps those tills working.
       *
       * Keyed on `draft` because that is what makes the query a till's open
       * list. The kitchen board asks for 'requested,preparing' and must NOT be
       * aliased: an order leaving the board is precisely what "handed over"
       * means, and adding it back would put finished food in front of the
       * chef again. An old waiter build likewise just loses the ability to
       * add a round to a handed-over table — awkward, but it blocks no money.
       *
       * REMOVE once the web and mobile releases with `handed_over` are out.
       */
      if (
        statuses.includes('draft') &&
        statuses.includes('preparing') &&
        !statuses.includes('handed_over')
      ) {
        statuses.push('handed_over');
      }

      qb.andWhere('order.orderStatus IN (:...statuses)', { statuses });
    }
    if (filters.orderType) {
      qb.andWhere('order.orderType = :orderType', { orderType: filters.orderType });
    }
    if (filters.tableId) {
      qb.andWhere('order.tableId = :tableId', { tableId: filters.tableId });
    }
    if (filters.shiftId) {
      qb.andWhere('order.shiftId = :shiftId', { shiftId: filters.shiftId });
    }

    /**
     * Server-side search across the fields the order list actually shows.
     * Doing this in SQL rather than in the client matters once the list is
     * paged: filtering the current page only would hide matches sitting on
     * every other page.
     */
    const term = filters.search?.trim();
    if (term) {
      // Every alias is quoted: both `order` and `table` are reserved words in
      // SQL, so an unquoted alias is a syntax error rather than a wrong result.
      qb.andWhere(
        `(
          CAST("order"."orderSequence" AS TEXT) ILIKE :term
          OR "order"."orderNumber" ILIKE :term
          OR COALESCE("tbl"."name", '') ILIKE :term
          OR COALESCE("order"."customerName", '') ILIKE :term
          OR COALESCE("order"."customerPhone", '') ILIKE :term
          OR COALESCE("createdBy"."name", '') ILIKE :term
        )`,
        { term: `%${term}%` },
      );
    }

    return qb;
  }

  async findAll(
    storeId: string,
    filters: {
      orderStatus?: string;
      orderType?: string;
      tableId?: string;
      shiftId?: string;
    } = {},
  ) {
    return (await this.baseQuery(storeId, filters).getMany()).map((o) => this.present(o));
  }

  /**
   * Paged variant for the order-history screens.
   *
   * Uses `getManyAndCount`, which counts DISTINCT root entities — a plain
   * `getMany().length` would be wrong here anyway, but the count especially
   * so: the joins onto items multiply rows, and counting those would report
   * the number of order LINES rather than orders.
   */
  async findAllPaged(
    storeId: string,
    filters: {
      orderStatus?: string;
      orderType?: string;
      tableId?: string;
      search?: string;
      shiftId?: string;
    } = {},
    paging: { skip: number; take: number },
  ): Promise<Page<any>> {
    const [rows, total] = await this.baseQuery(storeId, filters)
      .skip(paging.skip)
      .take(paging.take)
      .getManyAndCount();

    return toPage(rows.map((o) => this.present(o)), total, paging.skip, paging.take);
  }

  async findOne(id: string, storeId: string) {
    // Uses the query builder rather than `relations`, which would select every
    // column of the joined users — including passwordHash.
    const order = await this.baseQuery(storeId).andWhere('order.id = :id', { id }).getOne();

    if (!order || order.orderStatus === 'none') {
      throw new NotFoundException('Order not found');
    }
    return this.present(order);
  }

  /**
   * Adds `paymentStatus` alongside the legacy `status` column.
   *
   * The column cannot safely be renamed: `synchronize` runs in production and
   * TypeORM's rename detection would degrade into DROP + ADD, erasing the
   * payment status of every historical order.
   */
  private present(order: Order) {
    return {
      ...order,
      paymentStatus: order.status,
      waiterName: (order as any).createdBy?.name ?? null,
      /** Who took the money. Null on unpaid orders and on historical rows. */
      settledByName: (order as any).settledBy?.name ?? null,
      tableName: (order as any).table?.name ?? null,
    };
  }

  // --------------------------------------------------------------- writes

  async create(storeId: string, userId: string, dto: CreateRestaurantOrderDto) {
    if (needsTable(dto.orderType) && !dto.tableId) {
      throw new BadRequestException(
        dto.orderType === 'dine_out'
          ? 'A dine-out order is eaten at a table too — pick one'
          : 'A dine-in order needs a table',
      );
    }
    if (dto.orderType === 'delivery' && !dto.deliveryAddress?.trim()) {
      throw new BadRequestException('A delivery order needs an address');
    }
    if (!dto.items?.length) {
      throw new BadRequestException('An order needs at least one item');
    }

    const isDraft = !!dto.isDraft;
    const now = new Date();
    const lines = await this.buildItems(storeId, dto.items, isDraft ? null : now);
    const subtotal = round2(lines.reduce((sum, l) => sum + Number(l.total), 0));

    // The id is generated up-front so the table can be claimed BEFORE the
    // order is inserted. Claiming afterwards let the partial unique index on
    // (tableId WHERE orderStatus IN ('requested','preparing')) reject the
    // INSERT first, surfacing a raw 23505 as a 500 rather than a clear 409 —
    // and it also meant paying for item inserts that were about to roll back.
    const orderId = randomUUID();

    // One transaction covering the table claim and the order insert — the
    // first in this codebase. Events are emitted only after it commits.
    const saved = await this.dataSource.transaction(async (manager) => {
      if (!isDraft && needsTable(dto.orderType)) {
        const won = await this.tablesService.tryReserve(
          manager,
          dto.tableId,
          storeId,
          orderId,
        );
        if (!won) {
          throw new ConflictException(
            'That table was just taken by another order. Pick another table.',
          );
        }
      }

      const orderSequence = await this.nextOrderSequence(manager, storeId);

      const order = manager.create(Order, {
        id: orderId,
        storeId,
        orderNumber: generateOrderNumber(),
        orderSequence,
        createdById: userId,
        orderType: dto.orderType,
        orderStatus: (isDraft ? 'draft' : 'requested') as RestaurantOrderStatus,
        // 'draft' is not a member of the payment enum; a draft is simply unpaid.
        status: 'unpaid',
        tableId: needsTable(dto.orderType) ? dto.tableId : null,
        customerName: dto.customerName ?? null,
        customerPhone: dto.customerPhone ?? null,
        deliveryAddress: dto.deliveryAddress ?? null,
        notes: dto.notes ?? null,
        subtotal,
        tax: 0,
        discount: 0,
        total: subtotal,
        items: lines.map((l) => manager.create(OrderItem, l)),
      });

      return manager.save(order);
    }).catch(rethrowTableConflict);

    const order = await this.findOne(saved.id, storeId);

    if (isDraft) {
      this.realtime.emitToStore(storeId, RealtimeEvents.draftUpdated, order);
    } else {
      this.realtime.emitToStore(storeId, RealtimeEvents.orderCreated, order);
      if (order.tableId) await this.emitTable(storeId, order.tableId);
    }

    return order;
  }

  /** Edits a draft. Shared between waiters, hence the optimistic lock. */
  async updateDraft(id: string, storeId: string, dto: UpdateDraftOrderDto) {
    const existing = await this.ordersRepository.findOne({ where: { id, storeId } });
    if (!existing) throw new NotFoundException('Order not found');
    if (existing.orderStatus !== 'draft') {
      throw new ConflictException('Only a draft can be edited');
    }
    if (dto.version !== undefined && dto.version !== existing.version) {
      throw new ConflictException(
        'Another waiter changed this draft. Reload it before saving.',
      );
    }

    const lines = await this.buildItems(storeId, dto.items, null);
    const subtotal = round2(lines.reduce((sum, l) => sum + Number(l.total), 0));

    await this.dataSource.transaction(async (manager) => {
      await manager.delete(OrderItem, { orderId: id });
      await manager.save(
        manager.create(OrderItem, lines.map((l) => ({ ...l, orderId: id }))) as OrderItem[],
      );
      await manager.update(Order, id, {
        tableId: dto.tableId ?? existing.tableId,
        notes: dto.notes ?? existing.notes,
        subtotal,
        total: subtotal,
      });
    });

    const order = await this.findOne(id, storeId);
    this.realtime.emitToStore(storeId, RealtimeEvents.draftUpdated, order);
    return order;
  }

  /**
   * Sends a draft to the kitchen, claiming its table on the way.
   *
   * On a lost race the draft is preserved exactly as it was so the waiter can
   * retry against a different table — never silently discarded.
   */
  async punchDraft(id: string, storeId: string, tableId?: string) {
    const existing = await this.ordersRepository.findOne({ where: { id, storeId } });
    if (!existing) throw new NotFoundException('Order not found');
    if (existing.orderStatus !== 'draft') {
      throw new ConflictException('This order has already been sent');
    }

    const targetTable = tableId ?? existing.tableId;
    if (needsTable(existing.orderType) && !targetTable) {
      throw new BadRequestException('Pick a table before sending this order');
    }

    await this.dataSource.transaction(async (manager) => {
      if (needsTable(existing.orderType)) {
        const won = await this.tablesService.tryReserve(manager, targetTable, storeId, id);
        if (!won) {
          throw new ConflictException(
            'That table was just taken by another order. Pick another table.',
          );
        }
      }

      await manager.update(Order, id, {
        orderStatus: 'requested',
        tableId: needsTable(existing.orderType) ? targetTable : null,
      });
      // Stamp the round so the kitchen ticket knows which lines are new.
      await manager.update(OrderItem, { orderId: id }, { sentAt: new Date() });
    }).catch(rethrowTableConflict);

    const order = await this.findOne(id, storeId);
    this.realtime.emitToStore(storeId, RealtimeEvents.orderCreated, order);
    if (order.tableId) await this.emitTable(storeId, order.tableId);
    return order;
  }

  /**
   * Appends a further round to a live order.
   *
   * The new lines get their own `sentAt`, so the kitchen prints a ticket
   * containing only them rather than reprinting the whole order.
   */
  async addItems(id: string, storeId: string, dto: AddOrderItemsDto) {
    const existing = await this.ordersRepository.findOne({ where: { id, storeId } });
    if (!existing) throw new NotFoundException('Order not found');
    if (!LIVE_ORDER_STATUSES.includes(existing.orderStatus)) {
      throw new ConflictException('This order is no longer open');
    }
    if (!dto.items?.length) {
      throw new BadRequestException('Add at least one item');
    }

    const sentAt = new Date();
    const lines = await this.buildItems(storeId, dto.items, sentAt);

    /**
     * A round added after the kitchen already handed the order over has to put
     * it back on the kitchen board — which only shows requested/preparing. Left
     * as `handed_over`, the new lines would print a ticket nobody is looking at
     * and the food would never be made.
     */
    const reopensKitchen = existing.orderStatus === 'handed_over';

    await this.dataSource.transaction(async (manager) => {
      await manager.save(
        manager.create(OrderItem, lines.map((l) => ({ ...l, orderId: id }))) as OrderItem[],
      );

      const all = await manager.find(OrderItem, { where: { orderId: id } });
      const subtotal = round2(all.reduce((sum, l) => sum + Number(l.total), 0));
      const discount = Number(existing.discount) || 0;

      await manager.update(Order, id, {
        subtotal,
        total: round2(Math.max(subtotal - discount, 0)),
        ...(reopensKitchen ? { orderStatus: 'requested' as RestaurantOrderStatus } : {}),
      });
    });

    const order = await this.findOne(id, storeId);
    // The kitchen needs to know WHICH lines are new, so send them explicitly.
    this.realtime.emitToStore(storeId, RealtimeEvents.orderItemsAdded, {
      order,
      newItems: order.items.filter(
        (i) => i.sentAt && new Date(i.sentAt).getTime() === sentAt.getTime(),
      ),
    });
    // The status moved, so screens that filter on it (the cashier's list, the
    // waiter's live orders) need to re-place this order.
    if (reopensKitchen) {
      this.realtime.emitToStore(storeId, RealtimeEvents.orderUpdated, order);
    }
    return order;
  }

  /**
   * Kitchen moves an order along: requested → preparing → handed_over.
   *
   * `handed_over` is where the kitchen's authority ends. Settling — taking the
   * money, freeing the table — belongs to the cashier alone.
   */
  async updateStatus(id: string, storeId: string, dto: UpdateOrderStatusDto) {
    const existing = await this.ordersRepository.findOne({ where: { id, storeId } });
    if (!existing) throw new NotFoundException('Order not found');
    if (existing.orderStatus === 'none') throw new NotFoundException('Order not found');

    if (existing.orderStatus === 'draft') {
      throw new ConflictException('This order has not been sent to the kitchen yet');
    }
    if (existing.orderStatus === 'completed' || existing.orderStatus === 'cancelled') {
      throw new ConflictException('This order is already closed');
    }

    /**
     * Explicit transition table.
     *
     * Previously any status in the DTO was written blindly, so the kitchen
     * could mark an order 'completed': that paid nothing, never released the
     * table (release only happens in settle/cancel), permanently bricked the
     * table for future orders, and still counted the unpaid order as revenue.
     */
    const allowed = KITCHEN_TRANSITIONS[existing.orderStatus] ?? [];
    if (!allowed.includes(dto.orderStatus)) {
      throw new ConflictException(
        `An order that is ${existing.orderStatus.replace('_', ' ')} cannot be moved to ${dto.orderStatus.replace('_', ' ')}`,
      );
    }

    await this.ordersRepository.update(id, { orderStatus: dto.orderStatus });

    const order = await this.findOne(id, storeId);
    this.realtime.emitToStore(storeId, RealtimeEvents.orderUpdated, order);
    return order;
  }

  /**
   * Cashier settles: applies the discount, marks it paid, completes it, frees
   * the table, and stamps the money onto the settling cashier's open shift.
   *
   * Settling is allowed from any live status — requested, preparing or
   * handed_over — because guests sometimes pay before the last dish lands.
   * `handed_over` is merely the state the cashier's screen highlights as
   * ready to bill.
   *
   * `userId` is who took the money. Note this is NOT `createdById`: that is
   * the waiter, who never handles cash.
   */
  async settle(id: string, storeId: string, dto: SettleOrderDto, userId: string) {
    const existing = await this.ordersRepository.findOne({
      where: { id, storeId },
      relations: ['items'],
    });
    if (!existing || existing.orderStatus === 'none') {
      throw new NotFoundException('Order not found');
    }
    if (existing.orderStatus === 'draft') {
      throw new ConflictException('Send this order to the kitchen before settling it');
    }
    if (existing.orderStatus === 'completed') {
      throw new ConflictException('This order is already settled');
    }
    if (existing.orderStatus === 'cancelled') {
      throw new ConflictException('This order was cancelled');
    }

    const subtotal = round2(
      (existing.items ?? []).reduce((sum, l) => sum + Number(l.total), 0),
    );

    // Recomputed and clamped server-side — never trusted from the client.
    const { discount, discountType, discountValue } = resolveDiscount(dto, subtotal);
    const total = round2(Math.max(subtotal - discount, 0));

    // Tenants with shifts switched on require an open drawer; the rest simply
    // record who settled, so turning the flag on later has history to show.
    const enforceShift = await this.shiftsService.isEnforced(storeId);

    await this.dataSource.transaction(async (manager) => {
      /**
       * Resolved INSIDE the transaction, and it takes a share lock on the
       * shift row. That lock is what makes closing a drawer safe: close()
       * takes FOR UPDATE, so it waits here until this payment commits rather
       * than snapshotting totals that are about to change.
       */
      const stamp = await this.shiftsService.stampSettlement(manager, storeId, userId, {
        enforce: enforceShift,
      });

      await manager.update(Order, id, {
        orderStatus: 'completed',
        status: 'paid',
        paymentMethod: (dto.paymentMethod as any) ?? 'cash',
        subtotal,
        discount,
        discountType,
        discountValue,
        total,
        ...stamp,
      });

      if (existing.tableId) {
        await this.tablesService.release(manager, existing.tableId, storeId);
      }
    });

    const order = await this.findOne(id, storeId);
    this.realtime.emitToStore(storeId, RealtimeEvents.orderUpdated, order);
    if (existing.tableId) await this.emitTable(storeId, existing.tableId);
    return order;
  }

  /** Cashier or owner cancels. The kitchen deliberately cannot. */
  async cancel(id: string, storeId: string) {
    const existing = await this.ordersRepository.findOne({ where: { id, storeId } });
    if (!existing || existing.orderStatus === 'none') {
      throw new NotFoundException('Order not found');
    }
    if (existing.orderStatus === 'completed') {
      throw new ConflictException('A settled order cannot be cancelled');
    }

    await this.dataSource.transaction(async (manager) => {
      await manager.update(Order, id, { orderStatus: 'cancelled', status: 'cancelled' });
      if (existing.tableId) {
        await this.tablesService.release(manager, existing.tableId, storeId);
      }
    });

    const order = await this.findOne(id, storeId);
    this.realtime.emitToStore(storeId, RealtimeEvents.orderUpdated, order);
    if (existing.tableId) await this.emitTable(storeId, existing.tableId);
    return order;
  }

  // --------------------------------------------------------------- helpers

  /**
   * Resolves products and snapshots price AND cost onto each line.
   *
   * Snapshotting `unitCost` is what keeps profit honest: reading it from the
   * live product later would silently rewrite the margin on every past order
   * whenever someone edits a cost. No stock is read or deducted — restaurant
   * products do not track stock.
   */
  private async buildItems(
    storeId: string,
    items: RestaurantOrderItemDto[],
    sentAt: Date | null,
  ): Promise<Partial<OrderItem>[]> {
    const ids = [...new Set(items.map((i) => i.productId))];
    const products = await this.productsRepository.find({
      where: { id: In(ids), storeId },
    });
    const byId = new Map(products.map((p) => [p.id, p]));

    return items.map((item) => {
      const product = byId.get(item.productId);
      if (!product) {
        throw new BadRequestException(`Product ${item.productId} is not in this store`);
      }
      if (!product.isActive) {
        throw new BadRequestException(`"${product.name}" is no longer available`);
      }

      const unitPrice = Number(product.price);
      const lineTotal = round2(unitPrice * item.quantity);

      return {
        productId: product.id,
        productName: product.name,
        quantity: item.quantity,
        unitPrice,
        // costPrice is nullable on legacy rows; 0 keeps the arithmetic valid and
        // the report separately counts how many lines had unknown cost.
        unitCost: product.costPrice === null || product.costPrice === undefined
          ? 0
          : Number(product.costPrice),
        subtotal: lineTotal,
        discount: 0,
        total: lineTotal,
        notes: item.notes?.trim() || null,
        // Marks a line to be packed on a dine_out order. Harmless elsewhere:
        // a takeaway order is entirely parcel, so nothing flags it per line.
        isParcel: !!item.isParcel,
        sentAt,
      };
    });
  }

  /**
   * Claims the next per-restaurant order number.
   *
   * A single atomic `UPDATE … RETURNING`: Postgres locks the store row for the
   * duration of the enclosing transaction, so two waiters punching at the same
   * instant get 7 and 8 rather than both getting 7. Reading the current value
   * and writing back separately — or taking MAX(orderSequence)+1 — would race.
   *
   * Numbering is per store and starts at 1, so the count is independent of
   * other restaurants on the platform.
   */
  private async nextOrderSequence(manager: EntityManager, storeId: string): Promise<number> {
    const raw = await manager.query(
      `UPDATE "stores"
          SET "orderSequence" = COALESCE("orderSequence", 0) + 1
        WHERE "id" = $1
      RETURNING "orderSequence"`,
      [storeId],
    );

    // TypeORM returns `[rows, affectedCount]` for UPDATE/DELETE but a bare
    // `rows` array for SELECT (PostgresQueryRunner, `switch (raw.command)`).
    // Unwrapping both shapes keeps this correct either way.
    const records = Array.isArray(raw?.[0]) ? raw[0] : raw;
    const next = Number(records?.[0]?.orderSequence);
    if (!Number.isFinite(next) || next < 1) {
      throw new BadRequestException('Could not allocate an order number');
    }
    return next;
  }

  private async emitTable(storeId: string, tableId: string) {
    const table = await this.tablesRepository.findOne({ where: { id: tableId, storeId } });
    if (table) {
      this.realtime.emitToStore(storeId, RealtimeEvents.tableUpdated, table);
    }
  }
}
