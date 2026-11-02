import {
  DAY,
  TPS,
  type ApparelKind,
  type ApparelPiece,
  type ApparelQuality,
  type Counts,
} from './types';

export const APPAREL_NAMES: Record<ApparelKind, string> = {
  tuque: '无边帽',
  parka: '防寒派克大衣',
  duster: '防尘长外套',
  shirt: 'T恤',
  pants: '长裤',
};
export const APPAREL_KINDS = Object.keys(APPAREL_NAMES) as ApparelKind[];
export const QUALITY_NAMES = ['极差', '较差', '普通', '良好', '优秀', '大师', '传奇'] as const;
export const INSULATION_QUALITY = [0.8, 0.9, 1, 1.1, 1.2, 1.5, 1.8] as const;
export const TAILOR_COST: Readonly<Partial<Counts>> = Object.freeze({ wood: 75 });
export const TAILOR_WORK = Math.ceil((2000 * 0.7) / 3);
export const APPAREL_DEFS: Record<
  ApparelKind,
  {
    cloth: number;
    work: number;
    equipDelay: number;
    maxHitPoints: number;
    cold: number;
    heat: number;
    layer: 'Overhead' | 'Shell' | 'OnSkin';
    bodyParts: string[];
  }
> = {
  tuque: {
    cloth: 20,
    work: 800,
    equipDelay: 0.8,
    maxHitPoints: 80,
    cold: 9,
    heat: 0,
    layer: 'Overhead',
    bodyParts: ['UpperHead'],
  },
  parka: {
    cloth: 80,
    work: Math.ceil(8000 / 3 / 0.5),
    equipDelay: 3,
    maxHitPoints: 180,
    cold: 36,
    heat: 0,
    layer: 'Shell',
    bodyParts: ['Torso', 'Neck', 'Shoulders', 'Arms'],
  },
  duster: {
    cloth: 80,
    work: Math.ceil(10000 / 3 / 0.5),
    equipDelay: 3,
    maxHitPoints: 200,
    cold: 10.8,
    heat: 15.3,
    layer: 'Shell',
    bodyParts: ['Torso', 'Neck', 'Shoulders', 'Arms'],
  },
  shirt: {
    cloth: 40,
    work: Math.ceil(1600 / 3 / 0.5),
    equipDelay: 1.5,
    maxHitPoints: 100,
    cold: 3.96,
    heat: 1.8,
    layer: 'OnSkin',
    bodyParts: ['Torso', 'Shoulders'],
  },
  pants: {
    cloth: 40,
    work: Math.ceil(1600 / 3 / 0.5),
    equipDelay: 2,
    maxHitPoints: 100,
    cold: 3.6,
    heat: 1.44,
    layer: 'OnSkin',
    bodyParts: ['Legs'],
  },
};
export function apparelStats(piece: Pick<ApparelPiece, 'kind' | 'quality'>) {
  const def = APPAREL_DEFS[piece.kind],
    factor = INSULATION_QUALITY[piece.quality];
  return {
    cold: def.cold * factor,
    heat: def.heat * factor,
    maxHitPoints: def.maxHitPoints,
    qualityName: QUALITY_NAMES[piece.quality],
    name: APPAREL_NAMES[piece.kind],
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
    material: 'cloth',
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
  return (
    left.layer !== right.layer || !left.bodyParts.some((part) => right.bodyParts.includes(part))
  );
}
export function apparelDelay(piece: Pick<ApparelPiece, 'kind'>): number {
  return Math.ceil(APPAREL_DEFS[piece.kind].equipDelay * TPS);
}
export function validApparel(raw: unknown): raw is ApparelPiece {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
  const a = raw as ApparelPiece;
  return (
    Object.keys(a).length === 6 &&
    Number.isSafeInteger(a.id) &&
    a.id > 0 &&
    Object.hasOwn(APPAREL_DEFS, a.kind) &&
    a.material === 'cloth' &&
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
