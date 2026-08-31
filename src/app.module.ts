import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { typeormConfig } from './database/typeorm.config';
import { User, Category, Product, Customer, Order, OrderItem, Store, Employee, RefreshToken, RestaurantTable, Expense, ExpenseCategory, CashierShift } from './entities';
import { AuthModule } from './auth/auth.module';
import { CommonModule } from './common/common.module';
import { AppController } from './app.controller';
import { ProductsModule } from './modules/products/products.module';
import { CategoriesModule } from './modules/categories/categories.module';
import { CustomersModule } from './modules/customers/customers.module';
import { OrdersModule } from './modules/orders/orders.module';
import { InvoicesModule } from './modules/invoices/invoices.module';
import { StoresModule } from './modules/stores/stores.module';
import { UsersModule } from './modules/users/users.module';
import { EmployeesModule } from './modules/employees/employees.module';
import { RestaurantModule } from './modules/restaurant/restaurant.module';
import { ExpensesModule } from './modules/expenses/expenses.module';
import { ShiftsModule } from './modules/shifts/shifts.module';
import { RealtimeModule } from './realtime/realtime.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    // Timer infrastructure for OrderSequenceResetService, which rolls every
    // restaurant's order number back to 1 each morning.
    ScheduleModule.forRoot(),
    TypeOrmModule.forRoot(typeormConfig()),
    TypeOrmModule.forFeature([User, Category, Product, Customer, Order, OrderItem, Store, Employee, RefreshToken, RestaurantTable, Expense, ExpenseCategory, CashierShift]),
    CommonModule,
    AuthModule,
    ProductsModule,
    CategoriesModule,
    CustomersModule,
    OrdersModule,
    InvoicesModule,
    StoresModule,
    UsersModule,
    EmployeesModule,
    RealtimeModule,
    RestaurantModule,
    ExpensesModule,
    ShiftsModule,
  ],
  controllers: [AppController],
  providers: [],
})
export class AppModule {}
