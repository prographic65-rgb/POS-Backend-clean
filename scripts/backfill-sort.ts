import 'reflect-metadata';
// Nest loads .env through ConfigModule; a standalone script has to do it
// itself, or typeormConfig() silently falls back to localhost defaults.
import * as dotenv from 'dotenv';
dotenv.config();

import { createConnection, IsNull } from 'typeorm';
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
 * Number the menu.
 *
 * `sortOrder` on categories and products fixes where each appears on the
 * till, but every row written before the column existed is NULL and sorts
 * to the bottom in name order. This gives each store's unnumbered rows a
 * number, in the order they were created, continuing from whatever the
 * store's highest number already is — so nothing an owner has numbered by
 * hand is disturbed and nothing collides with it.
 *
 *   npm run db:backfill-sort            # dry run: prints what it WOULD do
 *   npm run db:backfill-sort -- --apply # writes
 *   npm run db:backfill-sort -- --store=<uuid>
 *
 * Safe to re-run: a row that already has a number is never touched.
 */

interface Numbered {
  id: string;
  name: string;
  storeId: string | null;
  sortOrder: number | null;
  createdAt: Date;
}

interface Plan {
  kind: 'category' | 'product';
  id: string;
  name: string;
  storeId: string | null;
  sortOrder: number;
}

/** Per store: unnumbered rows get max+1, max+2, … in creation order. */
function plan(kind: Plan['kind'], rows: Numbered[]): Plan[] {
  const byStore = new Map<string | null, Numbered[]>();
  for (const row of rows) {
    const bucket = byStore.get(row.storeId);
    if (bucket) bucket.push(row);
    else byStore.set(row.storeId, [row]);
  }

  const out: Plan[] = [];
  for (const [storeId, bucket] of byStore) {
    let next =
      bucket.reduce((max, row) => (row.sortOrder == null ? max : Math.max(max, row.sortOrder)), 0) + 1;
    const unnumbered = bucket
      .filter((row) => row.sortOrder == null)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    for (const row of unnumbered) {
      out.push({ kind, id: row.id, name: row.name, storeId, sortOrder: next++ });
    }
  }
  return out;
}

async function main() {
  const apply = process.argv.includes('--apply');
  const storeArg = process.argv.find((a) => a.startsWith('--store='));
  const storeId = storeArg ? storeArg.split('=')[1] : undefined;

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

    const planned = [...plan('category', categories), ...plan('product', products)];
    const untouched =
      categories.filter((c) => c.sortOrder != null).length +
      products.filter((p) => p.sortOrder != null).length;

    console.log('\n── would number ──');
    for (const row of planned) {
      console.log(`  #${String(row.sortOrder).padStart(3)}  ${row.kind.padEnd(8)} ${row.name}`);
    }
    console.log(`\n── already numbered, untouched ── ${untouched}`);

    if (!apply) {
      console.log('\n👀 Dry run — nothing was written. Re-run with --apply to commit.\n');
      return;
    }

    for (const row of planned) {
      const repo =
        row.kind === 'category'
          ? connection.getRepository(Category)
          : connection.getRepository(Product);
      // Guarded on IsNull so a row numbered by hand between the read and the
      // write is left alone rather than overwritten.
      await repo.update({ id: row.id, sortOrder: IsNull() } as any, { sortOrder: row.sortOrder } as any);
    }

    console.log(`\n✅ Numbered ${planned.length} rows.\n`);
  } finally {
    await connection.close();
  }
}

main().catch((error) => {
  console.error('❌ Backfill failed:', error);
  process.exit(1);
});
