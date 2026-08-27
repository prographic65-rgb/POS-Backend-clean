import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Store } from './store.entity';
import { User } from './user.entity';
import { ExpenseCategory } from './expense-category.entity';

/** How the money left the till. Mirrors the order-side payment methods. */
export type ExpensePaymentMethod = 'cash' | 'card' | 'bank' | 'other';

export const EXPENSE_PAYMENT_METHODS: ExpensePaymentMethod[] = [
  'cash',
  'card',
  'bank',
  'other',
];

/**
 * A single spend booked against the store.
 *
 * Store-scoped, not user-scoped: an expense belongs to the business, so every
 * user with the expenses module sees the same ledger. `createdById` records
 * who entered it, which is an audit trail rather than an ownership claim.
 */
@Entity('expenses')
export class Expense {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  storeId: string;

  /**
   * Nullable so retiring a category cannot orphan or delete spend history;
   * such rows surface as "Uncategorized".
   */
  @Column({ type: 'uuid', nullable: true })
  categoryId?: string | null;

  @Column({ type: 'varchar', length: 255 })
  title: string;

  @Column({ type: 'decimal', precision: 12, scale: 2 })
  amount: number;

  /**
   * A calendar day, not a timestamp — "today's expenses" must mean the store's
   * own day. Stored as Postgres `date` and read back as a 'YYYY-MM-DD' string,
   * so no timezone conversion can shift an evening entry into tomorrow, which
   * is exactly the bug a `timestamptz` here would introduce.
   */
  @Column({ type: 'date' })
  expenseDate: string;

  @Column({ type: 'varchar', length: 20, nullable: true })
  paymentMethod?: ExpensePaymentMethod | null;

  /** Free-text reference: invoice number, vendor, whatever the owner needs. */
  @Column({ type: 'text', nullable: true })
  notes?: string | null;

  /** Audit only. Null for rows whose author was since deleted. */
  @Column({ type: 'uuid', nullable: true })
  createdById?: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @ManyToOne(() => Store)
  @JoinColumn({ name: 'storeId' })
  store: Store;

  @ManyToOne(() => ExpenseCategory, (category) => category.expenses, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'categoryId' })
  category?: ExpenseCategory | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'createdById' })
  createdBy?: User | null;
}
