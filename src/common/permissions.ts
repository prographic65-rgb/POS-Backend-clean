import { EffectiveRole, resolveEffectiveRole } from './roles';

/**
 * A module a user may be granted access to.
 *
 * Deliberately a flat list of MODULES rather than verbs: the product decision
 * is "can this person touch expenses at all", not "may they update but not
 * delete". Splitting into read/write later is additive — this file is the only
 * place the vocabulary is defined, and all three clients mirror it.
 *
 * `pos` and `cashier` are both "the till", kept apart because they are
 * different screens: `pos` is the general-account POS, `cashier` the
 * restaurant settlement screen. A user never legitimately holds both, since
 * one account type has no route for the other.
 */
export type PermissionKey =
  | 'dashboard'
  | 'expenses'
  | 'pos'
  | 'cashier'
  | 'kitchen'
  | 'tables'
  | 'products'
  | 'categories'
  | 'orders'
  | 'customers'
  | 'inventory';

export const ALL_PERMISSIONS: PermissionKey[] = [
  'dashboard',
  'expenses',
  'pos',
  'cashier',
  'kitchen',
  'tables',
  'products',
  'categories',
  'orders',
  'customers',
  'inventory',
];

/** Modules that only exist on a restaurant tenant. */
const RESTAURANT_MODULES: PermissionKey[] = [
  'dashboard',
  'expenses',
  'cashier',
  'kitchen',
  'tables',
  'products',
  'categories',
  'orders',
];

/** Modules that only exist on a general tenant. */
const GENERAL_MODULES: PermissionKey[] = [
  'dashboard',
  'expenses',
  'pos',
  'products',
  'categories',
  'orders',
  'customers',
  'inventory',
];

/**
 * The one module a staff member always holds, by designation.
 *
 * This is their landing screen, so it is granted unconditionally and cannot be
 * revoked — an employee with an empty permission set would sign in to nowhere.
 */
const RESTAURANT_BASE: Record<string, PermissionKey> = {
  cashier: 'cashier',
  kitchen: 'kitchen',
  waiter: 'tables',
};

/** General-account staff all start on the POS, whatever their job title. */
const GENERAL_BASE: PermissionKey = 'pos';

/**
 * What an owner may ADDITIONALLY hand out, on top of the base above.
 *
 * A restaurant cashier already handles money and the floor, so they can be
 * lifted most of the way to an owner's view. Kitchen and waiting staff can
 * only be given the two back-office modules — granting them the till or the
 * menu editor is not a mistake worth making possible.
 */
const RESTAURANT_GRANTABLE: Record<string, PermissionKey[]> = {
  cashier: ['dashboard', 'expenses', 'tables', 'categories', 'products', 'orders'],
  kitchen: ['dashboard', 'expenses'],
  waiter: ['dashboard', 'expenses'],
};

/** General-account staff may be assigned any module their tenant has. */
const GENERAL_GRANTABLE: PermissionKey[] = GENERAL_MODULES.filter((p) => p !== GENERAL_BASE);

function normalizeDesignation(designation?: string | null): string {
  return (designation ?? '').trim().toLowerCase();
}

function isRestaurant(accountType?: string | null): boolean {
  return accountType === 'restaurant';
}

/** Every module that exists for this tenant, owner-level access. */
export function permissionsForAccountType(accountType?: string | null): PermissionKey[] {
  return isRestaurant(accountType) ? [...RESTAURANT_MODULES] : [...GENERAL_MODULES];
}

/**
 * The non-revocable module for a staff member — their landing screen.
 *
 * `designation` is a free-text column holding arbitrary live values, so an
 * unrecognised one must degrade rather than lock someone out. It degrades to
 * CASHIER on a restaurant tenant, deliberately matching resolveEffectiveRole(),
 * which also falls through to 'cashier'.
 *
 * The two must agree. The clients send a user who fails a permission check to
 * their own home screen, and home is chosen by effective role: if that role
 * said 'cashier' (→ /cashier) while this said 'pos', the redirect would bounce
 * to a screen the user cannot open, and back again, forever.
 */
export function basePermissionFor(
  accountType?: string | null,
  designation?: string | null,
): PermissionKey {
  if (!isRestaurant(accountType)) return GENERAL_BASE;
  return RESTAURANT_BASE[normalizeDesignation(designation)] ?? RESTAURANT_BASE.cashier;
}

/**
 * What an owner is allowed to tick on for this staff member.
 *
 * An unrecognised restaurant designation gets the cashier set, for the same
 * reason basePermissionFor gives it the cashier base — the two must describe
 * the same person.
 */
export function grantablePermissionsFor(
  accountType?: string | null,
  designation?: string | null,
): PermissionKey[] {
  if (!isRestaurant(accountType)) return [...GENERAL_GRANTABLE];
  const grantable = RESTAURANT_GRANTABLE[normalizeDesignation(designation)];
  return [...(grantable ?? RESTAURANT_GRANTABLE.cashier)];
}

/**
 * The effective permission set for a user.
 *
 * IDEMPOTENT, and must stay so: AuthService puts the resolved list on
 * `req.user.permissions`, and PermissionsGuard resolves that object again on
 * every request. Feeding an already-resolved list back in has to produce the
 * same list.
 *
 * Owners and platform admins are computed, never stored — adding a module must
 * not require a data migration to make it visible to the people who own the
 * tenant.
 *
 * For staff, `stored` is filtered against what their designation allows, so a
 * set saved before a designation change (waiter promoted to cashier, or the
 * reverse) can never leave them holding a module they should not have.
 */
export function resolvePermissions(input: {
  role?: string;
  accountType?: string | null;
  designation?: string | null;
  permissions?: string[] | null;
}): PermissionKey[] {
  const effectiveRole: EffectiveRole = resolveEffectiveRole(input);

  if (effectiveRole === 'super_admin') return [...ALL_PERMISSIONS];
  if (effectiveRole === 'store_owner' || effectiveRole === 'restaurant_owner') {
    return permissionsForAccountType(input.accountType);
  }

  const base = basePermissionFor(input.accountType, input.designation);
  const grantable = grantablePermissionsFor(input.accountType, input.designation);

  // `null` means "never customised" — the documented default is the base
  // module alone, which is what a freshly created employee gets.
  const stored = Array.isArray(input.permissions) ? input.permissions : [];
  const extra = stored.filter((p): p is PermissionKey =>
    grantable.includes(p as PermissionKey),
  );

  return [base, ...extra.filter((p) => p !== base)];
}

export function hasPermission(
  user: {
    role?: string;
    accountType?: string | null;
    designation?: string | null;
    permissions?: string[] | null;
  },
  permission: PermissionKey,
): boolean {
  return resolvePermissions(user).includes(permission);
}

/**
 * Narrows a submitted permission list to what may actually be saved.
 *
 * The base module is dropped rather than stored: it is granted by
 * resolvePermissions() regardless, and persisting it would make a later
 * designation change carry the old base along with it.
 */
export function sanitizePermissions(
  accountType: string | null | undefined,
  designation: string | null | undefined,
  requested: string[] | null | undefined,
): PermissionKey[] {
  if (!Array.isArray(requested)) return [];
  const grantable = grantablePermissionsFor(accountType, designation);
  const base = basePermissionFor(accountType, designation);

  return [...new Set(requested)].filter(
    (p): p is PermissionKey => p !== base && grantable.includes(p as PermissionKey),
  );
}
