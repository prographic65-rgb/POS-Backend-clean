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
  parseOptionalPaging,
  wantsCount,
} from '@/common';
import { ExpensesService } from './expenses.service';
import { ExpenseCategoriesService } from './expense-categories.service';
import {
  CreateExpenseDto,
  UpdateExpenseDto,
  CreateExpenseCategoryDto,
  UpdateExpenseCategoryDto,
} from './dto';

/**
 * The store's spend ledger.
 *
 * Expenses are STORE-scoped, so everyone holding the module sees the same
 * ledger — this is the business's book, not a personal one. `createdById`
 * records who entered a row, but confers no special rights over it.
 *
 * Access is by module, not role: an owner always holds `expenses`
 * (owner permissions are derived from the account type), and staff hold it
 * only once the owner ticks it on. Categories are the exception — they stay
 * owner-only via @Roles, because they are the shape of the ledger rather than
 * entries in it.
 */
@ApiTags('Expenses')
@ApiBearerAuth()
@Controller('expenses')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
export class ExpensesController {
  constructor(
    private expensesService: ExpensesService,
    private categoriesService: ExpenseCategoriesService,
    private tenantService: TenantService,
  ) {}

  // -------------------------------------------------------- categories
  // Declared before the ':id' routes below: Nest matches in declaration
  // order, so 'categories' would otherwise be captured as an expense id.

  @Get('categories')
  @RequirePermissions('expenses')
  @ApiOperation({ summary: 'List expense categories for the caller’s store' })
  @ApiQuery({ name: 'includeInactive', required: false, type: Boolean })
  async listCategories(
    @CurrentUser() user: any,
    @Query('includeInactive') includeInactive?: string,
    @Query('skip') skip?: string,
    @Query('take') take?: string,
    @Query('withCount') withCount?: string,
  ) {
    const storeId = await this.tenantService.requireStoreId(user);
    const all = includeInactive === 'true';

    if (wantsCount(withCount)) {
      const paging = parsePaging(skip, take);
      return this.categoriesService.findAllPaged(storeId, paging.skip, paging.take, all);
    }
    // Unpaged by default: this feeds the expense form's picker, which has to
    // offer the complete list rather than a page of it.
    return this.categoriesService.findAll(storeId, all);
  }

  @Post('categories')
  @Roles('store_owner', 'restaurant_owner', 'super_admin')
  @ApiOperation({ summary: 'Create an expense category (owner only)' })
  @ApiResponse({ status: 409, description: 'A category with that name already exists' })
  async createCategory(@CurrentUser() user: any, @Body() dto: CreateExpenseCategoryDto) {
    const storeId = await this.tenantService.requireStoreId(user);
    return this.categoriesService.create(storeId, dto);
  }

  @Patch('categories/:id')
  @Roles('store_owner', 'restaurant_owner', 'super_admin')
  @ApiOperation({ summary: 'Rename or retire an expense category (owner only)' })
  async updateCategory(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() dto: UpdateExpenseCategoryDto,
  ) {
    const storeId = await this.tenantService.requireStoreId(user);
    return this.categoriesService.update(id, storeId, dto);
  }

  @Delete('categories/:id')
  @Roles('store_owner', 'restaurant_owner', 'super_admin')
  @ApiOperation({ summary: 'Delete an expense category (owner only)' })
  @ApiResponse({ status: 200, description: 'Deleted; its expenses become uncategorized' })
  async removeCategory(@CurrentUser() user: any, @Param('id') id: string) {
    const storeId = await this.tenantService.requireStoreId(user);
    return this.categoriesService.remove(id, storeId);
  }

  // ----------------------------------------------------------- summary

  @Get('summary')
  @RequirePermissions('expenses')
  @ApiOperation({ summary: "Today's and this month's spend, for the dashboard" })
  @ApiQuery({
    name: 'date',
    required: false,
    description: "The client's local calendar day (YYYY-MM-DD). Defaults to the server's.",
  })
  async summary(@CurrentUser() user: any, @Query('date') date?: string) {
    const storeId = await this.tenantService.requireStoreId(user);
    // Anything not date-shaped is ignored rather than rejected — a bad param
    // should not take the dashboard down.
    const day = /^\d{4}-\d{2}-\d{2}$/.test(date ?? '') ? date : undefined;
    return this.expensesService.summary(storeId, day);
  }

  // ---------------------------------------------------------- expenses

  @Get()
  @RequirePermissions('expenses')
  @ApiOperation({ summary: 'List expenses' })
  @ApiQuery({ name: 'from', required: false, description: 'Inclusive start day, YYYY-MM-DD' })
  @ApiQuery({ name: 'to', required: false, description: 'Inclusive end day, YYYY-MM-DD' })
  @ApiQuery({ name: 'categoryId', required: false, description: "Category id, or 'none'" })
  @ApiQuery({ name: 'search', required: false })
  async list(
    @CurrentUser() user: any,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('categoryId') categoryId?: string,
    @Query('search') search?: string,
    @Query('skip') skip?: string,
    @Query('take') take?: string,
    @Query('withCount') withCount?: string,
  ) {
    const storeId = await this.tenantService.requireStoreId(user);
    const filters = { from, to, categoryId, search };

    if (wantsCount(withCount)) {
      const paging = parsePaging(skip, take);
      return this.expensesService.findAllPaged(storeId, paging.skip, paging.take, filters);
    }
    const paging = parseOptionalPaging(skip, take);
    return this.expensesService.findAll(storeId, filters, paging.skip, paging.take);
  }

  @Get(':id')
  @RequirePermissions('expenses')
  @ApiOperation({ summary: 'Get one expense' })
  async findOne(@CurrentUser() user: any, @Param('id') id: string) {
    const storeId = await this.tenantService.requireStoreId(user);
    return this.expensesService.findOne(id, storeId);
  }

  @Post()
  @RequirePermissions('expenses')
  @ApiOperation({ summary: 'Record an expense' })
  async create(@CurrentUser() user: any, @Body() dto: CreateExpenseDto) {
    const storeId = await this.tenantService.requireStoreId(user);
    return this.expensesService.create(storeId, dto, user.id);
  }

  @Patch(':id')
  @RequirePermissions('expenses')
  @ApiOperation({ summary: 'Update an expense' })
  async update(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() dto: UpdateExpenseDto,
  ) {
    const storeId = await this.tenantService.requireStoreId(user);
    return this.expensesService.update(id, storeId, dto);
  }

  @Delete(':id')
  @RequirePermissions('expenses')
  @ApiOperation({ summary: 'Delete an expense' })
  async remove(@CurrentUser() user: any, @Param('id') id: string) {
    const storeId = await this.tenantService.requireStoreId(user);
    return this.expensesService.remove(id, storeId);
  }
}
