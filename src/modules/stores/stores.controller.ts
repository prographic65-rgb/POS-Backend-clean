import {
  BadRequestException,
  Controller,
  Get,
  Post,
  Body,
  Param,
  Patch,
  Delete,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  Query,
  ForbiddenException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiConsumes,
  ApiBody,
} from '@nestjs/swagger';
import { StoresService, type UploadedLogo } from './stores.service';
import { CreateStoreDto, UpdateStoreDto, UpdateStoreSettingsDto } from './dto';
import { JwtAuthGuard } from '@/auth/jwt-auth.guard';
import { Roles, RolesGuard, CurrentUser, TenantService, parsePaging, wantsCount } from '@/common';

/** 500 KB. Enforced by multer, and mirrored client-side for a better message. */
const MAX_LOGO_BYTES = 512_000;

const ALLOWED_LOGO_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

@ApiTags('Stores')
@Controller('stores')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
export class StoresController {
  constructor(
    private storesService: StoresService,
    private tenantService: TenantService,
  ) {}

  @Get()
  @Roles('super_admin')
  @ApiOperation({ summary: 'Get all stores (platform admin only)' })
  @ApiResponse({ status: 200, description: 'List of stores' })
  async getAllStores(
    @Query('skip') skip?: string,
    @Query('take') take?: string,
    @Query('withCount') withCount?: string,
  ) {
    const paging = parsePaging(skip, take, 10);
    if (wantsCount(withCount)) {
      return this.storesService.findAllPaged(paging.skip, paging.take);
    }
    return this.storesService.findAll(paging.skip, paging.take);
  }

  /**
   * Left open to any authenticated user because both clients read their own
   * store here for receipt headers (currency, address, printer). Scoped below
   * so a user cannot read another tenant's store.
   */
  @Get(':id')
  @ApiOperation({ summary: 'Get store by ID (own store, or any for platform admin)' })
  @ApiResponse({ status: 200, description: 'Store details' })
  @ApiResponse({ status: 403, description: 'Not your store' })
  @ApiResponse({ status: 404, description: 'Store not found' })
  async getStore(@Param('id') id: string, @CurrentUser() user: any) {
    const storeId = await this.tenantService.resolveStoreId(user);
    // `undefined` means platform admin, which is intentionally unscoped.
    if (storeId && storeId !== id) {
      throw new ForbiddenException('You do not have access to this store');
    }
    return this.storesService.findOne(id);
  }

  @Post()
  @Roles('super_admin')
  @ApiOperation({ summary: 'Create a store and its owner account (platform admin only)' })
  @ApiResponse({ status: 201, description: 'Store created successfully' })
  async createStore(@Body() createStoreDto: CreateStoreDto) {
    return this.storesService.create(createStoreDto);
  }

  /**
   * The owner's own store settings.
   *
   * Separate from PATCH :id, which stays platform-admin only — an owner may
   * edit their receipt header and turn shifts on, but not their own plan.
   * `@Roles` takes EFFECTIVE roles, so a restaurant owner resolves to
   * 'restaurant_owner' and would be missed by 'store_owner' alone.
   */
  @Patch(':id/settings')
  @Roles('store_owner', 'restaurant_owner', 'super_admin')
  @ApiOperation({ summary: 'Update your own store’s settings (owner)' })
  @ApiResponse({ status: 403, description: 'Not your store' })
  async updateStoreSettings(
    @Param('id') id: string,
    @CurrentUser() user: any,
    @Body() dto: UpdateStoreSettingsDto,
  ) {
    await this.tenantService.assertStoreAccess(user, id);
    return this.storesService.updateSettings(id, dto);
  }

  /**
   * Logo upload, in memory rather than to multer's disk storage.
   *
   * `diskStorage` would need `@types/multer` (absent, and multer ships none of
   * its own), and writing the file ourselves is what lets the old one be
   * removed only after the row is safely repointed.
   */
  @Post(':id/logo')
  @Roles('store_owner', 'restaurant_owner', 'super_admin')
  @UseInterceptors(
    FileInterceptor('logo', {
      limits: { fileSize: MAX_LOGO_BYTES },
      fileFilter: (_req: any, file: any, cb: any) => {
        if (!ALLOWED_LOGO_TYPES.includes(file.mimetype)) {
          // An HttpException thrown here is passed through by Nest's multer
          // wrapper, so the client gets 400 with this message rather than 500.
          return cb(new BadRequestException('Logo must be a PNG, JPEG or WebP image'), false);
        }
        cb(null, true);
      },
    }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { logo: { type: 'string', format: 'binary' } },
    },
  })
  @ApiOperation({ summary: 'Upload the store logo (owner, max 500 KB)' })
  @ApiResponse({ status: 413, description: 'Larger than 500 KB' })
  @ApiResponse({ status: 400, description: 'Not a PNG, JPEG or WebP' })
  async uploadLogo(
    @Param('id') id: string,
    @CurrentUser() user: any,
    @UploadedFile() file: UploadedLogo,
  ) {
    await this.tenantService.assertStoreAccess(user, id);
    if (!file) throw new BadRequestException('No logo file was uploaded');
    return this.storesService.saveLogo(id, file);
  }

  @Delete(':id/logo')
  @Roles('store_owner', 'restaurant_owner', 'super_admin')
  @ApiOperation({ summary: 'Remove the store logo (owner)' })
  async removeLogo(@Param('id') id: string, @CurrentUser() user: any) {
    await this.tenantService.assertStoreAccess(user, id);
    return this.storesService.removeLogo(id);
  }

  @Patch(':id')
  @Roles('super_admin')
  @ApiOperation({ summary: 'Update store (platform admin only)' })
  @ApiResponse({ status: 200, description: 'Store updated successfully' })
  async updateStore(
    @Param('id') id: string,
    @Body() updateStoreDto: UpdateStoreDto,
  ) {
    return this.storesService.update(id, updateStoreDto);
  }

  @Delete(':id')
  @Roles('super_admin')
  @ApiOperation({ summary: 'Delete store and its owner (platform admin only)' })
  @ApiResponse({ status: 200, description: 'Store deleted successfully' })
  async deleteStore(@Param('id') id: string) {
    return this.storesService.delete(id);
  }
}
