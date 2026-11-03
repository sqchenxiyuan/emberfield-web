import {
  DAY,
  TPS,
  type ApparelKind,
  type ApparelPiece,
  type ApparelQuality,
  type ArmorKind,
  type Counts,
} from './types';
import { BODY_PARTS, BODY_PART_LIST, isPartMissing, type BodyPartId } from './anatomy';
import type { Trauma } from './injuries';
import type { ResearchKey } from './research';

export const APPAREL_NAMES: Record<ApparelKind, string> = {
  tuque: '无边帽',
  parka: '防寒派克大衣',
  duster: '防尘长外套',
  shirt: 'T恤',
  pants: '长裤',
  simpleHelmet: '简易头盔',
  plateArmor: '板甲',
};
export const APPAREL_KINDS = Object.keys(APPAREL_NAMES) as ApparelKind[];
export const TAILOR_KINDS: readonly ApparelKind[] = ['tuque', 'parka', 'duster', 'shirt', 'pants'];
export const ARMOR_KINDS: readonly ArmorKind[] = ['simpleHelmet', 'plateArmor'];
export const QUALITY_NAMES = ['极差', '较差', '普通', '良好', '优秀', '大师', '传奇'] as const;
export const INSULATION_QUALITY = [0.8, 0.9, 1, 1.1, 1.2, 1.5, 1.8] as const;
export const ARMOR_QUALITY = [0.6, 0.8, 1, 1.15, 1.3, 1.45, 1.8] as const;
export const APPAREL_LAYER_ORDER = { OnSkin: 0, Middle: 100, Shell: 200, Overhead: 400 } as const;
export type ApparelLayer = keyof typeof APPAREL_LAYER_ORDER;
export const TAILOR_COST: Readonly<Partial<Counts>> = Object.freeze({ wood: 75 });
export const TAILOR_WORK = Math.ceil((2000 * 0.7) / 3);
export const APPAREL_DEFS: Record<
  ApparelKind,
  {
    cloth: number;
    cost: Readonly<Partial<Counts>>;
    material: ApparelPiece['material'];
    sourceWork: number;
    sourceResearch: ResearchKey | null;
    sourceCraftingLevel: number;
    work: number;
    equipDelay: number;
    maxHitPoints: number;
    cold: number;
    heat: number;
    layer: ApparelLayer;
    layers: readonly ApparelLayer[];
    bodyParts: string[];
    armorSharp: number;
    armorBlunt: number;
    armorHeat: number;
    moveSpeedOffset: number;
  }
> = {
  tuque: {
    cloth: 20,
    cost: { cloth: 20 },
    material: 'cloth',
    sourceWork: 1200,
    sourceResearch: 'ComplexClothing',
    sourceCraftingLevel: 0,
    work: 800,
    equipDelay: 0.8,
    maxHitPoints: 80,
    cold: 9,
    heat: 0,
    layer: 'Overhead',
    layers: ['Overhead'],
    bodyParts: ['UpperHead'],
    armorSharp: 0.072,
    armorBlunt: 0,
    armorHeat: 0.036,
    moveSpeedOffset: 0,
  },
  parka: {
    cloth: 80,
    cost: { cloth: 80 },
    material: 'cloth',
    sourceWork: 8000,
    sourceResearch: null,
    sourceCraftingLevel: 0,
    work: Math.ceil(8000 / 3 / 0.5),
    equipDelay: 3,
    maxHitPoints: 180,
    cold: 36,
    heat: 0,
    layer: 'Shell',
    layers: ['Shell'],
    bodyParts: ['Torso', 'Neck', 'Shoulders', 'Arms'],
    armorSharp: 0.072,
    armorBlunt: 0,
    armorHeat: 0.036,
    moveSpeedOffset: 0,
  },
  duster: {
    cloth: 80,
    cost: { cloth: 80 },
    material: 'cloth',
    sourceWork: 10000,
    sourceResearch: 'ComplexClothing',
    sourceCraftingLevel: 0,
    work: Math.ceil(10000 / 3 / 0.5),
    equipDelay: 3,
    maxHitPoints: 200,
    cold: 10.8,
    heat: 15.3,
    layer: 'Shell',
    layers: ['Shell'],
    bodyParts: ['Torso', 'Neck', 'Shoulders', 'Arms', 'Legs'],
    armorSharp: 0.108,
    armorBlunt: 0,
    armorHeat: 0.054,
    moveSpeedOffset: 0,
  },
  shirt: {
    cloth: 40,
    cost: { cloth: 40 },
    material: 'cloth',
    sourceWork: 1600,
    sourceResearch: 'ComplexClothing',
    sourceCraftingLevel: 0,
    work: Math.ceil(1600 / 3 / 0.5),
    equipDelay: 1.5,
    maxHitPoints: 100,
    cold: 3.96,
    heat: 1.8,
    layer: 'OnSkin',
    layers: ['OnSkin'],
    bodyParts: ['Torso', 'Shoulders'],
    armorSharp: 0.072,
    armorBlunt: 0,
    armorHeat: 0.036,
    moveSpeedOffset: 0,
  },
  pants: {
    cloth: 40,
    cost: { cloth: 40 },
    material: 'cloth',
    sourceWork: 1600,
    sourceResearch: 'ComplexClothing',
    sourceCraftingLevel: 0,
    work: Math.ceil(1600 / 3 / 0.5),
    equipDelay: 2,
    maxHitPoints: 100,
    cold: 3.6,
    heat: 1.44,
    layer: 'OnSkin',
    layers: ['OnSkin'],
    bodyParts: ['Legs'],
    armorSharp: 0.072,
    armorBlunt: 0,
    armorHeat: 0.036,
    moveSpeedOffset: 0,
  },
  simpleHelmet: {
    cloth: 0,
    cost: { steel: 40 },
    material: 'steel',
    sourceWork: 3200,
    sourceResearch: 'Smithing',
    sourceCraftingLevel: 0,
    work: Math.ceil(3200 / 3),
    equipDelay: 1.5,
    maxHitPoints: 100,
    cold: 0.45,
    heat: 0,
    layer: 'Overhead',
    layers: ['Overhead'],
    bodyParts: ['UpperHead'],
    armorSharp: 0.45,
    armorBlunt: 0.225,
    armorHeat: 0.3,
    moveSpeedOffset: 0,
  },
  plateArmor: {
    cloth: 0,
    cost: { steel: 170 },
    material: 'steel',
    sourceWork: 38000,
    sourceResearch: 'PlateArmor',
    sourceCraftingLevel: 7,
    work: Math.ceil(38000 / 3),
    equipDelay: 15,
    maxHitPoints: 290,
    cold: 3,
    heat: 0,
    layer: 'Shell',
    layers: ['Middle', 'Shell'],
    bodyParts: ['Torso', 'Neck', 'Shoulders', 'Arms', 'Legs'],
    armorSharp: 0.81,
    armorBlunt: 0.405,
    armorHeat: 0.54,
    moveSpeedOffset: -0.8,
  },
};
export function apparelStats(piece: Pick<ApparelPiece, 'kind' | 'quality'>) {
  const def = APPAREL_DEFS[piece.kind],
    factor = INSULATION_QUALITY[piece.quality],
    armorFactor = ARMOR_QUALITY[piece.quality];
  return {
    cold: def.cold * factor,
    heat: def.heat * factor,
    maxHitPoints: def.maxHitPoints,
    qualityName: QUALITY_NAMES[piece.quality],
    name: APPAREL_NAMES[piece.kind],
    // Native armor has quality, but neither remaining-HP scaling nor quality-scaled maxHP.
    armorSharp: Math.min(2, Math.max(0, def.armorSharp * armorFactor)),
    armorBlunt: Math.min(2, Math.max(0, def.armorBlunt * armorFactor)),
    armorHeat: Math.min(2, Math.max(0, def.armorHeat * armorFactor)),
    moveSpeedOffset: def.moveSpeedOffset,
  };
}
export function makeApparel(
  id: number,
  kind: ApparelKind,
  quality: ApparelQuality = 2,
): ApparelPiece {
  return {
    id,
    kind,
    material: APPAREL_DEFS[kind].material,
    quality,
    hitPoints: apparelStats({ kind, quality }).maxHitPoints,
    wearTicks: 0,
  };
}
export function compatibleApparel(
  a: Pick<ApparelPiece, 'kind'>,
  b: Pick<ApparelPiece, 'kind'>,
): boolean {
  const left = APPAREL_DEFS[a.kind],
    right = APPAREL_DEFS[b.kind];
  if (!left.layers.some((layer) => right.layers.includes(layer))) return true;
  // All groups named by these seven garments are apparel-relevant native groups.
  // Two differently named groups can intersect on the same Human body record.
  return !BODY_PART_LIST.some(
    (part) => apparelCoversPart(a, part.id) && apparelCoversPart(b, part.id),
  );
}
/** CoversBodyPart tests this exact record's groups, including internal organs. */
export function apparelCoversPart(piece: Pick<ApparelPiece, 'kind'>, part: BodyPartId): boolean {
  return BODY_PARTS[part].groups.some((group) =>
    APPAREL_DEFS[piece.kind].bodyParts.includes(group),
  );
}
/** Native HasPartsToWear needs any covered non-missing record, not every record. */
export function apparelHasPartsToWear(piece: Pick<ApparelPiece, 'kind'>, trauma: Trauma): boolean {
  return BODY_PART_LIST.some(
    (part) => !isPartMissing(trauma, part.id) && apparelCoversPart(piece, part.id),
  );
}
/** Native worn storage order; the armor resolver traverses this list backwards. */
export function sortApparelByLayer<T extends Pick<ApparelPiece, 'kind'>>(worn: readonly T[]): T[] {
  return [...worn].sort(
    (a, b) =>
      APPAREL_LAYER_ORDER[APPAREL_DEFS[a.kind].layers.at(-1)!] -
      APPAREL_LAYER_ORDER[APPAREL_DEFS[b.kind].layers.at(-1)!],
  );
}
/** Native additive equipped offset then Moving, relative to the existing project grid speed. */
export function apparelMoveFactor(worn: readonly ApparelPiece[], moving: number): number {
  if (!Number.isFinite(moving) || moving < 0) throw new RangeError('移动能力无效');
  const offset = worn.reduce((sum, piece) => sum + apparelStats(piece).moveSpeedOffset, 0);
  return Math.max(0.15, (4.6 + offset) * moving) / 4.6;
}
export function apparelDelay(piece: Pick<ApparelPiece, 'kind'>): number {
  return Math.ceil(APPAREL_DEFS[piece.kind].equipDelay * TPS);
}
export function validApparel(raw: unknown): raw is ApparelPiece {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
  const a = raw as ApparelPiece;
  return (
    Object.keys(a).length === 6 &&
    ['id', 'kind', 'material', 'quality', 'hitPoints', 'wearTicks'].every((key) =>
      Object.hasOwn(a, key),
    ) &&
    Number.isSafeInteger(a.id) &&
    a.id > 0 &&
    Object.hasOwn(APPAREL_DEFS, a.kind) &&
    a.material === APPAREL_DEFS[a.kind].material &&
    Number.isInteger(a.quality) &&
    a.quality >= 0 &&
    a.quality <= 6 &&
    Number.isInteger(a.hitPoints) &&
    a.hitPoints > 0 &&
    a.hitPoints <= apparelStats(a).maxHitPoints &&
    Number.isSafeInteger(a.wearTicks) &&
    a.wearTicks >= 0
  );
}
/** Original daily Bernoulli(.4); deterministic sampling replaces the native RNG sequence. */
export function apparelWearDamage(seed: number, id: number, day: number): 0 | 1 {
  let h = Math.imul(seed ^ id, 0x45d9f3b) ^ Math.imul(day, 0x27d4eb2d);
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296 < 0.4 ? 1 : 0;
}
export function insulation(worn: readonly ApparelPiece[]) {
  return worn.reduce(
    (sum, piece) => {
      const stats = apparelStats(piece);
      return { cold: sum.cold + stats.cold, heat: sum.heat + stats.heat };
    },
    { cold: 0, heat: 0 },
  );
}
export const APPAREL_WEAR_INTERVAL = DAY;
