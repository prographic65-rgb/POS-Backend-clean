import { Injectable, ConflictException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Store } from '@/entities';
import { User } from '@/entities';
import { Employee } from '@/entities';
import { CreateStoreDto, UpdateStoreDto, UpdateStoreSettingsDto } from './dto';
import { toPage, type Page } from '@/common';
import * as bcrypt from 'bcrypt';
import { promises as fs } from 'fs';
import { join, basename, extname } from 'path';

/**
 * Where uploaded files live.
 *
 * Resolved from __dirname rather than process.cwd(): production runs
 * `node dist/main` and pm2 does not guarantee the working directory. From both
 * `dist/modules/stores/` and `src/modules/stores/` this lands on
 * `POS-Backend/uploads`, which is outside `dist` — important, because the
 * `prebuild` script rimrafs `dist` on every build and would otherwise delete
 * every tenant's logo.
 */
export const UPLOAD_DIR =
  process.env.UPLOAD_DIR ?? join(__dirname, '..', '..', '..', 'uploads');

export const LOGO_DIR = join(UPLOAD_DIR, 'logo');

/** Public path prefix; mirrored by useStaticAssets() in main.ts. */
const LOGO_URL_PREFIX = '/uploads/logo/';

const LOGO_EXTENSIONS: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
};

/**
 * Narrows the eagerly-joined owner to what a client may see.
 *
 * `User.passwordHash` carries no `select: false` on the entity, so a plain
 * `relations: ['owner']` puts the owner's bcrypt hash in the response — and
 * GET /stores/:id is deliberately open to every employee of the tenant.
 */
const STORE_OWNER_SELECT = {
  owner: { id: true, name: true, email: true, phone: true, role: true, isActive: true },
} as const;

/** The subset of a multer file this service needs, typed locally. */
export interface UploadedLogo {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
  size: number;
}

@Injectable()
export class StoresService {
  constructor(
    @InjectRepository(Store)
    private storesRepository: Repository<Store>,
    @InjectRepository(User)
    private usersRepository: Repository<User>,
    @InjectRepository(Employee)
    private employeesRepository: Repository<Employee>,
  ) {}

  async findAll(skip = 0, take = 10) {
    return await this.storesRepository.find({
      skip,
      take,
      order: { createdAt: 'DESC' },
      relations: ['owner'],
      // `User.passwordHash` has no `select: false`, and GET /stores/:id is
      // readable by every employee of the tenant — without this the owner's
      // bcrypt hash is in the response that builds the receipt header.
      select: STORE_OWNER_SELECT,
    });
  }

  async findAllPaged(skip: number, take: number): Promise<Page<Store>> {
    const [items, total] = await this.storesRepository.findAndCount({
      skip,
      take,
      order: { createdAt: 'DESC' },
      relations: ['owner'],
      select: STORE_OWNER_SELECT,
    });
    return toPage(items, total, skip, take);
  }

  async findOne(id: string) {
    return await this.storesRepository.findOne({
      where: { id },
      relations: ['owner'],
      // `User.passwordHash` has no `select: false`, and GET /stores/:id is
      // readable by every employee of the tenant — without this the owner's
      // bcrypt hash is in the response that builds the receipt header.
      select: STORE_OWNER_SELECT,
    });
  }

  async create(createStoreDto: CreateStoreDto) {
    // Check if email already exists
    const existingUser = await this.usersRepository.findOne({
      where: { email: createStoreDto.email },
    });

    if (existingUser) {
      throw new ConflictException('Email already exists');
    }

    // Create user for store owner
    const hashedPassword = await bcrypt.hash(createStoreDto.password, 10);
    const user = this.usersRepository.create({
      name: createStoreDto.name,
      phone: createStoreDto.phone,
      email: createStoreDto.email,
      passwordHash: hashedPassword,
      role: 'store_owner' as any,
      isActive: true,
    });

    const savedUser = await this.usersRepository.save(user);

    // Create store with userId reference
    const store = this.storesRepository.create({
      ...createStoreDto,
      userId: savedUser.id,
    });

    // Remove password from the DTO before saving to store
    delete (store as any).password;

    return await this.storesRepository.save(store);
  }

  async update(id: string, updateStoreDto: UpdateStoreDto) {
    const store = await this.storesRepository.findOne({ where: { id } });
    if (!store) {
      throw new BadRequestException(`Store with ID ${id} not found`);
    }
    Object.assign(store, updateStoreDto);
    return await this.storesRepository.save(store);
  }

  /**
   * The owner-writable slice of a store.
   *
   * `shiftsEnabled` is gated on account type here rather than in the DTO: the
   * general POS has no "open your shift" widget, so letting a general store
   * turn it on would be an unusable state.
   */
  async updateSettings(id: string, dto: UpdateStoreSettingsDto) {
    const store = await this.storesRepository.findOne({ where: { id } });
    if (!store) {
      throw new BadRequestException(`Store with ID ${id} not found`);
    }

    if (dto.shiftsEnabled === true && store.accountType !== 'restaurant') {
      throw new BadRequestException(
        'Cashier shifts are only available on restaurant accounts',
      );
    }

    Object.assign(store, dto);
    return await this.storesRepository.save(store);
  }

  /**
   * Stores a tenant logo on disk and points the store row at it.
   *
   * Written to disk rather than the database: a base64 column would be read on
   * every `GET /stores/:id` (which both clients call to build receipt headers)
   * and inflate every one of those responses by ~700 KB.
   */
  async saveLogo(id: string, file: UploadedLogo) {
    const store = await this.storesRepository.findOne({ where: { id } });
    if (!store) {
      throw new BadRequestException(`Store with ID ${id} not found`);
    }

    const extension = LOGO_EXTENSIONS[file.mimetype];
    if (!extension) {
      throw new BadRequestException('Logo must be a PNG, JPEG or WebP image');
    }

    await fs.mkdir(LOGO_DIR, { recursive: true });

    // Timestamped so a replacement gets a new URL — a stable filename would be
    // served stale from the browser and CDN caches for as long as maxAge says.
    const filename = `${id}-${Date.now()}${extension}`;
    await fs.writeFile(join(LOGO_DIR, filename), file.buffer);

    const previous = store.logoUrl;
    store.logoUrl = LOGO_URL_PREFIX + filename;
    const saved = await this.storesRepository.save(store);

    // Only after the row points at the new file, so a failed unlink cannot
    // leave the store referencing a logo that is gone.
    await this.removeLogoFile(previous);

    return saved;
  }

  async removeLogo(id: string) {
    const store = await this.storesRepository.findOne({ where: { id } });
    if (!store) {
      throw new BadRequestException(`Store with ID ${id} not found`);
    }

    const previous = store.logoUrl;
    store.logoUrl = null;
    const saved = await this.storesRepository.save(store);
    await this.removeLogoFile(previous);

    return saved;
  }

  /**
   * Deletes a previously stored logo, tolerating a missing file.
   *
   * `basename` is not decoration: the path comes from a database column, and
   * joining an unsanitised value onto LOGO_DIR is how a stray '../' turns a
   * cleanup into deleting something else.
   */
  private async removeLogoFile(logoUrl?: string | null) {
    if (!logoUrl || !logoUrl.startsWith(LOGO_URL_PREFIX)) return;

    const name = basename(logoUrl);
    if (!name || !extname(name)) return;

    await fs.unlink(join(LOGO_DIR, name)).catch(() => {
      // Already gone, or never written. Nothing to recover from.
    });
  }

  async delete(id: string) {
    const store = await this.storesRepository.findOne({ where: { id } });
    if (!store) {
      throw new BadRequestException(`Store with ID ${id} not found`);
    }

    const employees = await this.employeesRepository.find({
      where: { storeId: id },
    });
    console.log(`Deleting ${employees.length} employees associated with store ID ${id}`);

    for (const employee of employees) {
      if (employee.userId) {
        await this.employeesRepository.delete(employee.id);
        await this.usersRepository.delete(employee.userId);
      }
    }

    await this.employeesRepository.delete({ storeId: id });
    const result = await this.storesRepository.delete(id);

    if (store.userId) {
      await this.usersRepository.delete(store.userId);
    }

    if (result.affected === 0) {
      throw new BadRequestException(`Store with ID ${id} not found`);
    }
    return { message: 'Store and associated user deleted successfully' };
  }
}
