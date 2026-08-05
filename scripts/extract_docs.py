"""Extract a clean recipe/item/building dataset from Satisfactory's Docs.json.

Docs.json is the game's own data dump, shipped in the install under
CommunityResources/Docs/. It is UTF-16 and stores nested structs as Unreal
property-blob strings, so it needs normalising before a UI can use it.

Two things worth knowing about the raw data:
  - Fluid and gas amounts are in litres, i.e. 1000x the in-game m^3 display.
  - Plenty of "recipes" build buildings or paint colours; only those produced
    in an actual manufacturer are production recipes.

Usage:
    python scripts/extract_docs.py [docs.json] [-o public/data.json]
"""
import argparse
import json
import re
import sys
from pathlib import Path

# Steam moves libraries around; check the usual suspects before giving up.
DEFAULT_DOCS = [
    Path(d) / "steamapps/common/Satisfactory/CommunityResources/Docs/en-US.json"
    for d in (
        r"H:\steam", r"C:\Program Files (x86)\Steam", r"D:\SteamLibrary",
        r"E:\SteamLibrary", r"F:\SteamLibrary", r"G:\SteamLibrary",
    )
]

ITEM_CLASSES = (
    "FGItemDescriptor", "FGResourceDescriptor", "FGItemDescriptorBiomass",
    "FGItemDescriptorNuclearFuel", "FGEquipmentDescriptor", "FGConsumableDescriptor",
    "FGAmmoTypeProjectile", "FGAmmoTypeInstantHit", "FGAmmoTypeSpreadshot",
    "FGPowerShardDescriptor", "FGItemDescriptorPowerBoosterFuel",
)
MANUFACTURER_CLASSES = ("FGBuildableManufacturer", "FGBuildableManufacturerVariablePower")
EXTRACTOR_CLASSES = (
    "FGBuildableResourceExtractor", "FGBuildableWaterPump", "FGBuildableFrackingExtractor",
)
FORMS = {"RF_SOLID": "solid", "RF_LIQUID": "liquid", "RF_GAS": "gas"}


def native(entry):
    """"...Class'/Script/FactoryGame.FGRecipe'" -> "FGRecipe" """
    m = re.search(r"FactoryGame\.(\w+)", entry["NativeClass"])
    return m.group(1) if m else entry["NativeClass"]


def short_class(path):
    """Any Unreal object path -> its trailing class name (Desc_IronOre_C)."""
    return path.strip().strip("\"'").rstrip("'").split(".")[-1]


def parse_item_amounts(blob):
    """'((ItemClass="...Desc_X_C\'",Amount=3),...)' -> [(class, amount)]"""
    return [
        (short_class(cls), float(amount))
        for cls, amount in re.findall(r"ItemClass=\"?(.+?)\"?,Amount=([\d.]+)\)", blob or "")
    ]


def parse_class_list(blob):
    """'("/Game/.../Build_X.Build_X_C","...")' -> [class, ...]"""
    return [short_class(p) for p in re.findall(r'"([^"]+)"', blob or "")]


def num(v, default=0.0):
    try:
        return float(v)
    except (TypeError, ValueError):
        return default


def find_docs():
    for p in DEFAULT_DOCS:
        if p.exists():
            return p
    sys.exit(
        "Could not find Docs/en-US.json. Pass the path explicitly:\n"
        "  python scripts/extract_docs.py \"<Satisfactory>/CommunityResources/Docs/en-US.json\""
    )


def build_items(by_native):
    items = {}
    for key in ITEM_CLASSES:
        for c in by_native.get(key, []):
            items[c["ClassName"]] = {
                "class": c["ClassName"],
                "name": c["mDisplayName"],
                "form": FORMS.get(c.get("mForm", "RF_SOLID"), "solid"),
                "stackSize": c.get("mStackSize"),
                "energyMJ": num(c.get("mEnergyValue")),
                "sinkPoints": int(num(c.get("mResourceSinkPoints"), -1)),
                "isRawResource": key == "FGResourceDescriptor",
            }
    return items


def build_buildings(by_native, items):
    buildings = {}
    for key in MANUFACTURER_CLASSES + EXTRACTOR_CLASSES:
        for c in by_native.get(key, []):
            is_extractor = key in EXTRACTOR_CLASSES
            b = {
                "class": c["ClassName"],
                "name": c["mDisplayName"],
                "kind": "extractor" if is_extractor else "manufacturer",
                "powerMW": num(c.get("mPowerConsumption")),
                "powerExponent": num(c.get("mPowerConsumptionExponent"), 1.6),
            }
            if is_extractor:
                per_cycle = num(c.get("mItemsPerCycle"))
                cycle = num(c.get("mExtractCycleTime"))
                allowed = parse_class_list(c.get("mAllowedResources"))
                # Liquid extractors report litres per cycle, same x1000 as recipes.
                forms = [items[r]["form"] for r in allowed if r in items]
                if per_cycle and any(f in ("liquid", "gas") for f in forms):
                    per_cycle /= 1000.0
                b["allowedResources"] = allowed
                b["allowedForms"] = [
                    FORMS.get(f, f) for f in parse_class_list(c.get("mAllowedResourceForms"))
                ] or sorted(set(forms))
                # Rate at a normal-purity node, 100% clock.
                b["baseRatePerMin"] = round(per_cycle * 60.0 / cycle, 6) if cycle else None
            buildings[c["ClassName"]] = b
    return buildings


def build_recipes(by_native, items, buildings):
    def scale(cls, amount):
        it = items.get(cls)
        return amount / 1000.0 if it and it["form"] in ("liquid", "gas") else amount

    recipes = []
    for c in by_native.get("FGRecipe", []):
        made_in = [m for m in parse_class_list(c.get("mProducedIn")) if m in buildings]
        if not made_in:
            continue  # build-gun recipe, handcraft-only, or customizer paint

        duration = num(c.get("mManufactoringDuration"))
        if duration <= 0:
            continue
        per_min = 60.0 / duration

        def side(blob):
            rows = []
            for cls, amt in parse_item_amounts(blob):
                if cls not in items:
                    return None  # yields a building, not an item
                a = scale(cls, amt)
                rows.append({"item": cls, "amount": a, "perMinute": round(a * per_min, 6)})
            return rows

        ins, outs = side(c.get("mIngredients")), side(c.get("mProduct"))
        if ins is None or outs is None or not outs:
            continue

        # Most alternates carry a Recipe_Alternate_ prefix, but a handful (e.g.
        # Recipe_PureAluminumIngot_C) do not and are only marked in the display name.
        name = c["mDisplayName"]
        recipes.append({
            "class": c["ClassName"],
            "name": name,
            "alternate": c["ClassName"].startswith("Recipe_Alternate_")
                         or name.startswith("Alternate:"),
            "durationSec": duration,
            "building": made_in[0],
            "ingredients": ins,
            "products": outs,
            "variablePowerConstant": num(c.get("mVariablePowerConsumptionConstant")),
            "variablePowerFactor": num(c.get("mVariablePowerConsumptionFactor")),
        })
    return sorted(recipes, key=lambda r: (r["alternate"], r["name"]))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("docs", nargs="?", type=Path)
    ap.add_argument("-o", "--out", type=Path, default=Path("public/data.json"))
    args = ap.parse_args()

    docs_path = args.docs or find_docs()
    raw = json.loads(docs_path.read_bytes().decode("utf-16"))

    by_native = {}
    for entry in raw:
        by_native.setdefault(native(entry), []).extend(entry["Classes"])

    items = build_items(by_native)
    buildings = build_buildings(by_native, items)
    recipes = build_recipes(by_native, items, buildings)

    # Drop items nothing can make, extract or consume.
    used = {r["item"] for rec in recipes for r in rec["ingredients"] + rec["products"]}
    used |= {r for b in buildings.values() for r in b.get("allowedResources", [])}
    used |= {k for k, v in items.items() if v["isRawResource"]}

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps({
        "source": str(docs_path),
        "items": {k: v for k, v in items.items() if k in used},
        "buildings": buildings,
        "recipes": recipes,
    }, indent=1), encoding="utf-8")

    alts = sum(1 for r in recipes if r["alternate"])
    print(f"{args.out}: {len(used)} items, {len(buildings)} buildings, "
          f"{len(recipes)} recipes ({alts} alternate)")


if __name__ == "__main__":
    main()
