import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS_KEY } from './decorators';
import { PermissionKey, resolvePermissions } from './permissions';

/**
 * Module-level access, complementing RolesGuard.
 *
 * RolesGuard answers "which kind of user is this"; this one answers "was this
 * module handed to them". Routes that owners share with staff use this instead
 * of listing every effective role, so granting a cashier the expenses module
 * does not mean editing a decorator.
 *
 * Must be combined with JwtAuthGuard — it only inspects `req.user`.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<PermissionKey[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!required?.length) return true;

    const user = context.switchToHttp().getRequest().user;
    if (!user) throw new ForbiddenException('Not authenticated');

    // Recomputed rather than read off the token: JwtStrategy.validate()
    // re-reads the employee row on every request, so revoking a module takes
    // effect immediately instead of when the access token happens to lapse.
    const granted = resolvePermissions(user);

    // Any-of, not all-of. Every current route needs exactly one module, and
    // "any" is the reading that does not silently over-restrict if a route
    // later lists two related ones.
    if (!required.some((permission) => granted.includes(permission))) {
      throw new ForbiddenException('You do not have access to this module');
    }

    return true;
  }
}
