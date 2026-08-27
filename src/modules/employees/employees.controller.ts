import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Patch,
  Delete,
  UseGuards,
  Query,
  Request,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { EmployeesService } from './employees.service';
import { CreateEmployeeDto, UpdateEmployeeDto, UpdatePermissionsDto } from './dto';
import { JwtAuthGuard } from '@/auth/jwt-auth.guard';
import { Roles, RolesGuard, CurrentUser, TenantService, parsePaging, wantsCount } from '@/common';

@ApiTags('Employees')
@Controller('employees')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
export class EmployeesController {
  constructor(
    private employeesService: EmployeesService,
    private tenantService: TenantService,
  ) {}

  @Get()
  @Roles('super_admin')
  @ApiOperation({ summary: 'List employees across every store (platform admin only)' })
  async listAll(
    @Query('skip') skip?: string,
    @Query('take') take?: string,
    @Query('search') search?: string,
    @Query('storeId') storeId?: string,
  ) {
    const paging = parsePaging(skip, take);
    return this.employeesService.findAllAcrossStoresPaged(
      paging.skip, paging.take, search, storeId,
    );
  }

  @Get('store/:storeId')
  @ApiOperation({ summary: 'Get all employees for a store' })
  @ApiResponse({ status: 200, description: 'List of employees' })
  @ApiResponse({ status: 403, description: 'Not your store' })
  async getStoreEmployees(
    @Param('storeId') storeId: string,
    @CurrentUser() user: any,
    @Query('skip') skip?: string,
    @Query('take') take?: string,
    @Query('withCount') withCount?: string,
    @Query('search') search?: string,
  ) {
    // storeId is a route param, so it must be checked against the caller
    // rather than trusted.
    await this.tenantService.assertStoreAccess(user, storeId);

    const paging = parsePaging(skip, take, 10);
    if (wantsCount(withCount)) {
      return this.employeesService.findAllPaged(storeId, paging.skip, paging.take, search);
    }
    return this.employeesService.findAll(storeId, paging.skip, paging.take);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get employee by ID' })
  @ApiResponse({ status: 200, description: 'Employee details' })
  @ApiResponse({ status: 404, description: 'Employee not found' })
  async getEmployee(@Param('id') id: string, @CurrentUser() user: any) {
    const employee = await this.employeesService.findOne(id);
    if (employee) {
      await this.tenantService.assertStoreAccess(user, employee.storeId);
    }
    return employee;
  }

  @Post('store/:storeId')
  @Roles('super_admin', 'store_owner', 'restaurant_owner')
  @ApiOperation({ summary: 'Create new employee for a store' })
  @ApiResponse({ status: 201, description: 'Employee created successfully' })
  @ApiResponse({ status: 403, description: 'Not your store' })
  async createEmployee(
    @Param('storeId') storeId: string,
    @Body() createEmployeeDto: CreateEmployeeDto,
    @CurrentUser() user: any,
  ) {
    await this.tenantService.assertStoreAccess(user, storeId);
    return this.employeesService.create(storeId, createEmployeeDto);
  }

  @Patch(':id')
  @Roles('super_admin', 'store_owner', 'restaurant_owner')
  @ApiOperation({ summary: 'Update employee' })
  @ApiResponse({ status: 200, description: 'Employee updated successfully' })
  async updateEmployee(
    @Param('id') id: string,
    @Body() updateEmployeeDto: UpdateEmployeeDto,
    @CurrentUser() user: any,
  ) {
    const employee = await this.employeesService.findOne(id);
    if (employee) {
      await this.tenantService.assertStoreAccess(user, employee.storeId);
    }
    return this.employeesService.update(id, updateEmployeeDto);
  }

  @Get(':id/permissions')
  @Roles('super_admin', 'store_owner', 'restaurant_owner')
  @ApiOperation({ summary: "An employee's granted modules and what else may be assigned" })
  async getPermissions(@Param('id') id: string, @CurrentUser() user: any) {
    const employee = await this.employeesService.findOne(id);
    if (employee) {
      await this.tenantService.assertStoreAccess(user, employee.storeId);
    }
    return this.employeesService.getPermissions(id);
  }

  /**
   * Owner-only by design: @Roles here is the whole point of the feature.
   * Staff who hold the employees-adjacent modules still cannot widen their own
   * access, because reaching this route at all requires being the owner.
   */
  @Patch(':id/permissions')
  @Roles('super_admin', 'store_owner', 'restaurant_owner')
  @ApiOperation({ summary: 'Replace an employee\'s granted modules (owner only)' })
  @ApiResponse({ status: 200, description: 'The resulting permission set' })
  async updatePermissions(
    @Param('id') id: string,
    @Body() dto: UpdatePermissionsDto,
    @CurrentUser() user: any,
  ) {
    const employee = await this.employeesService.findOne(id);
    if (employee) {
      await this.tenantService.assertStoreAccess(user, employee.storeId);
    }
    return this.employeesService.setPermissions(id, dto.permissions);
  }

  @Delete(':id')
  @Roles('super_admin', 'store_owner', 'restaurant_owner')
  @ApiOperation({ summary: 'Delete employee' })
  @ApiResponse({ status: 200, description: 'Employee deleted successfully' })
  async deleteEmployee(@Param('id') id: string, @CurrentUser() user: any) {
    const employee = await this.employeesService.findOne(id);
    if (employee) {
      await this.tenantService.assertStoreAccess(user, employee.storeId);
    }
    return this.employeesService.delete(id);
  }
}
