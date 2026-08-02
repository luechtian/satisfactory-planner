import { PURITY_MULTIPLIER } from "./types";
import type { Building, ExtractorNode, GameData, Item, Purity, Recipe } from "./types";

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

/**
 * Water Extractors pull a flat 120/min wherever they sit — there is no node purity to
 * pick, unlike miners, oil pumps and wells.
 */
export const hasPurity = (building: string) => building !== "Build_WaterPump_C";

/** What one extractor yields at 100% clock on a node of the given purity. */
export function extractorRateFor(db: Db, building: string, purity: Purity): number {
  const b = db.buildings[building];
  if (!b?.baseRatePerMin) return 0;
  return b.baseRatePerMin * (hasPurity(building) ? PURITY_MULTIPLIER[purity] : 1);
}

export const extractorRate = (db: Db, node: ExtractorNode) =>
  extractorRateFor(db, node.building, node.purity);

/**
 * Preference order when the planner has to pick an extractor itself. Miners declare no
 * allowed resources and take any solid, so they are tried first; the dedicated pumps
 * beat the Resource Well, which also accepts water and oil but needs a pressurizer.
 */
const EXTRACTOR_PREFERENCE = [
  "Build_MinerMk3_C", "Build_WaterPump_C", "Build_OilPump_C", "Build_FrackingExtractor_C",
];

/** The extractor to place for a resource when none was chosen, or null if none fits. */
export function defaultExtractorFor(db: Db, resource: string): string | null {
  for (const building of EXTRACTOR_PREFERENCE) {
    if (!db.buildings[building]) continue;
    if (resourcesFor(db, building).some((i) => i.class === resource)) return building;
  }
  return null;
}

/** Extractor power scales with clock just like a manufacturer. */
export function extractorPower(db: Db, node: ExtractorNode): number {
  const b = db.buildings[node.building];
  if (!b) return 0;
  return b.powerMW * node.count * Math.pow(node.clock / 100, b.powerExponent);
}

/** Resources a given extractor may be placed on. Miners list nothing and take any solid. */
export function resourcesFor(db: Db, building: string): Item[] {
  const b = db.buildings[building];
  const raws = Object.values(db.items).filter((i) => i.isRawResource);
  if (!b) return raws;
  if (b.allowedResources?.length) {
    return b.allowedResources.map((r) => db.items[r]).filter(Boolean);
  }
  const forms = new Set(b.allowedForms?.length ? b.allowedForms : ["solid"]);
  return raws.filter((i) => forms.has(i.form));
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
