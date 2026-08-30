import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { User, Store, Employee } from '../entities';
import { RefreshTokenService } from './refresh-token.service';
import { resolveEffectiveRole } from '../common/roles';
import { resolvePermissions } from '../common/permissions';

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User)
    private usersRepository: Repository<User>,
    @InjectRepository(Store)
    private storesRepository: Repository<Store>,
    @InjectRepository(Employee)
    private employeesRepository: Repository<Employee>,
    private jwtService: JwtService,
    private refreshTokenService: RefreshTokenService,
  ) {}

  async validateUser(email: string, password: string): Promise<any> {
    const user = await this.usersRepository.findOne({ where: { email } });
    if (user && (await bcrypt.compare(password, user.passwordHash))) {
      const { passwordHash, ...result } = user;
      return result;
    }
    return null;
  }

  async getUserWithStore(user: any) {
    let storeId: string | undefined;
    let storeName: string | undefined;
    let currency: string | undefined;
    let printerConfig: string | undefined;
    let accountType: string | undefined;
    let designation: string | undefined;
    let printerName: string | undefined;
    let logoUrl: string | undefined | null;
    let shiftsEnabled: boolean | undefined;
    let storedPermissions: string[] | null = null;

    if (user.role === 'store_owner') {
      const store = await this.storesRepository.findOne({ where: { userId: user.id } });
      storeId = store?.id;
      storeName = store?.name;
      currency = store?.currency;
      printerConfig = store?.printerConfig;
      accountType = store?.accountType;
      logoUrl = store?.logoUrl;
      shiftsEnabled = store?.shiftsEnabled;
    } else if (user.role === 'employee' || user.role === 'cashier') {
      const employee = await this.employeesRepository.findOne({ where: { userId: user.id } });
      storeId = employee?.storeId;
      designation = employee?.designation;
      printerName = employee?.printerName;
      storedPermissions = employee?.permissions ?? null;
      if (storeId) {
        const store = await this.storesRepository.findOne({ where: { id: storeId } });
        storeName = store?.name;
        currency = store?.currency;
        printerConfig = store?.printerConfig;
        accountType = store?.accountType;
        logoUrl = store?.logoUrl;
        shiftsEnabled = store?.shiftsEnabled;
      }
    }

    // Never let the bcrypt hash escape. This object becomes `req.user` via
    // JwtStrategy.validate() AND the body of GET /auth/me, so stripping it
    // here closes both at once.
    const { passwordHash, ...safeUser } = user;

    return {
      ...safeUser,
      storeId,
      /**
       * Store identity and tenant flags ride along here rather than forcing
       * every screen to fetch GET /stores/:id — the sidebar needs the name and
       * logo on first paint, and the till needs to know whether shifts are on
       * before it can decide to block settling.
       */
      storeName,
      logoUrl: logoUrl ?? null,
      shiftsEnabled: shiftsEnabled ?? false,
      currency,
      printerConfig,
      accountType,
      designation,
      printerName,
      // Additive. `role` above is untouched, so existing clients that branch
      // on it keep behaving exactly as before.
      effectiveRole: resolveEffectiveRole({ role: user.role, accountType, designation }),
      /**
       * The modules this user may open. Derived, never read straight from the
       * column: owners get everything their account type has, and a staff
       * member's stored set is re-filtered against their current designation.
       *
       * This object becomes `req.user`, so the guards downstream see the raw
       * `permissions` too and recompute rather than trusting this field.
       */
      permissions: resolvePermissions({
        role: user.role,
        accountType,
        designation,
        permissions: storedPermissions,
      }),
    };
  }

  async login(user: any, userAgent?: string) {
    const userWithStore = await this.getUserWithStore(user);
    const payload = { email: user.email, sub: user.id, role: user.role };

    return {
      accessToken: this.jwtService.sign(payload),
      refreshToken: await this.refreshTokenService.issue(user.id, userAgent),
      user: userWithStore,
    };
  }

  /**
   * Exchanges a refresh token for a new access token, rotating the refresh
   * token in the process. Re-reads the user each time so a deactivated account
   * cannot keep refreshing its way into the app.
   */
  async refresh(refreshToken: string, userAgent?: string) {
    const { token, userId } = await this.refreshTokenService.rotate(
      refreshToken,
      userAgent,
    );

    const user = await this.usersRepository.findOne({ where: { id: userId } });
    if (!user || !user.isActive) {
      await this.refreshTokenService.revokeAllForUser(userId);
      throw new UnauthorizedException('Account is no longer active');
    }

    const payload = { email: user.email, sub: user.id, role: user.role };

    return {
      accessToken: this.jwtService.sign(payload),
      refreshToken: token,
      user: await this.getUserWithStore(user),
    };
  }

  async logout(refreshToken?: string) {
    if (refreshToken) {
      await this.refreshTokenService.revokeByToken(refreshToken);
    }
    return { message: 'Logged out successfully' };
  }

  /**
   * Changes a signed-in user's own password.
   *
   * Every refresh token for the user is revoked, so other devices are signed
   * out as soon as their current access token lapses. Already-issued access
   * tokens stay valid until then (they carry no `jti` to revoke against) —
   * that window is bounded by JWT_ACCESS_EXPIRATION, currently 30 minutes.
   */
  async changePassword(userId: string, currentPassword: string, newPassword: string) {
    const user = await this.usersRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new BadRequestException('User not found');
    }

    const matches = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!matches) {
      throw new BadRequestException('Current password is incorrect');
    }

    if (currentPassword === newPassword) {
      throw new BadRequestException('New password must be different from the current one');
    }

    // Same cost factor as register().
    user.passwordHash = await bcrypt.hash(newPassword, 10);
    await this.usersRepository.save(user);

    await this.refreshTokenService.revokeAllForUser(userId);

    // Deliberately does not echo the user entity — getUserWithStore already
    // leaks passwordHash on /auth/me; don't add a second place it can escape.
    return { message: 'Password updated successfully' };
  }

  async register(email: string, password: string, name: string) {
    const hashedPassword = await bcrypt.hash(password, 10);
    const user = this.usersRepository.create({
      email,
      passwordHash: hashedPassword,
      name,
      role: 'employee' as any,
    });
    return await this.usersRepository.save(user);
  }
}
