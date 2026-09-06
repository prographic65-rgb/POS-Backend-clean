import {
  Injectable,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository, SelectQueryBuilder } from 'typeorm';
import { CashierShift, Order, Store } from '../../entities';
import { round2 } from '../../common/discount';
import { toPage, type Page } from '../../common/pagination';
import { RealtimeGateway, RealtimeEvents } from '../../realtime/realtime.gateway';
import { CloseShiftDto, CollectShiftDto, ListShiftsQueryDto } from './dto';

/** Money taken during a shift, split the way an owner counts it. */
export interface ShiftTotals {
  cashSales: number;
  cardSales: number;
  onlineSales: number;
  otherSales: number;
  totalSales: number;
  orderCount: number;
  cashPaidOut: number;
  expectedCash: number;
}

/**
 * Takings by method over whatever paid orders the query builder narrows to.
 *
 * One aggregate query rather than loading rows: a busy shift has hundreds of
 * orders and the cashier's header polls this.
 *
 * A 'partial' payment contributes its `paidCash` / `paidCard` / `paidOnline`
 * to each bucket separately — that split is the whole reason it is stored,
 * so the cashier can hand the owner an exact per-method figure. Every other
 * method puts its full total in one bucket, which also covers rows written
 * before the split columns existed. 'check' and a legacy NULL land in
 * `other`: not cash, so never handed over as notes, but still takings.
 *
 * Every column is written as a fully quoted `"order"."column"`, never as
 * `order.column`. The builder's alias is `order`, a reserved word, so it MUST
 * be quoted — and TypeORM's own rewrite of `alias.property` into a quoted
 * pair cannot be relied on inside a multi-line fragment: its regex captures
 * the property name as "anything but space, =, ( ) or ,", which swallows a
 * trailing newline, so `order.paidCash⏎` was looked up as "paidCash\n",
 * matched nothing, and went to Postgres verbatim. Result: "syntax error at or
 * near order" on GET /shifts/current, /shifts/me/dashboard and the tail of
 * POST /shifts/open (row inserted, then the response 500ed) — which is how a
 * cashier came to see "shift not open" and "you already have an open shift"
 * at the same time.
 */
async function sumByMethod(
  qb: SelectQueryBuilder<Order>,
): Promise<{ cash: number; card: number; online: number; other: number; count: number }> {
  const bucket = (method: 'cash' | 'card' | 'online', column: string) =>
    `COALESCE(SUM(CASE
        WHEN "order"."paymentMethod" = 'partial' THEN "order"."${column}"
        WHEN "order"."paymentMethod" = '${method}' THEN "order"."total"
        ELSE 0 END), 0)`;

  const row = await qb
    .select(bucket('cash', 'paidCash'), 'cash')
    .addSelect(bucket('card', 'paidCard'), 'card')
    .addSelect(bucket('online', 'paidOnline'), 'online')
    .addSelect(
      `COALESCE(SUM(CASE
          WHEN "order"."paymentMethod" IN ('partial', 'cash', 'card', 'online') THEN 0
          ELSE "order"."total" END), 0)`,
      'other',
    )
    .addSelect('COUNT("order"."id")', 'count')
    .getRawOne<{ cash: string; card: string; online: string; other: string; count: string }>();

  // Postgres returns SUM as a string and COUNT as a bigint string; both
  // concatenate instead of adding unless coerced.
  return {
    cash: round2(Number(row?.cash) || 0),
    card: round2(Number(row?.card) || 0),
    online: round2(Number(row?.online) || 0),
    other: round2(Number(row?.other) || 0),
    count: Number(row?.count) || 0,
  };
}

/** What settle()/create() must stamp onto an order. */
export interface SettlementStamp {
  shiftId: string | null;
  settledById: string;
  settledAt: Date;
}

/**
 * Translates the double-open race into a clear 409.
 *
 * Mirrors rethrowTableConflict in RestaurantOrdersService: without it a
 * Postgres 23505 from UQ_cashier_shifts_open_user surfaces to the cashier as a
 * 500 rather than "you already have a shift open".
 */
function rethrowOpenShiftConflict(error: any): never {
  if (
    error?.code === '23505' &&
    String(error?.constraint).includes('UQ_cashier_shifts_open_user')
  ) {
    throw new ConflictException(
      'You already have an open shift. Close it before opening another.',
    );
  }
  throw error;
}

/**
 * Cashier shifts — the unit of cash accountability.
 *
 * The core idea: money is attributed to a SHIFT at the moment it is taken,
 * never derived from a calendar day afterwards. That is what lets several
 * cashiers work the same day and each hand over exactly what they collected.
 */
@Injectable()
export class ShiftsService {
  constructor(
    @InjectRepository(CashierShift)
    private shiftsRepository: Repository<CashierShift>,
    @InjectRepository(Store)
    private storesRepository: Repository<Store>,
    private realtime: RealtimeGateway,
    private dataSource: DataSource,
  ) {}

  // ------------------------------------------------------------- stamping

  /**
   * Resolves what to write onto an order being paid.
   *
   * `enforce` is the difference between the two account types: a restaurant
   * cashier with shifts on MUST have an open drawer (the whole point), while
   * the general POS only soft-stamps so turning the flag on can never block a
   * sale on a screen that has no shift widget yet.
   *
   * Runs inside the caller's transaction so the shift cannot be closed between
   * this lookup and the order write — the FOR SHARE lock below is what makes
   * close() wait for in-flight settlements.
   */
  async stampSettlement(
    manager: EntityManager,
    storeId: string,
    userId: string,
    options: { enforce: boolean },
  ): Promise<SettlementStamp> {
    const shift = await this.findOpenShift(manager, storeId, userId, true);

    if (!shift && options.enforce) {
      throw new ConflictException(
        'Open your shift before taking payments.',
      );
    }

    return {
      shiftId: shift?.id ?? null,
      settledById: userId,
      settledAt: new Date(),
    };
  }

  /** Whether this tenant requires an open shift to take money. */
  async isEnforced(storeId: string): Promise<boolean> {
    const store = await this.storesRepository.findOne({
      where: { id: storeId },
      select: { id: true, shiftsEnabled: true, accountType: true },
    });
    // Restaurant-only for v1: the general POS has no till widget yet, so
    // enforcing there would block sales with no way for the cashier to comply.
    return !!store?.shiftsEnabled && store.accountType === 'restaurant';
  }

  /**
   * The caller's open drawer, if any.
   *
   * `lock` takes FOR SHARE, which is what close() blocks on. A share lock (not
   * FOR UPDATE) so concurrent settlements by the same cashier on two devices do
   * not serialise against each other — they only need the shift to stay open.
   *
   * The lock is applied ONLY when the manager is inside a transaction: Postgres
   * has nothing to hold a row lock for otherwise, and TypeORM rejects the query
   * outright with PessimisticLockTransactionRequiredError. Callers that only
   * want to READ the current shift (the till header, a soft stamp on the
   * general POS) legitimately pass a non-transactional manager, and silently
   * failing there is how an expense stops being linked to its drawer.
   */
  private async findOpenShift(
    manager: EntityManager,
    storeId: string,
    userId: string,
    lock = false,
  ): Promise<CashierShift | null> {
    const qb = manager
      .createQueryBuilder(CashierShift, 'shift')
      .where('shift.userId = :userId', { userId })
      .andWhere('shift.storeId = :storeId', { storeId })
      .andWhere("shift.status = 'open'");

    if (lock && manager.queryRunner?.isTransactionActive) {
      qb.setLock('pessimistic_read');
    }

    return qb.getOne();
  }

  // ---------------------------------------------------------------- totals

  /**
   * Live totals for a shift, computed from the orders stamped onto it.
   *
   * Two aggregate queries rather than loading rows: a busy shift has hundreds
   * of orders and the cashier's header polls this.
   */
  async computeTotals(
    manager: EntityManager,
    shift: Pick<CashierShift, 'id' | 'openingFloat'>,
  ): Promise<ShiftTotals> {
    const sales = await sumByMethod(
      manager
        .createQueryBuilder(Order, 'order')
        .where('order.shiftId = :shiftId', { shiftId: shift.id })
        .andWhere("order.status = 'paid'"),
    );

    const cashSales = sales.cash;
    const cardSales = sales.card;
    const onlineSales = sales.online;
    const otherSales = sales.other;
    const orderCount = sales.count;

    const paidOutRow = await manager.query(
      `SELECT COALESCE(SUM("amount"), 0) AS sum
         FROM "expenses"
        WHERE "shiftId" = $1 AND "paymentMethod" = 'cash'`,
      [shift.id],
    );
    const cashPaidOut = Number(paidOutRow?.[0]?.sum) || 0;

    const openingFloat = Number(shift.openingFloat) || 0;

    return {
      cashSales: round2(cashSales),
      cardSales: round2(cardSales),
      onlineSales: round2(onlineSales),
      otherSales: round2(otherSales),
      totalSales: round2(cashSales + cardSales + onlineSales + otherSales),
      orderCount,
      cashPaidOut: round2(cashPaidOut),
      // The drawer should hold the float it started with, plus cash taken,
      // minus cash spent out of it. Card and online never touch the drawer.
      expectedCash: round2(openingFloat + cashSales - cashPaidOut),
    };
  }

  // ----------------------------------------------------------------- reads

  /** The caller's open shift with live totals, or null. */
  async current(storeId: string, userId: string) {
    const shift = await this.findOpenShift(this.dataSource.manager, storeId, userId);
    if (!shift) return null;

    const totals = await this.computeTotals(this.dataSource.manager, shift);
    return { ...this.present(shift), totals };
  }

  async findOne(id: string, storeId: string, user: any) {
    const shift = await this.shiftsRepository.findOne({
      where: { id, storeId },
      relations: ['user', 'closedBy', 'collectedBy'],
    });
    if (!shift) throw new NotFoundException('Shift not found');

    // A cashier may only ever open their own drawer's detail. Owners see all.
    if (!this.isOwner(user) && shift.userId !== user.id) {
      throw new ForbiddenException('You can only view your own shifts');
    }

    // Open shifts have no snapshot yet, so compute; closed ones must show what
    // was signed off at the time, never a recomputation.
    const totals =
      shift.status === 'open'
        ? await this.computeTotals(this.dataSource.manager, shift)
        : this.snapshotTotals(shift);

    return { ...this.present(shift), totals };
  }

  async findAllPaged(
    storeId: string,
    filters: ListShiftsQueryDto,
    paging: { skip: number; take: number },
  ): Promise<Page<any>> {
    const [rows, total] = await this.baseQuery(storeId, filters)
      .skip(paging.skip)
      .take(paging.take)
      .getManyAndCount();

    return toPage(rows.map((s) => this.present(s)), total, paging.skip, paging.take);
  }

  async findAll(storeId: string, filters: ListShiftsQueryDto) {
    const rows = await this.baseQuery(storeId, filters).getMany();
    return rows.map((s) => this.present(s));
  }

  /**
   * The orders whose money landed in this shift.
   *
   * Queried here rather than through RestaurantOrdersService so ShiftsModule
   * does not have to import RestaurantModule — which imports ShiftsModule for
   * settle(), and the cycle would need forwardRef on both sides.
   *
   * Ordered by when the money was taken, which is the order the cashier
   * remembers taking it in.
   */
  async ordersForShift(storeId: string, shiftId: string) {
    const orders = await this.dataSource
      .createQueryBuilder(Order, 'order')
      .leftJoinAndSelect('order.items', 'items')
      .leftJoin('order.table', 'tbl')
      .addSelect(['tbl.id', 'tbl.name'])
      // Users are joined WITHOUT AndSelect: passwordHash has no `select: false`
      // on the entity, so a blanket select would leak the hash.
      .leftJoin('order.createdBy', 'createdBy')
      .addSelect(['createdBy.id', 'createdBy.name'])
      .where('order.storeId = :storeId', { storeId })
      .andWhere('order.shiftId = :shiftId', { shiftId })
      .orderBy('order.settledAt', 'DESC')
      .getMany();

    return orders.map((order) => ({
      ...order,
      paymentStatus: order.status,
      tableName: (order as any).table?.name ?? null,
      waiterName: (order as any).createdBy?.name ?? null,
    }));
  }

  private baseQuery(storeId: string, filters: ListShiftsQueryDto = {}) {
    const qb = this.shiftsRepository
      .createQueryBuilder('shift')
      // Never leftJoinAndSelect a User: the entity has no `select: false` on
      // passwordHash, so the hash would ride along into every response.
      .leftJoin('shift.user', 'user')
      .addSelect(['user.id', 'user.name', 'user.email'])
      .leftJoin('shift.closedBy', 'closedBy')
      .addSelect(['closedBy.id', 'closedBy.name'])
      .leftJoin('shift.collectedBy', 'collectedBy')
      .addSelect(['collectedBy.id', 'collectedBy.name'])
      .where('shift.storeId = :storeId', { storeId })
      .orderBy('shift.openedAt', 'DESC');

    if (filters.status) qb.andWhere('shift.status = :status', { status: filters.status });
    if (filters.userId) qb.andWhere('shift.userId = :userId', { userId: filters.userId });
    if (filters.from) qb.andWhere('shift.openedAt >= :from', { from: new Date(filters.from) });
    if (filters.to) qb.andWhere('shift.openedAt <= :to', { to: new Date(filters.to) });

    return qb;
  }

  /**
   * One row per cashier for the owner's "who collected what" screen.
   *
   * Closed and collected shifts contribute their SNAPSHOT — the figures the
   * cashier signed off — while open shifts are computed live, so the page adds
   * up to the same numbers the cashiers themselves see.
   */
  async summaryByCashier(storeId: string, from?: string, to?: string) {
    const shifts = await this.baseQuery(storeId, { from, to }).getMany();

    const byUser = new Map<string, any>();

    for (const shift of shifts) {
      const key = shift.userId;
      const entry = byUser.get(key) ?? {
        userId: key,
        name: (shift as any).user?.name ?? 'Unknown',
        shifts: 0,
        openNow: false,
        orders: 0,
        cashSales: 0,
        cardSales: 0,
        onlineSales: 0,
        otherSales: 0,
        totalSales: 0,
        cashPaidOut: 0,
        expectedCash: 0,
        countedCash: 0,
        difference: 0,
        collectedAmount: 0,
        pendingCollection: 0,
      };

      const totals =
        shift.status === 'open'
          ? await this.computeTotals(this.dataSource.manager, shift)
          : this.snapshotTotals(shift);

      entry.shifts += 1;
      if (shift.status === 'open') entry.openNow = true;
      entry.orders += totals.orderCount;
      entry.cashSales += totals.cashSales;
      entry.cardSales += totals.cardSales;
      entry.onlineSales += totals.onlineSales;
      entry.otherSales += totals.otherSales;
      entry.totalSales += totals.totalSales;
      entry.cashPaidOut += totals.cashPaidOut;
      entry.expectedCash += totals.expectedCash;
      entry.countedCash += Number(shift.countedCash) || 0;
      entry.difference += Number(shift.difference) || 0;
      entry.collectedAmount += Number(shift.collectedAmount) || 0;
      // Closed but not yet collected — this is what the owner still has to
      // physically take from that cashier.
      if (shift.status === 'closed') {
        entry.pendingCollection += Number(shift.countedCash) || 0;
      }

      byUser.set(key, entry);
    }

    return [...byUser.values()]
      .map((e) => ({
        ...e,
        cashSales: round2(e.cashSales),
        cardSales: round2(e.cardSales),
        onlineSales: round2(e.onlineSales),
        otherSales: round2(e.otherSales),
        totalSales: round2(e.totalSales),
        cashPaidOut: round2(e.cashPaidOut),
        expectedCash: round2(e.expectedCash),
        countedCash: round2(e.countedCash),
        difference: round2(e.difference),
        collectedAmount: round2(e.collectedAmount),
        pendingCollection: round2(e.pendingCollection),
      }))
      .sort((a, b) => b.totalSales - a.totalSales);
  }

  /**
   * The cashier's own dashboard: what THEY collected.
   *
   * The window is on `settledAt`, not `createdAt` — an order punched before
   * midnight and paid after it is this cashier's money today, not the waiter's
   * yesterday.
   */
  async myDashboard(storeId: string, userId: string, from?: string, to?: string) {
    const qb = this.dataSource
      .createQueryBuilder(Order, 'order')
      .where('order.storeId = :storeId', { storeId })
      .andWhere('order.settledById = :userId', { userId })
      .andWhere("order.status = 'paid'");

    if (from) qb.andWhere('order.settledAt >= :from', { from: new Date(from) });
    if (to) qb.andWhere('order.settledAt <= :to', { to: new Date(to) });

    const sales = await sumByMethod(qb);

    const range = {
      cash: sales.cash,
      card: sales.card,
      online: sales.online,
      other: sales.other,
      total: sales.cash + sales.card + sales.online + sales.other,
      orderCount: sales.count,
    };

    const recent = await this.baseQuery(storeId, { userId })
      .take(10)
      .getMany();

    return {
      range: {
        cash: round2(range.cash),
        card: round2(range.card),
        online: round2(range.online),
        other: round2(range.other),
        total: round2(range.total),
        orderCount: range.orderCount,
      },
      currentShift: await this.current(storeId, userId),
      recentShifts: recent.map((s) => this.present(s)),
    };
  }

  // ---------------------------------------------------------------- writes

  async open(storeId: string, userId: string, openingFloat = 0) {
    const store = await this.storesRepository.findOne({ where: { id: storeId } });
    if (!store) throw new BadRequestException('Store not found');
    if (!store.shiftsEnabled) {
      throw new ConflictException(
        'Cashier shifts are turned off for this store. Ask the owner to enable them in Settings.',
      );
    }

    const saved = await this.shiftsRepository
      .save(
        this.shiftsRepository.create({
          storeId,
          userId,
          status: 'open',
          openedAt: new Date(),
          openingFloat: round2(Number(openingFloat) || 0),
        }),
      )
      .catch(rethrowOpenShiftConflict);

    const shift = await this.findOneRaw(saved.id, storeId);
    this.realtime.emitToStore(storeId, RealtimeEvents.shiftOpened, this.present(shift));
    return this.current(storeId, userId);
  }

  /**
   * Closes a drawer and freezes its figures.
   *
   * `closedById` differs from `userId` when an owner force-closes for a cashier
   * who went home without closing.
   */
  async close(
    id: string,
    storeId: string,
    actor: any,
    dto: CloseShiftDto | { countedCash: null; notes?: string },
  ) {
    const isOwner = this.isOwner(actor);

    await this.dataSource.transaction(async (manager) => {
      /**
       * FOR UPDATE, and taken BEFORE reading the totals.
       *
       * settle() holds a FOR SHARE lock on this row for the length of its own
       * transaction, so this blocks until any in-flight payment has committed.
       * Without it a sale could land between the aggregate and the status
       * flip, and that money would belong to a shift that is already closed —
       * invisible on both the Z-report and the next one.
       */
      const shift = await manager
        .createQueryBuilder(CashierShift, 'shift')
        .setLock('pessimistic_write')
        .where('shift.id = :id', { id })
        .andWhere('shift.storeId = :storeId', { storeId })
        .getOne();

      if (!shift) throw new NotFoundException('Shift not found');
      if (!isOwner && shift.userId !== actor.id) {
        throw new ForbiddenException('You can only close your own shift');
      }
      if (shift.status !== 'open') {
        throw new ConflictException('This shift is already closed');
      }

      const totals = await this.computeTotals(manager, shift);
      const countedCash =
        dto.countedCash === null || dto.countedCash === undefined
          ? null
          : round2(Number(dto.countedCash));

      const result = await manager
        .createQueryBuilder()
        .update(CashierShift)
        .set({
          status: 'closed',
          closedAt: new Date(),
          closedById: actor.id,
          cashSales: totals.cashSales,
          cardSales: totals.cardSales,
          onlineSales: totals.onlineSales,
          otherSales: totals.otherSales,
          totalSales: totals.totalSales,
          orderCount: totals.orderCount,
          cashPaidOut: totals.cashPaidOut,
          expectedCash: totals.expectedCash,
          countedCash,
          // Null counted cash (a force-close) means the variance is unknown,
          // not zero — recording 0 would claim the drawer balanced.
          difference:
            countedCash === null ? null : round2(countedCash - totals.expectedCash),
          closingNotes: dto.notes?.trim() || null,
        })
        .where('id = :id', { id })
        .andWhere("status = 'open'")
        .execute();

      if (result.affected !== 1) {
        throw new ConflictException('This shift was closed by someone else');
      }
    });

    const shift = await this.findOneRaw(id, storeId);
    this.realtime.emitToStore(storeId, RealtimeEvents.shiftClosed, this.present(shift));
    return this.findOne(id, storeId, actor);
  }

  /** Owner confirms the cash physically reached them. */
  async collect(id: string, storeId: string, actor: any, dto: CollectShiftDto) {
    const shift = await this.shiftsRepository.findOne({ where: { id, storeId } });
    if (!shift) throw new NotFoundException('Shift not found');
    if (shift.status === 'open') {
      throw new ConflictException('Close this shift before collecting its cash');
    }
    if (shift.status === 'collected') {
      throw new ConflictException('This shift has already been collected');
    }

    await this.shiftsRepository.update(
      { id },
      {
        status: 'collected',
        collectedAmount: round2(Number(dto.collectedAmount) || 0),
        collectedById: actor.id,
        collectedAt: new Date(),
        collectionNotes: dto.notes?.trim() || null,
      },
    );

    const updated = await this.findOneRaw(id, storeId);
    this.realtime.emitToStore(storeId, RealtimeEvents.shiftCollected, this.present(updated));
    return this.findOne(id, storeId, actor);
  }

  // --------------------------------------------------------------- helpers

  private async findOneRaw(id: string, storeId: string): Promise<CashierShift> {
    const shift = await this.baseQuery(storeId).andWhere('shift.id = :id', { id }).getOne();
    if (!shift) throw new NotFoundException('Shift not found');
    return shift;
  }

  private isOwner(user: any): boolean {
    return (
      user?.effectiveRole === 'restaurant_owner' ||
      user?.effectiveRole === 'store_owner' ||
      user?.effectiveRole === 'super_admin' ||
      user?.role === 'admin' ||
      user?.role === 'store_owner'
    );
  }

  /** The frozen figures of a closed shift, in the same shape as live totals. */
  private snapshotTotals(shift: CashierShift): ShiftTotals {
    return {
      cashSales: Number(shift.cashSales) || 0,
      cardSales: Number(shift.cardSales) || 0,
      onlineSales: Number(shift.onlineSales) || 0,
      otherSales: Number(shift.otherSales) || 0,
      totalSales: Number(shift.totalSales) || 0,
      orderCount: Number(shift.orderCount) || 0,
      cashPaidOut: Number(shift.cashPaidOut) || 0,
      expectedCash: Number(shift.expectedCash) || 0,
    };
  }

  /**
   * Numbers out as numbers, and the cashier's name flattened.
   *
   * TypeORM hands decimals back as strings; leaving them would make every
   * client do `Number()` and some of them would forget.
   */
  private present(shift: CashierShift) {
    const num = (v: any) => (v === null || v === undefined ? null : Number(v));

    return {
      ...shift,
      openingFloat: num(shift.openingFloat) ?? 0,
      cashSales: num(shift.cashSales),
      cardSales: num(shift.cardSales),
      onlineSales: num(shift.onlineSales),
      otherSales: num(shift.otherSales),
      totalSales: num(shift.totalSales),
      cashPaidOut: num(shift.cashPaidOut),
      expectedCash: num(shift.expectedCash),
      countedCash: num(shift.countedCash),
      difference: num(shift.difference),
      collectedAmount: num(shift.collectedAmount),
      cashierName: (shift as any).user?.name ?? null,
      closedByName: (shift as any).closedBy?.name ?? null,
      collectedByName: (shift as any).collectedBy?.name ?? null,
    };
  }
}
