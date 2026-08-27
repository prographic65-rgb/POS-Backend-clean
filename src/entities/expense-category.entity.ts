import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  OneToMany,
  JoinColumn,
} from 'typeorm';
import { Store } from './store.entity';
import { Expense } from './expense.entity';

/**
 * Expense buckets ("Rent", "Utilities", "Supplies"), owned by the tenant.
 *
 * Deliberately separate from `categories`, which groups PRODUCTS and is joined
 * by the POS grid and every menu picker. Sharing one table would put rent in
 * the dish list.
 *
 * Only the owner maintains these; staff granted the expenses module pick from
 * them but cannot add or remove them.
 */
@Entity('expense_categories')
export class ExpenseCategory {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  storeId: string;

  @Column({ type: 'varchar', length: 255 })
  name: string;

  @Column({ type: 'text', nullable: true })
  description?: string;

  /**
   * Retiring a category hides it from the expense form without rewriting the
   * expenses already booked against it — a deleted category would either take
   * its history with it or leave a dangling id.
   */
  @Column({ default: true })
  isActive: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @ManyToOne(() => Store)
  @JoinColumn({ name: 'storeId' })
  store: Store;

  @OneToMany(() => Expense, (expense) => expense.category)
  expenses: Expense[];
}
