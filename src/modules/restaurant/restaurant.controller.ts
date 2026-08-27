import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { JwtAuthGuard } from '@/auth/jwt-auth.guard';
import { Roles, RolesGuard, CurrentUser, TenantService, parsePaging, wantsCount } from '@/common';
import { TablesService } from './tables.service';
import { RestaurantOrdersService } from './restaurant-orders.service';
import { RestaurantReportsService } from './restaurant-reports.service';
import {
  AddOrderItemsDto,
  CreateRestaurantOrderDto,
  CreateTableDto,
  SettleOrderDto,
  UpdateDraftOrderDto,
  UpdateOrderStatusDto,
  UpdateTableDto,
} from './dto';

/**
 * Every route is gated twice: RolesGuard checks the effective role, and
 * `requireRestaurantStore` rejects a general tenant outright, so these
 * endpoints cannot be used to mutate a general store's data.
 */
@ApiTags('Restaurant')
@ApiBearerAuth()
@Controller('restaurant')
@UseGuards(JwtAuthGuard, RolesGuard)
export class RestaurantController {
  constructor(
    private tablesService: TablesService,
    private ordersService: RestaurantOrdersService,
    private reportsService: RestaurantReportsService,
    private tenantService: TenantService,
  ) {}

  // ------------------------------------------------------------- tables

  @Get('tables')
  @Roles('restaurant_owner', 'waiter', 'kitchen', 'cashier')
  @ApiOperation({ summary: 'List tables with their live status' })
  async listTables(@CurrentUser() user: any, @Query('includeInactive') includeInactive?: string) {
    const store = await this.tenantService.requireRestaurantStore(user);
    return this.tablesService.findAll(store.id, includeInactive === 'true');
  }

  @Post('tables')
  @Roles('restaurant_owner')
  @ApiOperation({ summary: 'Add a table' })
  @ApiResponse({ status: 409, description: 'A table with that name already exists' })
  async createTable(@CurrentUser() user: any, @Body() dto: CreateTableDto) {
    const store = await this.tenantService.requireRestaurantStore(user);
    return this.tablesService.create(store.id, dto);
  }

  @Patch('tables/:id')
  @Roles('restaurant_owner')
  @ApiOperation({ summary: 'Rename or reactivate a table' })
  async updateTable(@CurrentUser() user: any, @Param('id') id: string, @Body() dto: UpdateTableDto) {
    const store = await this.tenantService.requireRestaurantStore(user);
    return this.tablesService.update(id, store.id, dto);
  }

  @Delete('tables/:id')
  @Roles('restaurant_owner')
  @ApiOperation({ summary: 'Remove a table (soft delete)' })
  async removeTable(@CurrentUser() user: any, @Param('id') id: string) {
    const store = await this.tenantService.requireRestaurantStore(user);
    return this.tablesService.deactivate(id, store.id);
  }

  // ------------------------------------------------------------- orders

  @Get('orders')
  @Roles('restaurant_owner', 'waiter', 'kitchen', 'cashier')
  @ApiOperation({ summary: 'List restaurant orders' })
  async listOrders(
    @CurrentUser() user: any,
    @Query('orderStatus') orderStatus?: string,
    @Query('orderType') orderType?: string,
    @Query('tableId') tableId?: string,
    @Query('search') search?: string,
    @Query('skip') skip?: string,
    @Query('take') take?: string,
    @Query('withCount') withCount?: string,
  ) {
    const store = await this.tenantService.requireRestaurantStore(user);
    const filters = { orderStatus, orderType, tableId, search };

    // Opt-in envelope. The kitchen and cashier live views deliberately fetch
    // the complete open set — a ticket pushed onto "page 2" is a ticket that
    // gets missed — so they call without these params and still get an array.
    if (wantsCount(withCount)) {
      return this.ordersService.findAllPaged(store.id, filters, parsePaging(skip, take));
    }
    return this.ordersService.findAll(store.id, filters);
  }

  @Get('orders/:id')
  @Roles('restaurant_owner', 'waiter', 'kitchen', 'cashier')
  @ApiOperation({ summary: 'Get one restaurant order' })
  async getOrder(@CurrentUser() user: any, @Param('id') id: string) {
    const store = await this.tenantService.requireRestaurantStore(user);
    return this.ordersService.findOne(id, store.id);
  }

  /** Waiters punch dine-in; cashiers take takeaway and delivery. */
  @Post('orders')
  @Roles('waiter', 'cashier', 'restaurant_owner')
  @ApiOperation({ summary: 'Create an order, as a draft or sent to the kitchen' })
  @ApiResponse({ status: 409, description: 'The table was claimed by another order' })
  async createOrder(@CurrentUser() user: any, @Body() dto: CreateRestaurantOrderDto) {
    const store = await this.tenantService.requireRestaurantStore(user);
    return this.ordersService.create(store.id, user.id, dto);
  }

  @Patch('orders/:id/draft')
  @Roles('waiter', 'cashier', 'restaurant_owner')
  @ApiOperation({ summary: 'Edit a shared draft' })
  @ApiResponse({ status: 409, description: 'Another waiter changed this draft' })
  async updateDraft(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() dto: UpdateDraftOrderDto,
  ) {
    const store = await this.tenantService.requireRestaurantStore(user);
    return this.ordersService.updateDraft(id, store.id, dto);
  }

  @Post('orders/:id/punch')
  @Roles('waiter', 'cashier', 'restaurant_owner')
  @ApiOperation({ summary: 'Send a draft to the kitchen and claim its table' })
  @ApiResponse({ status: 409, description: 'The table was claimed by another order' })
  async punch(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() body: { tableId?: string },
  ) {
    const store = await this.tenantService.requireRestaurantStore(user);
    return this.ordersService.punchDraft(id, store.id, body?.tableId);
  }

  @Post('orders/:id/items')
  @Roles('waiter', 'cashier', 'restaurant_owner')
  @ApiOperation({ summary: 'Append another round to a live order' })
  async addItems(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() dto: AddOrderItemsDto,
  ) {
    const store = await this.tenantService.requireRestaurantStore(user);
    return this.ordersService.addItems(id, store.id, dto);
  }

  @Patch('orders/:id/status')
  @Roles('kitchen', 'restaurant_owner')
  @ApiOperation({ summary: 'Kitchen moves an order to preparing' })
  async updateStatus(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() dto: UpdateOrderStatusDto,
  ) {
    const store = await this.tenantService.requireRestaurantStore(user);
    return this.ordersService.updateStatus(id, store.id, dto);
  }

  @Post('orders/:id/settle')
  @Roles('cashier', 'restaurant_owner')
  @ApiOperation({ summary: 'Apply a discount, take payment, complete, and free the table' })
  async settle(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() dto: SettleOrderDto,
  ) {
    const store = await this.tenantService.requireRestaurantStore(user);
    return this.ordersService.settle(id, store.id, dto);
  }

  /** Deliberately excludes the kitchen — cancelling is a money decision. */
  @Post('orders/:id/cancel')
  @Roles('cashier', 'restaurant_owner')
  @ApiOperation({ summary: 'Cancel an order and free its table' })
  async cancel(@CurrentUser() user: any, @Param('id') id: string) {
    const store = await this.tenantService.requireRestaurantStore(user);
    return this.ordersService.cancel(id, store.id);
  }

  // ------------------------------------------------------------ reports

  @Get('reports/sales')
  @Roles('restaurant_owner')
  @ApiOperation({ summary: 'Sales and profit for the owner dashboard' })
  async sales(
    @CurrentUser() user: any,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const store = await this.tenantService.requireRestaurantStore(user);
    return this.reportsService.sales(store.id, from, to);
  }
}
