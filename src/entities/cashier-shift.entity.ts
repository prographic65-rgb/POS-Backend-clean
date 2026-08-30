import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { Store } from './store.entity';
import { User } from './user.entity';

export type CashierShiftStatus = 'open' | 'closed' | 'collected';

/**
 * One cashier's window of accountability over a cash drawer.
 *
 * The unit of reconciliation is deliberately the SHIFT, not the calendar day:
 * money is attributed at the moment it is taken, so an order opened at 23:50
 * and settled at 00:10 belongs to whoever was actually at the till.
 *
 * `orders.createdById` records the WAITER. Cash is always taken by a cashier,
 * which is what `orders.settledById` + `orders.shiftId` record.
 */
@Entity('cashier_shifts')
/**
 * One open shift per PERSON, enforced by Postgres rather than by application
 * code — the same partial-index trick as `UQ_orders_live_table_v2` on orders.
 * Partial unique indexes ignore rows outside the predicate, so any number of
 * closed/collected shifts may coexist for the same user.
 *
 * This is what makes several cashiers working simultaneously safe: each holds
 * exactly one open row, and a double-open races into a 23505 instead of
 * silently creating a second drawer.
 *
 * The predicate is what forces `status` to be a varchar rather than a pg enum
 * — see the column below.
 */
@Index('UQ_cashier_shifts_open_user', ['userId'], {
  unique: true,
  where: `"status" = 'open'`,
})
export class CashierShift {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'uuid' })
  storeId: string;

  /** The cashier this drawer belongs to. */
  @Index()
  @Column({ type: 'uuid' })
  userId: string;

  /**
   * Deliberately a plain varchar, NOT a pg enum — the union type above is what
   * keeps it honest at compile time.
   *
   * The partial unique index on this table filters on `status = 'open'`, and a
   * predicate that compares an enum column stores the literal as that enum
   * TYPE, making the index depend on it. TypeORM changes an enum by renaming
   * the old type and re-typing the column, and Postgres rebuilds the dependent
   * index mid-way:
   *   operator does not exist: cashier_shifts_status_enum = ..._enum_old
   * The whole sync transaction aborts and the API never boots — verified, not
   * theoretical. Casting the column to text in the predicate does not help
   * either: `enum::text` is STABLE, and Postgres rejects non-IMMUTABLE
   * functions in an index predicate.
   *
   * A varchar sidesteps both, and adding a status value later stays a
   * no-migration change. This follows the precedent already set by
   * `Employee.designation`, which is varchar for the same family of reasons.
   */
  @Column({ type: 'varchar', length: 20, default: 'open' })
  status: CashierShiftStatus;

  /**
   * Set explicitly rather than with @CreateDateColumn so a backfill or an
   * owner-side correction can state when the drawer really opened.
   */
  @Column({ type: 'timestamp' })
  openedAt: Date;

  /** Change already in the drawer when the shift began. */
  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  openingFloat: number;

  @Column({ type: 'timestamp', nullable: true })
  closedAt?: Date | null;

  /** Who closed it — the cashier themselves, or an owner force-closing. */
  @Column({ type: 'uuid', nullable: true })
  closedById?: string | null;

  /**
   * Everything below is a SNAPSHOT written once at close and never recomputed.
   *
   * Same reasoning as `OrderItem.unitCost`: a Z-report is a statement about a
   * moment. Recomputing it later would let a subsequent edit, refund or
   * correction silently rewrite what a cashier already signed off and handed
   * over. NULL simply means "not closed yet".
   */
  @Column({ type: 'decimal', precision: 12, scale: 2, nullable: true })
  cashSales?: number | null;

  @Column({ type: 'decimal', precision: 12, scale: 2, nullable: true })
  cardSales?: number | null;

  @Column({ type: 'decimal', precision: 12, scale: 2, nullable: true })
  onlineSales?: number | null;

  /** Anything that is not cash/card/online — currently the 'check' method. */
  @Column({ type: 'decimal', precision: 12, scale: 2, nullable: true })
  otherSales?: number | null;

  @Column({ type: 'decimal', precision: 12, scale: 2, nullable: true })
  totalSales?: number | null;

  @Column({ type: 'int', nullable: true })
  orderCount?: number | null;

  /** Cash expenses booked against this shift — money that left the drawer. */
  @Column({ type: 'decimal', precision: 12, scale: 2, nullable: true })
  cashPaidOut?: number | null;

  /** openingFloat + cashSales − cashPaidOut. */
  @Column({ type: 'decimal', precision: 12, scale: 2, nullable: true })
  expectedCash?: number | null;

  /** What the cashier physically counted. NULL for an owner force-close. */
  @Column({ type: 'decimal', precision: 12, scale: 2, nullable: true })
  countedCash?: number | null;

  /** countedCash − expectedCash. Negative is short, positive is over. */
  @Column({ type: 'decimal', precision: 12, scale: 2, nullable: true })
  difference?: number | null;

  @Column({ type: 'text', nullable: true })
  closingNotes?: string | null;

  /**
   * The owner's confirmation that the cash physically reached them. Kept
   * separate from `countedCash` on purpose — what the cashier counted and what
   * the owner received are two different claims, and the gap between them is
   * exactly what an owner wants to see.
   */
  @Column({ type: 'decimal', precision: 12, scale: 2, nullable: true })
  collectedAmount?: number | null;

  @Column({ type: 'uuid', nullable: true })
  collectedById?: string | null;

  @Column({ type: 'timestamp', nullable: true })
  collectedAt?: Date | null;

  @Column({ type: 'text', nullable: true })
  collectionNotes?: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @ManyToOne(() => Store, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'storeId' })
  store: Store;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'closedById' })
  closedBy?: User | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'collectedById' })
  collectedBy?: User | null;
}
