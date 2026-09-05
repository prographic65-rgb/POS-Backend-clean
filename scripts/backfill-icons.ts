import 'reflect-metadata';
// Nest loads .env through ConfigModule; a standalone script has to do it
// itself, or typeormConfig() silently falls back to localhost defaults.
import * as dotenv from 'dotenv';
dotenv.config();

import { createConnection } from 'typeorm';
import { typeormConfig } from '../src/database/typeorm.config';
import * as entities from '../src/entities';
import { Category, Product } from '../src/entities';

/**
 * Every entity, not just the two being written: Category and Product point at
 * Store and OrderItem, and TypeORM refuses to build metadata for half a graph.
 */
const ALL_ENTITIES = (Object.values(entities) as unknown[]).filter(
  (value) => typeof value === 'function',
) as Function[];

/**
 * Give existing menus their icons.
 *
 * The `image` column on products and categories holds an emoji, but every row
 * written before the icon pickers existed is NULL — so every tile in the till
 * falls back to the same generic glyph, which is worse than no icon at all.
 * This reads each name and stamps the obvious match.
 *
 *   npm run db:backfill-icons            # dry run: prints what it WOULD do
 *   npm run db:backfill-icons -- --apply # writes
 *   npm run db:backfill-icons -- --store=<uuid>
 *
 * Two rules keep it safe to re-run:
 *   - a row that already has an icon is never touched, so an owner's own
 *     choice always wins over this guesswork;
 *   - a name that matches nothing is left NULL rather than given a wrong
 *     icon. A dish left NULL inherits its category's, which is the whole
 *     point of the fallback — most dishes should never need their own.
 */

/** Only icons that exist on the pickers' shelf, so a backfilled row shows as selected. */
const SHELF = new Set([
  '🍔', '🍕', '🍟', '🌭', '🥪', '🌮', '🌯', '🥙', '🍝', '🍜', '🍲', '🍛',
  '🍗', '🍖', '🥩', '🍢', '🍤', '🐟', '🦐', '🥓', '🍳', '🥚', '🧆', '🫓',
  '🥗', '🍚', '🍱', '🥘', '🍞', '🥐', '🥖', '🧀', '🥔', '🌽', '🥕', '🥒',
  '🍰', '🧁', '🍩', '🍪', '🍫', '🍬', '🍮', '🍨', '🍦', '🥧', '🍯', '🍡',
  '☕', '🍵', '🥤', '🧋', '🧃', '🥛', '🧉', '🍺', '🍷', '🍹', '🧊', '🍾',
  '🍎', '🍌', '🍇', '🍓', '🍉', '🥭', '🍍', '🥥', '📦', '🛍️', '🧴', '🧼',
]);

/**
 * Keyword to icon, most specific FIRST — "chicken burger" has to land on the
 * burger, not the drumstick, so 'burger' is tested before 'chicken'.
 */
const RULES: Array<[string[], string]> = [
  // --- condiments first: "Cocktail Dip" is a sauce, not a cocktail, and
  //     "Honey Mustard Dip" must not be filed under honey.
  [['dip', 'sauce', 'ketchup', 'mayo', 'chutney', 'raita sauce'], '🍯'],

  // --- named fast food, before any ingredient word can claim it
  [['zinger', 'burger'], '🍔'],
  [['margarita', 'margherita', 'pepperoni', 'calzone'], '🍕'],
  [['dinner roll'], '🍞'],
  [['pizza', 'calzone'], '🍕'],
  [['fries', 'french fry', 'chips', 'wedges'], '🍟'],
  [['hot dog', 'hotdog'], '🌭'],
  [['sandwich', 'club sand', 'panini', 'sub '], '🥪'],
  [['shawarma', 'wrap', 'paratha roll', 'roll'], '🌯'],
  [['taco', 'nacho', 'quesadilla', 'burrito'], '🌮'],
  [['pasta', 'spaghetti', 'macaroni', 'lasagna', 'lasagne', 'penne', 'alfredo'], '🍝'],
  [['noodle', 'chowmein', 'chow mein', 'ramen', 'soup', 'shorba'], '🍜'],
  [['pita', 'gyro', 'falafel wrap'], '🥙'],

  // --- desi mains
  [['biryani', 'biriyani', 'pulao', 'pilaf', 'fried rice', 'rice', 'chawal'], '🍛'],
  [
    [
      'karahi', 'handi', 'qorma', 'korma', 'nihari', 'haleem', 'salan', 'curry',
      'daal', 'dal', 'chana', 'chanay', 'gravy', 'masala', 'bhuna',
    ],
    '🥘',
  ],
  [['tikka', 'boti', 'seekh', 'kabab', 'kebab', 'bbq', 'barbecue', 'tandoori', 'grill', 'malai'], '🍢'],
  [['nihari'], '🍲'],
  [['qeema', 'keema', 'mutton', 'beef', 'steak', 'lamb', 'burra'], '🥩'],
  [['broast', 'wings', 'nugget', 'drumstick', 'fried chicken', 'chicken'], '🍗'],
  [['bacon'], '🥓'],
  [['prawn', 'shrimp'], '🍤'],
  [['fish', 'machli', 'machhli', 'salmon', 'tuna'], '🐟'],

  // --- breads and sides
  [['naan', 'roti', 'chapati', 'paratha', 'kulcha', 'sheermal', 'taftan', 'tandoori roti'], '🫓'],
  [['garlic bread', 'baguette'], '🥖'],
  [['bread', 'bun', 'toast', 'rusk'], '🍞'],
  [['croissant'], '🥐'],
  [['samosa', 'pakora', 'spring roll', 'cutlet', 'fritter', 'falafel'], '🧆'],
  [['salad', 'coleslaw', 'russian'], '🥗'],
  [['omelette', 'omelet', 'anda', 'egg'], '🍳'],
  [['cheese', 'mozzarella', 'paneer'], '🧀'],
  [['corn'], '🌽'],
  [['potato', 'aloo', 'mashed'], '🥔'],
  [['carrot', 'gajar'], '🥕'],
  [['cucumber', 'kheera', 'salad ka'], '🥒'],

  // --- sweets
  [['ice cream', 'icecream', 'kulfi', 'falooda', 'sundae', 'cone'], '🍦'],
  [['cake', 'gateau'], '🍰'],
  [['pastry', 'cupcake', 'muffin'], '🧁'],
  [['donut', 'doughnut'], '🍩'],
  [['cookie', 'biscuit'], '🍪'],
  [['chocolate', 'brownie', 'fudge'], '🍫'],
  [['kheer', 'custard', 'trifle', 'pudding', 'firni', 'caramel'], '🍮'],
  [['gulab jamun', 'jalebi', 'barfi', 'mithai', 'halwa', 'ras malai', 'rasmalai', 'sweet'], '🍡'],
  [['pie'], '🥧'],
  [['honey', 'shahad'], '🍯'],
  [['candy', 'toffee'], '🍬'],

  // --- drinks
  [['chai', 'tea', 'karak', 'doodh patti'], '☕'],
  [['green tea', 'kahwa', 'qehwa'], '🍵'],
  [['coffee', 'espresso', 'latte', 'cappuccino', 'mocha', 'americano'], '☕'],
  [['lassi', 'milk', 'doodh', 'raita', 'yogurt', 'dahi'], '🥛'],
  [['shake', 'smoothie', 'malt'], '🧋'],
  [['juice', 'nectar'], '🧃'],
  [['mojito', 'mocktail', 'slush', 'cocktail', 'punch'], '🍹'],
  [['water', 'aqua', 'mineral', 'ice'], '🧊'],
  [
    ['pepsi', 'coke', 'coca', 'cola', 'sprite', '7up', 'seven up', 'fanta', 'mirinda', 'dew', 'soda', 'soft drink', 'cold drink', 'drink', 'beverage'],
    '🥤',
  ],

  // --- fruit
  [['apple'], '🍎'],
  [['banana', 'kela'], '🍌'],
  [['grape', 'angoor'], '🍇'],
  [['strawberry'], '🍓'],
  [['watermelon', 'tarbooz'], '🍉'],
  [['mango', 'aam'], '🥭'],
  [['pineapple'], '🍍'],
  [['coconut', 'nariyal'], '🥥'],

  // --- generic buckets, last resort before giving up. These mostly catch
  //     CATEGORY names, which is where they earn their keep: a dish under
  //     "Regular Deals" with no icon of its own still gets a sensible one.
  [['deal', 'combo', 'platter', 'meal', 'family', 'box'], '🍱'],
  [['starter', 'appetiser', 'appetizer', 'snack', 'side'], '🧆'],
  [['add on', 'addon', 'extra', 'topping'], '📦'],
];

/**
 * First rule whose keyword appears in the name, or null to leave it unset.
 *
 * Matched on word boundaries so "rice" does not fire on "price" and "dal"
 * does not fire on "dalda" — a wrong icon is worse than none, because the
 * owner has to notice it before they can fix it.
 */
function suggest(name: string): string | null {
  const haystack = ` ${name.toLowerCase().replace(/[^a-z0-9]+/g, ' ')} `;
  for (const [keywords, icon] of RULES) {
    for (const keyword of keywords) {
      const needle = keyword.replace(/[^a-z0-9]+/g, ' ').trim();
      // Plural-tolerant: category names are almost always plural ("Burgers",
      // "Wraps", "Sandwiches") while the keywords read naturally in the
      // singular, and categories are the rows that matter most here — every
      // dish under one inherits its icon.
      const pattern = `\\b${needle.replace(/\s+/g, '\\s+')}(?:e?s)?\\b`;
      if (new RegExp(pattern).test(haystack)) {
        return icon;
      }
    }
  }
  return null;
}

const isUnset = (value: unknown) => value === null || value === undefined || String(value).trim() === '';

async function main() {
  const apply = process.argv.includes('--apply');
  const storeArg = process.argv.find((a) => a.startsWith('--store='));
  const storeId = storeArg ? storeArg.split('=')[1] : undefined;

  const badIcons = RULES.map(([, icon]) => icon).filter((icon) => !SHELF.has(icon));
  if (badIcons.length) {
    throw new Error(`Rules use icons that are not on the picker shelf: ${badIcons.join(' ')}`);
  }

  // Cast: typeormConfig() is typed as Nest's option union, which createConnection
  // cannot narrow. `synchronize` off — a backfill must never alter the schema.
  const connection = await createConnection({
    ...(typeormConfig() as any),
    entities: ALL_ENTITIES,
    synchronize: false,
  } as any);

  try {
    const where = storeId ? { storeId } : {};
    const categories = await connection.getRepository(Category).find({ where });
    const products = await connection.getRepository(Product).find({ where });

    console.log(
      `\n${apply ? '✍️  APPLYING' : '👀 DRY RUN'} — ${categories.length} categories, ${products.length} products` +
        (storeId ? ` (store ${storeId})` : ' (all stores)'),
    );

    const planned: Array<{ kind: string; id: string; name: string; icon: string }> = [];
    const skipped: string[] = [];
    const unmatched: string[] = [];

    for (const category of categories) {
      if (!isUnset(category.image)) {
        skipped.push(`category "${category.name}" (${category.image})`);
        continue;
      }
      const icon = suggest(category.name ?? '');
      if (icon) planned.push({ kind: 'category', id: category.id, name: category.name, icon });
      else unmatched.push(`category "${category.name}"`);
    }

    for (const product of products) {
      if (!isUnset(product.image)) {
        skipped.push(`product "${product.name}" (${product.image})`);
        continue;
      }
      const icon = suggest(product.name ?? '');
      if (icon) planned.push({ kind: 'product', id: product.id, name: product.name, icon });
      else unmatched.push(`product "${product.name}"`);
    }

    console.log('\n── would set ──');
    for (const row of planned) {
      console.log(`  ${row.icon}  ${row.kind.padEnd(8)} ${row.name}`);
    }

    /**
     * A product left unset is not a product left blank — it inherits. What
     * actually matters is how many tiles end up on the neutral glyph, which
     * is the complaint this backfill exists to answer.
     */
    const iconAfter = new Map<string, string>();
    for (const category of categories) {
      const resolved = !isUnset(category.image)
        ? String(category.image)
        : planned.find((p) => p.kind === 'category' && p.id === category.id)?.icon;
      if (resolved) iconAfter.set(category.id, resolved);
    }

    const inheriting: string[] = [];
    const neutral: string[] = [];
    for (const product of products) {
      if (!isUnset(product.image)) continue;
      if (planned.some((p) => p.kind === 'product' && p.id === product.id)) continue;
      const inherited = product.categoryId ? iconAfter.get(product.categoryId) : undefined;
      if (inherited) inheriting.push(`${inherited}  ${product.name}`);
      else neutral.push(product.name);
    }

    console.log(`\n── left unset, but INHERITS its category's icon ── ${inheriting.length}`);
    for (const row of inheriting.slice(0, 15)) console.log(`  ${row}`);
    if (inheriting.length > 15) console.log(`  … and ${inheriting.length - 15} more`);

    console.log(`\n── would still show the neutral glyph, pick these by hand ── ${neutral.length}`);
    for (const row of neutral) console.log(`  ·  ${row}`);
    const blankCategories = unmatched.filter((row) => row.startsWith('category'));
    for (const row of blankCategories) console.log(`  ·  ${row}`);

    console.log(`\n── already had an icon, untouched ── ${skipped.length}`);
    for (const row of skipped.slice(0, 20)) console.log(`  ·  ${row}`);
    if (skipped.length > 20) console.log(`  … and ${skipped.length - 20} more`);

    if (!apply) {
      console.log('\n👀 Dry run — nothing was written. Re-run with --apply to commit.\n');
      return;
    }

    for (const row of planned) {
      const repo =
        row.kind === 'category'
          ? connection.getRepository(Category)
          : connection.getRepository(Product);
      await repo.update(row.id, { image: row.icon } as any);
    }

    console.log(`\n✅ Updated ${planned.length} rows.\n`);
  } finally {
    await connection.close();
  }
}

main().catch((error) => {
  console.error('❌ Backfill failed:', error);
  process.exit(1);
});
