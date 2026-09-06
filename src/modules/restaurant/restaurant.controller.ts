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
import { RestaurantOrdersService, type OrderViewer } from './restaurant-orders.service';
import { RestaurantReportsService } from './restaurant-reports.service';
import {
  AddOrderItemsDto,
  CreateRestaurantOrderDto,
  CreateTableDto,
  PrintBillDto,
  SettleOrderDto,
  UpdateDraftOrderDto,
  UpdateOrderStatusDto,
  UpdateTableDto,
} from './dto';

/** Who is asking, as the orders service needs it: id plus effective role. */
const viewerOf = (user: any): OrderViewer => ({ userId: user.id, role: user.effectiveRole });

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

  /**
   * A cashier's list omits bills another cashier has printed — see
   * RestaurantOrdersService.baseQuery. Owners, waiters and the kitchen see
   * everything their filters ask for.
   */
  @Get('orders')
  @Roles('restaurant_owner', 'waiter', 'kitchen', 'cashier')
  @ApiOperation({ summary: 'List restaurant orders' })
  async listOrders(
    @CurrentUser() user: any,
    @Query('orderStatus') orderStatus?: string,
    @Query('orderType') orderType?: string,
    @Query('tableId') tableId?: string,
    @Query('search') search?: string,
    @Query('billPrinted') billPrinted?: string,
    @Query('skip') skip?: string,
    @Query('take') take?: string,
    @Query('withCount') withCount?: string,
  ) {
    const store = await this.tenantService.requireRestaurantStore(user);
    const filters = { orderStatus, orderType, tableId, search, billPrinted };
    const viewer = viewerOf(user);

    // Opt-in envelope. The kitchen and cashier live views deliberately fetch
    // the complete open set — a ticket pushed onto "page 2" is a ticket that
    // gets missed — so they call without these params and still get an array.
    if (wantsCount(withCount)) {
      return this.ordersService.findAllPaged(store.id, filters, parsePaging(skip, take), viewer);
    }
    return this.ordersService.findAll(store.id, filters, viewer);
  }

  @Get('orders/:id')
  @Roles('restaurant_owner', 'waiter', 'kitchen', 'cashier')
  @ApiOperation({ summary: 'Get one restaurant order' })
  async getOrder(@CurrentUser() user: any, @Param('id') id: string) {
    const store = await this.tenantService.requireRestaurantStore(user);
    return this.ordersService.findOne(id, store.id, viewerOf(user));
  }

  /** Waiters punch dine-in and dine-out; cashiers take takeaway and delivery. */
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

  /** Drafts are scratch, so any waiter may bin one — no money or table is involved. */
  @Delete('orders/:id/draft')
  @Roles('waiter', 'cashier', 'restaurant_owner')
  @ApiOperation({ summary: 'Discard a draft that was never sent to the kitchen' })
  @ApiResponse({ status: 409, description: 'The order is no longer a draft' })
  async discardDraft(@CurrentUser() user: any, @Param('id') id: string) {
    const store = await this.tenantService.requireRestaurantStore(user);
    return this.ordersService.discardDraft(id, store.id);
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
  @ApiOperation({
    summary: 'Append another round to a live order. Drinks lines never reach the kitchen.',
  })
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
  @ApiOperation({
    summary: 'Kitchen moves an order along: preparing, then handed over to the floor',
  })
  @ApiResponse({ status: 409, description: 'Not a legal transition from the current status' })
  async updateStatus(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() dto: UpdateOrderStatusDto,
  ) {
    const store = await this.tenantService.requireRestaurantStore(user);
    return this.ordersService.updateStatus(id, store.id, dto);
  }

  /**
   * Step one of taking payment: the bill is printed and the order is claimed
   * by this cashier. Calling it again reprints (and re-fixes the discount).
   */
  @Post('orders/:id/print-bill')
  @Roles('cashier', 'restaurant_owner')
  @ApiOperation({
    summary: 'Fix the discount, record the rider on a delivery, and claim the order for this cashier',
  })
  @ApiResponse({ status: 400, description: 'A delivery bill needs the rider name' })
  @ApiResponse({ status: 403, description: 'Another cashier already printed this bill' })
  async printBill(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() dto: PrintBillDto,
  ) {
    const store = await this.tenantService.requireRestaurantStore(user);
    return this.ordersService.printBill(id, store.id, dto, viewerOf(user));
  }

  /**
   * Step two: the money. Cash is always taken by a cashier, so the caller is
   * recorded as the settler — and, when the tenant has shifts on, must have an
   * open drawer. Only the cashier who printed the bill (or an owner) may.
   */
  @Post('orders/:id/settle')
  @Roles('cashier', 'restaurant_owner')
  @ApiOperation({ summary: 'Mark a printed bill paid, complete the order, and free the table' })
  @ApiResponse({ status: 403, description: 'Another cashier printed this bill' })
  @ApiResponse({
    status: 409,
    description: 'The bill has not been printed, or shifts are on and the cashier has none open',
  })
  async settle(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() dto: SettleOrderDto,
  ) {
    const store = await this.tenantService.requireRestaurantStore(user);
    return this.ordersService.settle(id, store.id, dto, viewerOf(user));
  }

  /** Deliberately excludes the kitchen — cancelling is a money decision. */
  @Post('orders/:id/cancel')
  @Roles('cashier', 'restaurant_owner')
  @ApiOperation({ summary: 'Cancel an order and free its table' })
  @ApiResponse({ status: 403, description: 'Another cashier printed this bill' })
  async cancel(@CurrentUser() user: any, @Param('id') id: string) {
    const store = await this.tenantService.requireRestaurantStore(user);
    return this.ordersService.cancel(id, store.id, viewerOf(user));
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
