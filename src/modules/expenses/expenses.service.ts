import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Expense, ExpenseCategory, type ExpensePaymentMethod } from '@/entities';
import { toPage, type Page } from '@/common';
import { CreateExpenseDto, UpdateExpenseDto } from './dto';

export interface ExpenseSummary {
  /** The calendar day these figures were computed for, echoed back. */
  date: string;
  today: number;
  todayCount: number;
  month: number;
  monthCount: number;
}

@Injectable()
export class ExpensesService {
  constructor(
    @InjectRepository(Expense)
    private expensesRepository: Repository<Expense>,
    @InjectRepository(ExpenseCategory)
    private categoriesRepository: Repository<ExpenseCategory>,
  ) {}

  /** 'YYYY-MM-DD' for the server's local day, used when a client sends none. */
  private serverToday(): string {
    const now = new Date();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${now.getFullYear()}-${month}-${day}`;
  }

  /** A category id must belong to the same store, or it is not a real link. */
  private async assertCategoryInStore(storeId: string, categoryId?: string | null) {
    if (!categoryId) return;
    const exists = await this.categoriesRepository.findOne({
      where: { id: categoryId, storeId },
      select: { id: true },
    });
    if (!exists) throw new BadRequestException('Expense category not found for this store');
  }

  async create(
    storeId: string,
    dto: CreateExpenseDto,
    createdById?: string,
  ): Promise<Expense> {
    await this.assertCategoryInStore(storeId, dto.categoryId);

    // `paymentMethod` is validated against the same list by @IsIn, but the DTO
    // types it as a plain string so the DTO does not import the entity's union.
    const expense = this.expensesRepository.create({
      ...dto,
      title: dto.title.trim(),
      storeId,
      createdById: createdById ?? null,
      paymentMethod: (dto.paymentMethod as ExpensePaymentMethod) ?? null,
      // The client sends its own local day; falling back to the server's is
      // only for API callers that omit it.
      expenseDate: dto.expenseDate ?? this.serverToday(),
    } as Partial<Expense>);

    const saved = await this.expensesRepository.save(expense);
    return this.findOne(saved.id, storeId);
  }

  private baseQuery(storeId: string, filters: ExpenseFilters = {}) {
    const qb = this.expensesRepository
      .createQueryBuilder('expense')
      .leftJoinAndSelect('expense.category', 'category')
      .leftJoinAndSelect('expense.createdBy', 'createdBy')
      .where('expense.storeId = :storeId', { storeId });

    if (filters.from) qb.andWhere('expense.expenseDate >= :from', { from: filters.from });
    if (filters.to) qb.andWhere('expense.expenseDate <= :to', { to: filters.to });

    if (filters.categoryId) {
      // A literal 'none' is how the client asks for the uncategorized bucket;
      // an `= NULL` comparison would silently match nothing.
      if (filters.categoryId === 'none') {
        qb.andWhere('expense.categoryId IS NULL');
      } else {
        qb.andWhere('expense.categoryId = :categoryId', { categoryId: filters.categoryId });
      }
    }

    const term = filters.search?.trim();
    if (term) {
      qb.andWhere(
        `("expense"."title" ILIKE :term
          OR COALESCE("expense"."notes", '') ILIKE :term
          OR COALESCE("category"."name", '') ILIKE :term)`,
        { term: `%${term}%` },
      );
    }

    return qb;
  }

  async findAll(storeId: string, filters: ExpenseFilters = {}, skip?: number, take?: number) {
    const qb = this.baseQuery(storeId, filters)
      // Two keys: several expenses share a day, and `expenseDate` is a plain
      // date, so entry order is the only stable tie-break.
      .orderBy('expense.expenseDate', 'DESC')
      .addOrderBy('expense.createdAt', 'DESC');

    if (skip !== undefined) qb.skip(skip);
    if (take !== undefined) qb.take(take);

    return qb.getMany();
  }

  async findAllPaged(
    storeId: string,
    skip: number,
    take: number,
    filters: ExpenseFilters = {},
  ): Promise<Page<Expense> & { filteredTotal: number }> {
    const qb = this.baseQuery(storeId, filters)
      .orderBy('expense.expenseDate', 'DESC')
      .addOrderBy('expense.createdAt', 'DESC')
      .skip(skip)
      .take(take);

    const [items, total] = await qb.getManyAndCount();

    // The summed value of everything MATCHING THE FILTER, not just this page —
    // a pager that shows 20 rows and a total for those 20 rows is misleading.
    const { sum } = await this.baseQuery(storeId, filters)
      .select('COALESCE(SUM(expense.amount), 0)', 'sum')
      .getRawOne<{ sum: string }>();

    return { ...toPage(items, total, skip, take), filteredTotal: Number(sum) || 0 };
  }

  async findOne(id: string, storeId: string): Promise<Expense> {
    const expense = await this.expensesRepository.findOne({
      where: { id, storeId },
      relations: ['category', 'createdBy'],
    });
    if (!expense) throw new NotFoundException('Expense not found');
    return expense;
  }

  async update(id: string, storeId: string, dto: UpdateExpenseDto): Promise<Expense> {
    const expense = await this.findOne(id, storeId);

    if (dto.categoryId !== undefined) {
      await this.assertCategoryInStore(storeId, dto.categoryId);
    }

    this.expensesRepository.merge(expense, {
      ...dto,
      ...(dto.title !== undefined ? { title: dto.title.trim() } : {}),
      ...(dto.paymentMethod !== undefined
        ? { paymentMethod: dto.paymentMethod as ExpensePaymentMethod }
        : {}),
    } as Partial<Expense>);

    await this.expensesRepository.save(expense);
    return this.findOne(id, storeId);
  }

  async remove(id: string, storeId: string): Promise<{ message: string }> {
    const expense = await this.findOne(id, storeId);
    await this.expensesRepository.remove(expense);
    return { message: 'Expense deleted' };
  }

  /**
   * Headline figures for the owner's dashboard.
   *
   * `date` comes from the client so "today" is the user's calendar day rather
   * than the server's — a store an hour ahead of the API would otherwise see
   * its evening spend counted as tomorrow's.
   */
  async summary(storeId: string, date?: string): Promise<ExpenseSummary> {
    const today = date ?? this.serverToday();
    const monthStart = `${today.slice(0, 7)}-01`;

    const totals = async (from: string, to: string) => {
      const row = await this.expensesRepository
        .createQueryBuilder('expense')
        .select('COALESCE(SUM(expense.amount), 0)', 'sum')
        .addSelect('COUNT(expense.id)', 'count')
        .where('expense.storeId = :storeId', { storeId })
        .andWhere('expense.expenseDate >= :from', { from })
        .andWhere('expense.expenseDate <= :to', { to })
        .getRawOne<{ sum: string; count: string }>();

      // Postgres returns SUM as a string and COUNT as a bigint string; both
      // need coercing or they concatenate downstream.
      return { sum: Number(row?.sum) || 0, count: Number(row?.count) || 0 };
    };

    const [day, month] = await Promise.all([
      totals(today, today),
      totals(monthStart, today),
    ]);

    return {
      date: today,
      today: day.sum,
      todayCount: day.count,
      month: month.sum,
      monthCount: month.count,
    };
  }
}

export interface ExpenseFilters {
  from?: string;
  to?: string;
  /** A category id, or the literal 'none' for uncategorized. */
  categoryId?: string;
  search?: string;
}
