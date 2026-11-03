import { DAMAGE_DEFS, validBodyPart, type BodyPartId, type DamageDef } from './anatomy';
import { apparelCoversPart, apparelStats, sortApparelByLayer, validApparel } from './apparel';
import type { ApparelKind, ApparelPiece } from './types';

export type ArmorCategory = 'Sharp' | 'Blunt';
export interface ArmorStep {
  apparelId: number | null;
  kind: ApparelKind | null;
  part: BodyPartId;
  armorCategory: ArmorCategory;
  armorRating: number;
  armorPenetration: number;
  effectiveArmor: number;
  beforeAmount: number;
  afterAmount: number;
  beforeDamageDef: DamageDef;
  afterDamageDef: DamageDef;
  roll: number;
  durabilityRoll: number | null;
  halfDamageRoll: number | null;
  hitPointsBefore: number | null;
  hitPointsAfter: number | null;
  hitPointDamage: number;
  outcome: 'deflect' | 'diminish' | 'penetrate';
  metal: boolean;
}
export interface ArmorResolution {
  amount: number;
  damageDef: DamageDef;
  initialCategory: ArmorCategory;
  worn: ApparelPiece[];
  steps: ArmorStep[];
  deflected: boolean;
  deflectedByMetalArmor: boolean;
  diminishedByMetalArmor: boolean;
  destroyedIds: number[];
}
export interface ArmorInput {
  worn: readonly ApparelPiece[];
  part: BodyPartId;
  damageDef: DamageDef;
  amount: number;
  armorPenetration: number;
}
export function damageArmorCategory(damageDef: DamageDef): ArmorCategory {
  if (!DAMAGE_DEFS.includes(damageDef)) throw new RangeError('护甲伤害类型无效');
  return damageDef === 'Blunt' || damageDef === 'Poke' ? 'Blunt' : 'Sharp';
}

/**
 * Ordinary adult Human armor, RimWorld 1.7.4980 rev60 ArmorUtility sequence.
 * Body selection precedes this call; propagation follows it without more armor.
 * Armor stats are read before impact HP loss. Original category is cached even
 * after Sharp converts to Blunt. Natural Human armor is zero, but consumes its
 * native protection roll. Inputs never mutate, including on an invalid RNG.
 */
export function resolveArmor(input: ArmorInput, random: () => number): ArmorResolution {
  if (
    !input ||
    !Array.isArray(input.worn) ||
    !input.worn.every(validApparel) ||
    new Set(input.worn.map((piece) => piece.id)).size !== input.worn.length ||
    !validBodyPart(input.part) ||
    !DAMAGE_DEFS.includes(input.damageDef) ||
    !Number.isFinite(input.amount) ||
    input.amount <= 0 ||
    input.amount > 1000 ||
    !Number.isFinite(input.armorPenetration) ||
    input.armorPenetration < 0 ||
    typeof random !== 'function'
  )
    throw new RangeError('护甲结算参数无效');
  const roll = () => {
    const value = random();
    if (!Number.isFinite(value) || value < 0 || value >= 1) throw new RangeError('护甲随机值无效');
    return value;
  };
  // RoundRandom consumes a sample even when the input is already integral.
  const rounded = (amount: number, value: number) =>
    Math.floor(amount) + (value < amount % 1 ? 1 : 0);
  const worn = sortApparelByLayer(input.worn.map((piece) => ({ ...piece })));
  const result: ArmorResolution = {
    amount: input.amount,
    damageDef: input.damageDef,
    initialCategory: damageArmorCategory(input.damageDef),
    worn,
    steps: [],
    deflected: false,
    deflectedByMetalArmor: false,
    diminishedByMetalArmor: false,
    destroyedIds: [],
  };
  const apply = (piece: ApparelPiece | null): boolean => {
    const stats = piece ? apparelStats(piece) : null;
    const armorRating = stats
      ? result.initialCategory === 'Sharp'
        ? stats.armorSharp
        : stats.armorBlunt
      : 0;
    const effectiveArmor = Math.max(0, armorRating - input.armorPenetration);
    const step: ArmorStep = {
      apparelId: piece?.id ?? null,
      kind: piece?.kind ?? null,
      part: input.part,
      armorCategory: result.initialCategory,
      armorRating,
      armorPenetration: input.armorPenetration,
      effectiveArmor,
      beforeAmount: result.amount,
      afterAmount: result.amount,
      beforeDamageDef: result.damageDef,
      afterDamageDef: result.damageDef,
      roll: 0,
      durabilityRoll: null,
      halfDamageRoll: null,
      hitPointsBefore: piece?.hitPoints ?? null,
      hitPointsAfter: piece?.hitPoints ?? null,
      hitPointDamage: 0,
      outcome: 'penetrate',
      metal: piece?.material === 'steel',
    };
    if (piece) {
      step.durabilityRoll = roll();
      step.hitPointDamage = Math.min(
        piece.hitPoints,
        rounded(result.amount * 0.25, step.durabilityRoll),
      );
      piece.hitPoints -= step.hitPointDamage;
      step.hitPointsAfter = piece.hitPoints;
      if (piece.hitPoints === 0) result.destroyedIds.push(piece.id);
    }
    step.roll = roll();
    if (step.roll < effectiveArmor * 0.5) {
      result.amount = 0;
      step.outcome = 'deflect';
    } else if (step.roll < effectiveArmor) {
      step.halfDamageRoll = roll();
      result.amount = rounded(result.amount / 2, step.halfDamageRoll);
      if (damageArmorCategory(result.damageDef) === 'Sharp') result.damageDef = 'Blunt';
      step.outcome = 'diminish';
    }
    step.afterAmount = result.amount;
    step.afterDamageDef = result.damageDef;
    result.steps.push(step);
    if (result.amount < 0.001) {
      result.amount = 0;
      result.deflected = true;
      result.deflectedByMetalArmor = step.metal;
      return true;
    }
    if (result.amount < step.beforeAmount && step.metal) result.diminishedByMetalArmor = true;
    return false;
  };
  let stopped = false;
  for (let i = worn.length - 1; i >= 0; i--) {
    if (apparelCoversPart(worn[i], input.part) && apply(worn[i])) {
      stopped = true;
      break;
    }
  }
  if (!stopped) apply(null);
  result.worn = worn.filter((piece) => piece.hitPoints > 0);
  return result;
}
