import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Unique,
} from 'typeorm';
import { Store } from './store.entity';

export type TableStatus = 'free' | 'reserved';

/**
 * A physical table in a restaurant. Only meaningful for stores whose
 * `accountType` is 'restaurant'.
 */
@Entity('restaurant_tables')
@Unique('UQ_restaurant_table_name_per_store', ['storeId', 'name'])
export class RestaurantTable {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  storeId: string;

  @Column({ type: 'varchar', length: 100 })
  name: string;

  /**
   * Denormalized from "does a live order exist for this table". Kept as a
   * column because the waiter grid and every socket payload want it cheaply,
   * but it is NOT the invariant — the partial unique index
   * `UQ_orders_live_table_v2` on
   * `orders.tableId WHERE orderStatus IN ('requested','preparing','handed_over')`
   * is. `currentOrderId` exists so drift between the two is detectable.
   *
   * Note a handed-over order still holds its table: the kitchen has served the
   * food, but the guests are still sitting there and have not paid.
   */
  @Column({
    type: 'enum',
    enum: ['free', 'reserved'],
    enumName: 'restaurant_tables_status_enum',
    default: 'free',
  })
  status: TableStatus;

  @Column({ type: 'uuid', nullable: true })
  currentOrderId?: string;

  /**
   * Tables are soft-deleted only. `orders.tableId` references this row, so a
   * hard delete would either fail or null out the history of served orders.
   */
  @Column({ default: true })
  isActive: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @ManyToOne(() => Store, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'storeId' })
  store: Store;
}
