import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { CronJob } from 'cron';
import { Repository } from 'typeorm';
import { Store } from '../../entities';

/**
 * Rolls every restaurant's customer-facing order number back to 1 each morning.
 *
 * `stores.orderSequence` is the counter behind the number printed on the bill
 * (see `RestaurantOrdersService.nextOrderSequence`). Left alone it climbs
 * forever, so by the end of a busy month the cashier is calling out "order
 * 4,317". Zeroing it overnight means the first bill after the cutover reads
 * "1" again — the counter holds the LAST number issued, so 0 here is what
 * makes the next order #1, not #0.
 *
 * Only `accountType = 'restaurant'` rows are touched. General-account stores
 * never call nextOrderSequence at all; their counter sits at 0 permanently and
 * writing to it would just be churn.
 *
 * WHAT THIS DELIBERATELY IS NOT: `orders.orderNumber` (`ORD-<ts>-<rand>`) is a
 * globally UNIQUE column and invoice numbers are derived from it. It is never
 * reset — only the display number is.
 */
@Injectable()
export class OrderSequenceResetService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OrderSequenceResetService.name);

  /** Registry key. Also what shows up in SchedulerRegistry.getCronJobs(). */
  static readonly JOB_NAME = 'order-sequence-daily-reset';

  private static readonly DEFAULT_HOUR = 6;
  private static readonly DEFAULT_TIMEZONE = 'Asia/Karachi';

  constructor(
    @InjectRepository(Store)
    private readonly stores: Repository<Store>,
    private readonly config: ConfigService,
    private readonly scheduler: SchedulerRegistry,
  ) {}

  /**
   * Registers the job at boot rather than with an `@Cron()` decorator.
   *
   * A decorator's arguments are evaluated when this file is first imported,
   * which happens while the AppModule's `imports` array is still being built —
   * strictly BEFORE `ConfigModule.forRoot()` runs and loads `.env`. Reading the
   * hour and timezone from a decorator would therefore always see undefined and
   * silently fall back, whatever the operator configured. Building the CronJob
   * here means ConfigService is already populated.
   */
  onModuleInit(): void {
    const hour = this.resolveHour();
    const timeZone = this.resolveTimeZone();

    const job = CronJob.from({
      // Minute 0 of the cutover hour, every day.
      cronTime: `0 ${hour} * * *`,
      timeZone,
      onTick: () => {
        // The tick signature is synchronous: an async body's rejection would
        // surface as an unhandledRejection and, under Node's default policy,
        // take the API process down at 6am. reset() swallows its own errors,
        // and this void is what documents that it must keep doing so.
        void this.reset();
      },
    });

    this.scheduler.addCronJob(OrderSequenceResetService.JOB_NAME, job);
    job.start();

    this.logger.log(
      `Daily order-number reset scheduled for ${String(hour).padStart(2, '0')}:00 ${timeZone}`,
    );
  }

  onModuleDestroy(): void {
    // main.ts does not call enableShutdownHooks(), so this fires on an explicit
    // app.close() (tests, and the dev watcher) rather than on SIGTERM. Stopping
    // the timer there is what stops a closed Nest context from being kept alive
    // by a pending tick.
    this.scheduler.getCronJob(OrderSequenceResetService.JOB_NAME)?.stop();
  }

  /**
   * Zeroes the counter for every restaurant.
   *
   * One statement, so it needs no transaction of its own: Postgres locks each
   * store row for the duration of the UPDATE, and `nextOrderSequence` claims
   * its number under the same lock. An order punched in the same instant as
   * the reset therefore serialises cleanly either side of it — the only
   * consequence is that one bill in that second may repeat a number, which is
   * the accepted cost of a fixed-time reset.
   *
   * Never throws. This runs on a timer with no caller to handle a failure, and
   * a stale counter is a cosmetic problem — it must not become a crashed API.
   */
  async reset(): Promise<number> {
    try {
      const result = await this.stores
        .createQueryBuilder()
        .update(Store)
        .set({ orderSequence: 0 })
        // Skipping rows already at 0 keeps the write proportional to the
        // number of restaurants that actually traded yesterday.
        .where('"accountType" = :accountType', { accountType: 'restaurant' })
        .andWhere('"orderSequence" <> 0')
        .execute();

      const affected = result.affected ?? 0;
      this.logger.log(`Order numbers reset to start from 1 for ${affected} restaurant(s)`);
      return affected;
    } catch (error) {
      this.logger.error('Daily order-number reset failed; counters continue from yesterday', error);
      return 0;
    }
  }

  /** Cutover hour, 0-23. Anything unparseable falls back to 6am. */
  private resolveHour(): number {
    const raw = this.config.get<string>('ORDER_SEQUENCE_RESET_HOUR');
    if (raw === undefined || raw === null || String(raw).trim() === '') {
      return OrderSequenceResetService.DEFAULT_HOUR;
    }

    const hour = Number(raw);
    if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
      this.logger.error(
        `ORDER_SEQUENCE_RESET_HOUR="${raw}" is not an hour 0-23; using ${OrderSequenceResetService.DEFAULT_HOUR}:00`,
      );
      return OrderSequenceResetService.DEFAULT_HOUR;
    }
    return hour;
  }

  /**
   * The timezone the cutover hour is read in.
   *
   * This is not optional detail: the server runs UTC in production, so an
   * unqualified "6am" would fire at 11am in Karachi — the middle of lunch prep.
   *
   * An invalid zone is logged and replaced rather than thrown, because
   * CronJob.from() rejects one by throwing, and a typo in an env var must not
   * be the reason a till cannot boot.
   */
  private resolveTimeZone(): string {
    const raw = this.config.get<string>('ORDER_SEQUENCE_RESET_TIMEZONE');
    const zone = String(raw ?? '').trim() || OrderSequenceResetService.DEFAULT_TIMEZONE;

    try {
      new Intl.DateTimeFormat('en-US', { timeZone: zone });
      return zone;
    } catch {
      this.logger.error(
        `ORDER_SEQUENCE_RESET_TIMEZONE="${zone}" is not a known IANA zone; using ${OrderSequenceResetService.DEFAULT_TIMEZONE}`,
      );
      return OrderSequenceResetService.DEFAULT_TIMEZONE;
    }
  }
}
