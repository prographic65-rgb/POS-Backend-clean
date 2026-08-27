import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Expense, ExpenseCategory } from '@/entities';
import { ExpensesController } from './expenses.controller';
import { ExpensesService } from './expenses.service';
import { ExpenseCategoriesService } from './expense-categories.service';

@Module({
  imports: [TypeOrmModule.forFeature([Expense, ExpenseCategory])],
  controllers: [ExpensesController],
  providers: [ExpensesService, ExpenseCategoriesService],
  exports: [ExpensesService, ExpenseCategoriesService],
})
export class ExpensesModule {}
