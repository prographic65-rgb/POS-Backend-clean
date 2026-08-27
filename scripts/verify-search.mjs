/**
 * Verifies server-side search on the paged endpoints.
 *   API_URL=http://localhost:3000/api node scripts/verify-search.mjs
 */
const API = process.env.API_URL ?? 'http://localhost:3000/api';
const call = async (m, p, b, t) => {
  const r = await fetch(API + p, {
    method: m,
    headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: `Bearer ${t}` } : {}) },
    body: b === undefined ? undefined : JSON.stringify(b),
  });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const login = async (e, p) => (await call('POST', '/auth/login', { email: e, password: p })).body;

const results = [];
const check = (n, pass, d = '') => results.push({ n, pass, d });

const stamp = Date.now();
const admin = await login('admin@poscloud.com', 'admin123');
const owner = { email: `srch-${stamp}@x.com`, password: 'owner123' };
await call('POST', '/stores', {
  name: `Search Co ${stamp}`, email: owner.email, password: owner.password,
  accountType: 'restaurant', currency: 'PKR',
}, admin.accessToken);
const auth = await login(owner.email, owner.password);
const T = auth.accessToken, storeId = auth.user.storeId;

const cat = await call('POST', '/categories', { name: 'Mains', storeId }, T);
const mk = (name, price) => call('POST', '/products',
  { name, price, costPrice: price * 0.8, categoryId: cat.body?.id, storeId }, T);

await mk('Chicken Tikka Pizza', 650);
await mk('Beef Pepperoni Pizza', 750);
const fries = await mk('Masala Fries', 230);

// ---- products ----
const hit = await call('GET', `/products?withCount=true&storeId=${storeId}&search=tikka&take=50`, undefined, T);
check('product search matches by name', hit.body?.total === 1 && hit.body.items[0].name.includes('Tikka'),
  `${hit.body?.total} hits`);

const ci = await call('GET', `/products?withCount=true&storeId=${storeId}&search=TIKKA&take=50`, undefined, T);
check('product search is case-insensitive', ci.body?.total === 1, `${ci.body?.total} hits`);

const partial = await call('GET', `/products?withCount=true&storeId=${storeId}&search=pizza&take=50`, undefined, T);
check('product search matches partial words', partial.body?.total === 2, `${partial.body?.total} hits`);

const byCat = await call('GET', `/products?withCount=true&storeId=${storeId}&search=Mains&take=50`, undefined, T);
check('product search matches category name', byCat.body?.total === 3, `${byCat.body?.total} hits`);

const none = await call('GET', `/products?withCount=true&storeId=${storeId}&search=zzzz&take=50`, undefined, T);
check('no match returns an empty page, not everything', none.body?.total === 0, `${none.body?.total} hits`);

// total must reflect the SEARCH, not the whole table — this is what makes
// paging over search results correct.
const paged = await call('GET', `/products?withCount=true&storeId=${storeId}&search=pizza&take=1`, undefined, T);
check('total counts matches, not all rows', paged.body?.total === 2 && paged.body.items.length === 1,
  `total ${paged.body?.total}, page ${paged.body?.items?.length}`);

// ---- restaurant orders ----
await call('POST', '/restaurant/orders', {
  orderType: 'takeaway', items: [{ productId: fries.body.id, quantity: 1 }],
  customerName: 'Zainab Khan', customerPhone: '03001234567',
}, T);

const byCustomer = await call('GET', '/restaurant/orders?withCount=true&search=zainab&take=50', undefined, T);
check('order search matches customer name', byCustomer.body?.total === 1, `${byCustomer.body?.total} hits`);

const byPhone = await call('GET', '/restaurant/orders?withCount=true&search=0300123&take=50', undefined, T);
check('order search matches phone', byPhone.body?.total === 1, `${byPhone.body?.total} hits`);

const bySeq = await call('GET', '/restaurant/orders?withCount=true&search=1&take=50', undefined, T);
check('order search matches order number', bySeq.body?.total >= 1, `${bySeq.body?.total} hits`);

const byWaiter = await call('GET', `/restaurant/orders?withCount=true&search=${encodeURIComponent('Search Co')}&take=50`, undefined, T);
check('order search matches waiter name', byWaiter.body?.total === 1, `${byWaiter.body?.total} hits`);

// A search combined with a status filter must apply BOTH.
const combo = await call('GET', '/restaurant/orders?withCount=true&search=zainab&orderStatus=draft&take=50', undefined, T);
check('search combines with the status filter', combo.body?.total === 0, `${combo.body?.total} hits`);

// ---- catalogue must not be truncated by the page cap ----
const cata = await call('GET', `/products/active?storeId=${storeId}&take=1000`, undefined, T);
check('catalogue endpoint returns a bare array', Array.isArray(cata.body), typeof cata.body);
check('catalogue is not capped at 200', Array.isArray(cata.body) && cata.body.length === 3,
  `${cata.body?.length} items`);

let failed = 0;
for (const r of results) {
  if (!r.pass) failed++;
  console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.n}${r.d ? '  (' + r.d + ')' : ''}`);
}
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
