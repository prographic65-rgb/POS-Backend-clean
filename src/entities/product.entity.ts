import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  OneToMany,
  JoinColumn,
  Index,
} from 'typeorm';
import { Store } from './store.entity';
import { Category } from './category.entity';
import { OrderItem } from './order-item.entity';

@Entity('products')
/** One slot per number per store; NULL (legacy) rows are exempt. */
@Index('UQ_products_store_sort_order', ['storeId', 'sortOrder'], {
  unique: true,
  where: '"sortOrder" IS NOT NULL',
})
export class Product {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid', { nullable: true })
  storeId: string;

  @Column()
  name: string;

  @Column({ type: 'text', nullable: true })
  description: string;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  price: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  costPrice: number;

  @Column({ type: 'int', default: 0 })
  stock: number;

  @Column({ type: 'int', default: 5, nullable: true })
  lowStockAlertQuantity: number;

  @Column({ nullable: true })
  sku: string;

  @Column({ nullable: true })
  barcode: string;

  @Column({ nullable: true })
  image: string;

  @Column({ default: true })
  isActive: boolean;

  /**
   * Position on the till, lowest first — across the whole store, not per
   * category, so "All" and a single category both read in the same order.
   * Unique within the store; auto-assigned to the end when omitted; NULL on
   * rows that predate the column, which sort last.
   */
  @Column({ type: 'int', nullable: true })
  sortOrder: number | null;

  @ManyToOne(() => Store)
  @JoinColumn({ name: 'storeId' })
  store: Store;

  @ManyToOne(() => Category, (category) => category.products)
  @JoinColumn({ name: 'categoryId' })
  category: Category;

  @Column('uuid', { nullable: true })
  categoryId: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @OneToMany(() => OrderItem, (item) => item.product)
  orderItems: OrderItem[];
}
