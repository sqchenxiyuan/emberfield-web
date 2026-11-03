import { DAY } from './types';

export type BodyRegion = 'torso' | 'head' | 'neck' | 'leftArm' | 'rightArm' | 'leftLeg' | 'rightLeg';
export type InjuryKind = 'bruise' | 'bite' | 'cut' | 'stab';
export interface Injury {
  id: number;
  part: BodyRegion;
  kind: InjuryKind;
  severity: number;
  ageTicks: number;
  tendQuality: number | null;
}
export interface Trauma {
  wounds: Injury[];
  bloodLoss: number;
  /** Permanent coarse-region damage; healing an injury cannot regenerate this region. */
  brokenParts: BodyRegion[];
}

/**
 * Source: selected original BodyPartDefs HP/bleed factors, Hediff_Injury,
 * Pawn_HealthTracker and TendUtility (research combat/injuries evidence).
 * Seven external regions, their hit weights, paired-limb capacity averages and
 * core-region death are project rules. They are not the full native anatomy,
 * internal organs, damage propagation, severing or fresh-stump bleeding system.
 * HealthScale, race bleed factor and injury healing factor are fixed at 1 here.
 */
export const BODY_REGIONS: Record<
  BodyRegion,
  { name: string; hitPoints: number; bleedRate: number; weight: number }
> = {
  torso: { name: '躯干', hitPoints: 40, bleedRate: 1, weight: 0.4 },
  head: { name: '头部', hitPoints: 25, bleedRate: 2, weight: 0.12 },
  neck: { name: '颈部', hitPoints: 25, bleedRate: 4, weight: 0.06 },
  leftArm: { name: '左臂', hitPoints: 30, bleedRate: 1, weight: 0.105 },
  rightArm: { name: '右臂', hitPoints: 30, bleedRate: 1, weight: 0.105 },
  leftLeg: { name: '左腿', hitPoints: 30, bleedRate: 1, weight: 0.105 },
  rightLeg: { name: '右腿', hitPoints: 30, bleedRate: 1, weight: 0.105 },
};
export const INJURY_NAMES: Record<InjuryKind, string> = {
  bruise: '瘀伤', bite: '咬伤', cut: '割伤', stab: '刺伤',
};
export const BLOOD_INTERVAL = DAY / 1000;
export const HEAL_INTERVAL = DAY / 100;
const kinds: InjuryKind[] = ['bruise', 'bite', 'cut', 'stab'];
const core: BodyRegion[] = ['torso', 'head', 'neck'];
const MAX_WOUNDS = 1024, MAX_SEVERITY = 1000;
const HEALTHY_TRAUMA_SUMMARY = Object.freeze({
  pain: 0,
  bleedRate: 0,
  consciousnessOffset: 0,
  consciousnessMax: 1,
  movingFactor: 1,
  manipulationFactor: 1,
  deathReason: null as string | null,
});
const clamp = (n: number, min = 0, max = 1) => Math.max(min, Math.min(max, n));
const exactKeys = (value: object, keys: string[]) =>
  Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
const damageAt = (t: Trauma, part: BodyRegion) =>
  t.wounds.reduce((sum, w) => sum + (w.part === part ? w.severity : 0), 0);
const isBroken = (t: Trauma, part: BodyRegion) =>
  t.brokenParts.includes(part) || damageAt(t, part) >= BODY_REGIONS[part].hitPoints;

/** Pure keyed sampling replaces the native RNG; no mutable hidden RNG to lose on save. */
function sample(seed: number, pawnId: number, tick: number, stream: number, injuryId = 0): number {
  let h = Math.imul(seed ^ pawnId, 0x45d9f3b) ^ Math.imul(tick, 0x27d4eb2d);
  h ^= Math.imul(stream ^ injuryId, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
export function initialTrauma(): Trauma {
  return { wounds: [], bloodLoss: 0, brokenParts: [] };
}

/** Original 90000..180000 ticks mapped onto game days, based on current severity. */
export function bleedingStopsAt(wound: Pick<Injury, 'severity'>): number {
  const nativeTicks = 90000 + Math.round(90000 * clamp((wound.severity - 1) / 29));
  return (nativeTicks * DAY) / 60000;
}
export function injuryBleedRate(wound: Injury): number {
  if (wound.kind === 'bruise' || wound.tendQuality !== null || wound.ageTicks >= bleedingStopsAt(wound))
    return 0;
  return wound.severity * 0.06 * BODY_REGIONS[wound.part].bleedRate;
}
export function traumaSummary(trauma: Trauma) {
  if (!trauma.wounds.length && trauma.bloodLoss === 0 && !trauma.brokenParts.length)
    return HEALTHY_TRAUMA_SUMMARY;
  const destroyedCore = core.find((part) => isBroken(trauma, part));
  const deathReason = destroyedCore
    ? `${BODY_REGIONS[destroyedCore].name}损毁致死`
    : trauma.bloodLoss >= 1 ? '失血致死' : null;
  const fraction = (part: BodyRegion) => isBroken(trauma, part)
    ? 0 : clamp(1 - damageAt(trauma, part) / BODY_REGIONS[part].hitPoints);
  const stage = trauma.bloodLoss >= 0.6 ? 4 : trauma.bloodLoss >= 0.45 ? 3
    : trauma.bloodLoss >= 0.3 ? 2 : trauma.bloodLoss >= 0.15 ? 1 : 0;
  return {
    pain: deathReason ? 0 : clamp(trauma.wounds.reduce((sum, w) => sum + w.severity * 0.0125, 0)),
    bleedRate: deathReason ? 0 : trauma.wounds.reduce((sum, w) => sum + injuryBleedRate(w), 0),
    consciousnessOffset: [0, -0.1, -0.2, -0.4, -0.4][stage],
    consciousnessMax: deathReason ? 0 : stage === 4 ? 0.1 : 1,
    movingFactor: deathReason ? 0 : (fraction('leftLeg') + fraction('rightLeg')) / 2,
    manipulationFactor: deathReason ? 0 : (fraction('leftArm') + fraction('rightArm')) / 2,
    deathReason,
  };
}

/** Adds full damage, including overflow; does not cap injury below a region's HP. */
export function applyInjury(
  trauma: Trauma, id: number, part: BodyRegion, kind: InjuryKind, amount: number,
): Injury | null {
  if (!Number.isSafeInteger(id) || id <= 0 || trauma.wounds.some((w) => w.id === id) ||
    !Object.hasOwn(BODY_REGIONS, part) || !kinds.includes(kind) ||
    !Number.isFinite(amount) || amount <= 0 || amount > MAX_SEVERITY || trauma.wounds.length >= MAX_WOUNDS)
    throw new RangeError('伤口参数无效');
  if (traumaSummary(trauma).deathReason) return null;
  const wound: Injury = { id, part, kind, severity: amount, ageTicks: 0, tendQuality: null };
  trauma.wounds.push(wound);
  if (damageAt(trauma, part) >= BODY_REGIONS[part].hitPoints && !trauma.brokenParts.includes(part))
    trauma.brokenParts.push(part);
  return wound;
}

export interface TraumaContext {
  seed: number;
  pawnId: number;
  starving: boolean;
  resting: boolean;
  inBed: boolean;
}
/** Once per simulation tick. Global intervals are a deterministic project scheduling choice. */
export function advanceTrauma(trauma: Trauma, tick: number, context: TraumaContext): void {
  if (!trauma.wounds.length && trauma.bloodLoss === 0) return;
  if (traumaSummary(trauma).deathReason) return;
  for (const wound of trauma.wounds) wound.ageTicks++;
  if (tick % BLOOD_INTERVAL === 0) {
    const bleeding = traumaSummary(trauma).bleedRate;
    trauma.bloodLoss = clamp(trauma.bloodLoss + (bleeding >= 0.1 ? bleeding * 0.001 : -1 / 3000));
  }
  if (traumaSummary(trauma).deathReason || context.starving || tick % HEAL_INTERVAL !== 0) return;
  // One shared natural budget, independently one shared tended budget; never full rates per wound.
  const natural = trauma.wounds.filter((w) => w.severity > 0).sort((a, b) => a.id - b.id);
  if (natural.length) {
    const chosen = natural[Math.floor(sample(context.seed, context.pawnId, tick, 1) * natural.length)];
    const daily = 8 + (context.resting ? 4 + (context.inBed ? 4 : 0) : 0);
    chosen.severity = Math.max(0, chosen.severity - daily * 0.01);
  }
  const tended = trauma.wounds.filter((w) => w.severity > 0 && w.tendQuality !== null)
    .sort((a, b) => a.id - b.id);
  if (tended.length) {
    const chosen = tended[Math.floor(sample(context.seed, context.pawnId, tick, 2) * tended.length)];
    chosen.severity = Math.max(0, chosen.severity - 8 * (0.5 + clamp(chosen.tendQuality!)) * 0.01);
  }
  trauma.wounds = trauma.wounds.filter((w) => w.severity > 1e-9);
}

/** No medicine: one injury, bleed priority then severity, no instant severity removal. */
export function tendOne(
  trauma: Trauma, seed: number, pawnId: number, tick: number, doctorQuality = 0.75,
): Injury | null {
  if (!Number.isFinite(doctorQuality) || doctorQuality < 0) throw new RangeError('护理质量无效');
  if (traumaSummary(trauma).deathReason) return null;
  const wound = trauma.wounds.filter((w) => w.tendQuality === null && w.severity > 0)
    .sort((a, b) => (injuryBleedRate(b) - injuryBleedRate(a)) * 1.5 ||
      b.severity - a.severity || a.id - b.id)[0];
  if (!wound) return null;
  const base = clamp(doctorQuality * 0.3, 0, 0.7);
  wound.tendQuality = clamp(base + sample(seed, pawnId, tick, 3, wound.id) * 0.5 - 0.25, 0, 0.7);
  return wound;
}

/** Strict save/input boundary. Unknown keys, duplicate IDs and contradictory damage are rejected. */
export function validTrauma(value: unknown, tick: number): value is Trauma {
  if (!Number.isSafeInteger(tick) || tick < 0 || !value || typeof value !== 'object' || Array.isArray(value))
    return false;
  const t = value as Trauma;
  if (!exactKeys(t, ['wounds', 'bloodLoss', 'brokenParts']) || !Number.isFinite(t.bloodLoss) || t.bloodLoss < 0 || t.bloodLoss > 1 ||
    !Array.isArray(t.wounds) || t.wounds.length > MAX_WOUNDS || !Array.isArray(t.brokenParts) ||
    t.brokenParts.length > 7 || new Set(t.brokenParts).size !== t.brokenParts.length ||
    t.brokenParts.some((p) => typeof p !== 'string' || !Object.hasOwn(BODY_REGIONS, p))) return false;
  const ids = new Set<number>();
  for (const w of t.wounds) {
    if (!w || typeof w !== 'object' || Array.isArray(w) ||
      !exactKeys(w, ['id', 'part', 'kind', 'severity', 'ageTicks', 'tendQuality']) ||
      !Number.isSafeInteger(w.id) || w.id <= 0 || ids.has(w.id) ||
      typeof w.part !== 'string' || !Object.hasOwn(BODY_REGIONS, w.part) || !kinds.includes(w.kind) ||
      !Number.isFinite(w.severity) || w.severity <= 0 || w.severity > MAX_SEVERITY ||
      !Number.isSafeInteger(w.ageTicks) || w.ageTicks < 0 || w.ageTicks > tick ||
      (w.tendQuality !== null && (!Number.isFinite(w.tendQuality) || w.tendQuality < 0 || w.tendQuality > 0.7)))
      return false;
    ids.add(w.id);
  }
  return (Object.keys(BODY_REGIONS) as BodyRegion[]).every((part) =>
    damageAt(t, part) < BODY_REGIONS[part].hitPoints || t.brokenParts.includes(part));
}
