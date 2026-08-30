import {
  resolvePermissions,
  sanitizePermissions,
  grantablePermissionsFor,
  basePermissionFor,
  ALL_PERMISSIONS,
} from './permissions';

const employee = (over: Record<string, any> = {}) => ({
  role: 'employee',
  accountType: 'restaurant',
  ...over,
});

describe('resolvePermissions', () => {
  describe('owners hold every module their tenant has', () => {
    it('gives a restaurant owner the restaurant modules and no general-only ones', () => {
      const granted = resolvePermissions({ role: 'store_owner', accountType: 'restaurant' });
      expect(granted).toEqual(expect.arrayContaining(['dashboard', 'expenses', 'tables', 'cashier']));
      // POS/customers/inventory have no restaurant screens behind them.
      expect(granted).not.toContain('pos');
      expect(granted).not.toContain('inventory');
    });

    it('gives a general store owner the general modules and no restaurant-only ones', () => {
      const granted = resolvePermissions({ role: 'store_owner', accountType: 'general' });
      expect(granted).toEqual(
        expect.arrayContaining(['dashboard', 'expenses', 'pos', 'customers', 'inventory']),
      );
      expect(granted).not.toContain('kitchen');
      expect(granted).not.toContain('tables');
    });

    it('treats a store with no accountType as general', () => {
      // Rows predating the accountType column must not fall through to a
      // restaurant surface.
      expect(resolvePermissions({ role: 'store_owner' })).toContain('pos');
    });

    it('gives a platform admin everything', () => {
      expect(resolvePermissions({ role: 'admin' })).toEqual(ALL_PERMISSIONS);
    });
  });

  describe('staff defaults', () => {
    it('gives a restaurant cashier only the till', () => {
      expect(resolvePermissions(employee({ designation: 'cashier' }))).toEqual(['cashier']);
    });

    it('gives kitchen staff only the kitchen display', () => {
      expect(resolvePermissions(employee({ designation: 'kitchen' }))).toEqual(['kitchen']);
    });

    it('gives a waiter only the tables', () => {
      expect(resolvePermissions(employee({ designation: 'waiter' }))).toEqual(['tables']);
    });

    it('gives every general employee only the POS, whatever their job title', () => {
      // `designation` is free text on general stores, so live rows hold
      // arbitrary values. None of them may change the default.
      for (const designation of ['cashier', 'Manager', 'Sales Rep', 'waiter', '']) {
        expect(
          resolvePermissions({ role: 'employee', accountType: 'general', designation }),
        ).toEqual(['pos']);
      }
    });

    it('treats an empty stored set the same as never having been customised', () => {
      expect(resolvePermissions(employee({ designation: 'waiter', permissions: [] }))).toEqual([
        'tables',
      ]);
    });
  });

  describe('granted modules', () => {
    it('adds what the owner assigned, keeping the base first', () => {
      expect(
        resolvePermissions(
          employee({ designation: 'cashier', permissions: ['orders', 'expenses'] }),
        ),
      ).toEqual(['cashier', 'orders', 'expenses']);
    });

    /** The rule that makes the feature safe to expose. */
    it('drops modules the designation may never hold', () => {
      expect(
        resolvePermissions(
          employee({ designation: 'kitchen', permissions: ['expenses', 'cashier', 'products'] }),
        ),
      ).toEqual(['kitchen', 'expenses']);
    });

    /**
     * The owner's dashboard shows whole-store revenue, profit and every
     * cashier's takings. Restaurant staff get their own screens instead, so a
     * stored grant left over from before must not resurrect it.
     */
    it('never gives restaurant staff the owner dashboard, however it was stored', () => {
      for (const designation of ['cashier', 'kitchen', 'waiter']) {
        expect(
          resolvePermissions(employee({ designation, permissions: ['dashboard'] })),
        ).not.toContain('dashboard');
      }
    });

    it('does not duplicate the base when it was also stored', () => {
      expect(
        resolvePermissions(employee({ designation: 'waiter', permissions: ['tables', 'expenses'] })),
      ).toEqual(['tables', 'expenses']);
    });

    it('lets a general employee be given any module their tenant has', () => {
      expect(
        resolvePermissions({
          role: 'employee',
          accountType: 'general',
          designation: 'staff',
          permissions: ['dashboard', 'expenses', 'inventory', 'customers'],
        }),
      ).toEqual(['pos', 'dashboard', 'expenses', 'inventory', 'customers']);
    });

    it('ignores modules that do not exist', () => {
      expect(
        resolvePermissions(employee({ designation: 'cashier', permissions: ['nonsense'] })),
      ).toEqual(['cashier']);
    });
  });

  /**
   * A restaurant designation outside waiter/kitchen/cashier must not lock
   * anyone out — the column is free text and the service only validates it on
   * write, so older rows can hold anything.
   *
   * It resolves to CASHIER, matching resolveEffectiveRole's own fallback. If
   * the two disagreed, the clients would bounce such a user between their home
   * screen and a permission check forever.
   */
  it('degrades to cashier access for an unrecognised restaurant designation', () => {
    expect(resolvePermissions(employee({ designation: 'Bartender' }))).toEqual(['cashier']);
  });

  it('stays idempotent when fed its own output', () => {
    // AuthService puts the resolved list on req.user, and PermissionsGuard
    // resolves that object again on every request.
    for (const input of [
      employee({ designation: 'cashier', permissions: ['dashboard', 'orders'] }),
      employee({ designation: 'waiter', permissions: ['expenses'] }),
      employee({ designation: 'Bartender' }),
      { role: 'employee', accountType: 'general', designation: 'staff', permissions: ['inventory'] },
      { role: 'store_owner', accountType: 'restaurant' },
      { role: 'admin' },
    ]) {
      const once = resolvePermissions(input);
      expect(resolvePermissions({ ...input, permissions: once })).toEqual(once);
    }
  });
});

describe('basePermissionFor / grantablePermissionsFor', () => {
  it('never lets kitchen or waiting staff be offered the till or the menu', () => {
    for (const designation of ['kitchen', 'waiter']) {
      expect(grantablePermissionsFor('restaurant', designation)).toEqual(['expenses']);
    }
  });

  it('offers a restaurant cashier the wider set', () => {
    expect(grantablePermissionsFor('restaurant', 'cashier')).toEqual([
      'expenses',
      'tables',
      'categories',
      'products',
      'orders',
    ]);
  });

  /** The owner's dashboard is not delegatable on a restaurant tenant. */
  it('never offers the owner dashboard to any restaurant designation', () => {
    for (const designation of ['cashier', 'kitchen', 'waiter', 'Bartender']) {
      expect(grantablePermissionsFor('restaurant', designation)).not.toContain('dashboard');
    }
    // A general store is unchanged — its dashboard is still delegatable.
    expect(grantablePermissionsFor('general', 'staff')).toContain('dashboard');
  });

  it('treats an unrecognised restaurant designation as a cashier throughout', () => {
    expect(basePermissionFor('restaurant', 'Bartender')).toBe('cashier');
    expect(grantablePermissionsFor('restaurant', 'Bartender')).toEqual(
      grantablePermissionsFor('restaurant', 'cashier'),
    );
  });

  it('never offers a base module as grantable', () => {
    for (const designation of ['cashier', 'kitchen', 'waiter']) {
      const base = basePermissionFor('restaurant', designation);
      expect(grantablePermissionsFor('restaurant', designation)).not.toContain(base);
    }
    expect(grantablePermissionsFor('general', 'staff')).not.toContain('pos');
  });
});

describe('sanitizePermissions', () => {
  it('keeps only what the designation allows', () => {
    expect(
      sanitizePermissions('restaurant', 'waiter', ['expenses', 'cashier', 'orders']),
    ).toEqual(['expenses']);
  });

  it('refuses to store the owner dashboard for restaurant staff', () => {
    expect(sanitizePermissions('restaurant', 'cashier', ['dashboard', 'orders'])).toEqual([
      'orders',
    ]);
  });

  it('does not persist the base module', () => {
    // Storing it would carry a stale base through a later designation change.
    expect(sanitizePermissions('restaurant', 'cashier', ['cashier', 'orders'])).toEqual(['orders']);
  });

  it('de-duplicates', () => {
    expect(sanitizePermissions('general', 'staff', ['expenses', 'expenses'])).toEqual(['expenses']);
  });

  it('is safe on a missing list', () => {
    expect(sanitizePermissions('general', 'staff', undefined)).toEqual([]);
    expect(sanitizePermissions('general', 'staff', null)).toEqual([]);
  });
});
