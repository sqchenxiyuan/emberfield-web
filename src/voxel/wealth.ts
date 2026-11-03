import type { VoxelSimulation } from './world';
import { Block, type ApparelPiece, type Cargo, type Counts, type Pawn, type Resource } from './types';
import { WEAPON_DEFS, type WeaponPiece } from './weapons';
import { APPAREL_DEFS, TAILOR_COST, TAILOR_WORK } from './apparel';
import { DEVICE_COSTS, DEVICE_WORK } from './power';
import { STONECUTTER_COST, STONECUTTER_WORK, STONE_CONSTRUCTION } from './crafting';
import { MACHINING_COST, MACHINING_WORK, SANDBAG_COST, SANDBAG_WORK, SMITHY_COST, SMITHY_WORK } from './weaponProduction';
import { RESEARCH_BENCH_COST, RESEARCH_BENCH_WORK } from './research';
import { BODY_PARTS, isDescendantOrSelf, roundedCapacity, type CapacityKey } from './anatomy';
import { isFreshStump, injuryBleedRate, traumaSummary } from './injuries';
import { healthSummary } from './survival';
import { SKILL_KEYS } from './skills';
import type { WealthTotals } from './storytellerRules';
import { ANIMAL_DEFS } from './wildlife';
import { HORSESHOE_COST, HORSESHOE_WORK } from './recreation';

/** Core 1.7 selected full-HP resource prices, except provisional meat=2.
 * Carcasses use their species' meat yield below; deposits/plants are not items. */
export const RESOURCE_MARKET_VALUE: Readonly<Record<Exclude<Resource, 'apparel' | 'weapon'>, number>> = {
  silver: 1,
  wood: 1.2, stone: .9, steel: 1.9, components: 32, food: 24,
  grain: 1.1, meat: 2, carcass: 0, meal: 15, chunk: 0, cloth: 1.5, herb: 10,
};
const QUALITY = [.5, .75, 1, 1.25, 1.5, 2.5, 5] as const;
const QUALITY_GAIN = [9999999, 9999999, 9999999, 500, 1000, 2000, 3000] as const;
const clamp = (n: number, low = 0, high = 1) => Math.max(low, Math.min(high, n));
export function unityRound(value: number): number {
  const whole = Math.floor(value), fraction = value - whole;
  return fraction < .5 ? whole : fraction > .5 ? whole + 1 : whole % 2 === 0 ? whole : whole + 1;
}
function line(points: readonly (readonly [number, number])[], value: number): number {
  if (value <= points[0][0]) return points[0][1];
  for (let i = 1; i < points.length; i++) {
    const [x, y] = points[i], [previousX, previousY] = points[i - 1];
    if (value <= x) return previousY + (value - previousX) / (x - previousX) * (y - previousY);
  }
  return points[points.length - 1][1];
}
export function finalizeMarketValue(value: number): number {
  return Math.max(0, value > 200 ? unityRound(value / 5) * 5 : value);
}
/** Quality gain caps apply before condition; rounding is only at the end. */
export function itemMarketValue(base: number, quality = 2, hpFraction = 1, tainted = false): number {
  const afterQuality = base + Math.min(base * (QUALITY[quality] - 1), QUALITY_GAIN[quality]);
  const condition = line([[0, 0], [.5, .1], [.6, .5], [.9, 1]], hpFraction);
  return finalizeMarketValue(afterQuality * (tainted ? .1 : 1) * condition);
}
export function materialValue(cost: Readonly<Partial<Counts>>): number {
  let value = 0;
  for (const [resource, count] of Object.entries(cost)) {
    if (resource !== 'apparel' && resource !== 'weapon')
      value += count * RESOURCE_MARKET_VALUE[resource as Exclude<Resource, 'apparel' | 'weapon'>];
  }
  return value;
}
function rawMadeValue(cost: Readonly<Partial<Counts>>, nativeWork: number): number {
  const work = nativeWork > 300 ? unityRound(nativeWork / 5) * 5 : nativeWork;
  return materialValue(cost) + (work > 2 ? work * .0036 : 0);
}
export function weaponMarketValue(piece: WeaponPiece): number {
  const def = WEAPON_DEFS[piece.kind];
  return itemMarketValue(rawMadeValue(def.cost, def.sourceWork * def.materialWorkFactor),
    def.hasQuality ? piece.quality : 2, piece.hitPoints / def.maxHitPoints);
}
export function apparelMarketValue(piece: ApparelPiece, tainted = false): number {
  const def = APPAREL_DEFS[piece.kind];
  return itemMarketValue(rawMadeValue(def.cost, def.sourceWork), piece.quality,
    piece.hitPoints / def.maxHitPoints, tainted);
}
export function cargoMarketValue(cargo: Cargo): number {
  if (cargo.resource === 'weapon') return cargo.weapon ? weaponMarketValue(cargo.weapon) * cargo.amount : 0;
  if (cargo.resource === 'apparel') return cargo.apparel ? apparelMarketValue(cargo.apparel) * cargo.amount : 0;
  // Reference asset value only. Animal carcass trading is not supported.
  if (cargo.resource === 'carcass') return cargo.carcass && Object.hasOwn(ANIMAL_DEFS, cargo.carcass.species)
    ? ANIMAL_DEFS[cargo.carcass.species].meat * RESOURCE_MARKET_VALUE.meat * cargo.amount : 0;
  return RESOURCE_MARKET_VALUE[cargo.resource] * cargo.amount;
}

/** SummaryHealthHandler is a product of injury impacts, not an average of capacities.
 * This project has adult Human HealthScale=1, visible nonpermanent injuries and no implants. */
export function summaryHealthPercent(pawn: Pick<Pawn, 'dead' | 'trauma'>): number {
  if (pawn.dead) return 0;
  let value = 1;
  for (const wound of pawn.trauma.wounds) value *= 1 - Math.min(wound.severity / 75, .95);
  for (const missing of pawn.trauma.missingParts) {
    if (pawn.trauma.missingParts.some(other => other !== missing && isDescendantOrSelf(missing.part, other.part))) continue;
    const part = BODY_PARTS[missing.part];
    if (!isFreshStump(missing) || (!part.tags.length && !part.children.length && injuryBleedRate(missing) <= 0)) continue;
    value *= 1 - Math.min(part.hitPoints / 75, .95);
  }
  return clamp(value, .05, 1);
}
/** Native forTradePrice ignores direct temporary Hediff capacity modifiers, while
 * capacity workers still consult current dependent capacities and total pain.
 * Current temporary malnutrition/temperature/blood-loss/infection defs have no priceImpact.
 * No age, traits, implants or absent native social/animals/artistic skills are invented. */
export function pawnMarketValue(pawn: Pawn): number {
  if (pawn.dead) return 0;
  const actual = healthSummary(pawn), body = traumaSummary(pawn.trauma);
  const painPenalty = clamp((actual.pain - .1) / .9 * .4, 0, .4);
  const consciousness = roundedCapacity((body.consciousnessSource - (painPenalty >= .01 ? painPenalty : 0)) *
    (.8 + .2 * Math.min(actual.bloodPumping, 1)) * (.8 + .2 * Math.min(actual.breathing, 1)) *
    (.9 + .1 * Math.min(actual.bloodFiltration, 1)));
  const awake = actual.consciousness >= .3;
  const trade: Record<CapacityKey, number> = {
    consciousness,
    moving: awake ? roundedCapacity(body.movingFactor * (.8 + .2 * Math.min(actual.breathing, 1)) /
      (.8 + .2 * Math.min(body.breathing, 1)) * Math.min(actual.consciousness, 1)) : 0,
    manipulation: awake ? roundedCapacity(body.manipulationFactor * actual.consciousness) : 0,
    talking: awake ? roundedCapacity(body.talkingFactor * actual.consciousness) : 0,
    eating: awake ? roundedCapacity(Math.max(.1, body.eatingFactor * actual.consciousness)) : 0,
    sight: body.sight, hearing: body.hearing, breathing: body.breathing,
    bloodFiltration: body.bloodFiltration, bloodPumping: body.bloodPumping, metabolism: body.metabolism,
  };
  let factor = .2 + .8 * summaryHealthPercent(pawn);
  for (const key of Object.keys(trade) as CapacityKey[]) {
    const capable = actual[key] > (key === 'moving' ? .15 : 0);
    factor *= capable ? .5 + .5 * clamp(trade[key]) : .6;
  }
  // Explicit project subset: original averages all 12 skills, this game stores 10.
  const average = SKILL_KEYS.reduce((sum, key) => sum + pawn.skills[key].level, 0) / SKILL_KEYS.length;
  factor *= line([[0, .2], [5.5, 1], [20, 3]], average);
  return finalizeMarketValue(1750 * Math.max(.1, factor));
}

/** Construction work is at 20 TPS versus native 60 TPS. Game-day scaling does not apply. */
export const CONSTRUCTION_SOURCE_WORK_FACTOR = 3;
export function constructedMarketValue(cost: Readonly<Partial<Counts>>, work: number): number {
  return finalizeMarketValue(rawMadeValue(cost, work * CONSTRUCTION_SOURCE_WORK_FACTOR));
}
export function structureMarketValue(material: 'wood' | 'stone', kind: 'floor' | 'wallHalf' | 'legacyUnknown'): number {
  if (kind === 'floor') return material === 'wood'
    ? constructedMarketValue({ wood: 3 }, 45)
    : constructedMarketValue({ stone: STONE_CONSTRUCTION.floor.cost }, STONE_CONSTRUCTION.floor.work);
  return (material === 'wood'
    ? constructedMarketValue({ wood: 6 }, 80)
    : constructedMarketValue({ stone: STONE_CONSTRUCTION.wall.cost }, STONE_CONSTRUCTION.wall.work)) / 2;
}
export interface WealthDetails extends WealthTotals {
  total: number;
  storyteller: number;
  itemSources: { ground: number; cargo: number; equipment: number; delivered: number };
  buildingSources: { structures: number; facilities: number; ladders: number };
  legacyStructureCells: number;
  unvaluedCorpses: number;
  pawnValues: { id: number; value: number; summaryHealth: number }[];
}
/** All present map cells are visible in this project. No fog, ownership claims,
 * pocket maps, guest/slave pawns, plants-as-assets or underground mineral wealth.
 * Fuel/energy floats are already consumed inputs. Human corpse meat/leather value
 * remains 0; former-colony gear remains a physical item asset. Animal carcasses
 * are separate physical cargo, valued from their provisional meat yield. */
export function colonyWealthDetails(sim: VoxelSimulation): WealthDetails {
  const itemSources = { ground: 0, cargo: 0, equipment: 0, delivered: 0 };
  for (const item of sim.items) itemSources.ground += cargoMarketValue(item);
  for (const animal of sim.animals) if (animal.dead)
    itemSources.ground += cargoMarketValue({ resource: 'carcass', amount: 1,
      carcass: { animalId: animal.id, species: animal.species } });
  for (const pawn of sim.pawns) if (pawn.faction === 'colony') {
    if (pawn.cargo) itemSources.cargo += cargoMarketValue(pawn.cargo);
    if (pawn.weapon) itemSources.equipment += weaponMarketValue(pawn.weapon);
    for (const piece of pawn.worn) itemSources.equipment += apparelMarketValue(piece, pawn.dead);
  }
  // Ordinary food is already included in materialValue. Carcass value needs its
  // species metadata, so its generic material value is zero and added exactly once here.
  // Crafting inputs retain value here until commit, an explicit difference from native UFT=0.
  for (const job of sim.jobs) itemSources.delivered += materialValue(job.delivered) +
    job.deliveredFood.filter(batch => batch.resource === 'carcass').reduce((n, batch) => n + cargoMarketValue(batch), 0);
  const buildingSources = { structures: 0, facilities: 0, ladders: 0 };
  let legacyStructureCells = 0;
  const kinds = (sim as VoxelSimulation & { structureKinds?: Uint8Array }).structureKinds;
  for (let i = 0; i < sim.blocks.length; i++) {
    const block = sim.blocks[i];
    if (block === Block.Wood || block === Block.Masonry) {
      const kind = kinds?.[i] ?? 0;
      if (!kind) legacyStructureCells++;
      buildingSources.structures += structureMarketValue(block === Block.Wood ? 'wood' : 'stone',
        kind === 1 ? 'floor' : kind === 2 || kind === 3 ? 'wallHalf' : 'legacyUnknown');
    }
    // Up ladders and dug ladders share one stored bit; value the reusable ladder,
    // excluding excavation labour that cannot be recovered from this representation.
    if (sim.ladders[i]) buildingSources.ladders += constructedMarketValue({ wood: 2 }, 40);
  }
  const add = (count: number, cost: Readonly<Partial<Counts>>, work: number) => {
    buildingSources.facilities += count * constructedMarketValue(cost, work);
  };
  add(sim.beds.length, { wood: 45 }, 187);
  add(sim.doors.length, { wood: 25 }, 199);
  add(sim.stoves.length, { wood: 20 }, 120);
  add(sim.stonecutters.length, STONECUTTER_COST, STONECUTTER_WORK);
  add(sim.tailors.length, TAILOR_COST, TAILOR_WORK);
  add(sim.researchBenches.length, RESEARCH_BENCH_COST, RESEARCH_BENCH_WORK);
  add(sim.sandbags.length, SANDBAG_COST, SANDBAG_WORK);
  add(sim.horseshoePins.length, HORSESHOE_COST, HORSESHOE_WORK);
  add(sim.wires.length, { steel: 1 }, 12);
  for (const bench of sim.weaponBenches) {
    if (bench.kind === 'smithy') add(1, SMITHY_COST, SMITHY_WORK);
    else if (bench.kind === 'machining') add(1, MACHINING_COST, MACHINING_WORK);
    // CraftingSpot is a designation with no material or market value.
  }
  for (const device of sim.devices) add(1, DEVICE_COSTS[device.kind], DEVICE_WORK[device.kind]);
  const pawnValues = sim.pawns.filter(p => p.faction === 'colony' && !p.dead)
    .map(p => ({ id: p.id, value: pawnMarketValue(p), summaryHealth: summaryHealthPercent(p) }));
  const items = Object.values(itemSources).reduce((a, b) => a + b, 0);
  const buildings = Object.values(buildingSources).reduce((a, b) => a + b, 0);
  const pawns = pawnValues.reduce((sum, p) => sum + p.value, 0);
  return { items, buildings, pawns, total: items + buildings + pawns, storyteller: items + buildings * .5 + pawns,
    itemSources, buildingSources, legacyStructureCells, unvaluedCorpses: sim.pawns.filter(p => p.dead).length, pawnValues };
}
export function colonyWealth(sim: VoxelSimulation): WealthTotals {
  const { items, buildings, pawns } = colonyWealthDetails(sim);
  return { items, buildings, pawns };
}
