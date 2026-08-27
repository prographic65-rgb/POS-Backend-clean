import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  OneToOne,
  JoinColumn,
} from 'typeorm';

/** Designations that carry behaviour. Restaurant stores are limited to the last three. */
export type EmployeeDesignation =
  | 'cashier'
  | 'manager'
  | 'staff'
  | 'waiter'
  | 'kitchen';

/** The only designations a restaurant employee may hold. */
export const RESTAURANT_DESIGNATIONS = ['waiter', 'kitchen', 'cashier'] as const;

@Entity('employee_details')
export class Employee {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  storeId: string;

  @Column({ type: 'uuid' })
  userId: string;

  @Column({ type: 'varchar', length: 50 })
  employeeId: string; // Custom employee ID like EMP001, EMP002

  @Column({ type: 'varchar', length: 255 })
  name: string;

  @Column({ type: 'varchar', length: 255 })
  email: string;

  @Column({ type: 'varchar', length: 20, nullable: true })
  phone?: string;

  @Column({ type: 'text', nullable: true })
  address?: string;

  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  salary?: number;

  @Column({ type: 'date', nullable: true })
  joinDate?: Date;

  /**
   * Employee role/position. For restaurant stores this is what routes the user
   * to the waiter / kitchen / cashier screens.
   *
   * Deliberately still a plain varchar, not a pg enum: this column has always
   * been fed by an `@IsString()`-only DTO behind a free-text input, so live
   * data contains arbitrary values ("Manager", "Sales Rep"). Converting to an
   * enum would fail the `::text::` cast on real rows. The restaurant values
   * are validated at the service layer for restaurant stores only, leaving
   * general stores free-text so their existing employees stay editable.
   */
  @Column({ type: 'varchar', length: 50, default: 'cashier' })
  designation: EmployeeDesignation | string;

  /**
   * Optional per-employee default printer name. The authoritative binding is
   * device-local (browser localStorage / mobile MMKV), because a printer
   * belongs to a station rather than a person — two staff share one kitchen
   * screen, and one person walks between stations. This is only a fallback.
   */
  @Column({ type: 'varchar', length: 255, nullable: true })
  printerName?: string;

  /**
   * Extra modules this employee has been granted, on top of the one their
   * designation always carries (a cashier's till, the kitchen display, the
   * waiter's tables).
   *
   * NULL means "never customised" and is not the same as `[]` — although both
   * currently resolve to base-only access, keeping them distinct lets the UI
   * show whether an owner has actually reviewed this person's access.
   *
   * Never trusted as-is: resolvePermissions() re-filters it against what the
   * current designation allows, so a stale entry left behind by a role change
   * cannot grant anything.
   */
  @Column({ type: 'jsonb', nullable: true })
  permissions?: string[] | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @ManyToOne('Store')
  @JoinColumn({ name: 'storeId' })
  store: any;

  @OneToOne('User')
  @JoinColumn({ name: 'userId' })
  user: any;
}
