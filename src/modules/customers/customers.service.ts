import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Customer, Order } from '../../entities';
import { CreateCustomerDto, UpdateCustomerDto } from './dto/customer.dto';
import { toPage, type Page } from '../../common/pagination';

@Injectable()
export class CustomersService {
  constructor(
    @InjectRepository(Customer)
    private customersRepository: Repository<Customer>,
    @InjectRepository(Order)
    private ordersRepository: Repository<Order>,
  ) {}

  async create(createCustomerDto: CreateCustomerDto): Promise<Customer> {
    const customer = this.customersRepository.create(createCustomerDto);
    return await this.customersRepository.save(customer);
  }

  async findAll(skip?: number, take?: number): Promise<Customer[]> {
    return await this.customersRepository.find({
      relations: ['orders'],
      skip,
      take,
    });
  }

  async findAllPaged(skip: number, take: number, search?: string): Promise<Page<Customer>> {
    const qb = this.customersRepository
      .createQueryBuilder('customer')
      .leftJoinAndSelect('customer.orders', 'orders')
      .orderBy('customer.createdAt', 'DESC')
      .skip(skip)
      .take(take);

    const term = search?.trim();
    if (term) {
      qb.andWhere(
        `("customer"."name" ILIKE :term
          OR COALESCE("customer"."email", '') ILIKE :term
          OR COALESCE("customer"."phone", '') ILIKE :term
          OR COALESCE("customer"."city", '') ILIKE :term)`,
        { term: `%${term}%` },
      );
    }

    const [items, total] = await qb.getManyAndCount();
    return toPage(items, total, skip, take);
  }

  async findOne(id: string): Promise<Customer> {
    const customer = await this.customersRepository.findOne({
      where: { id },
      relations: ['orders'],
    });
    if (!customer) {
      throw new NotFoundException(`Customer #${id} not found`);
    }
    return customer;
  }

  async getCustomerWithOrders(id: string): Promise<{ customer: Customer; orders: Order[] }> {
    const customer = await this.findOne(id);
    const orders = await this.ordersRepository.find({
      where: { customerId: id },
      relations: ['items', 'items.product', 'createdBy'],
      order: { createdAt: 'DESC' },
    });
    return { customer, orders };
  }

  async update(
    id: string,
    updateCustomerDto: UpdateCustomerDto,
  ): Promise<Customer> {
    const customer = await this.findOne(id);
    const updated = this.customersRepository.merge(customer, updateCustomerDto);
    return await this.customersRepository.save(updated);
  }

  async remove(id: string): Promise<void> {
    const customer = await this.findOne(id);
    await this.customersRepository.remove(customer);
  }
}
