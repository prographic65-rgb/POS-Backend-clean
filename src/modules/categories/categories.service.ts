import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Category } from '../../entities';
import { CreateCategoryDto, UpdateCategoryDto } from './dto/category.dto';
import { toPage, type Page } from '../../common/pagination';
import { SORT_ORDER_FIND_ORDER, isUniqueViolation } from '../../common/sort-order';

@Injectable()
export class CategoriesService {
  constructor(
    @InjectRepository(Category)
    private categoriesRepository: Repository<Category>,
  ) {}

  async create(createCategoryDto: CreateCategoryDto, storeId: string): Promise<Category> {
    // No number given: the new category goes on the end of the menu rather
    // than being left unnumbered, so it is never lost among the legacy rows.
    const sortOrder =
      createCategoryDto.sortOrder ?? (await this.nextSortOrder(storeId));
    if (createCategoryDto.sortOrder != null) {
      await this.assertSortOrderFree(storeId, createCategoryDto.sortOrder);
    }
    const category = this.categoriesRepository.create({
      ...createCategoryDto,
      sortOrder,
      storeId,
    });
    return this.saveGuarded(category);
  }

  async findAll(storeId: string, skip?: number, take?: number): Promise<Category[]> {
    return await this.categoriesRepository.find({
      where: { storeId },
      relations: ['products'],
      order: SORT_ORDER_FIND_ORDER,
      skip,
      take,
    });
  }

  async findAllPaged(storeId: string, skip: number, take: number): Promise<Page<Category>> {
    const [items, total] = await this.categoriesRepository.findAndCount({
      where: { storeId },
      relations: ['products'],
      // Menu order, so the management page reads the way the till will.
      order: SORT_ORDER_FIND_ORDER,
      skip,
      take,
    });
    return toPage(items, total, skip, take);
  }

  async findOne(id: string, storeId?: string): Promise<Category> {
    const where: any = { id };
    if (storeId) where.storeId = storeId;

    const category = await this.categoriesRepository.findOne({
      where,
      relations: ['products'],
    });
    if (!category) {
      throw new NotFoundException(`Category #${id} not found`);
    }
    if (storeId && category.storeId !== storeId) {
      throw new ForbiddenException('You do not have access to this category');
    }
    return category;
  }

  async update(
    id: string,
    updateCategoryDto: UpdateCategoryDto,
    storeId: string,
  ): Promise<Category> {
    const category = await this.findOne(id, storeId);
    if (updateCategoryDto.sortOrder != null) {
      await this.assertSortOrderFree(storeId, updateCategoryDto.sortOrder, id);
    }
    const updated = this.categoriesRepository.merge(category, updateCategoryDto);
    return this.saveGuarded(updated);
  }

  async remove(id: string, storeId: string): Promise<void> {
    const category = await this.findOne(id, storeId);
    await this.categoriesRepository.remove(category);
  }

  // ------------------------------------------------------------ sort order

  /** One past the highest number in this store, so a new row lands last. */
  private async nextSortOrder(storeId: string): Promise<number> {
    const row = await this.categoriesRepository
      .createQueryBuilder('category')
      .select('MAX(category.sortOrder)', 'max')
      .where('category.storeId = :storeId', { storeId })
      .getRawOne<{ max: number | string | null }>();
    return (row?.max == null ? 0 : Number(row.max)) + 1;
  }

  /**
   * Rejects a number another category in the store already holds. Named in
   * the message, because the owner's next move is to go and renumber it.
   */
  private async assertSortOrderFree(
    storeId: string,
    sortOrder: number,
    exceptId?: string,
  ): Promise<void> {
    const clash = await this.categoriesRepository.findOne({ where: { storeId, sortOrder } });
    if (clash && clash.id !== exceptId) {
      throw new ConflictException(
        `Sort number ${sortOrder} is already used by "${clash.name}"`,
      );
    }
  }

  /**
   * Two owners saving the same number at the same moment both pass the check
   * above; the unique index then stops the second, and this turns that raw
   * driver error into the same 409 the check would have produced.
   */
  private async saveGuarded(category: Category): Promise<Category> {
    try {
      return await this.categoriesRepository.save(category);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException(`Sort number ${category.sortOrder} is already in use`);
      }
      throw error;
    }
  }
}
