import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { Store } from './store.entity';
import { Product } from './product.entity';

@Entity('categories')
/**
 * One slot per number per store. Partial, so rows that predate the feature
 * (and therefore sit at NULL) never collide with each other.
 */
@Index('UQ_categories_store_sort_order', ['storeId', 'sortOrder'], {
  unique: true,
  where: '"sortOrder" IS NOT NULL',
})
export class Category {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid', { nullable: true })
  storeId: string;

  @Column()
  name: string;

  @Column({ nullable: true })
  description: string;

  @Column({ nullable: true })
  image: string;

  @Column({ default: true })
  isActive: boolean;

  /**
   * Where this category sits in the menu, lowest first. Chosen by the owner
   * and unique within the store; a category created without one is put at
   * the end. NULL only on rows written before the column existed — those
   * sort after every numbered category.
   */
  @Column({ type: 'int', nullable: true })
  sortOrder: number | null;

  /**
   * Nothing in this category needs cooking — it is served straight from the
   * counter, like drinks — so its lines are never sent to the kitchen.
   *
   * Categories NAMED Drinks/Beverages skip the kitchen automatically (see
   * common/kitchen-routing.ts); this flag is how an owner extends that to any
   * other category. `default: false` keeps every existing row unchanged and
   * lets `synchronize` add the column to a populated table.
   */
  @Column({ default: false })
  skipKitchen: boolean;

  @ManyToOne(() => Store)
  @JoinColumn({ name: 'storeId' })
  store: Store;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @OneToMany(() => Product, (product) => product.category)
  products: Product[];
}
