import { Injectable, BadRequestException, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Employee, RESTAURANT_DESIGNATIONS } from '@/entities';
import { User } from '@/entities';
import { TenantService, toPage, sanitizePermissions, grantablePermissionsFor, basePermissionFor, resolvePermissions, type Page } from '@/common';
import { CreateEmployeeDto, UpdateEmployeeDto } from './dto';
import * as bcrypt from 'bcrypt';

@Injectable()
export class EmployeesService {
  constructor(
    @InjectRepository(Employee)
    private employeesRepository: Repository<Employee>,
    @InjectRepository(User)
    private usersRepository: Repository<User>,
    private tenantService: TenantService,
  ) {}

  async findAll(storeId: string, skip = 0, take = 10) {
    return await this.employeesRepository.find({
      where: { storeId },
      skip,
      take,
      order: { createdAt: 'DESC' },
      relations: ['user', 'store'],
    });
  }

  async findAllPaged(
    storeId: string,
    skip: number,
    take: number,
    search?: string,
  ): Promise<Page<Employee>> {
    const qb = this.employeesRepository
      .createQueryBuilder('employee')
      .leftJoinAndSelect('employee.user', 'user')
      .leftJoinAndSelect('employee.store', 'store')
      .where('employee.storeId = :storeId', { storeId })
      .orderBy('employee.createdAt', 'DESC')
      .skip(skip)
      .take(take);

    const term = search?.trim();
    if (term) {
      qb.andWhere(
        `("employee"."name" ILIKE :term
          OR COALESCE("employee"."email", '') ILIKE :term
          OR COALESCE("employee"."phone", '') ILIKE :term
          OR COALESCE("employee"."designation", '') ILIKE :term
          OR COALESCE("employee"."employeeId", '') ILIKE :term)`,
        { term: `%${term}%` },
      );
    }

    const [items, total] = await qb.getManyAndCount();
    return toPage(items, total, skip, take);
  }

  /**
   * Every employee on the platform, for the super-admin screen.
   *
   * Replaces an N+1 in the client that fetched the store list and then issued
   * one employees request per store, holding the whole platform in memory to
   * render one page.
   */
  async findAllAcrossStoresPaged(
    skip: number,
    take: number,
    search?: string,
    storeId?: string,
  ): Promise<Page<Employee>> {
    const qb = this.employeesRepository
      .createQueryBuilder('employee')
      .leftJoinAndSelect('employee.user', 'user')
      .leftJoinAndSelect('employee.store', 'store')
      .orderBy('employee.createdAt', 'DESC')
      .skip(skip)
      .take(take);

    // Both filters run in SQL: applied to the loaded page instead, they would
    // hide every match that happens to sit on another page.
    if (storeId) {
      qb.andWhere('employee.storeId = :storeId', { storeId });
    }

    const term = search?.trim();
    if (term) {
      qb.andWhere(
        `("employee"."name" ILIKE :term
          OR COALESCE("employee"."email", '') ILIKE :term
          OR COALESCE("employee"."employeeId", '') ILIKE :term
          OR COALESCE("store"."name", '') ILIKE :term)`,
        { term: `%${term}%` },
      );
    }

    const [items, total] = await qb.getManyAndCount();
    return toPage(items, total, skip, take);
  }

  async findOne(id: string) {
    return await this.employeesRepository.findOne({
      where: { id },
      relations: ['user', 'store'],
    });
  }

  async findByStoreAndEmployeeId(storeId: string, employeeId: string) {
    return await this.employeesRepository.findOne({
      where: { storeId, employeeId },
      relations: ['user', 'store'],
    });
  }

  /**
   * Restaurant staff must hold one of the three roles the app routes on;
   * anything else would leave them on a screen that does not exist.
   *
   * General stores are deliberately left unvalidated: `designation` has always
   * been a free-text input there, so live rows hold arbitrary titles and a
   * blanket whitelist would make those employees uneditable.
   */
  private async assertDesignationAllowed(storeId: string, designation?: string) {
    if (!designation) return;

    const store = await this.tenantService.getStore(storeId);
    if (store.accountType !== 'restaurant') return;

    const normalized = designation.trim().toLowerCase();
    if (!RESTAURANT_DESIGNATIONS.includes(normalized as any)) {
      throw new BadRequestException(
        `A restaurant employee must be one of: ${RESTAURANT_DESIGNATIONS.join(', ')}`,
      );
    }
  }

  async create(storeId: string, createEmployeeDto: CreateEmployeeDto) {
    await this.assertDesignationAllowed(storeId, createEmployeeDto.designation);

    // Check if email already exists
    const existingUser = await this.usersRepository.findOne({
      where: { email: createEmployeeDto.email },
    });

    if (existingUser) {
      throw new ConflictException('Email already exists');
    }

    // Check if employee ID already exists in this store
    const existingEmployee = await this.employeesRepository.findOne({
      where: { storeId, employeeId: createEmployeeDto.employeeId },
    });

    if (existingEmployee) {
      throw new ConflictException('Employee ID already exists in this store');
    }

    // Create user for employee
    const hashedPassword = await bcrypt.hash(createEmployeeDto.password, 10);
    const user = this.usersRepository.create({
      email: createEmployeeDto.email,
      passwordHash: hashedPassword,
      name: createEmployeeDto.name,
      phone: createEmployeeDto.phone,
      role: 'employee' as any,
      isActive: createEmployeeDto.isActive ?? true,
    });

    const savedUser = await this.usersRepository.save(user);

    // Create employee record
    const employee = this.employeesRepository.create({
      ...createEmployeeDto,
      storeId,
      userId: savedUser.id,
    });

    // Remove password and isActive from the DTO before saving to employee table
    delete (employee as any).password;
    delete (employee as any).isActive;

    return await this.employeesRepository.save(employee);
  }

  async update(id: string, updateEmployeeDto: UpdateEmployeeDto) {
    const employee = await this.employeesRepository.findOne({ where: { id } });
    
    if (!employee) {
      throw new BadRequestException(`Employee with ID ${id} not found`);
    }

    await this.assertDesignationAllowed(employee.storeId, updateEmployeeDto.designation);

    // If email is being updated, check for conflicts
    if (updateEmployeeDto.email && updateEmployeeDto.email !== employee.email) {
      const existingUser = await this.usersRepository.findOne({
        where: { email: updateEmployeeDto.email },
      });
      if (existingUser) {
        throw new ConflictException('Email already exists');
      }
    }

    // If password is being updated, hash it
    if (updateEmployeeDto.password) {
      const hashedPassword = await bcrypt.hash(updateEmployeeDto.password, 10);
      await this.usersRepository.update(employee.userId, {
        passwordHash: hashedPassword,
      });
    }

    // If isActive is being updated, update the User table
    if (updateEmployeeDto.isActive !== undefined) {
      await this.usersRepository.update(employee.userId, {
        isActive: updateEmployeeDto.isActive,
      });
    }

    // Update employee record (exclude password from employee table update)
    const { password, isActive, ...updateData } = updateEmployeeDto;

    Object.assign(employee, updateData);

    // Re-narrow the granted modules against the (possibly new) designation.
    // Promoting a waiter to cashier, or demoting one, must not leave modules
    // behind that the new role could never have been given.
    if (updateEmployeeDto.designation !== undefined && employee.permissions?.length) {
      const store = await this.tenantService.getStore(employee.storeId);
      employee.permissions = sanitizePermissions(
        store.accountType,
        employee.designation,
        employee.permissions,
      );
    }

    return await this.employeesRepository.save(employee);
  }

  /**
   * Replaces an employee's granted modules.
   *
   * The submitted list is narrowed to what the designation actually allows —
   * a kitchen hand cannot be handed the till by editing the request body — and
   * the base module is not stored, because resolvePermissions() always grants
   * it and persisting it would carry a stale base through a role change.
   */
  async setPermissions(id: string, permissions: string[]) {
    const employee = await this.employeesRepository.findOne({ where: { id } });
    if (!employee) {
      throw new BadRequestException(`Employee with ID ${id} not found`);
    }

    const store = await this.tenantService.getStore(employee.storeId);

    employee.permissions = sanitizePermissions(
      store.accountType,
      employee.designation,
      permissions,
    );

    await this.employeesRepository.save(employee);
    return this.describePermissions(employee, store.accountType);
  }

  /**
   * What this employee currently holds and what may still be ticked on.
   *
   * The grantable set is returned alongside so the client never has to
   * hard-code the designation rules — it renders whatever the server says is
   * available, and a change here reaches every client without a release.
   */
  async getPermissions(id: string) {
    const employee = await this.employeesRepository.findOne({ where: { id } });
    if (!employee) {
      throw new BadRequestException(`Employee with ID ${id} not found`);
    }
    const store = await this.tenantService.getStore(employee.storeId);
    return this.describePermissions(employee, store.accountType);
  }

  private describePermissions(employee: Employee, accountType: string) {
    return {
      employeeId: employee.id,
      designation: employee.designation,
      /** Always held; shown ticked and disabled. */
      base: basePermissionFor(accountType, employee.designation),
      /** What the owner may additionally assign. */
      grantable: grantablePermissionsFor(accountType, employee.designation),
      /** Base + granted, i.e. what this person can actually open. */
      permissions: resolvePermissions({
        role: 'employee',
        accountType,
        designation: employee.designation,
        permissions: employee.permissions,
      }),
    };
  }

  async delete(id: string) {
    const employee = await this.employeesRepository.findOne({ where: { id } });
    
    if (!employee) {
      throw new BadRequestException(`Employee with ID ${id} not found`);
    }

    // Delete the associated user
    if (employee.userId) {
      await this.usersRepository.delete(employee.userId);
    }

    await this.employeesRepository.delete(id);
    return { message: 'Employee and associated user deleted successfully' };
  }
}
