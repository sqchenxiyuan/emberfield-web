import { DAY, type Pawn, type SurvivalHealth, type ApparelPiece } from './types';
import { insulation } from './apparel';
import {
  initialTrauma,
  traumaSummary,
  BODY_REGIONS,
  type Trauma,
  type LegacyTrauma,
} from './injuries';
import { roundedCapacity, type CapacityReasons } from './anatomy';
import { initialMedical, infectionEffects, type MedicalState } from './medicine';
import { SANITATION_RULES } from './sanitation';

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
  | 'allowedAreaId'
  | 'firefightTask'
  | 'repairTask'
  | 'cleanTask'
  | 'dirtCarry'
  | 'foodPoisoning'
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
  | 'careMedicineId'
  | 'careAmount'
  | 'trauma'
  | 'medical'
  | 'faction'
  | 'drafted'
  | 'retreating'
  | 'attackTargetId'
  | 'nextAttackTick'
  | 'shooting'
  | 'staggerUntil'
  | 'weapon'
  | 'weaponTask'
  | 'weaponDropPending'
> {
  // Deterministic personal sampling is a prototype adaptation; the original uses its pawn RNG.
  let hash = Math.imul(seed ^ id, 0x45d9f3b);
  hash = Math.imul(hash ^ (hash >>> 16), 0x45d9f3b);
  return {
    allowedAreaId: null,
    firefightTask: null, repairTask: null,
    cleanTask: null, dirtCarry: 0, foodPoisoning: null,
    trauma: initialTrauma(),
    medical: initialMedical(),
    faction: 'colony',
    drafted: false,
    retreating: false,
    attackTargetId: null,
    nextAttackTick: 0,
    shooting: null,
    staggerUntil: 0,
    weapon: null,
    weaponTask: null,
    weaponDropPending: false,
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
    careMedicineId: null,
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
/** The pre-v16 health contract is retained only to validate genuine old saves. */
export function legacyHealthState(h: SurvivalHealth, t: LegacyTrauma) {
  const damage = (part: string) =>
    t.wounds.reduce((sum, w) => sum + (w.part === part ? w.severity : 0), 0);
  const broken = (part: keyof typeof BODY_REGIONS) =>
    t.brokenParts.includes(part as (typeof t.brokenParts)[number]) ||
    damage(part) >= BODY_REGIONS[part].hitPoints;
  const core = (['torso', 'head', 'neck'] as const).find(broken);
  const deathReason = core
    ? `${BODY_REGIONS[core].name}损毁致死`
    : t.bloodLoss >= 1
      ? '失血致死'
      : h.malnutrition >= 1
        ? '营养不良致死'
        : h.hypothermia >= 1
          ? '失温致死'
          : h.heatstroke >= 1
            ? '中暑致死'
            : null;
  const dead = deathReason !== null;
  const fraction = (part: keyof typeof BODY_REGIONS) =>
    broken(part) ? 0 : clamp(1 - damage(part) / BODY_REGIONS[part].hitPoints);
  const mal = stage(h.malnutrition, [0, 0.2, 0.4, 0.6, 0.8]),
    cold = stage(h.hypothermia, [0, 0.04, 0.2, 0.35, 0.62]),
    hot = stage(h.heatstroke, [0, 0.04, 0.2, 0.35, 0.62]),
    blood = stage(t.bloodLoss, [0, 0.15, 0.3, 0.45, 0.6]);
  const traumaDead = !!core || t.bloodLoss >= 1;
  const pain = clamp(
    (traumaDead ? 0 : t.wounds.reduce((sum, w) => sum + w.severity * 0.0125, 0)) +
      [0, 0, 0, 0.15, 0.3][cold] +
      [0, 0, 0, 0.15, 0.3][hot],
  );
  const penalty = clamp(((pain - 0.1) / 0.9) * 0.4, 0, 0.4);
  const consciousness = dead
    ? 0
    : rounded(
        Math.min(
          1 -
            (penalty >= 0.01 ? penalty : 0) +
            [0, -0.05, -0.1, -0.2, -0.3][mal] +
            [0, -0.05, -0.1, -0.2, 0][cold] +
            [0, -0.05, -0.1, -0.2, 0][hot] +
            [0, -0.1, -0.2, -0.4, -0.4][blood],
          mal === 4 || cold === 4 || hot === 4 || blood === 4 ? 0.1 : 1,
        ),
      );
  const moving =
    consciousness < 0.3
      ? 0
      : rounded(
          ((Math.min(consciousness, 1) + [0, 0, -0.1, -0.3, 0][cold] + [0, 0, -0.1, -0.3, 0][hot]) *
            (fraction('leftLeg') + fraction('rightLeg'))) /
            2,
        );
  const manipulation =
    consciousness < 0.3
      ? 0
      : rounded(
          ((consciousness + [0, -0.08, -0.2, -0.5, 0][cold]) *
            (fraction('leftArm') + fraction('rightArm'))) /
            2,
        );
  return {
    dead,
    downed: !dead && (pain >= 0.8 || consciousness < 0.3 || moving <= 0.15),
    deathReason,
    manipulation,
    moving,
    consciousness,
    pain,
  };
}
function capacities(
  h: SurvivalHealth,
  trauma: ReturnType<typeof traumaSummary>,
  dead: boolean,
  medical?: MedicalState,
) {
  const infection = infectionEffects(medical);
  const breathing = roundedCapacity(
    trauma.breathing > 0 ? trauma.breathing + infection.breathingOffset : trauma.breathing,
  );
  const mal = stage(h.malnutrition, [0, 0.2, 0.4, 0.6, 0.8]),
    cold = stage(h.hypothermia, [0, 0.04, 0.2, 0.35, 0.62]),
    hot = stage(h.heatstroke, [0, 0.04, 0.2, 0.35, 0.62]);
  const pain = clamp(
    trauma.pain + infection.pain + [0, 0, 0, 0.15, 0.3][cold] + [0, 0, 0, 0.15, 0.3][hot],
  );
  const penalty = clamp(((pain - 0.1) / 0.9) * 0.4, 0, 0.4);
  const consciousRaw =
    (trauma.consciousnessSource - (penalty >= 0.01 ? penalty : 0)) *
    (0.8 + 0.2 * Math.min(trauma.bloodPumping, 1)) *
    (0.8 + 0.2 * Math.min(breathing, 1)) *
    (0.9 + 0.1 * Math.min(trauma.bloodFiltration, 1));
  const consciousOffset =
    [0, -0.05, -0.1, -0.2, -0.3][mal] +
    [0, -0.05, -0.1, -0.2, 0][cold] +
    [0, -0.05, -0.1, -0.2, 0][hot] +
    trauma.consciousnessOffset +
    infection.consciousnessOffset;
  // PawnCapacityUtility: only positive worker results receive condition modifiers.
  const consciousness = dead
    ? 0
    : roundedCapacity(
        consciousRaw > 0
          ? Math.min(
              consciousRaw + consciousOffset,
              mal === 4 || cold === 4 || hot === 4 ? 0.1 : 1,
              trauma.consciousnessMax,
              infection.consciousnessMax,
            )
          : consciousRaw,
      );
  const movingRaw =
      ((trauma.movingFactor * (0.8 + 0.2 * Math.min(breathing, 1))) /
        (0.8 + 0.2 * Math.min(trauma.breathing, 1))) *
      Math.min(consciousness, 1),
    manipulationRaw = trauma.manipulationFactor * consciousness;
  const moving =
    consciousness < 0.3
      ? 0
      : roundedCapacity(
          movingRaw > 0
            ? movingRaw + [0, 0, -0.1, -0.3, 0][cold] + [0, 0, -0.1, -0.3, 0][hot]
            : movingRaw,
        );
  const manipulation =
    consciousness < 0.3
      ? 0
      : roundedCapacity(
          manipulationRaw > 0 ? manipulationRaw + [0, -0.08, -0.2, -0.5, 0][cold] : manipulationRaw,
        );
  const capacityReasons = Object.fromEntries(
    Object.entries(trauma.capacityReasons).map(([key, reasons]) => [key, [...reasons]]),
  ) as CapacityReasons;
  if (penalty >= 0.01) capacityReasons.consciousness.push(`疼痛 ${Math.round(pain * 100)}%`);
  for (const [key, name] of [
    ['bloodPumping', '血液循环'],
    ['breathing', '呼吸'],
    ['bloodFiltration', '血液过滤'],
  ] as const) {
    if (trauma[key] !== 1)
      capacityReasons.consciousness.push(
        `${name} ${Math.round(trauma[key] * 100)}%（${capacityReasons[key].join('；')}）`,
      );
    if (key !== 'bloodFiltration' && trauma[key] !== 1)
      capacityReasons.moving.push(`${name} ${Math.round(trauma[key] * 100)}%`);
  }
  if (consciousness !== 1)
    for (const key of ['moving', 'manipulation', 'talking', 'eating'] as const)
      capacityReasons[key].push(
        `意识 ${Math.round(consciousness * 100)}%${consciousness < 0.3 ? '，低于清醒阈值30%' : ''}`,
      );
  if (h.malnutrition > 0) capacityReasons.consciousness.push('营养不良');
  if (h.hypothermia > 0)
    for (const key of ['consciousness', 'moving', 'manipulation'] as const)
      capacityReasons[key].push('失温');
  if (h.heatstroke > 0)
    for (const key of ['consciousness', 'moving'] as const) capacityReasons[key].push('中暑');
  if (trauma.consciousnessOffset !== 0) capacityReasons.consciousness.push('失血');
  if (medical?.infections.length) {
    capacityReasons.consciousness.push('伤口感染');
    if (infection.breathingOffset !== 0) capacityReasons.breathing.push('重度感染');
  }
  const labels = ['初期', '轻微', '中度', '严重', '极重'];
  return {
    consciousness,
    moving,
    manipulation,
    pain,
    capacityReasons,
    sight: dead ? 0 : trauma.sight,
    breathing: dead ? 0 : breathing,
    bloodPumping: dead ? 0 : trauma.bloodPumping,
    bloodFiltration: dead ? 0 : trauma.bloodFiltration,
    metabolism: dead ? 0 : trauma.metabolism,
    hearing: dead ? 0 : trauma.hearing,
    talking: consciousness < 0.3 ? 0 : roundedCapacity(trauma.talkingFactor * consciousness),
    eating:
      consciousness < 0.3 ? 0 : roundedCapacity(Math.max(0.1, trauma.eatingFactor * consciousness)),
    stages: {
      malnutrition: h.malnutrition > 0 ? labels[mal] : '无',
      hypothermia: h.hypothermia > 0 ? labels[cold] : '无',
      heatstroke: h.heatstroke > 0 ? labels[hot] : '无',
    },
  };
}
export function healthDeathReason(
  h: SurvivalHealth,
  trauma: Trauma = initialTrauma(),
  medical?: MedicalState,
): string | null {
  const summary = traumaSummary(trauma);
  const primary =
    summary.deathReason ||
    (infectionEffects(medical).lethal ? '伤口感染致死' : null) ||
    (h.malnutrition >= 1
      ? '营养不良致死'
      : h.hypothermia >= 1
        ? '失温致死'
        : h.heatstroke >= 1
          ? '中暑致死'
          : null);
  if (primary) return primary;
  const derived = capacities(h, summary, false, medical);
  return derived.breathing <= 0
    ? '呼吸功能丧失致死'
    : derived.consciousness <= 0
      ? '意识功能丧失致死'
      : null;
}
export function healthSummary(
  p: Pick<Pawn, 'health' | 'dead' | 'deathReason'> &
    Partial<Pick<Pawn, 'worn' | 'trauma' | 'medical' | 'foodPoisoning'>>,
) {
  const trauma = traumaSummary(p.trauma ?? initialTrauma()),
    derived = capacities(p.health, trauma, p.dead, p.medical);
  const reason = p.dead
    ? (p.deathReason ?? '死亡')
    : [
        p.health.malnutrition > 0 ? `营养不良（${derived.stages.malnutrition}）` : '',
        p.health.hypothermia > 0 ? `失温（${derived.stages.hypothermia}）` : '',
        p.health.heatstroke > 0 ? `中暑（${derived.stages.heatstroke}）` : '',
        p.trauma?.wounds.length ? `${p.trauma.wounds.length} 处外伤` : '',
        p.trauma?.missingParts.length ? `${p.trauma.missingParts.length} 处部位缺失` : '',
        p.trauma && p.trauma.bloodLoss > 0 ? '失血' : '',
        p.medical?.infections.length ? `${p.medical.infections.length} 处感染` : '',
      ]
        .filter(Boolean)
        .join('、') || '健康';
  if (p.foodPoisoning && !p.dead) {
    const symptoms = SANITATION_RULES.capacity[p.foodPoisoning.stage];
    if (symptoms) {
      derived.moving = roundedCapacity(derived.moving * symptoms.moving);
      derived.manipulation = roundedCapacity(derived.manipulation * symptoms.manipulation);
    }
    derived.capacityReasons.moving.push('食物中毒'); derived.capacityReasons.manipulation.push('食物中毒');
  }
  const protection = insulation(p.worn ?? []);
  return {
    ...derived,
    bleedRate: trauma.bleedRate,
    reason: p.foodPoisoning && !p.dead ? (reason === '健康' ? '食物中毒' : reason + '、食物中毒') : reason,
    comfortableMin: COMFORTABLE_MIN - protection.cold,
    comfortableMax: COMFORTABLE_MAX + protection.heat,
    safeMin: SAFE_MIN - protection.cold,
    safeMax: SAFE_MAX + protection.heat,
  };
}
