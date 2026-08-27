import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Expense, ExpenseCategory } from '@/entities';
import { toPage, type Page } from '@/common';
import { CreateExpenseCategoryDto, UpdateExpenseCategoryDto } from './dto';

@Injectable()
export class ExpenseCategoriesService {
  constructor(
    @InjectRepository(ExpenseCategory)
    private categoriesRepository: Repository<ExpenseCategory>,
    @InjectRepository(Expense)
    private expensesRepository: Repository<Expense>,
  ) {}

  /**
   * Rejects a duplicate name within the store, case-insensitively.
   *
   * Enforced here rather than by a unique index so the user gets a readable
   * message instead of a driver error, and so "Rent" cannot sit alongside
   * "rent" in the picker.
   */
  private async assertNameFree(storeId: string, name: string, exceptId?: string) {
    const qb = this.categoriesRepository
      .createQueryBuilder('category')
      .where('category.storeId = :storeId', { storeId })
      .andWhere('LOWER(category.name) = LOWER(:name)', { name: name.trim() });

    if (exceptId) qb.andWhere('category.id != :exceptId', { exceptId });

    if (await qb.getExists()) {
      throw new ConflictException(`An expense category named "${name.trim()}" already exists`);
    }
  }

  async create(storeId: string, dto: CreateExpenseCategoryDto): Promise<ExpenseCategory> {
    await this.assertNameFree(storeId, dto.name);
    const category = this.categoriesRepository.create({
      ...dto,
      name: dto.name.trim(),
      storeId,
    });
    return this.categoriesRepository.save(category);
  }

  /**
   * `includeInactive` is opt-in: the expense form must only offer live
   * categories, while the management screen has to show retired ones or they
   * could never be brought back.
   */
  async findAll(storeId: string, includeInactive = false): Promise<ExpenseCategory[]> {
    const where: any = { storeId };
    if (!includeInactive) where.isActive = true;
    return this.categoriesRepository.find({ where, order: { name: 'ASC' } });
  }

  async findAllPaged(
    storeId: string,
    skip: number,
    take: number,
    includeInactive = false,
  ): Promise<Page<ExpenseCategory>> {
    const where: any = { storeId };
    if (!includeInactive) where.isActive = true;

    const [items, total] = await this.categoriesRepository.findAndCount({
      where,
      order: { name: 'ASC' },
      skip,
      take,
    });
    return toPage(items, total, skip, take);
  }

  async findOne(id: string, storeId: string): Promise<ExpenseCategory> {
    const category = await this.categoriesRepository.findOne({ where: { id, storeId } });
    if (!category) throw new NotFoundException('Expense category not found');
    return category;
  }

  async update(
    id: string,
    storeId: string,
    dto: UpdateExpenseCategoryDto,
  ): Promise<ExpenseCategory> {
    const category = await this.findOne(id, storeId);
    if (dto.name !== undefined) {
      await this.assertNameFree(storeId, dto.name, id);
      dto = { ...dto, name: dto.name.trim() };
    }
    return this.categoriesRepository.save(this.categoriesRepository.merge(category, dto));
  }

  /**
   * Removes a category, detaching the expenses booked against it.
   *
   * The detach is explicit rather than relying on the `onDelete: 'SET NULL'`
   * on the relation, because that FK action only exists if the schema was
   * created after this column — `synchronize` does not retrofit it onto a
   * constraint it already created. Doing it here means spend history survives
   * either way, showing as "Uncategorized" rather than vanishing.
   */
  async remove(id: string, storeId: string): Promise<{ message: string }> {
    const category = await this.findOne(id, storeId);
    await this.expensesRepository.update({ categoryId: id, storeId }, { categoryId: null });
    await this.categoriesRepository.remove(category);
    return { message: 'Expense category deleted' };
  }
}
