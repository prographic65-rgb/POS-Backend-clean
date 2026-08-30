import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Order, OrderItem, Product, Store, Employee, Customer } from '../../entities';
import { CreateOrderDto, UpdateOrderDto } from './dto/order.dto';
import { ProductsService } from '../products/products.service';
import { ShiftsService, type SettlementStamp } from '../shifts/shifts.service';
import { generateOrderNumber } from '../../common/order-number';
import { toPage, type Page } from '../../common/pagination';

/**
 * Narrows the joined user relations to the columns a client may see.
 *
 * `User.passwordHash` has no `select: false` on the entity, so any
 * `relations: ['createdBy']` without this pulls the bcrypt hash of the staff
 * member into every order in the response. Naming the fields explicitly is
 * what keeps it out; TypeORM selects all root columns when a relation is
 * narrowed this way, so nothing else is lost.
 */
const ORDER_USER_SELECT = {
  createdBy: { id: true, name: true, email: true },
  settledBy: { id: true, name: true, email: true },
} as const;

@Injectable()
export class OrdersService {
  constructor(
    @InjectRepository(Order)
    private ordersRepository: Repository<Order>,
    @InjectRepository(OrderItem)
    private orderItemsRepository: Repository<OrderItem>,
    @InjectRepository(Product)
    private productsRepository: Repository<Product>,
    @InjectRepository(Store)
    private storesRepository: Repository<Store>,
    @InjectRepository(Employee)
    private employeesRepository: Repository<Employee>,
    @InjectRepository(Customer)
    private customersRepository: Repository<Customer>,
    private productsService: ProductsService,
    private shiftsService: ShiftsService,
    private dataSource: DataSource,
  ) {}

  /**
   * Records who took the money on a general-POS sale.
   *
   * SOFT stamping only — deliberately never throws. The general POS has no
   * "open your shift" widget, so enforcing a drawer here would block every
   * sale on that screen the moment an owner enabled shifts for their tenant.
   * The attribution is still recorded, so switching the flag on later has
   * history behind it, and `shiftId` is filled in only if the cashier happens
   * to have a drawer open.
   */
  private async settlementStamp(
    storeId: string | undefined,
    userId?: string,
  ): Promise<Partial<SettlementStamp>> {
    if (!storeId || !userId) return {};

    try {
      return await this.shiftsService.stampSettlement(
        this.dataSource.manager,
        storeId,
        userId,
        { enforce: false },
      );
    } catch {
      // Attribution is a nice-to-have here; never let it fail a sale.
      return { settledById: userId, settledAt: new Date(), shiftId: null };
    }
  }

  private async getStoreIdFromUser(user: any): Promise<string | undefined> {
    if (user.role === 'admin') {
      return undefined;
    } else if (user.role === 'store_owner') {
      const store = await this.storesRepository.findOne({ where: { userId: user.id } });
      if (!store) throw new BadRequestException('Store not found for this user');
      return store.id;
    } else if (user.role === 'employee' || user.role === 'cashier') {
      const employee = await this.employeesRepository.findOne({ where: { userId: user.id } });
      if (!employee) throw new BadRequestException('Employee record not found');
      return employee.storeId;
    }
    throw new BadRequestException('Invalid user role for this operation');
  }

  async create(createOrderDto: CreateOrderDto, userId: string, storeId?: string): Promise<Order> {
    if (!storeId) {
      throw new BadRequestException('Store ID is required to create an order');
    }

    const { items, tax = 0, discount = 0, customerId, status, ...orderData } = createOrderDto;

    const orderNumber = generateOrderNumber();

    // If customerId is provided, fetch customer and set customerName from it
    let customerName: string | undefined;
    if (customerId) {
      const customer = await this.customersRepository.findOne({ where: { id: customerId } });
      if (!customer) {
        throw new BadRequestException(`Customer with ID ${customerId} not found`);
      }
      customerName = customer.name;
    }

    // Step 1: Validate ALL items before processing any
    const validatedProducts = new Map();
    
    for (const item of items) {
      const product = await this.productsRepository.findOne({
        where: { id: item.productId, storeId },
      });

      if (!product) {
        throw new BadRequestException(`Product ${item.productId} not found or does not belong to your store`);
      }
      
      if (!product.isActive) {
        throw new BadRequestException(`Product "${product.name}" is no longer available or has been discontinued`);
      }
      
      if (product.stock < item.quantity) {
        throw new BadRequestException(`Insufficient stock for product "${product.name}". Available: ${product.stock}, Requested: ${item.quantity}`);
      }

      // Store validated product for later use
      validatedProducts.set(item.productId, product);
    }

    // Step 2: All validations passed, now build order items
    let subtotal = 0;
    const orderItems: OrderItem[] = [];

    for (const item of items) {
      const product = validatedProducts.get(item.productId);
      const itemSubtotal = item.quantity * item.unitPrice;
      const itemDiscount = item.discount || 0;
      const itemTotal = itemSubtotal - itemDiscount;
      subtotal += itemTotal;

      const orderItem = this.orderItemsRepository.create({
        productId: item.productId,
        productName: product.name,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        subtotal: itemSubtotal,
        discount: itemDiscount,
        total: itemTotal,
      });

      orderItems.push(orderItem);
    }

    const total = createOrderDto.total;

    const resolvedStatus =
      (status as 'paid' | 'unpaid' | 'pending' | 'cancelled' | 'refunded') || 'unpaid';

    // Money changing hands is what triggers attribution — an unpaid ticket has
    // no cashier yet.
    const stamp = resolvedStatus === 'paid' ? await this.settlementStamp(storeId, userId) : {};

    // Step 3: Create and save order (status defaults to 'unpaid' if not provided)
    const order = this.ordersRepository.create({
      storeId,
      orderNumber,
      customerId: customerId || null,
      customerName: customerName || null,
      createdById: userId,
      subtotal,
      tax: tax || 0,
      discount: discount || 0,
      total,
      notes: orderData.notes,
      status: resolvedStatus,
      paymentMethod: (orderData.paymentMethod) as any,
      items: orderItems,
      ...stamp,
    });

    const savedOrder = await this.ordersRepository.save(order);

    // Step 4: Deduct stock only after order is successfully saved
    for (const item of items) {
      await this.productsService.deductStock(item.productId, item.quantity, storeId);
    }

    // Step 5: Update customer's totalSpent if customerId was provided
    if (customerId) {
      const customer = await this.customersRepository.findOne({ where: { id: customerId } });
      if (customer) {
        customer.totalSpent = Number(customer.totalSpent) + Number(total);
        await this.customersRepository.save(customer);
      }
    }

    return savedOrder;
  }

  async findAll(storeId?: string, skip?: number, take?: number): Promise<Order[]> {
    const where: any = {};
    if (storeId) {
      where.storeId = storeId;
    }
    
    return await this.ordersRepository.find({
      where,
      relations: ['customer', 'createdBy', 'settledBy', 'items', 'items.product'],
      // `User.passwordHash` carries no `select: false`, so loading the whole
      // relation puts every cashier's bcrypt hash in the response.
      select: ORDER_USER_SELECT,
      skip,
      take,
      order: { createdAt: 'DESC' },
    });
  }

  async findAllPaged(storeId: string | undefined, skip: number, take: number): Promise<Page<Order>> {
    const where: any = {};
    if (storeId) where.storeId = storeId;

    const [items, total] = await this.ordersRepository.findAndCount({
      where,
      relations: ['customer', 'createdBy', 'settledBy', 'items', 'items.product'],
      // `User.passwordHash` carries no `select: false`, so loading the whole
      // relation puts every cashier's bcrypt hash in the response.
      select: ORDER_USER_SELECT,
      skip,
      take,
      order: { createdAt: 'DESC' },
    });
    return toPage(items, total, skip, take);
  }

  async findOne(id: string, storeId?: string): Promise<Order> {
    const where: any = { id };
    if (storeId) where.storeId = storeId;
    
    const order = await this.ordersRepository.findOne({
      where,
      relations: ['customer', 'createdBy', 'settledBy', 'items', 'items.product'],
      // `User.passwordHash` carries no `select: false`, so loading the whole
      // relation puts every cashier's bcrypt hash in the response.
      select: ORDER_USER_SELECT,
    });

    if (!order) {
      throw new NotFoundException(`Order #${id} not found`);
    }

    if (storeId && order.storeId !== storeId) {
      throw new ForbiddenException('You do not have access to this order');
    }

    return order;
  }

  async update(
    id: string,
    updateOrderDto: UpdateOrderDto,
    storeId?: string,
    userId?: string,
  ): Promise<Order> {
    const order = await this.findOne(id, storeId);

    // An update that flips an unpaid ticket to paid is a payment, and needs
    // the same attribution as marking it paid outright.
    const becomesPaid = updateOrderDto.status === 'paid' && order.status !== 'paid';
    const stamp = becomesPaid ? await this.settlementStamp(storeId, userId) : {};

    const updated = this.ordersRepository.merge(order, { ...updateOrderDto, ...stamp } as any);
    return await this.ordersRepository.save(updated);
  }

  /**
   * Settles an order with a targeted UPDATE rather than saving the aggregate.
   *
   * `save()` on a loaded Order re-persists its eagerly-loaded, cascading
   * `items` and bumps the @VersionColumn — so a two-field status change turned
   * into a write of every order line plus an optimistic-lock check that could
   * reject the update outright. Only the two columns that actually change are
   * written now; findOne() still enforces the tenancy check first.
   */
  async markAsPaid(
    id: string,
    storeId?: string,
    paymentMethod?: string,
    userId?: string,
  ): Promise<Order> {
    const existing = await this.findOne(id, storeId);

    const patch: Partial<Order> = { status: 'paid' };
    if (paymentMethod) patch.paymentMethod = paymentMethod as any;

    // Only attribute the first time it is paid; re-marking an already-paid
    // order must not move the money to whoever clicked last.
    if (existing.status !== 'paid') {
      Object.assign(patch, await this.settlementStamp(storeId, userId));
    }

    await this.ordersRepository.update({ id }, patch);
    return this.findOne(id, storeId);
  }

  async remove(id: string, storeId?: string): Promise<void> {
    const order = await this.findOne(id, storeId);
    await this.ordersRepository.remove(order);
  }

  async findByCustomer(customerId: string, storeId?: string): Promise<Order[]> {
    const where: any = { customerId };
    if (storeId) {
      where.storeId = storeId;
    }

    return await this.ordersRepository.find({
      where,
      relations: ['customer', 'items', 'items.product', 'createdBy', 'settledBy'],
      select: ORDER_USER_SELECT,
      order: { createdAt: 'DESC' },
    });
  }

  async findByCustomerAndStatus(customerId: string, status: string, storeId?: string): Promise<Order[]> {
    const where: any = { customerId, status };
    if (storeId) {
      where.storeId = storeId;
    }

    return await this.ordersRepository.find({
      where,
      relations: ['customer', 'items', 'items.product', 'createdBy', 'settledBy'],
      select: ORDER_USER_SELECT,
      order: { createdAt: 'DESC' },
    });
  }
}
