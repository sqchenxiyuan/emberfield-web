import { TPS, type Counts } from './types';
import { traumaSummary, type Trauma, type InjuryKind } from './injuries';
import { naturalGroupEfficiency } from './anatomy';

export type WeaponKind = 'woodClub' | 'steelKnife' | 'steelLongsword';
export type WeaponQuality = 0 | 1 | 2 | 3 | 4 | 5 | 6;
export type WeaponBenchKind = 'craftingSpot' | 'smithy';
export interface WeaponPiece {
  id: number;
  kind: WeaponKind;
  /** Club has no native CompQuality; 2 is its sole storage sentinel, not a quality roll. */
  quality: WeaponQuality;
  hitPoints: number;
}
export type MeleeDamageDef = 'Blunt' | 'Poke' | 'Cut' | 'Stab' | 'Bite';
export interface WeaponTool {
  id: 'handle' | 'head' | 'blade' | 'point' | 'edge';
  label: string;
  damageDef: MeleeDamageDef;
  power: number;
  cooldownSeconds: number;
}
export interface WeaponDefinition {
  cost: Readonly<Partial<Counts>>;
  /** Raw XML WorkToMake, before material and worktable speed. */
  sourceWork: number;
  materialWorkFactor: number;
  /** Project work ticks at GeneralLaborSpeed=1 and worktable speed=1. */
  work: number;
  benches: readonly WeaponBenchKind[];
  sourceResearch: 'LongBlades' | null;
  sourceCraftingLevel: number;
  material: 'wood' | 'steel';
  maxHitPoints: number;
  hasQuality: boolean;
  tools: readonly WeaponTool[];
}

export const WEAPON_NAMES: Record<WeaponKind, string> = {
  woodClub: '木棒',
  steelKnife: '钢匕首',
  steelLongsword: '钢长剑',
};
export const WEAPON_KINDS = Object.keys(WEAPON_NAMES) as WeaponKind[];
export const WEAPON_QUALITY_NAMES = [
  '极差',
  '较差',
  '普通',
  '良好',
  '优秀',
  '大师',
  '传奇',
] as const;
export const WEAPON_DAMAGE_QUALITY = [0.8, 0.9, 1, 1.1, 1.2, 1.45, 1.65] as const;
export const WEAPON_BENCH_SPEED: Readonly<Record<WeaponBenchKind, number>> = Object.freeze({
  craftingSpot: 0.5,
  smithy: 1,
});
/** Native DropEquipment waits 30 ticks; keep its half-second action duration. Equip is instant on arrival. */
export const WEAPON_DROP_TICKS = TPS / 2;

/**
 * Core 1.7 XML: BaseWeapons, MeleeNeolithic, MeleeMedieval, Items_Resource_Stuff,
 * Stats_Weapons_Melee and Stats_Basics_General; research chapters 39/42.
 * Kinds fix material deliberately. Original steel recipes allow other materials;
 * world validates the research and crafting requirements before starting work.
 * No apparel-style daily wear: BaseWeapon tickerType=Never. Ground deterioration
 * and external damage are separate systems; item HP does not scale melee damage.
 */
export const WEAPON_DEFS: Record<WeaponKind, WeaponDefinition> = {
  woodClub: {
    cost: { wood: 40 },
    sourceWork: 1200,
    materialWorkFactor: 0.7,
    work: 280,
    benches: ['craftingSpot', 'smithy'],
    sourceResearch: null,
    sourceCraftingLevel: 0,
    material: 'wood',
    maxHitPoints: 65,
    hasQuality: false,
    tools: [
      { id: 'handle', label: '柄端', damageDef: 'Poke', power: 9, cooldownSeconds: 2 },
      { id: 'head', label: '棒头', damageDef: 'Blunt', power: 14, cooldownSeconds: 2 },
    ],
  },
  steelKnife: {
    cost: { steel: 30 },
    sourceWork: 1800,
    materialWorkFactor: 1,
    work: 600,
    benches: ['craftingSpot', 'smithy'],
    sourceResearch: null,
    sourceCraftingLevel: 0,
    material: 'steel',
    maxHitPoints: 100,
    hasQuality: true,
    tools: [
      { id: 'handle', label: '刀柄', damageDef: 'Blunt', power: 9, cooldownSeconds: 2 },
      { id: 'blade', label: '刀刃', damageDef: 'Cut', power: 12, cooldownSeconds: 1.5 },
      { id: 'point', label: '刀尖', damageDef: 'Stab', power: 13, cooldownSeconds: 2 },
    ],
  },
  steelLongsword: {
    cost: { steel: 100 },
    sourceWork: 18000,
    materialWorkFactor: 1,
    work: 6000,
    benches: ['smithy'],
    sourceResearch: 'LongBlades',
    sourceCraftingLevel: 5,
    material: 'steel',
    maxHitPoints: 100,
    hasQuality: true,
    tools: [
      { id: 'handle', label: '剑柄', damageDef: 'Blunt', power: 9, cooldownSeconds: 2 },
      { id: 'point', label: '剑尖', damageDef: 'Stab', power: 23, cooldownSeconds: 2.6 },
      { id: 'edge', label: '剑刃', damageDef: 'Cut', power: 23, cooldownSeconds: 2.6 },
    ],
  },
};

function validKindQuality(value: Pick<WeaponPiece, 'kind' | 'quality'>): boolean {
  return (
    typeof value.kind === 'string' &&
    Object.hasOwn(WEAPON_DEFS, value.kind) &&
    Number.isInteger(value.quality) &&
    value.quality >= 0 &&
    value.quality <= 6 &&
    (WEAPON_DEFS[value.kind].hasQuality || value.quality === 2)
  );
}
export function weaponName(piece: Pick<WeaponPiece, 'kind' | 'quality'>): string {
  if (!validKindQuality(piece)) throw new RangeError('武器种类或品质无效');
  return (
    WEAPON_NAMES[piece.kind] +
    (WEAPON_DEFS[piece.kind].hasQuality ? `（${WEAPON_QUALITY_NAMES[piece.quality]}）` : '')
  );
}
export function weaponStats(piece: Pick<WeaponPiece, 'kind' | 'quality'>) {
  if (!validKindQuality(piece)) throw new RangeError('武器种类或品质无效');
  const def = WEAPON_DEFS[piece.kind];
  return {
    name: WEAPON_NAMES[piece.kind],
    label: weaponName(piece),
    material: def.material,
    hasQuality: def.hasQuality,
    qualityName: def.hasQuality ? WEAPON_QUALITY_NAMES[piece.quality] : null,
    maxHitPoints: def.maxHitPoints,
    damageMultiplier: def.hasQuality ? WEAPON_DAMAGE_QUALITY[piece.quality] : 1,
  };
}
export function makeWeapon(id: number, kind: WeaponKind, quality: WeaponQuality = 2): WeaponPiece {
  if (!Number.isSafeInteger(id) || id <= 0 || !validKindQuality({ kind, quality }))
    throw new RangeError('武器身份、种类或品质无效');
  return { id, kind, quality, hitPoints: WEAPON_DEFS[kind].maxHitPoints };
}
export function validWeapon(raw: unknown): raw is WeaponPiece {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
  const p = raw as WeaponPiece;
  return (
    Object.keys(p).length === 4 &&
    ['id', 'kind', 'quality', 'hitPoints'].every((key) => Object.hasOwn(p, key)) &&
    Number.isSafeInteger(p.id) &&
    p.id > 0 &&
    validKindQuality(p) &&
    Number.isInteger(p.hitPoints) &&
    p.hitPoints > 0 &&
    p.hitPoints <= WEAPON_DEFS[p.kind].maxHitPoints
  );
}
export function weaponWork(kind: WeaponKind, bench: WeaponBenchKind): number {
  if (
    !Object.hasOwn(WEAPON_DEFS, kind) ||
    !Object.hasOwn(WEAPON_BENCH_SPEED, bench) ||
    !WEAPON_DEFS[kind].benches.includes(bench)
  )
    throw new RangeError('此工作台不能制作该武器');
  return Math.ceil(WEAPON_DEFS[kind].work / WEAPON_BENCH_SPEED[bench]);
}

export interface MeleeBodyState {
  /** Natural-part group efficiencies supplied by the caller, not overall Manipulation. */
  leftHand: number;
  rightHand: number;
  teeth: number;
  head: number;
  damageFactor: number;
  cooldownFactor: number;
  active: boolean;
}
const HEALTHY_BODY: Readonly<MeleeBodyState> = Object.freeze({
  leftHand: 1,
  rightHand: 1,
  teeth: 1,
  head: 1,
  damageFactor: 1,
  cooldownFactor: 1,
  active: true,
});
export interface MeleeAttack {
  id: string;
  label: string;
  source: 'body' | 'weapon';
  damageDef: MeleeDamageDef;
  /** Current seven-region skin-injury mapping. Poke keeps its source damageDef above. */
  kind: InjuryKind;
  damage: number;
  armorPenetration: number;
  cooldownSeconds: number;
  cooldown: number;
  chanceFactor: number;
}
export interface MeleeOption extends MeleeAttack {
  initialWeight: number;
  category: 'Best' | 'Mid' | 'Worst';
  probability: number;
}
const woundKind: Record<MeleeDamageDef, InjuryKind> = {
  Blunt: 'bruise',
  Poke: 'bruise',
  Cut: 'cut',
  Stab: 'stab',
  Bite: 'bite',
};
function bodyState(input: Partial<MeleeBodyState>): MeleeBodyState {
  const state = { ...HEALTHY_BODY, ...input };
  for (const field of ['leftHand', 'rightHand', 'teeth', 'head'] as const)
    if (!Number.isFinite(state[field]) || state[field] < 0 || state[field] > 1)
      throw new RangeError('身体工具效率必须为0～1');
  if (
    !Number.isFinite(state.damageFactor) ||
    state.damageFactor < 0 ||
    !Number.isFinite(state.cooldownFactor) ||
    state.cooldownFactor < 0.05 ||
    typeof state.active !== 'boolean'
  )
    throw new RangeError('近战人物修正无效');
  return state;
}
function attack(
  id: string,
  label: string,
  source: MeleeAttack['source'],
  damageDef: MeleeDamageDef,
  damage: number,
  cooldownSeconds: number,
  chanceFactor: number,
): MeleeAttack {
  return {
    id,
    label,
    source,
    damageDef,
    kind: woundKind[damageDef],
    damage,
    armorPenetration: damage * 0.015,
    cooldownSeconds,
    cooldown: Math.max(1, Math.round(cooldownSeconds * TPS)),
    chanceFactor,
  };
}
export function weaponAttacks(
  piece: WeaponPiece,
  body: Partial<MeleeBodyState> = {},
): MeleeAttack[] {
  if (!validWeapon(piece)) throw new RangeError('武器实例无效');
  const state = bodyState(body),
    stats = weaponStats(piece),
    def = WEAPON_DEFS[piece.kind];
  if (!state.active || state.damageFactor === 0) return [];
  return def.tools.map((tool) => {
    const materialFactor =
      def.material === 'wood'
        ? tool.damageDef === 'Blunt' || tool.damageDef === 'Poke'
          ? 0.9
          : 0.4
        : 1;
    return attack(
      `${piece.kind}.${tool.id}`,
      tool.label,
      'weapon',
      tool.damageDef,
      tool.power * stats.damageMultiplier * materialFactor * state.damageFactor,
      tool.cooldownSeconds * state.cooldownFactor,
      1,
    );
  });
}

/**
 * Core Human natural-tool groups use remaining-part average efficiency. The
 * LeftHand/RightHand groups contain the fingers; Teeth is the jaw; head is HeadAttackTool.
 * Source weapon tools have no linked body group: do not multiply their damage by
 * Manipulation; hit chance/equipment eligibility remain the caller's responsibility.
 */
export function meleeBodyFromTrauma(trauma: Trauma): MeleeBodyState {
  return {
    ...HEALTHY_BODY,
    leftHand: naturalGroupEfficiency(trauma, 'LeftHand'),
    rightHand: naturalGroupEfficiency(trauma, 'RightHand'),
    head: naturalGroupEfficiency(trauma, 'HeadAttackTool'),
    teeth: naturalGroupEfficiency(trauma, 'Teeth'),
    active: !traumaSummary(trauma).deathReason,
  };
}

/**
 * Pawn_MeleeVerbs + VerbUtility's current Best/Mid/Worst path, for this explicitly
 * bounded candidate set: four Human tools and one equipped weapon, living pawn
 * target, accuracyTouch=1, no terrain/apparel/hediff/gene tools or surprise extras.
 * Body efficiency changes both adjusted damage and derived AP before grouping.
 * Reselection cadence, hit/dodge, random damage, armor and wound propagation are
 * outside this pure function. JavaScript arithmetic is not C# float bit emulation.
 */
export function meleeOptions(
  piece: WeaponPiece | null,
  body: Partial<MeleeBodyState> = {},
): MeleeOption[] {
  const state = bodyState(body);
  if (piece !== null && !validWeapon(piece)) throw new RangeError('武器实例无效');
  if (!state.active || state.damageFactor === 0) return [];
  const candidates: MeleeAttack[] = [];
  for (const [id, label, damageDef, power, efficiency, chance] of [
    ['leftFist', '左拳', 'Blunt', 8.2, state.leftHand, 1],
    ['rightFist', '右拳', 'Blunt', 8.2, state.rightHand, 1],
    ['teeth', '牙齿', 'Bite', 8.2, state.teeth, 0.07],
    ['head', '头撞', 'Blunt', 5, Math.max(0.4, state.head), 0.2],
  ] as const) {
    if (efficiency <= 0) continue;
    candidates.push(
      attack(
        id,
        label,
        'body',
        damageDef,
        power * efficiency * state.damageFactor,
        2 * state.cooldownFactor,
        chance,
      ),
    );
  }
  if (piece) candidates.push(...weaponAttacks(piece, state));
  const weights = candidates.map(
    (a) => ((a.damage * (1 + a.armorPenetration)) / a.cooldownSeconds) * a.chanceFactor,
  );
  const highest = Math.max(...weights);
  const categories = weights.map((weight) =>
    weight >= highest * 0.95
      ? ('Best' as const)
      : weight < highest * 0.25
        ? ('Worst' as const)
        : ('Mid' as const),
  );
  const bestCount = categories.filter((c) => c === 'Best').length;
  const midCount = categories.filter((c) => c === 'Mid').length;
  const finalWeights = categories.map((c) =>
    c === 'Best' ? 0.75 / bestCount : c === 'Mid' ? 0.25 / midCount : 0,
  );
  const total = finalWeights.reduce((n, weight) => n + weight, 0);
  return candidates.map((a, i) => ({
    ...a,
    initialWeight: weights[i],
    category: categories[i],
    probability: finalWeights[i] / total,
  }));
}
/** Supply a deterministic [0,1) roll from the simulation; no hidden RNG or mutable state. */
export function selectMeleeAttack(
  piece: WeaponPiece | null,
  roll: number,
  body: Partial<MeleeBodyState> = {},
): MeleeOption | null {
  if (!Number.isFinite(roll) || roll < 0 || roll >= 1)
    throw new RangeError('攻击抽样值必须为[0,1)');
  const options = meleeOptions(piece, body).filter((o) => o.probability > 0);
  let cumulative = 0;
  for (const option of options) {
    cumulative += option.probability;
    if (roll < cumulative) return option;
  }
  return options.at(-1) ?? null;
}
