/**
 * End-to-end check of the restaurant flow against a running server.
 *
 *   API_URL=http://localhost:3000/api node scripts/verify-restaurant-flow.mjs
 *
 * Creates its own restaurant tenant, so it never touches existing data.
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
const owner = { email: `rest-owner-${stamp}@example.com`, password: 'owner123' };
const waiter = { email: `waiter-${stamp}@example.com`, password: 'waiter123' };
const waiter2 = { email: `waiter2-${stamp}@example.com`, password: 'waiter123' };
const kitchen = { email: `kitchen-${stamp}@example.com`, password: 'kitchen123' };
const cashier = { email: `cashier-${stamp}@example.com`, password: 'cashier123' };

// ---------------------------------------------------------------- setup
const admin = await login(ADMIN.email, ADMIN.password);
const store = await call('POST', '/stores', {
  name: `Test Restaurant ${stamp}`,
  email: owner.email,
  password: owner.password,
  accountType: 'restaurant',
  currency: 'PKR',
}, admin.accessToken);
check('super admin creates a restaurant store', store.status === 201, `status ${store.status}`);
check('store persisted accountType=restaurant', store.body?.accountType === 'restaurant', String(store.body?.accountType));

const storeId = store.body?.id;
const ownerAuth = await login(owner.email, owner.password);
check('restaurant owner effectiveRole', ownerAuth?.user?.effectiveRole === 'restaurant_owner', ownerAuth?.user?.effectiveRole);
const OT = ownerAuth.accessToken;

// Staff
// employeeId must be unique per store, so it is keyed on the person rather
// than the designation (two waiters would otherwise collide).
let empSeq = 0;
const mkEmp = (e, designation, name) =>
  call('POST', `/employees/store/${storeId}`, {
    name, email: e.email, password: e.password,
    employeeId: `EMP${++empSeq}-${stamp}`.slice(0, 24),
    designation,
  }, OT);

const rWaiter = await mkEmp(waiter, 'waiter', 'Ali Waiter');
const rWaiter2 = await mkEmp(waiter2, 'waiter', 'Sara Waiter');
check('create waiter', rWaiter.status === 201, `status ${rWaiter.status}`);
check('create waiter 2', rWaiter2.status === 201, `status ${rWaiter2.status} ${rWaiter2.body?.message ?? ''}`);
check('create kitchen', (await mkEmp(kitchen, 'kitchen', 'Chef')).status === 201);
check('create cashier', (await mkEmp(cashier, 'cashier', 'Cash Desk')).status === 201);

const badRole = await mkEmp({ email: `bad-${stamp}@x.com`, password: 'pass123' }, 'busser', 'Bus');
check('restaurant rejects an invalid designation', badRole.status === 400, `status ${badRole.status}`);

const wAuth = await login(waiter.email, waiter.password);
const w2Auth = await login(waiter2.email, waiter2.password);
const kAuth = await login(kitchen.email, kitchen.password);
const cAuth = await login(cashier.email, cashier.password);
check('waiter effectiveRole', wAuth?.user?.effectiveRole === 'waiter', wAuth?.user?.effectiveRole);
check('kitchen effectiveRole', kAuth?.user?.effectiveRole === 'kitchen', kAuth?.user?.effectiveRole);
check('cashier effectiveRole', cAuth?.user?.effectiveRole === 'cashier', cAuth?.user?.effectiveRole);

// Catalogue
const cat = await call('POST', '/categories', { name: 'Mains', description: 'Hot food', storeId }, OT);
const p1 = await call('POST', '/products', { name: 'Biryani', price: 500, costPrice: 300, categoryId: cat.body?.id, storeId }, OT);
const p2 = await call('POST', '/products', { name: 'Karahi', price: 1200, costPrice: 800, categoryId: cat.body?.id, storeId }, OT);
check('owner creates products with cost', p1.status === 201 && p2.status === 201);

// Tables
const t1 = await call('POST', '/restaurant/tables', { name: 'Table 1' }, OT);
const t2 = await call('POST', '/restaurant/tables', { name: 'Table 2' }, OT);
check('owner creates tables', t1.status === 201 && t2.status === 201);
check('new table starts free', t1.body?.status === 'free', t1.body?.status);
check('duplicate table name rejected', (await call('POST', '/restaurant/tables', { name: 'Table 1' }, OT)).status === 409);
check('waiter cannot create tables', (await call('POST', '/restaurant/tables', { name: 'X' }, wAuth.accessToken)).status === 403);

// ------------------------------------------------------------ dine-in
const punch = await call('POST', '/restaurant/orders', {
  orderType: 'dine_in',
  tableId: t1.body.id,
  items: [{ productId: p1.body.id, quantity: 2, notes: 'No chillies' }],
}, wAuth.accessToken);
check('waiter punches a dine-in order', punch.status === 201, `status ${punch.status} ${punch.body?.message ?? ''}`);
check('punched order is requested', punch.body?.orderStatus === 'requested', punch.body?.orderStatus);
check('order is unpaid', punch.body?.paymentStatus === 'unpaid', punch.body?.paymentStatus);
check('server priced the order (2 x 500)', Number(punch.body?.total) === 1000, String(punch.body?.total));
check('line snapshotted unitCost', Number(punch.body?.items?.[0]?.unitCost) === 300, String(punch.body?.items?.[0]?.unitCost));
check('line kept kitchen notes', punch.body?.items?.[0]?.notes === 'No chillies');
check('order carries waiter + table name', !!punch.body?.waiterName && !!punch.body?.tableName, `${punch.body?.waiterName} / ${punch.body?.tableName}`);

const tablesNow = await call('GET', '/restaurant/tables', undefined, cAuth.accessToken);
check('table flipped to reserved',
  Array.isArray(tablesNow.body) && tablesNow.body.find((t) => t.id === t1.body.id)?.status === 'reserved',
  `status ${tablesNow.status}`);

// Concurrency: two waiters race for the SAME free table
const raceBody = { orderType: 'dine_in', tableId: t2.body.id, items: [{ productId: p1.body.id, quantity: 1 }] };
const [ra, rb] = await Promise.all([
  call('POST', '/restaurant/orders', raceBody, wAuth.accessToken),
  call('POST', '/restaurant/orders', raceBody, w2Auth.accessToken),
]);
const okCount = [ra, rb].filter((r) => r.status === 201).length;
const conflictCount = [ra, rb].filter((r) => r.status === 409).length;
check('concurrent punches: exactly one wins', okCount === 1 && conflictCount === 1, `${okCount} ok / ${conflictCount} conflict`);

// Punching an already-reserved table is refused
check('reserved table cannot be punched again',
  (await call('POST', '/restaurant/orders', { orderType: 'dine_in', tableId: t1.body.id, items: [{ productId: p1.body.id, quantity: 1 }] }, w2Auth.accessToken)).status === 409);

// ------------------------------------------------------------- drafts
const draft = await call('POST', '/restaurant/orders', {
  orderType: 'dine_in',
  tableId: t1.body.id, // hint only
  items: [{ productId: p2.body.id, quantity: 1 }],
  isDraft: true,
}, wAuth.accessToken);
check('waiter saves a draft against a reserved table', draft.status === 201, `status ${draft.status}`);
check('draft status is draft', draft.body?.orderStatus === 'draft');
check('draft items are not sent to the kitchen', draft.body?.items?.[0]?.sentAt === null);

const draftsForW2 = await call('GET', '/restaurant/orders?orderStatus=draft', undefined, w2Auth.accessToken);
check('drafts are shared across waiters',
  Array.isArray(draftsForW2.body) && draftsForW2.body.some((o) => o.id === draft.body.id),
  `status ${draftsForW2.status} ${JSON.stringify(draftsForW2.body).slice(0, 120)}`);

// Optimistic lock on a shared draft
const stale = await call('PATCH', `/restaurant/orders/${draft.body.id}/draft`, {
  items: [{ productId: p2.body.id, quantity: 3 }],
  version: (draft.body.version ?? 1) - 1,
}, w2Auth.accessToken);
check('stale draft edit is rejected', stale.status === 409, `status ${stale.status}`);

// ------------------------------------------------------ second round
const round2 = await call('POST', `/restaurant/orders/${punch.body.id}/items`, {
  items: [{ productId: p2.body.id, quantity: 1, notes: 'Extra spicy' }],
}, wAuth.accessToken);
check('waiter appends a second round', round2.status === 201, `status ${round2.status}`);
check('appended round recalculated the total (1000 + 1200)', Number(round2.body?.total) === 2200, String(round2.body?.total));
check('rounds have distinct sentAt stamps',
  new Set((round2.body?.items ?? []).map((i) => i.sentAt)).size === 2,
  String((round2.body?.items ?? []).map((i) => i.sentAt)));

// ------------------------------------------------------------ kitchen
const queue = await call('GET', '/restaurant/orders?orderStatus=requested', undefined, kAuth.accessToken);
check('kitchen sees requested orders',
  Array.isArray(queue.body) && queue.body.some((o) => o.id === punch.body.id),
  `status ${queue.status}`);
const prep = await call('PATCH', `/restaurant/orders/${punch.body.id}/status`, { orderStatus: 'preparing' }, kAuth.accessToken);
check('kitchen sets preparing', prep.status === 200 && prep.body?.orderStatus === 'preparing', prep.body?.orderStatus);
check('kitchen cannot settle', (await call('POST', `/restaurant/orders/${punch.body.id}/settle`, {}, kAuth.accessToken)).status === 403);

// The kitchen's authority ends at handed_over. 'completed' means paid and the
// table freed, which only settling may do — allowing it here used to strand
// the table forever and book an unpaid order as revenue.
check('kitchen cannot mark an order completed',
  (await call('PATCH', `/restaurant/orders/${punch.body.id}/status`, { orderStatus: 'completed' }, kAuth.accessToken)).status === 400);

const handed = await call('PATCH', `/restaurant/orders/${punch.body.id}/status`, { orderStatus: 'handed_over' }, kAuth.accessToken);
check('kitchen hands the order over', handed.status === 200 && handed.body?.orderStatus === 'handed_over', handed.body?.orderStatus);
check('a handed-over order is still unpaid', handed.body?.paymentStatus === 'unpaid', handed.body?.paymentStatus);

// The guests are still sitting there; only payment frees the table.
const stillHeld = await call('GET', '/restaurant/tables', undefined, wAuth.accessToken);
check('handed-over order still occupies its table',
  stillHeld.body?.find((t) => t.id === t1.body.id)?.status === 'reserved',
  String(stillHeld.body?.find((t) => t.id === t1.body.id)?.status));

check('a handed-over order cannot go back to preparing',
  (await call('PATCH', `/restaurant/orders/${punch.body.id}/status`, { orderStatus: 'preparing' }, kAuth.accessToken)).status === 409);

// ------------------------------------------------------------ cashier
const pct = await call('POST', `/restaurant/orders/${punch.body.id}/settle`, {
  discountType: 'percent', discountValue: 25, paymentMethod: 'cash',
}, cAuth.accessToken);
check('cashier settles with 25%', pct.status === 201, `status ${pct.status}`);
check('25% of 2200 => 550 discount', Number(pct.body?.discount) === 550, String(pct.body?.discount));
check('total after discount is 1650', Number(pct.body?.total) === 1650, String(pct.body?.total));
check('settled order is completed', pct.body?.orderStatus === 'completed');
check('settled order is paid', pct.body?.paymentStatus === 'paid');
// Cash is always taken by a cashier — never by the waiter who opened it.
check('settled order records who took the money',
  pct.body?.settledById === cAuth.user?.id && !!pct.body?.settledAt,
  `settledById ${pct.body?.settledById}`);
check('settler is not the waiter who created the order',
  pct.body?.settledById !== pct.body?.createdById);
// The order list joins users; a blanket select would ship bcrypt hashes.
check('order responses never leak a password hash',
  !JSON.stringify(pct.body).includes('passwordHash'));

const freed = await call('GET', '/restaurant/tables', undefined, wAuth.accessToken);
check('table freed after settling',
  Array.isArray(freed.body) && freed.body.find((t) => t.id === t1.body.id)?.status === 'free',
  `status ${freed.status}`);

// Flat discount + clamping, on the race-winning order
const liveOrder = (ra.status === 201 ? ra : rb).body;
const flat = await call('POST', `/restaurant/orders/${liveOrder.id}/settle`, {
  discountType: 'amount', discountValue: 250, paymentMethod: 'card',
}, cAuth.accessToken);
check('flat 250 discount applied', Number(flat.body?.discount) === 250, String(flat.body?.discount));
check('total after flat discount (500-250)', Number(flat.body?.total) === 250, String(flat.body?.total));

// Over-large discount must clamp, never go negative
const takeaway = await call('POST', '/restaurant/orders', {
  orderType: 'takeaway', items: [{ productId: p1.body.id, quantity: 1 }], customerName: 'Walk-in',
}, cAuth.accessToken);
check('cashier creates a takeaway order with no table', takeaway.status === 201 && takeaway.body?.tableId === null);
const over = await call('POST', `/restaurant/orders/${takeaway.body.id}/settle`, {
  discountType: 'amount', discountValue: 999999,
}, cAuth.accessToken);
check('excessive discount clamps to subtotal', Number(over.body?.discount) === 500, String(over.body?.discount));
check('total never goes negative', Number(over.body?.total) === 0, String(over.body?.total));

// Delivery requires an address
check('delivery without an address is rejected',
  (await call('POST', '/restaurant/orders', { orderType: 'delivery', items: [{ productId: p1.body.id, quantity: 1 }] }, cAuth.accessToken)).status === 400);

// ----------------------------------------------------------- dine_out
// Eating in AND taking a parcel: one order, one bill, one table.
check('dine_out without a table is rejected',
  (await call('POST', '/restaurant/orders', {
    orderType: 'dine_out', items: [{ productId: p1.body.id, quantity: 1 }],
  }, wAuth.accessToken)).status === 400);

const t3 = await call('POST', '/restaurant/tables', { name: 'Table 3' }, OT);
const dineOut = await call('POST', '/restaurant/orders', {
  orderType: 'dine_out',
  tableId: t3.body.id,
  items: [
    { productId: p1.body.id, quantity: 1 },
    { productId: p2.body.id, quantity: 1, isParcel: true },
  ],
}, wAuth.accessToken);
check('waiter punches a dine_out order', dineOut.status === 201, `status ${dineOut.status}`);
// The bug this guards: the tableId used to be nulled for anything that was
// not literally 'dine_in', stranding the order with no table.
check('dine_out keeps its table', dineOut.body?.tableId === t3.body.id, String(dineOut.body?.tableId));
const dineOutTables = await call('GET', '/restaurant/tables', undefined, wAuth.accessToken);
check('dine_out reserves its table',
  dineOutTables.body?.find((t) => t.id === t3.body.id)?.status === 'reserved');
check('the parcel flag round-trips per line',
  (dineOut.body?.items ?? []).filter((i) => i.isParcel).length === 1,
  String((dineOut.body?.items ?? []).map((i) => i.isParcel)));
check('non-parcel lines stay unmarked',
  (dineOut.body?.items ?? []).some((i) => i.isParcel === false));

// ------------------------------------------------------------ reports
const report = await call('GET', '/restaurant/reports/sales', undefined, OT);
check('owner reads the sales report', report.status === 200);
// Settled: 1650 (2 biryani + 1 karahi, 25% off) + 250 (1 biryani flat) + 0 (1 biryani free)
check('report revenue matches settled orders', Number(report.body?.revenue) === 1900, String(report.body?.revenue));
// Cost: (2x300 + 1x800) + 300 + 300 = 1400+600 = 2000
check('report cost uses snapshotted unitCost', Number(report.body?.cost) === 2000, String(report.body?.cost));
check('profit = revenue - cost', Number(report.body?.profit) === -100, String(report.body?.profit));
check('report excludes drafts and live orders', report.body?.orderCount === 3, String(report.body?.orderCount));
check('waiter cannot read reports', (await call('GET', '/restaurant/reports/sales', undefined, wAuth.accessToken)).status === 403);

// ------------------------------------------------- cross-tenant safety
const generalOwner = await login('owner@tapntrade.store', 'owner123');
if (generalOwner?.accessToken) {
  check('general store is blocked from restaurant endpoints',
    (await call('GET', '/restaurant/tables', undefined, generalOwner.accessToken)).status === 403);
  check('general owner effectiveRole unchanged',
    generalOwner.user?.effectiveRole === 'store_owner', generalOwner.user?.effectiveRole);
}

// Invoice carries the restaurant context
const invoice = await call('GET', `/invoices/${punch.body.id}`, undefined, cAuth.accessToken);
check('invoice includes table and waiter', !!invoice.body?.tableName && !!invoice.body?.waiterName,
  `${invoice.body?.tableName} / ${invoice.body?.waiterName}`);

let failed = 0;
for (const r of results) {
  if (!r.pass) failed++;
  console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? '  (' + r.detail + ')' : ''}`);
}
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
