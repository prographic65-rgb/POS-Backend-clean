/**
 * End-to-end check of cashier shifts against a running server.
 *
 *   API_URL=http://localhost:3000/api node scripts/verify-shifts.mjs
 *
 * Creates its own restaurant tenant, so it never touches existing data.
 *
 * What this is really proving: money is attributed to the PERSON who took it
 * at the MOMENT they took it, several cashiers can work the same day without
 * their drawers mixing, and closing a drawer freezes a figure the owner can
 * hold someone to.
 */
const API = process.env.API_URL ?? 'http://localhost:3000/api';
const ADMIN = { email: 'admin@poscloud.com', password: 'admin123' };

const call = async (method, path, body, token) => {
  const res = await fetch(API + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};

const results = [];
const check = (name, pass, detail = '') => results.push({ name, pass, detail });
const login = async (email, password) => (await call('POST', '/auth/login', { email, password })).body;

const stamp = Date.now();
const owner = { email: `shift-owner-${stamp}@example.com`, password: 'owner123' };
const cashierA = { email: `cash-a-${stamp}@example.com`, password: 'cashier123' };
const cashierB = { email: `cash-b-${stamp}@example.com`, password: 'cashier123' };
const waiter = { email: `shift-waiter-${stamp}@example.com`, password: 'waiter123' };

// ---------------------------------------------------------------- setup
const admin = await login(ADMIN.email, ADMIN.password);
const store = await call('POST', '/stores', {
  name: `Shift Test ${stamp}`,
  email: owner.email,
  password: owner.password,
  accountType: 'restaurant',
  currency: 'PKR',
}, admin.accessToken);
check('super admin creates a restaurant store', store.status === 201, `status ${store.status}`);

const storeId = store.body?.id;
const ownerAuth = await login(owner.email, owner.password);
const OT = ownerAuth.accessToken;

let empSeq = 0;
const mkEmp = (e, designation, name) =>
  call('POST', `/employees/store/${storeId}`, {
    name, email: e.email, password: e.password,
    employeeId: `EMP${++empSeq}-${stamp}`.slice(0, 24),
    designation,
  }, OT);

const empA = await mkEmp(cashierA, 'cashier', 'Ali Cash');
check('create cashier A', empA.status === 201);
check('create cashier B', (await mkEmp(cashierB, 'cashier', 'Sara Cash')).status === 201);
check('create waiter', (await mkEmp(waiter, 'waiter', 'Waiter')).status === 201);

// Cashier A also books expenses, so cash can leave their drawer. The owner
// grants the module — it is not part of the cashier's base access.
const grant = await call('PATCH', `/employees/${empA.body?.id}/permissions`, {
  permissions: ['expenses'],
}, OT);
check('owner grants the expenses module to cashier A', grant.status === 200, `status ${grant.status}`);
// The owner's dashboard is not among what a restaurant cashier may be offered.
check('the owner dashboard is not grantable to a cashier',
  !(grant.body?.grantable ?? []).includes('dashboard'),
  String(grant.body?.grantable));

const aAuth = await login(cashierA.email, cashierA.password);
const bAuth = await login(cashierB.email, cashierB.password);
const wAuth = await login(waiter.email, waiter.password);
const AT = aAuth.accessToken;
const BT = bAuth.accessToken;

// The owner's dashboard is not delegatable on a restaurant tenant — a cashier
// has their own screen instead.
check('cashier is not offered the owner dashboard',
  !(aAuth?.user?.permissions ?? []).includes('dashboard'),
  String(aAuth?.user?.permissions));

const cat = await call('POST', '/categories', { name: 'Food', storeId }, OT);
const prod = await call('POST', '/products', {
  name: 'Biryani', price: 500, costPrice: 300, categoryId: cat.body?.id, storeId,
}, OT);
const table = await call('POST', '/restaurant/tables', { name: 'T1' }, OT);

const newOrder = async (token, tableId) => {
  const created = await call('POST', '/restaurant/orders', {
    orderType: tableId ? 'dine_in' : 'takeaway',
    tableId,
    items: [{ productId: prod.body.id, quantity: 1 }],
  }, token);
  return created.body;
};

// --------------------------------------------------------- flag is off
// Shifts default to OFF so the release changes nothing for existing stores.
check('shifts default to off', store.body?.shiftsEnabled === false, String(store.body?.shiftsEnabled));

const preShiftOrder = await newOrder(wAuth.accessToken, table.body.id);
const preSettle = await call('POST', `/restaurant/orders/${preShiftOrder.id}/settle`, {
  paymentMethod: 'cash',
}, AT);
check('with shifts off, a cashier can settle without a drawer', preSettle.status === 201, `status ${preSettle.status}`);
// Attribution is still recorded, so turning the flag on later has history.
check('attribution is recorded even with shifts off',
  preSettle.body?.settledById === aAuth.user.id, String(preSettle.body?.settledById));
check('no shift is attached when the flag is off', preSettle.body?.shiftId === null, String(preSettle.body?.shiftId));

check('a cashier cannot open a shift while the flag is off',
  (await call('POST', '/shifts/open', { openingFloat: 0 }, AT)).status === 409);

// ---------------------------------------------------------- enable it
const enable = await call('PATCH', `/stores/${storeId}/settings`, { shiftsEnabled: true }, OT);
check('owner turns shifts on', enable.status === 200 && enable.body?.shiftsEnabled === true, `status ${enable.status}`);
check('a cashier cannot change store settings',
  (await call('PATCH', `/stores/${storeId}/settings`, { shiftsEnabled: false }, AT)).status === 403);

// -------------------------------------------------------- enforcement
const blockedOrder = await newOrder(wAuth.accessToken, table.body.id);
const blocked = await call('POST', `/restaurant/orders/${blockedOrder.id}/settle`, {
  paymentMethod: 'cash',
}, AT);
check('settling without an open shift is rejected', blocked.status === 409, `status ${blocked.status}`);

const openA = await call('POST', '/shifts/open', { openingFloat: 2000 }, AT);
check('cashier A opens a shift', openA.status === 201, `status ${openA.status}`);
check('opening float is recorded', Number(openA.body?.openingFloat) === 2000, String(openA.body?.openingFloat));

// The partial unique index is what makes several cashiers safe: one open
// drawer per person, enforced by Postgres rather than by application code.
check('a second open shift for the same person is rejected',
  (await call('POST', '/shifts/open', { openingFloat: 100 }, AT)).status === 409);

const openB = await call('POST', '/shifts/open', { openingFloat: 500 }, BT);
check('a different cashier may open their own shift at the same time', openB.status === 201, `status ${openB.status}`);

// ------------------------------------------------------------ takings
const cashOrder = await call('POST', `/restaurant/orders/${blockedOrder.id}/settle`, {
  paymentMethod: 'cash',
}, AT);
check('settling succeeds once the shift is open', cashOrder.status === 201, `status ${cashOrder.status}`);
check('the payment is stamped onto the open shift',
  cashOrder.body?.shiftId === openA.body?.id, String(cashOrder.body?.shiftId));

const cardOrderRow = await newOrder(AT, null);
const cardOrder = await call('POST', `/restaurant/orders/${cardOrderRow.id}/settle`, {
  paymentMethod: 'card',
}, AT);
check('card payment also lands in the shift', cardOrder.body?.shiftId === openA.body?.id);

// Cashier B settles their own order — the two drawers must not mix.
const bOrderRow = await newOrder(BT, null);
const bOrder = await call('POST', `/restaurant/orders/${bOrderRow.id}/settle`, {
  paymentMethod: 'cash',
}, BT);
check("cashier B's payment goes to B's shift", bOrder.body?.shiftId === openB.body?.id);

// Cash paid out of the drawer must reduce expected cash, or the cashier who
// paid a supplier from the till always looks short.
const expense = await call('POST', '/expenses', {
  title: 'Milk', amount: 300, paymentMethod: 'cash',
}, AT);
check('cash expense recorded', expense.status === 201, `status ${expense.status}`);

const current = await call('GET', '/shifts/current', undefined, AT);
check('current shift reports live totals', current.status === 200, `status ${current.status}`);
check('cash sales counted', Number(current.body?.totals?.cashSales) === 500, String(current.body?.totals?.cashSales));
check('card sales counted separately', Number(current.body?.totals?.cardSales) === 500, String(current.body?.totals?.cardSales));
check('cash paid out counted', Number(current.body?.totals?.cashPaidOut) === 300, String(current.body?.totals?.cashPaidOut));
// 2000 float + 500 cash − 300 paid out. Card never touches the drawer.
check('expected cash = float + cash sales − paid out',
  Number(current.body?.totals?.expectedCash) === 2200, String(current.body?.totals?.expectedCash));

// -------------------------------------------------------- shift detail
const detail = await call('GET', `/shifts/${openA.body.id}`, undefined, AT);
check('a cashier can open their own shift detail', detail.status === 200, `status ${detail.status}`);
check('the shift lists the orders settled in it',
  (detail.body?.orders ?? []).length === 2, String((detail.body?.orders ?? []).length));
check("a cashier cannot open another cashier's shift",
  (await call('GET', `/shifts/${openA.body.id}`, undefined, BT)).status === 403);
check('the owner can open any shift',
  (await call('GET', `/shifts/${openA.body.id}`, undefined, OT)).status === 200);

const dash = await call('GET', '/shifts/me/dashboard', undefined, AT);
check('cashier dashboard totals only their own money',
  Number(dash.body?.range?.cash) === 1000 && Number(dash.body?.range?.card) === 500,
  `cash ${dash.body?.range?.cash} card ${dash.body?.range?.card}`);

// ---------------------------------------------------------------- close
check('a cashier cannot force-close',
  (await call('POST', `/shifts/${openA.body.id}/force-close`, {}, AT)).status === 403);

// Counted 100 short of the 2200 expected.
const closed = await call('POST', `/shifts/${openA.body.id}/close`, {
  countedCash: 2100, notes: 'gave change from my own pocket',
}, AT);
check('cashier closes their shift', closed.status === 201, `status ${closed.status}`);
check('expected cash frozen on the shift', Number(closed.body?.expectedCash) === 2200, String(closed.body?.expectedCash));
check('counted cash recorded', Number(closed.body?.countedCash) === 2100, String(closed.body?.countedCash));
check('difference = counted − expected', Number(closed.body?.difference) === -100, String(closed.body?.difference));
check('closing twice is rejected',
  (await call('POST', `/shifts/${openA.body.id}/close`, { countedCash: 1 }, AT)).status === 409);

// Once closed, the cashier can open a fresh drawer for the next shift.
check('the cashier may open a new shift after closing',
  (await call('POST', '/shifts/open', { openingFloat: 0 }, AT)).status === 201);

// ------------------------------------------------------- owner summary
const summary = await call('GET', '/shifts/summary/by-cashier', undefined, OT);
check('owner reads the per-cashier summary', summary.status === 200, `status ${summary.status}`);
const rowA = (summary.body ?? []).find((r) => r.userId === aAuth.user.id);
check('cashier A appears in the summary', !!rowA);
check('summary counts both of A’s shifts', rowA?.shifts === 2, String(rowA?.shifts));
check('summary shows A still has an open drawer', rowA?.openNow === true, String(rowA?.openNow));
// Only the CLOSED shift has been counted, so that is what is owed so far.
check('pending collection is what was counted but not yet handed over',
  Number(rowA?.pendingCollection) === 2100, String(rowA?.pendingCollection));
check('cashier cannot read the per-cashier summary',
  (await call('GET', '/shifts/summary/by-cashier', undefined, AT)).status === 403);

// --------------------------------------------------------- collection
check('collecting an open shift is rejected',
  (await call('POST', `/shifts/${openB.body.id}/collect`, { collectedAmount: 1 }, OT)).status === 409);

const collected = await call('POST', `/shifts/${openA.body.id}/collect`, {
  collectedAmount: 2100, notes: 'counted together',
}, OT);
check('owner confirms the cash was received', collected.status === 201, `status ${collected.status}`);
check('shift is marked collected', collected.body?.status === 'collected', String(collected.body?.status));
check('collecting twice is rejected',
  (await call('POST', `/shifts/${openA.body.id}/collect`, { collectedAmount: 1 }, OT)).status === 409);

const afterCollect = await call('GET', '/shifts/summary/by-cashier', undefined, OT);
const rowAfter = (afterCollect.body ?? []).find((r) => r.userId === aAuth.user.id);
check('nothing is left to collect from A', Number(rowAfter?.pendingCollection) === 0, String(rowAfter?.pendingCollection));
check('the collected amount is recorded', Number(rowAfter?.collectedAmount) === 2100, String(rowAfter?.collectedAmount));

// ------------------------------------------------------- force close
const forced = await call('POST', `/shifts/${openB.body.id}/force-close`, { notes: 'went home' }, OT);
check('owner force-closes an abandoned shift', forced.status === 201, `status ${forced.status}`);
// Nobody counted the drawer, so the variance is UNKNOWN rather than zero —
// recording 0 would claim it balanced.
check('a force-closed shift has no counted cash', forced.body?.countedCash === null, String(forced.body?.countedCash));
check('a force-closed shift has an unknown variance', forced.body?.difference === null, String(forced.body?.difference));

// ------------------------------------------------- cross-tenant safety
check('the owner sees only their own store’s shifts',
  (await call('GET', '/shifts', undefined, OT)).body?.every((s) => s.storeId === storeId) !== false);

// ------------------------------------------------------------ summary
let failed = 0;
for (const r of results) {
  if (!r.pass) failed++;
  console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? '  (' + r.detail + ')' : ''}`);
}
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
