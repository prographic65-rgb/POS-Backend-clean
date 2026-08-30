import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  OneToMany,
  JoinColumn,
  VersionColumn,
  Index,
} from 'typeorm';
import { Customer } from './customer.entity';
import { User } from './user.entity';
import { OrderItem } from './order-item.entity';
import { RestaurantTable } from './restaurant-table.entity';

export type OrderStatus = 'pending' | 'paid' | 'unpaid' | 'cancelled' | 'refunded' | 'completed';

/**
 * Restaurant lifecycle. 'none' means "this is not a restaurant order".
 *
 * 'handed_over' is the KITCHEN's terminal state: the food has been cooked and
 * passed to the floor. The order still occupies its table and is still unpaid —
 * only the cashier's settle() moves it to 'completed' and frees the table.
 */
export type RestaurantOrderStatus =
  | 'none'
  | 'draft'
  | 'requested'
  | 'preparing'
  | 'handed_over'
  | 'completed'
  | 'cancelled';

/**
 * 'dine_out' is a dine-in order that also carries a parcel home. It needs a
 * table exactly like 'dine_in'; the parcel lines are marked per item with
 * `OrderItem.isParcel`, and both print on one receipt.
 */
export type OrderType = 'none' | 'dine_in' | 'dine_out' | 'takeaway' | 'delivery';

/**
 * Restaurant order states that occupy a table.
 *
 * MUST stay in sync with the predicate of UQ_orders_live_table_v2 below —
 * that index is the actual invariant, this list is what the application
 * reasons with.
 */
export const LIVE_ORDER_STATUSES: RestaurantOrderStatus[] = [
  'requested',
  'preparing',
  'handed_over',
];

/**
 * Enforces "at most one live order per table" in the schema rather than in
 * application code. Partial unique indexes ignore NULLs in Postgres, so every
 * existing (general-mode) row with tableId = NULL is unaffected.
 *
 * DELIBERATELY RENAMED (was UQ_orders_live_table) when 'handed_over' joined the
 * predicate. TypeORM's schema builder compares indexes by name, uniqueness and
 * COLUMNS ONLY — it never diffs the `where` clause, so editing the predicate in
 * place would leave the old index untouched in the database and silently stop
 * protecting handed-over tables. Renaming forces a drop-by-name and a create.
 * Any future predicate change needs another rename for the same reason.
 *
 * ⚠ ADDING A VALUE TO orders_order_status_enum REQUIRES RENAMING THIS INDEX
 * (to _v3, _v4…) EVEN IF THE PREDICATE IS OTHERWISE UNCHANGED.
 *
 * The predicate compares an enum column, so the literals are stored as that
 * enum TYPE and the index depends on it. TypeORM changes an enum by renaming
 * the old type and re-typing the column; Postgres then rebuilds any dependent
 * index mid-way and fails with
 *   operator does not exist: orders_order_status_enum = ..._enum_old
 * aborting the whole sync transaction so the API never boots. Renaming makes
 * dropOldIndices remove this index BEFORE the enum is touched, which is the
 * only reason the deploy that added 'handed_over' worked.
 *
 * Casting to text here is not an escape hatch: `enum::text` is STABLE, and
 * Postgres rejects non-IMMUTABLE functions in an index predicate. (The newer
 * cashier_shifts table avoids the whole problem by typing its status as a
 * varchar — an option not open here, because converting this live column would
 * rewrite every order row.)
 */
@Entity('orders')
@Index('UQ_orders_live_table_v2', ['tableId'], {
  unique: true,
  where: `"orderStatus" IN ('requested', 'preparing', 'handed_over')`,
})
export class Order {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid', { nullable: true })
  storeId: string;

  /**
   * Globally unique internal identifier (`ORD-<ts>-<rand>`).
   *
   * Kept unique across ALL stores because the column carries a global UNIQUE
   * index. Restaurants display `orderSequence` instead — two restaurants both
   * having an order "1" is expected, and would collide here.
   */
  @Column({ unique: true })
  orderNumber: string;

  /**
   * The number the restaurant actually shows: 1, 2, 3… per store.
   * Null for general-account orders, which keep using `orderNumber`.
   */
  @Column({ type: 'int', nullable: true })
  orderSequence?: number;

  @Column('uuid', { nullable: true })
  customerId: string;

  @ManyToOne(() => Customer, (customer) => customer.orders)
  @JoinColumn({ name: 'customerId' })
  customer: Customer;

  @Column({ nullable: true })
  customerName: string;

  /**
   * Contact details for takeaway/delivery, captured inline rather than as a
   * Customer row: `customers` has no storeId, so it is shared across every
   * tenant and writing walk-in details there leaks them between restaurants.
   */
  @Column({ nullable: true })
  customerPhone?: string;

  @Column({ type: 'text', nullable: true })
  deliveryAddress?: string;

  @ManyToOne(() => User, (user) => user.orders)
  @JoinColumn({ name: 'createdById' })
  createdBy: User;

  /**
   * Who OPENED the order. For a dine-in order this is the waiter, who never
   * handles money — see `settledById` for who actually took payment.
   */
  @Column('uuid')
  createdById: string;

  /**
   * Who TOOK THE MONEY, and when. Null on every order that predates cashier
   * shifts, and on orders that are not paid yet, so reports must treat null as
   * "unattributed" rather than assuming the creator collected.
   *
   * Kept separate from `createdById` because they are genuinely different
   * people in a restaurant: the waiter punches, the cashier settles.
   */
  @Column('uuid', { nullable: true })
  settledById?: string | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'settledById' })
  settledBy?: User | null;

  /**
   * The moment payment was taken. Reports about CASH must window on this, not
   * on `createdAt`: an order opened at 23:50 and settled at 00:10 belongs to
   * the next day's cashier, and to their shift.
   */
  @Column({ type: 'timestamp', nullable: true })
  settledAt?: Date | null;

  /**
   * The cashier shift this payment was taken during. Null when shifts are off
   * for the tenant, or for historical rows.
   */
  @Index()
  @Column('uuid', { nullable: true })
  shiftId?: string | null;

  /**
   * PAYMENT status. Exposed to newer clients as `paymentStatus` via a response
   * alias; the column keeps this name deliberately.
   *
   * DO NOT RENAME. `synchronize: true` runs against production, and TypeORM's
   * rename detection only fires when the net column count is unchanged with
   * exactly one unmatched column on each side. Renaming this alongside any
   * other column change silently degrades into DROP COLUMN + ADD COLUMN,
   * destroying the payment status of every historical order.
   *
   * Note there is no 'draft' member: a restaurant draft is
   * `status: 'unpaid'` + `orderStatus: 'draft'`.
   */
  @Column({
    type: 'enum',
    enum: ['pending', 'paid', 'unpaid', 'cancelled', 'refunded', 'completed'],
    default: 'unpaid',
  })
  status: OrderStatus;

  /**
   * Restaurant lifecycle, orthogonal to payment. NOT NULL with an explicit
   * 'none' member rather than nullable: in Postgres `WHERE orderStatus <> 'x'`
   * silently drops NULL rows, which would turn every existing general-mode
   * query into a three-valued-logic hazard.
   */
  @Column({
    type: 'enum',
    enum: ['none', 'draft', 'requested', 'preparing', 'handed_over', 'completed', 'cancelled'],
    enumName: 'orders_order_status_enum',
    default: 'none',
  })
  orderStatus: RestaurantOrderStatus;

  @Column({
    type: 'enum',
    enum: ['none', 'dine_in', 'dine_out', 'takeaway', 'delivery'],
    enumName: 'orders_order_type_enum',
    default: 'none',
  })
  orderType: OrderType;

  @Column('uuid', { nullable: true })
  tableId?: string;

  @ManyToOne(() => RestaurantTable, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'tableId' })
  table?: RestaurantTable;


  @Column({ type: 'decimal', precision: 10, scale: 2 })
  subtotal: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  tax: number;

  /** The resolved discount AMOUNT actually taken off this order. */
  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  discount: number;

  /**
   * How the discount was entered, and the raw figure entered. Storing the
   * input alongside the computed amount is what lets a receipt say "25% off"
   * instead of just "-250". Applies to both account types — the general POS
   * already computes a percentage and throws the input away.
   */
  @Column({
    type: 'enum',
    enum: ['amount', 'percent'],
    enumName: 'orders_discount_type_enum',
    nullable: true,
  })
  discountType?: 'amount' | 'percent';

  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  discountValue?: number;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  total: number;

  @Column({ nullable: true })
  notes: string;

  @Column({
    type: 'enum',
    enum: ['cash', 'card', 'check', 'online'],
    default: 'cash',
    nullable: true,
  })
  paymentMethod: 'cash' | 'card' | 'check' | 'online';

  /**
   * Optimistic lock. Drafts are shared across waiters, so two people can open
   * the same one; a stale write bumps into this and gets a 409 instead of
   * silently clobbering the other waiter's lines.
   */
  /**
   * `default: 1` is load-bearing, not cosmetic. Without it TypeORM emits
   * `ADD "version" integer NOT NULL` with no default, which fails outright on
   * a table that already has rows — taking the whole API down at boot, since
   * synchronize runs during startup.
   */
  @VersionColumn({ default: 1 })
  version: number;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @OneToMany(() => OrderItem, (item) => item.order, {
    cascade: true,
    eager: true,
  })
  items: OrderItem[];
}
