import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  Query,
  Request,
  BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { Request as ExpressRequest } from 'express';
import { OrdersService } from './orders.service';
import { CreateOrderDto, UpdateOrderDto, MarkAsPaidDto } from './dto/order.dto';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Store, Employee } from '../../entities';
import { parsePaging, parseOptionalPaging, wantsCount } from '@/common';

@ApiTags('Orders')
@Controller('orders')
export class OrdersController {
  constructor(
    private readonly ordersService: OrdersService,
    @InjectRepository(Store)
    private storesRepository: Repository<Store>,
    @InjectRepository(Employee)
    private employeesRepository: Repository<Employee>,
  ) {}

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

  @UseGuards(JwtAuthGuard)
  @Post()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a new order' })
  async create(@Body() createOrderDto: CreateOrderDto, @Request() req: ExpressRequest) {
    const storeId = await this.getStoreIdFromUser(req.user);
    return this.ordersService.create(createOrderDto, (req.user as any).id, storeId);
  }

  @UseGuards(JwtAuthGuard)
  @Get()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get all orders for store' })
  @ApiQuery({ name: 'skip', required: false, type: Number })
  @ApiQuery({ name: 'take', required: false, type: Number })
  @ApiQuery({ name: 'customerId', required: false, type: String })
  async findAll(
    @Request() req: ExpressRequest,
    @Query('skip') skip?: string,
    @Query('take') take?: string,
    @Query('customerId') customerId?: string,
    @Query('withCount') withCount?: string,
  ) {
    const storeId = await this.getStoreIdFromUser(req.user);
    if (customerId) {
      return this.ordersService.findByCustomer(customerId, storeId);
    }

    if (wantsCount(withCount)) {
      const paging = parsePaging(skip, take);
      return this.ordersService.findAllPaged(storeId, paging.skip, paging.take);
    }
    // skip/take arrive as strings; the previous code handed them to TypeORM raw.
    const paging = parseOptionalPaging(skip, take);
    return this.ordersService.findAll(storeId, paging.skip, paging.take);
  }

  @UseGuards(JwtAuthGuard)
  @Get(':id')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get order by ID' })
  @ApiResponse({ status: 403, description: 'Order belongs to another store' })
  async findOne(@Param('id') id: string, @Request() req: ExpressRequest) {
    // Previously unguarded and unscoped, so any order in the platform was
    // readable by ID. findOne() enforces the tenancy check when given a
    // storeId; admins still pass undefined and read across tenants.
    const storeId = await this.getStoreIdFromUser(req.user);
    return this.ordersService.findOne(id, storeId);
  }

  @UseGuards(JwtAuthGuard)
  @Get('customer/:customerId')
  @ApiBearerAuth()
  @ApiQuery({ name: 'storeId', required: true, type: String })
  async findByCustomer(@Request() req: ExpressRequest, @Param('customerId') customerId: string) {
    const storeId = await this.getStoreIdFromUser(req.user);
    return this.ordersService.findByCustomer(customerId, storeId);
  }

  @UseGuards(JwtAuthGuard)
  @Patch(':id')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update an order' })
  async update(
    @Request() req: ExpressRequest,
    @Param('id') id: string,
    @Body() updateOrderDto: UpdateOrderDto,
  ) {
    const storeId = await this.getStoreIdFromUser(req.user);
    return this.ordersService.update(id, updateOrderDto, storeId, (req.user as any).id);
  }

  @UseGuards(JwtAuthGuard)
  @Patch(':id/mark-as-paid')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Mark an order as paid' })
  async markAsPaid(
    @Request() req: ExpressRequest,
    @Param('id') id: string,
    @Body() markAsPaidDto: MarkAsPaidDto,
  ) {
    const storeId = await this.getStoreIdFromUser(req.user);
    return this.ordersService.markAsPaid(
      id,
      storeId,
      markAsPaidDto.paymentMethod,
      (req.user as any).id,
    );
  }

  @UseGuards(JwtAuthGuard)
  @Delete(':id')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete an order' })
  async remove(@Request() req: ExpressRequest, @Param('id') id: string) {
    const storeId = await this.getStoreIdFromUser(req.user);
    return this.ordersService.remove(id, storeId);
  }
}
