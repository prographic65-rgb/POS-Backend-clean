import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CashierShift, Order, Expense, Store, Employee } from '../../entities';
import { ShiftsController } from './shifts.controller';
import { ShiftsService } from './shifts.service';
import { RealtimeModule } from '../../realtime/realtime.module';

/**
 * Exports ShiftsService so the order and expense flows can stamp settlements
 * onto the caller's open drawer.
 *
 * Deliberately does NOT import RestaurantModule: that module imports this one,
 * and reaching back for RestaurantOrdersService would need forwardRef on both
 * sides. ShiftsService queries the Order repository directly instead.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([CashierShift, Order, Expense, Store, Employee]),
    RealtimeModule,
  ],
  controllers: [ShiftsController],
  providers: [ShiftsService],
  exports: [ShiftsService],
})
export class ShiftsModule {}
