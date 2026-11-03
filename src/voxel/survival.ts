import { DAY, type Pawn, type SurvivalHealth, type ApparelPiece } from './types';
import { insulation } from './apparel';
import { initialTrauma, traumaSummary, type Trauma } from './injuries';

// Source contract: chapter 33. Whole healthy adult body, no apparel, genes or traits.
// Source 60000 ticks/day is mapped to our DAY, independently of render/real-time TPS.
export const MALNUTRITION_INTERVAL = DAY / 400;
export const TEMPERATURE_INTERVAL = DAY / 1000;
export const FEED_WORK = (750 * DAY) / 60000;
export const COMFORTABLE_MIN = 16,
  COMFORTABLE_MAX = 26;
export const SAFE_MIN = 6,
  SAFE_MAX = 36;
const clamp = (n: number, min = 0, max = 1) => Math.max(min, Math.min(max, n));
const rounded = (n: number) => Math.round(Math.max(0, n) * 100) / 100;
export const HEAT_OVERAGE_CURVE = [
  [0, 0],
  [25, 25],
  [50, 40],
  [100, 60],
  [200, 80],
  [400, 100],
  [4000, 1000],
] as const;
export function heatOverage(delta: number): number {
  if (delta <= 0) return 0;
  for (let i = 1; i < HEAT_OVERAGE_CURVE.length; i++) {
    const [x, y] = HEAT_OVERAGE_CURVE[i],
      [px, py] = HEAT_OVERAGE_CURVE[i - 1];
    if (delta <= x) return py + ((y - py) * (delta - px)) / (x - px);
  }
  return 1000;
}
export function initialSurvival(
  seed: number,
  id: number,
): Pick<
  Pawn,
  | 'health'
  | 'dead'
  | 'downed'
  | 'deathReason'
  | 'carriedBy'
  | 'carryingPawnId'
  | 'patientId'
  | 'careBedId'
  | 'carePhase'
  | 'careProgress'
  | 'careFoodId'
  | 'careAmount'
  | 'trauma'
  | 'faction'
  | 'drafted'
  | 'retreating'
  | 'attackTargetId'
  | 'nextAttackTick'
  | 'weapon'
> {
  // Deterministic personal sampling is a prototype adaptation; the original uses its pawn RNG.
  let hash = Math.imul(seed ^ id, 0x45d9f3b);
  hash = Math.imul(hash ^ (hash >>> 16), 0x45d9f3b);
  return {
    trauma: initialTrauma(),
    faction: 'colony',
    drafted: false,
    retreating: false,
    attackTargetId: null,
    nextAttackTick: 0,
    weapon: 'fists',
    health: {
      malnutrition: 0,
      hypothermia: 0,
      heatstroke: 0,
      starvationFactor: 0.8 + (((hash ^ (hash >>> 16)) >>> 0) / 4294967296) * 0.4,
    },
    dead: false,
    downed: false,
    deathReason: null,
    carriedBy: null,
    carryingPawnId: null,
    patientId: null,
    careBedId: null,
    carePhase: null,
    careProgress: 0,
    careFoodId: null,
    careAmount: 0,
  };
}
const stage = (severity: number, thresholds: number[]) =>
  thresholds.reduce((n, v, i) => (severity >= v ? i : n), 0);
export function hungerMultiplier(health: SurvivalHealth): number {
  return health.malnutrition <= 0 ? 1 : health.malnutrition < 0.2 ? 1.5 : 1.6;
}
export function updateHealth(
  h: SurvivalHealth,
  food: number,
  temperature: number,
  tick: number,
  worn: readonly ApparelPiece[] = [],
) {
  const protection = insulation(worn),
    comfortableMin = COMFORTABLE_MIN - protection.cold,
    comfortableMax = COMFORTABLE_MAX + protection.heat,
    safeMin = comfortableMin - 10,
    safeMax = comfortableMax + 10;
  if (tick % MALNUTRITION_INTERVAL === 0)
    h.malnutrition = clamp(h.malnutrition + (food <= 0 ? 1 : -1) * 0.0011325 * h.starvationFactor);
  if (tick % TEMPERATURE_INTERVAL !== 0) return;
  if (temperature < safeMin)
    h.hypothermia = clamp(h.hypothermia + Math.max((safeMin - temperature) * 0.0000645, 0.00075));
  else if (temperature > comfortableMin)
    h.hypothermia = clamp(h.hypothermia - clamp(h.hypothermia * 0.027, 0.0015, 0.015));
  if (temperature > safeMax)
    h.heatstroke = clamp(
      h.heatstroke + Math.max(heatOverage(temperature - safeMax) * 0.0000645, 0.000375),
    );
  else if (temperature < comfortableMax)
    h.heatstroke = clamp(h.heatstroke - clamp(h.heatstroke * 0.027, 0.0015, 0.015));
}
export function healthDeathReason(h: SurvivalHealth, trauma?: Trauma): string | null {
  return (
    (trauma && traumaSummary(trauma).deathReason) ||
    (h.malnutrition >= 1
      ? '营养不良致死'
      : h.hypothermia >= 1
        ? '失温致死'
        : h.heatstroke >= 1
          ? '中暑致死'
          : null)
  );
}
export function healthSummary(
  p: Pick<Pawn, 'health' | 'dead' | 'deathReason'> & Partial<Pick<Pawn, 'worn' | 'trauma'>>,
) {
  const trauma = traumaSummary(p.trauma ?? initialTrauma());
  const h = p.health,
    mal = stage(h.malnutrition, [0, 0.2, 0.4, 0.6, 0.8]),
    cold = stage(h.hypothermia, [0, 0.04, 0.2, 0.35, 0.62]),
    hot = stage(h.heatstroke, [0, 0.04, 0.2, 0.35, 0.62]);
  const pain = clamp(trauma.pain + [0, 0, 0, 0.15, 0.3][cold] + [0, 0, 0, 0.15, 0.3][hot]);
  const penalty = clamp(((pain - 0.1) / 0.9) * 0.4, 0, 0.4);
  const consciousOffset =
    [0, -0.05, -0.1, -0.2, -0.3][mal] +
    [0, -0.05, -0.1, -0.2, 0][cold] +
    [0, -0.05, -0.1, -0.2, 0][hot] +
    trauma.consciousnessOffset;
  const consciousness = p.dead
    ? 0
    : rounded(
        Math.min(
          1 - (penalty >= 0.01 ? penalty : 0) + consciousOffset,
          mal === 4 || cold === 4 || hot === 4 ? 0.1 : 1,
          trauma.consciousnessMax,
        ),
      );
  const moving =
    consciousness < 0.3
      ? 0
      : rounded(
          (Math.min(consciousness, 1) + [0, 0, -0.1, -0.3, 0][cold] + [0, 0, -0.1, -0.3, 0][hot]) *
            trauma.movingFactor,
        );
  const manipulation =
    consciousness < 0.3
      ? 0
      : rounded((consciousness + [0, -0.08, -0.2, -0.5, 0][cold]) * trauma.manipulationFactor);
  const labels = ['初期', '轻微', '中度', '严重', '极重'];
  const stages = {
    malnutrition: h.malnutrition > 0 ? labels[mal] : '无',
    hypothermia: h.hypothermia > 0 ? labels[cold] : '无',
    heatstroke: h.heatstroke > 0 ? labels[hot] : '无',
  };
  const reason = p.dead
    ? (p.deathReason ?? '死亡')
    : [
        h.malnutrition > 0 ? '营养不良（' + stages.malnutrition + '）' : '',
        h.hypothermia > 0 ? '失温（' + stages.hypothermia + '）' : '',
        h.heatstroke > 0 ? '中暑（' + stages.heatstroke + '）' : '',
        p.trauma?.wounds.length ? `${p.trauma.wounds.length} 处外伤` : '',
        p.trauma && p.trauma.bloodLoss > 0 ? '失血' : '',
      ]
        .filter(Boolean)
        .join('、') || '健康';
  return {
    consciousness,
    moving,
    manipulation,
    pain,
    bleedRate: trauma.bleedRate,
    reason,
    stages,
    comfortableMin: COMFORTABLE_MIN - insulation(p.worn ?? []).cold,
    comfortableMax: COMFORTABLE_MAX + insulation(p.worn ?? []).heat,
    safeMin: SAFE_MIN - insulation(p.worn ?? []).cold,
    safeMax: SAFE_MAX + insulation(p.worn ?? []).heat,
  };
}
