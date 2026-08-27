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
  Req,
  BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { CategoriesService } from './categories.service';
import { CreateCategoryDto, UpdateCategoryDto } from './dto/category.dto';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Store, Employee, User } from '../../entities';
import { Request } from 'express';
import { parsePaging, parseOptionalPaging, wantsCount, MAX_CATALOGUE_SIZE } from '@/common';

@ApiTags('Categories')
@Controller('categories')
export class CategoriesController {
  constructor(
    private readonly categoriesService: CategoriesService,
    @InjectRepository(Store)
    private storesRepository: Repository<Store>,
    @InjectRepository(Employee)
    private employeesRepository: Repository<Employee>,
  ) {}

  private async getStoreIdFromUser(user: any): Promise<string> {
    if (user.role === 'store_owner') {
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
  @ApiOperation({ summary: 'Create a new category' })
  @ApiResponse({ status: 201, description: 'Category created' })
  async create(@Req() req: Request, @Body() createCategoryDto: CreateCategoryDto) {
    const storeId = await this.getStoreIdFromUser(req.user);
    return this.categoriesService.create(createCategoryDto, storeId);
  }

  @Get()
  @ApiOperation({ summary: 'Get all categories for store' })
  @ApiQuery({ name: 'skip', required: false, type: Number })
  @ApiQuery({ name: 'take', required: false, type: Number })
  @ApiQuery({ name: 'storeId', required: true, type: String })
  @ApiResponse({ status: 200, description: 'List of categories' })
  findAll(
    @Query('storeId') storeId?: string,
    @Query('skip') skip?: string,
    @Query('take') take?: string,
    @Query('withCount') withCount?: string,
  ) {
    if (!storeId) throw new BadRequestException('storeId query parameter is required');

    if (wantsCount(withCount)) {
      const paging = parsePaging(skip, take);
      return this.categoriesService.findAllPaged(storeId, paging.skip, paging.take);
    }
    // Categories drive pickers too, so the whole set must come back.
    const paging = parseOptionalPaging(skip, take, MAX_CATALOGUE_SIZE);
    return this.categoriesService.findAll(storeId, paging.skip, paging.take);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get category by ID' })
  @ApiResponse({ status: 200, description: 'Category found' })
  findOne(@Param('id') id: string) {
    return this.categoriesService.findOne(id);
  }

  @UseGuards(JwtAuthGuard)
  @Patch(':id')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update a category' })
  async update(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() updateCategoryDto: UpdateCategoryDto,
  ) {
    const storeId = await this.getStoreIdFromUser(req.user);
    return this.categoriesService.update(id, updateCategoryDto, storeId);
  }

  @UseGuards(JwtAuthGuard)
  @Delete(':id')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete a category' })
  async remove(@Req() req: Request, @Param('id') id: string) {
    const storeId = await this.getStoreIdFromUser(req.user);
    return this.categoriesService.remove(id, storeId);
  }
}
