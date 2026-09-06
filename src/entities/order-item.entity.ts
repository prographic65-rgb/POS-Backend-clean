import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Order } from './order.entity';
import { Product } from './product.entity';

@Entity('order_items')
export class OrderItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Order, (order) => order.items)
  @JoinColumn({ name: 'orderId' })
  order: Order;

  @Column('uuid')
  orderId: string;

  @ManyToOne(() => Product, (product) => product.orderItems)
  @JoinColumn({ name: 'productId' })
  product: Product;

  @Column('uuid')
  productId: string;

  @Column({ nullable: true })
  productName: string;

  @Column({ type: 'int' })
  quantity: number;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  unitPrice: number;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  subtotal: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  discount: number;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  total: number;

  /**
   * Snapshot of `product.costPrice` at the moment this line was created.
   * Profit must not be recomputed from the live product: editing a cost
   * tomorrow would silently rewrite the margin on every past order.
   *
   * `product.costPrice` is nullable and legacy rows hold NULL, so callers
   * store `costPrice ?? 0` and report how many lines had unknown cost rather
   * than presenting a confidently wrong profit figure.
   */
  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  unitCost?: number;

  /** Kitchen instructions for this line — "no onions", "extra spicy". */
  @Column({ type: 'text', nullable: true })
  notes?: string;

  /**
   * This line is to be packed to take away, on an order that is otherwise
   * eaten at the table (`orderType: 'dine_out'`).
   *
   * `default: false` is load-bearing, not cosmetic — the same trap documented
   * on Order.version: TypeORM would otherwise emit `ADD COLUMN ... NOT NULL`
   * with no default, which fails outright on a populated table and takes the
   * API down at boot, since synchronize runs during startup.
   */
  @Column({ default: false })
  isParcel: boolean;

  /**
   * When this line was sent to the kitchen. Set per round, so appending a
   * second round to a live order prints a ticket containing only the new
   * lines instead of reprinting the whole order. NULL while still a draft.
   */
  @Column({ type: 'timestamp', nullable: true })
  sentAt?: Date;

  /**
   * This line is served from the counter, not cooked — a drink. It never
   * appears on a kitchen ticket or the kitchen board, and an order made only
   * of such lines never goes to the kitchen at all.
   *
   * Snapshotted from the product's category at order time (see
   * common/kitchen-routing.ts) rather than looked up live: re-flagging a
   * category tomorrow must not change what the kitchen was told today.
   *
   * `default: false` is load-bearing — see `isParcel` above.
   */
  @Column({ default: false })
  skipKitchen: boolean;

  /**
   * Name of the product's category when this line was created, printed in
   * brackets after the dish on the kitchen ticket — "Chicken Karahi (Karahi)".
   *
   * Snapshotted for the same reason as `skipKitchen`: re-filing or renaming a
   * category later must not rewrite what an old ticket said. NULL on lines
   * written before the column existed and on retail lines, which never reach
   * a kitchen; the ticket simply omits the bracket then.
   *
   * The explicit `type` matters: a `string | null` property reflects as
   * Object, which TypeORM cannot map to a column.
   */
  @Column({ type: 'varchar', nullable: true })
  categoryName?: string | null;
}
