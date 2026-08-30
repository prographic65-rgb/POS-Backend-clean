import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery, ApiResponse } from '@nestjs/swagger';
import { JwtAuthGuard } from '@/auth/jwt-auth.guard';
import {
  CurrentUser,
  RequirePermissions,
  PermissionsGuard,
  Roles,
  RolesGuard,
  TenantService,
  parsePaging,
  wantsCount,
} from '@/common';
import { ShiftsService } from './shifts.service';
import {
  CloseShiftDto,
  CollectShiftDto,
  ForceCloseShiftDto,
  OpenShiftDto,
} from './dto';

/**
 * Cashier shifts — who is at the till, and what they owe at the end of it.
 *
 * A shift is one person's window of accountability over a drawer. Every
 * payment taken while it is open is stamped onto it, so several cashiers can
 * work the same day and each hand over exactly what they collected.
 *
 * Access follows the codebase's split: cashier-facing routes are gated on the
 * `cashier` MODULE (an owner holds it too, since they staff the till
 * themselves), while anything that reviews or overrides another person's
 * drawer is gated on the owner ROLE.
 *
 * Restaurant-only for now — `requireRestaurantStore` rejects general tenants,
 * whose POS has no till widget yet.
 */
@ApiTags('Shifts')
@ApiBearerAuth()
@Controller('shifts')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
export class ShiftsController {
  constructor(
    private shiftsService: ShiftsService,
    private tenantService: TenantService,
  ) {}

  // Literal paths are declared BEFORE ':id'. Nest matches in declaration
  // order, so 'current' / 'mine' / 'summary' would otherwise be captured as
  // a shift id — the same trap documented in ExpensesController.

  @Get('current')
  @RequirePermissions('cashier')
  @ApiOperation({ summary: 'My open shift with live totals, or null' })
  async current(@CurrentUser() user: any) {
    const store = await this.tenantService.requireRestaurantStore(user);
    return this.shiftsService.current(store.id, user.id);
  }

  @Get('mine')
  @RequirePermissions('cashier')
  @ApiOperation({ summary: 'My own shift history' })
  async mine(
    @CurrentUser() user: any,
    @Query('skip') skip?: string,
    @Query('take') take?: string,
    @Query('withCount') withCount?: string,
  ) {
    const store = await this.tenantService.requireRestaurantStore(user);
    const filters = { userId: user.id };

    if (wantsCount(withCount)) {
      return this.shiftsService.findAllPaged(store.id, filters, parsePaging(skip, take));
    }
    return this.shiftsService.findAll(store.id, filters);
  }

  @Get('me/dashboard')
  @RequirePermissions('cashier')
  @ApiOperation({ summary: "This cashier's own collections, by payment method" })
  @ApiQuery({ name: 'from', required: false, description: 'ISO datetime; filters on settledAt' })
  @ApiQuery({ name: 'to', required: false, description: 'ISO datetime; filters on settledAt' })
  async myDashboard(
    @CurrentUser() user: any,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const store = await this.tenantService.requireRestaurantStore(user);
    return this.shiftsService.myDashboard(store.id, user.id, from, to);
  }

  @Get('summary/by-cashier')
  @Roles('store_owner', 'restaurant_owner', 'super_admin')
  @ApiOperation({ summary: 'One row per cashier: takings, variance and what is still to collect' })
  @ApiQuery({ name: 'from', required: false, description: 'ISO datetime; filters on openedAt' })
  @ApiQuery({ name: 'to', required: false, description: 'ISO datetime; filters on openedAt' })
  async summaryByCashier(
    @CurrentUser() user: any,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const store = await this.tenantService.requireRestaurantStore(user);
    return this.shiftsService.summaryByCashier(store.id, from, to);
  }

  @Get()
  @Roles('store_owner', 'restaurant_owner', 'super_admin')
  @ApiOperation({ summary: 'All shifts for the store (owner)' })
  @ApiQuery({ name: 'status', required: false, enum: ['open', 'closed', 'collected'] })
  @ApiQuery({ name: 'userId', required: false })
  async list(
    @CurrentUser() user: any,
    @Query('status') status?: 'open' | 'closed' | 'collected',
    @Query('userId') userId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('skip') skip?: string,
    @Query('take') take?: string,
    @Query('withCount') withCount?: string,
  ) {
    const store = await this.tenantService.requireRestaurantStore(user);
    const filters = { status, userId, from, to };

    if (wantsCount(withCount)) {
      return this.shiftsService.findAllPaged(store.id, filters, parsePaging(skip, take));
    }
    return this.shiftsService.findAll(store.id, filters);
  }

  @Post('open')
  @RequirePermissions('cashier')
  @ApiOperation({ summary: 'Open my drawer for the day' })
  @ApiResponse({ status: 409, description: 'Shifts are off, or one is already open' })
  async open(@CurrentUser() user: any, @Body() dto: OpenShiftDto) {
    const store = await this.tenantService.requireRestaurantStore(user);
    return this.shiftsService.open(store.id, user.id, dto.openingFloat ?? 0);
  }

  /**
   * The shift, its frozen (or live) totals, AND the orders settled during it.
   *
   * One endpoint for two readers: a cashier reviewing their own drawer, and an
   * owner drilling into someone else's. The service rejects a cashier asking
   * for a shift that is not theirs.
   */
  @Get(':id')
  @RequirePermissions('cashier')
  @ApiOperation({ summary: 'One shift with its totals and the orders settled in it' })
  @ApiResponse({ status: 403, description: 'Not your shift' })
  async findOne(@CurrentUser() user: any, @Param('id') id: string) {
    const store = await this.tenantService.requireRestaurantStore(user);
    const shift = await this.shiftsService.findOne(id, store.id, user);
    const orders = await this.shiftsService.ordersForShift(store.id, id);
    return { ...shift, orders };
  }

  @Post(':id/close')
  @RequirePermissions('cashier')
  @ApiOperation({ summary: 'Count the drawer and close the shift' })
  @ApiResponse({ status: 409, description: 'Already closed' })
  async close(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() dto: CloseShiftDto,
  ) {
    const store = await this.tenantService.requireRestaurantStore(user);
    return this.shiftsService.close(id, store.id, user, dto);
  }

  /**
   * For the cashier who went home without closing. The variance is recorded as
   * unknown rather than zero — nobody counted the drawer.
   */
  @Post(':id/force-close')
  @Roles('store_owner', 'restaurant_owner', 'super_admin')
  @ApiOperation({ summary: 'Owner closes a shift the cashier left open' })
  async forceClose(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() dto: ForceCloseShiftDto,
  ) {
    const store = await this.tenantService.requireRestaurantStore(user);
    return this.shiftsService.close(id, store.id, user, {
      countedCash: null,
      notes: dto.notes,
    });
  }

  @Post(':id/collect')
  @Roles('store_owner', 'restaurant_owner', 'super_admin')
  @ApiOperation({ summary: 'Owner confirms the cash was handed over' })
  @ApiResponse({ status: 409, description: 'Shift is still open, or already collected' })
  async collect(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() dto: CollectShiftDto,
  ) {
    const store = await this.tenantService.requireRestaurantStore(user);
    return this.shiftsService.collect(id, store.id, user, dto);
  }
}
