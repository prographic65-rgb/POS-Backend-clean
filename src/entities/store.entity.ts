import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, OneToOne, JoinColumn } from 'typeorm';
import { User } from './user.entity';

@Entity('stores')
export class Store {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', nullable: true })
  userId: string;

  @Column({ type: 'varchar', length: 255 })
  name: string;

  /**
   * Legacy cosmetic label ('Café', 'Bakery', ...). Superseded by `accountType`
   * and no longer written by the UI. Deliberately NOT dropped: `synchronize`
   * runs against production, so removing it would issue a DROP COLUMN on
   * deploy. Retire it in its own dedicated release.
   */
  @Column({ type: 'varchar', length: 100, nullable: true })
  type?: string;

  /**
   * Drives which product/order flow the tenant gets. `general` is the original
   * behaviour and the default, so every pre-existing store keeps working
   * untouched. Immutable once set — switching would strand tables and orders.
   */
  @Column({
    type: 'enum',
    enum: ['general', 'restaurant'],
    enumName: 'stores_account_type_enum',
    default: 'general',
  })
  accountType: 'general' | 'restaurant';

  /**
   * Counter behind the per-restaurant order number, which customers see as
   * 1, 2, 3… rather than a timestamp.
   *
   * It lives on the store (not a global sequence) so each restaurant counts
   * independently, and it is incremented with an atomic
   * `UPDATE … SET orderSequence = orderSequence + 1 … RETURNING` inside the
   * order transaction — a read-then-write would hand two concurrent waiters
   * the same number.
   */
  @Column({ type: 'int', default: 0 })
  orderSequence: number;

  @Column({
    type: 'varchar',
    length: 50,
    default: 'starter',
  })
  plan: string;

  @Column({ type: 'varchar', length: 3, default: 'PKR' })
  currency: string;

  @Column({ type: 'text', nullable: true })
  address?: string;

  @Column({ type: 'varchar', length: 20, nullable: true })
  phone?: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  email?: string;

  @Column({ type: 'varchar', length: 255, nullable: true, default: 'BP-80' })
  printerConfig?: string;

  /**
   * Turns on cashier shifts for this tenant.
   *
   * Defaults to OFF so the release changes nothing for existing stores: with
   * it off, settling still records WHO took the money, but no one is blocked
   * for lacking an open shift. An owner opts in when their staff are ready,
   * because switching it on makes "open your shift" a precondition of taking
   * any payment.
   *
   * Restaurant tenants only for now — the general POS has no till widget yet.
   */
  @Column({ type: 'boolean', default: false })
  shiftsEnabled: boolean;

  /**
   * Server-relative path to the tenant's logo, e.g. '/uploads/logo/<id>-<ts>.png'.
   *
   * Stored relative, never absolute: the API's public origin differs between
   * dev, mobile emulators and production, so clients join it onto their own
   * base URL rather than trusting a host baked in at upload time.
   */
  @Column({ type: 'varchar', length: 500, nullable: true })
  logoUrl?: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @OneToOne(() => User, { nullable: false })
  @JoinColumn({ name: 'userId' })
  owner: User;
}
