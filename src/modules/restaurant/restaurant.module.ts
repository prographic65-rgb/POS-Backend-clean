import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Order, OrderItem, Product, RestaurantTable, Store, Employee } from '../../entities';
import { RestaurantController } from './restaurant.controller';
import { TablesService } from './tables.service';
import { RestaurantOrdersService } from './restaurant-orders.service';
import { RestaurantReportsService } from './restaurant-reports.service';
import { OrderSequenceResetService } from './order-sequence-reset.service';
import { RealtimeModule } from '../../realtime/realtime.module';
import { ShiftsModule } from '../shifts/shifts.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Order, OrderItem, Product, RestaurantTable, Store, Employee]),
    RealtimeModule,
    // settle() stamps the money onto the cashier's open drawer.
    ShiftsModule,
  ],
  controllers: [RestaurantController],
  providers: [
    TablesService,
    RestaurantOrdersService,
    RestaurantReportsService,
    OrderSequenceResetService,
  ],
  exports: [TablesService, RestaurantOrdersService],
})
export class RestaurantModule {}
