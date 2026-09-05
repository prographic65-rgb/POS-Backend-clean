import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Product } from '../../entities';
import { CreateProductDto, UpdateProductDto } from './dto/product.dto';
import { toPage, type Page } from '../../common/pagination';
import { SORT_ORDER_FIND_ORDER, isUniqueViolation } from '../../common/sort-order';

@Injectable()
export class ProductsService {
  constructor(
    @InjectRepository(Product)
    private productsRepository: Repository<Product>,
  ) { }

  async create(createProductDto: CreateProductDto, storeId: string): Promise<Product> {
    // No number given: the new product goes on the end of the till rather
    // than being left unnumbered among the legacy rows.
    const sortOrder = createProductDto.sortOrder ?? (await this.nextSortOrder(storeId));
    if (createProductDto.sortOrder != null) {
      await this.assertSortOrderFree(storeId, createProductDto.sortOrder);
    }
    const product = this.productsRepository.create({ ...createProductDto, sortOrder, storeId });
    return this.saveGuarded(product);
  }

  async findAll(storeId: string, skip?: number, take?: number): Promise<Product[]> {
    return await this.productsRepository.find({
      where: { storeId },
      relations: ['category'],
      order: SORT_ORDER_FIND_ORDER,
      skip,
      take,
    });
  }

  /** Paged variant. `findAndCount` gives the total without a second query. */
  async findAllPaged(
    storeId: string,
    skip: number,
    take: number,
    search?: string,
  ): Promise<Page<Product>> {
    const qb = this.productsRepository
      .createQueryBuilder('product')
      .leftJoinAndSelect('product.category', 'category')
      .where('product.storeId = :storeId', { storeId })
      // Till order, so the management page reads the way the cashier sees it.
      // Unnumbered rows fall last on their own — Postgres's default for ASC.
      .orderBy('product.sortOrder', 'ASC')
      .addOrderBy('product.name', 'ASC')
      .skip(skip)
      .take(take);

    // Searched in SQL, not on the loaded page — a paged list filtered
    // client-side would silently miss matches on other pages.
    const term = search?.trim();
    if (term) {
      qb.andWhere(
        `("product"."name" ILIKE :term
          OR COALESCE("product"."sku", '') ILIKE :term
          OR COALESCE("product"."barcode", '') ILIKE :term
          OR COALESCE("category"."name", '') ILIKE :term)`,
        { term: `%${term}%` },
      );
    }

    const [items, total] = await qb.getManyAndCount();
    return toPage(items, total, skip, take);
  }

  async findOne(id: string, storeId?: string): Promise<Product> {
    const where: any = { id };
    if (storeId) where.storeId = storeId;

    const product = await this.productsRepository.findOne({
      where,
      relations: ['category'],
    });
    if (!product) {
      throw new NotFoundException(`Product #${id} not found`);
    }
    if (storeId && product.storeId !== storeId) {
      throw new ForbiddenException('You do not have access to this product');
    }
    return product;
  }

  async findActive(storeId: string, skip?: number, take?: number): Promise<Product[]> {
    return await this.productsRepository.find({
      where: { storeId, isActive: true },
      relations: ['category'],
      order: SORT_ORDER_FIND_ORDER,
      skip,
      take,
    });
  }

  async update(
    id: string,
    updateProductDto: UpdateProductDto,
    storeId: string,
  ): Promise<Product> {
    const product = await this.findOne(id, storeId);
    if (updateProductDto.sortOrder != null) {
      await this.assertSortOrderFree(storeId, updateProductDto.sortOrder, id);
    }
    const updated = this.productsRepository.merge(product, updateProductDto);
    return this.saveGuarded(updated);
  }

  async remove(id: string, storeId: string): Promise<void> {
    const product = await this.findOne(id, storeId);
    await this.productsRepository.remove(product);
  }

  async findByCategory(categoryId: string, storeId: string): Promise<Product[]> {
    return await this.productsRepository.find({
      where: { categoryId, storeId },
      relations: ['category'],
      order: SORT_ORDER_FIND_ORDER,
    });
  }

  async deductStock(id: string, quantity: number, storeId: string): Promise<Product> {
    const product = await this.findOne(id, storeId);

    if (product.stock < quantity) {
      throw new BadRequestException(`Insufficient stock for product "${product.name}". Available: ${product.stock}, Requested: ${quantity}`);
    }

    product.stock -= quantity;
    return await this.productsRepository.save(product);
  }

  // ------------------------------------------------------------ sort order

  /** One past the highest number in this store, so a new row lands last. */
  private async nextSortOrder(storeId: string): Promise<number> {
    const row = await this.productsRepository
      .createQueryBuilder('product')
      .select('MAX(product.sortOrder)', 'max')
      .where('product.storeId = :storeId', { storeId })
      .getRawOne<{ max: number | string | null }>();
    return (row?.max == null ? 0 : Number(row.max)) + 1;
  }

  /**
   * Rejects a number another product in the store already holds. Named in
   * the message, because the owner's next move is to go and renumber it.
   */
  private async assertSortOrderFree(
    storeId: string,
    sortOrder: number,
    exceptId?: string,
  ): Promise<void> {
    const clash = await this.productsRepository.findOne({ where: { storeId, sortOrder } });
    if (clash && clash.id !== exceptId) {
      throw new ConflictException(
        `Sort number ${sortOrder} is already used by "${clash.name}"`,
      );
    }
  }

  /**
   * The check above cannot stop two owners saving the same number at the
   * same moment; the unique index does, and this turns that raw driver error
   * into the same 409 the check would have produced.
   */
  private async saveGuarded(product: Product): Promise<Product> {
    try {
      return await this.productsRepository.save(product);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException(`Sort number ${product.sortOrder} is already in use`);
      }
      throw error;
    }
  }
}
