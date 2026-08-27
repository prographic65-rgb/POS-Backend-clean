import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Product } from '../../entities';
import { CreateProductDto, UpdateProductDto } from './dto/product.dto';
import { toPage, type Page } from '../../common/pagination';

@Injectable()
export class ProductsService {
  constructor(
    @InjectRepository(Product)
    private productsRepository: Repository<Product>,
  ) { }

  async create(createProductDto: CreateProductDto, storeId: string): Promise<Product> {
    const product = this.productsRepository.create({ ...createProductDto, storeId });
    return await this.productsRepository.save(product);
  }

  async findAll(storeId: string, skip?: number, take?: number): Promise<Product[]> {
    return await this.productsRepository.find({
      where: { storeId },
      relations: ['category'],
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
      .orderBy('product.createdAt', 'DESC')
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
    console.log(`Finding active products for storeId=${storeId}, skip=${skip}, take=${take}`);
    return await this.productsRepository.find({
      where: { storeId, isActive: true },
      relations: ['category'],
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
    const updated = this.productsRepository.merge(product, updateProductDto);
    return await this.productsRepository.save(updated);
  }

  async remove(id: string, storeId: string): Promise<void> {
    const product = await this.findOne(id, storeId);
    await this.productsRepository.remove(product);
  }

  async findByCategory(categoryId: string, storeId: string): Promise<Product[]> {
    return await this.productsRepository.find({
      where: { categoryId, storeId },
      relations: ['category'],
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
}
