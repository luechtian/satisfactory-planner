import type { Building, GameData, Item, Recipe } from "./types";

/** Indexed view of data.json, built once at startup. */
export interface Db {
  raw: GameData;
  items: Record<string, Item>;
  buildings: Record<string, Building>;
  recipes: Recipe[];
  recipeByClass: Record<string, Recipe>;
  /** every recipe that yields this item, default recipe first */
  producersOf: Record<string, Recipe[]>;
  consumersOf: Record<string, Recipe[]>;
  itemName: (cls: string) => string;
}

export async function loadDb(): Promise<Db> {
  const res = await fetch(`${import.meta.env.BASE_URL}data.json`);
  if (!res.ok) {
    throw new Error(
      "data.json missing — run `python scripts/extract_docs.py` to generate it from your game install.",
    );
  }
  return indexDb(await res.json());
}

export function indexDb(raw: GameData): Db {
  const recipeByClass: Record<string, Recipe> = {};
  const producersOf: Record<string, Recipe[]> = {};
  const consumersOf: Record<string, Recipe[]> = {};

  for (const r of raw.recipes) {
    recipeByClass[r.class] = r;
    for (const p of r.products) (producersOf[p.item] ??= []).push(r);
    for (const i of r.ingredients) (consumersOf[i.item] ??= []).push(r);
  }
  // Rank so index 0 is "the obvious way to make this": recipes where the item is the
  // primary product beat ones where it only falls out as a byproduct, and standard
  // recipes beat alternates. Without the first rule, asking for Silica would scale up
  // Alumina Solution rather than reaching for Raw Quartz.
  for (const [item, list] of Object.entries(producersOf)) {
    list.sort(
      (a, b) =>
        Number(b.products[0]?.item === item) - Number(a.products[0]?.item === item) ||
        Number(a.alternate) - Number(b.alternate) ||
        a.name.localeCompare(b.name),
    );
  }

  return {
    raw,
    items: raw.items,
    buildings: raw.buildings,
    recipes: raw.recipes,
    recipeByClass,
    producersOf,
    consumersOf,
    itemName: (cls) => raw.items[cls]?.name ?? cls,
  };
}

/** Overclocking costs power superlinearly: P = base * (clock/100) ^ exponent. */
export function powerFor(db: Db, recipe: Recipe, count: number, clock: number): number {
  const b = db.buildings[recipe.machine];
  if (!b) return 0;
  const base = recipe.variablePowerConstant
    ? recipe.variablePowerConstant + recipe.variablePowerFactor / 2
    : b.powerMW;
  return base * count * Math.pow(clock / 100, b.powerExponent);
}

export function searchRecipes(db: Db, query: string, limit = 60): Recipe[] {
  const q = query.trim().toLowerCase();
  if (!q) return db.recipes.slice(0, limit);
  const scored: Array<[number, Recipe]> = [];
  for (const r of db.recipes) {
    const name = r.name.toLowerCase();
    const machine = db.buildings[r.machine]?.name.toLowerCase() ?? "";
    const products = r.products.map((p) => db.itemName(p.item).toLowerCase()).join(" ");
    let score = -1;
    if (name.startsWith(q)) score = 0;
    else if (name.includes(q)) score = 1;
    else if (products.includes(q)) score = 2;
    else if (machine.includes(q)) score = 3;
    if (score >= 0) scored.push([score + (r.alternate ? 0.5 : 0), r]);
  }
  scored.sort((a, b) => a[0] - b[0] || a[1].name.localeCompare(b[1].name));
  return scored.slice(0, limit).map(([, r]) => r);
}
