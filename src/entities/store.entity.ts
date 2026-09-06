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
   *
   * OrderSequenceResetService zeroes this every morning (6am by default), so
   * the value is "last number issued TODAY", not a lifetime total. Nothing may
   * treat it as unique or monotonic across days.
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

  /**
   * The logo bytes themselves, served by GET /stores/:id/logo.
   *
   * Kept in the database rather than on disk because production runs on a
   * container with an EPHEMERAL filesystem: every deploy started from a clean
   * image, so a logo written to `uploads/` vanished at the next release while
   * `logoUrl` kept pointing at it. The browser then received a JSON 404 where
   * it expected an image, which Chrome reports as ERR_BLOCKED_BY_ORB.
   *
   * `select: false` keeps the ~500 KB out of every ordinary `GET /stores/:id`
   * — both clients call that to build receipt headers, and neither wants the
   * image inline. Only the logo endpoint selects it explicitly.
   */
  @Column({ type: 'bytea', nullable: true, select: false })
  logoData?: Buffer | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  logoMimeType?: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @OneToOne(() => User, { nullable: false })
  @JoinColumn({ name: 'userId' })
  owner: User;
}
