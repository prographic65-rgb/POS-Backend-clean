/**
 * Seeds the real Snack Fuel menu.
 *
 *   npm run db:seed-snackfuel
 *
 * DESTRUCTIVE for this store only: removes its existing categories, products
 * and orders before loading the menu. Every other store is untouched.
 *
 * Cost prices are seeded at 80% of the selling price (a 20% gross margin) —
 * the printed menu carries no cost data, so this is a placeholder for the
 * owner dashboard, not real costing.
 */
import 'reflect-metadata';
import { DataSource } from 'typeorm';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config();

const STORE_ID = '7066205d-e925-4f33-839d-ba312b7fea6e';

/** Seeded margin. cost = price * COST_RATIO. */
const COST_RATIO = 0.8;

interface Item {
  name: string;
  price: number;
  description?: string;
}

interface Group {
  category: string;
  description: string;
  items: Item[];
}

/** Builds `flavour (Size)` rows — the schema has one price per product. */
function sized(
  flavours: string[],
  sizes: Array<[label: string, price: number]>,
): Item[] {
  const rows: Item[] = [];
  for (const flavour of flavours) {
    for (const [label, price] of sizes) {
      rows.push({ name: `${flavour} (${label})`, price });
    }
  }
  return rows;
}

const TRADITIONAL = [
  'Tikka', 'Fajita', 'Supreme', 'Cheese Margarita',
  'Veg Lover', 'Hot n Spicy', 'Chicken Lover',
];

const SPECIAL = [
  'Pepperoni', 'Malai Boti', 'Arabic Ranch', 'Mughal-e-Azam',
  'Bihari Kebab', 'Tandoori Chicken', 'Peri Peri',
];

const STUFFED = [
  'Snack Fuel Special', 'Kebab Stuff', 'Cheese Stuff',
  'Dawat-e-Khass', 'Crown Crust',
];

const DIPS = [
  'SF Special', 'Cocktail', 'Mint Mustard',
  'Honey Mustard', 'Garlic Mayo', 'Chipotle',
];

const MENU: Group[] = [
  {
    category: 'Appetizers',
    description: 'Fries, wings, nuggets and sides',
    items: [
      { name: 'Regular Fries (Small)', price: 220 },
      { name: 'Regular Fries (Large)', price: 270 },
      { name: 'Masala Fries', price: 230 },
      { name: 'Garlic Mayo Fries', price: 250 },
      { name: 'Loaded Fries', price: 550 },
      { name: 'Nuggets (6 pcs)', price: 290 },
      { name: 'Nuggets (12 pcs)', price: 550 },
      { name: 'Crunchy Wings (6 pcs)', price: 380 },
      { name: 'Crunchy Wings (12 pcs)', price: 680 },
      { name: 'Oven Baked Wings (6 pcs)', price: 400 },
      { name: 'Oven Baked Wings (12 pcs)', price: 750 },
      { name: 'Honey BBQ Wings (6 pcs)', price: 400 },
      { name: 'Honey BBQ Wings (12 pcs)', price: 750 },
      { name: 'Cheese Sticks', price: 500 },
      { name: 'Chicken Cheese Sticks', price: 650 },
      { name: 'Chicken Strips (4 pcs)', price: 300 },
      { name: 'Spin Rolls', price: 650 },
    ],
  },
  {
    category: 'Burgers',
    description: 'Chicken burgers and zingers',
    items: [
      { name: 'Patty Burger (Single)', price: 300 },
      { name: 'Patty Burger (Double)', price: 450 },
      { name: 'Fillet Grilled (Single)', price: 500 },
      { name: 'Fillet Grilled (Double)', price: 750 },
      { name: 'Zinger Mini', price: 300 },
      { name: 'Zinger Jumbo', price: 450 },
      { name: 'Big Bite Zinger', price: 700 },
      { name: 'Tender Fillet', price: 550 },
    ],
  },
  {
    category: 'Beef Burgers',
    description: 'Smash and classic beef burgers',
    items: [
      { name: 'Classic', price: 520 },
      { name: 'Smash (Single)', price: 600 },
      { name: 'Smash (Double)', price: 800 },
      { name: 'Smash Onion', price: 650 },
      { name: 'Beef Mexican', price: 650 },
    ],
  },
  {
    category: 'Wraps',
    description: 'Rolls and tortilla wraps',
    items: [
      { name: 'SF Special', price: 650 },
      { name: 'Twister', price: 550 },
      { name: 'Grilled', price: 550 },
      { name: 'Tortilla', price: 520 },
    ],
  },
  {
    category: 'Pasta',
    description: 'Half and full portions',
    items: [
      { name: 'SF Special (Half)', price: 400 },
      { name: 'SF Special (Full)', price: 750 },
      { name: 'Creamy Pasta (Half)', price: 350 },
      { name: 'Creamy Pasta (Full)', price: 650 },
      { name: 'Crunchy Pasta (Half)', price: 400 },
      { name: 'Crunchy Pasta (Full)', price: 750 },
      { name: 'Grilled Pasta (Half)', price: 400 },
      { name: 'Grilled Pasta (Full)', price: 750 },
    ],
  },
  {
    category: 'Sandwiches',
    description: 'Paninis and club sandwiches',
    items: [
      { name: 'Mexican', price: 700 },
      { name: 'Club Sandwich', price: 400 },
      { name: 'Tikka Panini', price: 550 },
      { name: 'Malai Panini', price: 550 },
      { name: 'Special Panini', price: 600 },
      { name: 'Grilled Panini', price: 600 },
    ],
  },
  {
    category: 'Fried Chicken',
    description: 'Bone-in fried chicken',
    items: [
      { name: 'Fried Chicken (2 pcs)', price: 550 },
      { name: 'Fried Chicken (4 pcs)', price: 950 },
    ],
  },
  {
    category: 'Pizza — Traditional',
    description: 'Classic flavours in four sizes',
    items: sized(TRADITIONAL, [
      ['Small', 650], ['Medium', 1200], ['Large', 1700], ['XL', 2100],
    ]),
  },
  {
    category: 'Pizza — Special',
    description: 'Premium flavours in four sizes',
    items: sized(SPECIAL, [
      ['Small', 750], ['Medium', 1300], ['Large', 1800], ['XL', 2350],
    ]),
  },
  {
    category: 'Stuffed Pizza',
    description: 'Stuffed-crust pizzas',
    items: sized(STUFFED, [
      ['Medium', 1350], ['Large', 1850], ['XL', 2400],
    ]),
  },
  {
    category: 'Doner Pizza',
    description: 'Doner-style pizza',
    items: [
      { name: 'Doner Pizza (Medium)', price: 1400 },
      { name: 'Doner Pizza (Large)', price: 1850 },
      { name: 'Doner Pizza (XL)', price: 2300 },
    ],
  },
  {
    category: 'Premium',
    description: 'Rolls, calzone, pide and platters',
    items: [
      { name: 'Bihari Roll', price: 650 },
      { name: 'Steaker Sandwich', price: 750 },
      { name: 'Calzone Chunk', price: 1000 },
      { name: 'Pide (Turkish Flat Bread)', price: 950 },
      { name: 'Kebabish Double Treat (Medium)', price: 1200 },
      { name: 'Kebabish Double Treat (Large)', price: 1800 },
      { name: 'Kebabish Double Treat (XL)', price: 2500 },
    ],
  },
  {
    category: 'Dip Sauces',
    description: 'All dips Rs 80',
    items: DIPS.map((name) => ({ name: `${name} Dip`, price: 80 })),
  },
  {
    category: 'Boxes',
    description: 'Loaded sharing boxes',
    items: [
      {
        name: 'Snack Fuel Box',
        price: 2100,
        description: '8 pc wings, 6 pc chicken strips, large fries, 6 pc nuggets, jumbo zinger',
      },
    ],
  },
  {
    category: 'Regular Deals',
    description: 'Everyday combo deals',
    items: [
      { name: 'Regular Deal 1', price: 1000, description: 'Small pizza (traditional) + regular fries + 1 litre drink' },
      { name: 'Regular Deal 2', price: 1550, description: '2 mini zingers + small pizza (traditional) + 5 wings + large fries + 1 litre drink' },
      { name: 'Regular Deal 3', price: 1250, description: '2 jumbo zingers + 5 wings + 2 NR drinks' },
      { name: 'Regular Deal 4', price: 1900, description: '1 medium pizza (traditional) + Mexican sandwich + 1 litre drink' },
      { name: 'Regular Deal 5', price: 2350, description: '1 large pizza (special) + 1 small pasta + regular fries + 1.5 litre drink' },
      { name: 'Regular Deal 6', price: 1550, description: '2 mini zingers + 2 jumbo zingers + 1.5 litre drink' },
    ],
  },
  {
    category: 'Family Deals',
    description: 'Large combos for sharing',
    items: [
      { name: 'Family Deal 1', price: 4650, description: '2 large pizzas (1 special, 1 traditional) + 4 mini zingers + large fries + 1.5 litre drink' },
      { name: 'Family Deal 2', price: 3750, description: '2 large pizzas (special) + large fries + 1.5 litre drink' },
      { name: 'Family Deal 3', price: 3400, description: '1 large pizza (any) + 10 crunchy wings + 2 jumbo zingers + large fries + 1.5 litre drink' },
    ],
  },
  {
    category: 'Kids Deals',
    description: 'Smaller combos for kids',
    items: [
      { name: 'Kids Deal 1', price: 500, description: '6 pc nuggets + regular fries + 1 NR drink' },
      { name: 'Kids Deal 2', price: 880, description: '6 pc nuggets + 1 patty burger + regular fries + 2 NR drinks' },
      { name: 'Kids Deal 3', price: 1450, description: '6 pc nuggets + 6 wings + 2 patty burgers + large fries + 1 litre drink' },
    ],
  },
  {
    category: 'Drinks',
    description: 'Bottles, cans and water',
    items: [
      { name: 'NR Bottle', price: 100 },
      { name: '1 Litre Bottle', price: 180 },
      { name: '1.5 Litre Bottle', price: 230 },
      { name: 'Small Water', price: 50 },
      { name: 'Large Water', price: 100 },
      { name: 'Can', price: 130 },
    ],
  },
  {
    category: 'Add-Ons',
    description: 'Extras and toppings',
    items: [
      { name: 'Cheese Slice', price: 80 },
      { name: 'Dinner Roll', price: 50 },
      { name: 'Extra Toppings (Small)', price: 150 },
      { name: 'Extra Toppings (Medium)', price: 280 },
      { name: 'Extra Toppings (Large)', price: 350 },
      { name: 'Extra Toppings (XL)', price: 400 },
    ],
  },
];

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

async function main() {
  const dataSource = new DataSource({
    type: 'postgres',
    host: process.env.DATABASE_HOST || 'localhost',
    port: parseInt(process.env.DATABASE_PORT || '5432', 10),
    username: process.env.DATABASE_USER || 'postgres',
    password: process.env.DATABASE_PASSWORD || 'postgres',
    database: process.env.DATABASE_NAME || 'postgres',
    entities: [path.join(__dirname, '../src/**/*.entity{.ts,.js}')],
    synchronize: false,
  });

  await dataSource.initialize();

  const store = await dataSource.query(
    'SELECT id, name, "accountType" FROM stores WHERE id = $1',
    [STORE_ID],
  );
  if (!store.length) {
    throw new Error(`Store ${STORE_ID} not found`);
  }
  if (store[0].accountType !== 'restaurant') {
    throw new Error(`Store ${store[0].name} is not a restaurant account`);
  }

  console.log(`🍔 Seeding menu for ${store[0].name}\n`);

  const totalItems = MENU.reduce((sum, g) => sum + g.items.length, 0);

  // One transaction: a partial menu is worse than no menu.
  await dataSource.transaction(async (manager) => {
    // --- clear this store's existing menu and order history ---
    // order_items must go first: it has FKs onto both orders and products, so
    // the products cannot be removed while any line still references them.
    const [{ count: itemCount }] = await manager.query(
      `SELECT count(*)::int AS count FROM order_items
        WHERE "orderId" IN (SELECT id FROM orders WHERE "storeId" = $1)`,
      [STORE_ID],
    );
    await manager.query(
      `DELETE FROM order_items
        WHERE "orderId" IN (SELECT id FROM orders WHERE "storeId" = $1)`,
      [STORE_ID],
    );

    // Tables point at a live order; clear that before the orders vanish or the
    // grid would show a table reserved by an order that no longer exists.
    await manager.query(
      `UPDATE restaurant_tables
          SET status = 'free', "currentOrderId" = NULL
        WHERE "storeId" = $1`,
      [STORE_ID],
    );

    const orders = await manager.query('DELETE FROM orders WHERE "storeId" = $1', [STORE_ID]);
    const products = await manager.query('DELETE FROM products WHERE "storeId" = $1', [STORE_ID]);
    const categories = await manager.query('DELETE FROM categories WHERE "storeId" = $1', [STORE_ID]);

    // Restart order numbering, so the first real order is #1.
    await manager.query('UPDATE stores SET "orderSequence" = 0 WHERE id = $1', [STORE_ID]);

    console.log('🗑  removed old data');
    console.log(`   order items  ${itemCount}`);
    console.log(`   orders       ${orders[1] ?? 0}`);
    console.log(`   products     ${products[1] ?? 0}`);
    console.log(`   categories   ${categories[1] ?? 0}`);
    console.log('   order numbering reset to start at #1\n');

    // --- insert the menu ---
    for (const group of MENU) {
      const [category] = await manager.query(
        `INSERT INTO categories ("storeId", name, description, "isActive")
         VALUES ($1, $2, $3, true) RETURNING id`,
        [STORE_ID, group.category, group.description],
      );

      for (const item of group.items) {
        await manager.query(
          `INSERT INTO products
             ("storeId", "categoryId", name, description, price, "costPrice", stock, "isActive")
           VALUES ($1, $2, $3, $4, $5, $6, 0, true)`,
          [
            STORE_ID,
            category.id,
            item.name,
            item.description ?? null,
            item.price,
            // Placeholder costing: the menu carries no cost data.
            round2(item.price * COST_RATIO),
            // Restaurant products do not track stock.
          ],
        );
      }

      console.log(`✅ ${group.category.padEnd(22)} ${String(group.items.length).padStart(3)} items`);
    }
  });

  console.log(`\n✨ Done — ${MENU.length} categories, ${totalItems} products.`);
  const pct = (n: number) => Math.round(n * 100);
  console.log(`   Cost price seeded at ${pct(COST_RATIO)}% of selling price (${pct(1 - COST_RATIO)}% margin).`);

  await dataSource.destroy();
}

main().catch((error) => {
  console.error('Seeding failed:', error.message);
  process.exit(1);
});
