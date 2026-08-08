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
  /**
   * Generators are here because burning fuel is a material flow like any other — it is
   * the only thing in the game that makes Uranium and Plutonium Waste. Their *power* is
   * not modelled yet: a generator's `powerMW` is 0, since power crosses site boundaries
   * on one global grid and so does not belong in a per-site total.
   */
  kind: "manufacturer" | "extractor" | "generator";
  powerMW: number;
  powerExponent: number;
  /** generators only: MW put onto the grid at 100% clock. Recorded, not yet used. */
  powerProductionMW?: number;
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
  /** class of the building that runs it, e.g. Build_ConstructorMk1_C */
  building: string;
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

export type Purity = "impure" | "normal" | "pure";

export const PURITY_MULTIPLIER: Record<Purity, number> = {
  impure: 0.5,
  normal: 1,
  pure: 2,
};

interface NodeBase {
  id: string;
  /** how many buildings; always a whole number, part-loading is expressed as clock */
  count: number;
  /** overclock percentage, 100 = default */
  clock: number;
  position: { x: number; y: number };
  note?: string;
}

/**
 * One row of the old spreadsheet: a recipe run on N buildings at a given clock.
 *
 * Named for the game's own grouping — `FGBuildableManufacturer` covers the Constructor,
 * Assembler, Refinery and the rest — rather than "building", which would be true of an
 * extractor too and so could not tell the two apart. The interface says *buildings*,
 * because one of the eleven is itself called the Manufacturer.
 */
export interface ManufacturerNode extends NodeBase {
  /**
   * Absent on every plan this app has written, since only extractors need marking. Read
   * defensively rather than relied on: `isExtractor` is the only test that matters.
   */
  kind?: "manufacturer";
  recipe: string;
}

/** Miners, pumps and wells — where raw resources actually enter the factory. */
export interface ExtractorNode extends NodeBase {
  kind: "extractor";
  /** building class, e.g. Build_MinerMk3_C */
  building: string;
  resource: string;
  purity: Purity;
}

export type PlanNode = ManufacturerNode | ExtractorNode;

export const isExtractor = (n: PlanNode): n is ExtractorNode => n.kind === "extractor";

/** A rate the site must deliver (target) or may draw on (import). */
export interface PlanFlow {
  id: string;
  item: string;
  perMinute: number;
  /**
   * Imports only: the site this is belted or trained from. Absent means it comes from
   * outside the plan entirely, which is what every import was before links existed.
   */
  from?: string;
}

export interface Site {
  id: string;
  name: string;
  /**
   * Optional heading shown in the tab bar. Sites keep one flat order; a group is only
   * a label that starts a run, so arranging them is the same act as reordering.
   */
  group?: string;
  nodes: PlanNode[];
  /** what this site must output, over and above internal consumption */
  targets: PlanFlow[];
  /** what arrives by belt/train from elsewhere, so it isn't flagged as a deficit */
  imports: PlanFlow[];
  /**
   * Where the derived target/export nodes have been dragged to, keyed by their
   * synthetic id. Purely presentation — the flow itself still lives in `targets` or in
   * the consuming site's import, so this is not a second copy of anything.
   */
  sinkPositions?: Record<string, { x: number; y: number }>;
  /** where this site sits on the All-sites map, once dragged */
  mapPosition?: { x: number; y: number };
  /**
   * Which recipe to make an item by, keyed by item class. Absent — the usual case —
   * leaves it to the solver: whatever is already on the canvas, else the default.
   *
   * Per site rather than per plan, because two sites can legitimately smelt
   * differently: the one next to the oil is the one that should be leaching iron.
   */
  recipeChoice?: Record<string, string>;
  /**
   * Belts drawn by hand.
   *
   * Rates alone cannot say whether two water extractors feed one shared manifold or two
   * separate sub-factories, so anything drawn here is taken as fact and routed first.
   * Whatever is left over still pools, which keeps a half-wired site balancing.
   */
  connections?: SiteConnection[];
}

export interface SiteConnection {
  id: string;
  /** node id, or a synthetic sink id for a target/export */
  from: string;
  to: string;
  item: string;
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
  /**
   * Owed to other sites, because they import it from here.
   *
   * A site's own `targets` are deliberately *not* counted. A target is the seed you
   * hand the solver to lay a chain out, not a standing promise the site is judged
   * against forever — once the chain exists, what matters is what the site actually
   * makes and who has claimed it.
   */
  committed: number;
  /** produced + imported - consumed - committed; negative means the site is short */
  net: number;
}

export interface NodeResult {
  nodeId: string;
  /** effective building-multiplier, i.e. count * clock/100 */
  effective: number;
  inputs: RecipePort[];
  outputs: RecipePort[];
  powerMW: number;
}

export interface SiteResult {
  nodes: NodeResult[];
  balances: ItemBalance[];
  /**
   * Every raw resource the site touches, covered or not, so supply can be typed in
   * against the demand. Raws are excluded from the shortage list to avoid listing
   * the same ore twice.
   */
  raws: ItemBalance[];
  totalPowerMW: number;
}
