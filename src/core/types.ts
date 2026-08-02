/** Shapes produced by scripts/extract_docs.py, plus the plan model layered on top. */

export type ItemForm = "solid" | "liquid" | "gas";

export interface Item {
  class: string;
  name: string;
  form: ItemForm;
  stackSize: number | null;
  energyMJ: number;
  sinkPoints: number;
  isRawResource: boolean;
}

export interface Building {
  class: string;
  name: string;
  kind: "manufacturer" | "extractor";
  powerMW: number;
  powerExponent: number;
  /** extractors only: yield at a normal-purity node, 100% clock */
  baseRatePerMin?: number | null;
  allowedResources?: string[];
  allowedForms?: string[];
}

export interface RecipePort {
  item: string;
  amount: number;
  perMinute: number;
}

export interface Recipe {
  class: string;
  name: string;
  alternate: boolean;
  durationSec: number;
  machine: string;
  ingredients: RecipePort[];
  products: RecipePort[];
  variablePowerConstant: number;
  variablePowerFactor: number;
}

export interface GameData {
  source: string;
  items: Record<string, Item>;
  buildings: Record<string, Building>;
  recipes: Recipe[];
}

/* ------------------------------------------------------------------ plan */

/** One row of the old spreadsheet: a recipe run on N machines at a given clock. */
export interface PlanNode {
  id: string;
  recipe: string;
  /** "Anzahl" — machine count, fractional allowed */
  count: number;
  /** overclock percentage, 100 = default */
  clock: number;
  position: { x: number; y: number };
  note?: string;
}

/** A rate the site must deliver (target) or may draw on (import). */
export interface PlanFlow {
  id: string;
  item: string;
  perMinute: number;
}

export interface Site {
  id: string;
  name: string;
  nodes: PlanNode[];
  /** what this site must output, over and above internal consumption */
  targets: PlanFlow[];
  /** what arrives by belt/train from elsewhere, so it isn't flagged as a deficit */
  imports: PlanFlow[];
}

export interface Plan {
  version: 1;
  sites: Site[];
}

/* -------------------------------------------------------------- computed */

export interface ItemBalance {
  item: string;
  produced: number;
  consumed: number;
  imported: number;
  target: number;
  /** produced + imported - consumed - target; negative means the site is short */
  net: number;
}

export interface NodeResult {
  nodeId: string;
  /** effective machine-multiplier, i.e. count * clock/100 */
  effective: number;
  inputs: RecipePort[];
  outputs: RecipePort[];
  powerMW: number;
}

export interface SiteResult {
  nodes: NodeResult[];
  balances: ItemBalance[];
  /** raw ores/fluids the site must be fed, keyed by item class */
  rawInputs: ItemBalance[];
  totalPowerMW: number;
}
