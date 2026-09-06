import { categorySkipsKitchen, kitchenLines } from './kitchen-routing';

describe('categorySkipsKitchen', () => {
  it('skips the kitchen for a category flagged by the owner', () => {
    expect(categorySkipsKitchen({ name: 'Desserts', skipKitchen: true })).toBe(true);
  });

  it.each(['Drinks', 'Cold Drinks', 'drinks & shakes', 'Beverages', 'Hot Beverage', 'DRINK'])(
    'skips the kitchen for a category named "%s" without any flag',
    (name) => {
      expect(categorySkipsKitchen({ name })).toBe(true);
    },
  );

  it.each(['Mains', 'Starters', 'Pizza', 'Drinkables', 'Sundowners'])(
    'sends "%s" to the kitchen',
    (name) => {
      expect(categorySkipsKitchen({ name, skipKitchen: false })).toBe(false);
    },
  );

  it('treats a missing category as something to cook', () => {
    expect(categorySkipsKitchen(null)).toBe(false);
    expect(categorySkipsKitchen(undefined)).toBe(false);
  });
});

describe('kitchenLines', () => {
  it('drops the lines the kitchen does not cook', () => {
    const lines = [
      { productName: 'Pizza', skipKitchen: false },
      { productName: 'Cola', skipKitchen: true },
      { productName: 'Fries' },
    ];
    expect(kitchenLines(lines).map((l) => l.productName)).toEqual(['Pizza', 'Fries']);
  });

  it('returns an empty list for a drinks-only order', () => {
    expect(kitchenLines([{ skipKitchen: true }, { skipKitchen: true }])).toEqual([]);
  });
});
