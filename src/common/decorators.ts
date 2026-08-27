import { SetMetadata, createParamDecorator, ExecutionContext } from '@nestjs/common';
import { EffectiveRole } from './roles';
import { PermissionKey } from './permissions';

export const ROLES_KEY = 'roles';
export const PERMISSIONS_KEY = 'permissions';

/**
 * Restricts a route to the given effective roles.
 *
 * Must be combined with JwtAuthGuard — RolesGuard only inspects `req.user`,
 * it does not authenticate:
 *   @UseGuards(JwtAuthGuard, RolesGuard)
 *   @Roles('restaurant_owner')
 */
export const Roles = (...roles: EffectiveRole[]) => SetMetadata(ROLES_KEY, roles);

/** The authenticated user, as assembled by AuthService.getUserWithStore(). */
export const CurrentUser = createParamDecorator(
  (data: string | undefined, ctx: ExecutionContext) => {
    const user = ctx.switchToHttp().getRequest().user;
    return data ? user?.[data] : user;
  },
);

/**
 * Restricts a route to users who hold at least one of the given modules.
 *
 * Must be combined with JwtAuthGuard and PermissionsGuard:
 *   @UseGuards(JwtAuthGuard, PermissionsGuard)
 *   @RequirePermissions('expenses')
 *
 * Owners always pass — their permission set is derived from the account type
 * rather than stored, so they hold every module their tenant has.
 */
export const RequirePermissions = (...permissions: PermissionKey[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);
