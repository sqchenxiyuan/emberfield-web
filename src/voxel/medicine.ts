import { DAY, type Pawn } from './types';
import { BODY_PARTS, isPartMissing, type BodyPartId } from './anatomy';
import {
  injuryBleedRate,
  tendableInjuries,
  type Injury,
  type Trauma,
  type TraumaRecord,
} from './injuries';

/** Selected Core medical rules; scheduling, keyed randomness and voxel room
 * cleanliness are explicit adaptations documented in chapter 62. */
export const MEDICAL_POLICIES = ['none', 'noMedicine', 'herbal'] as const;
export type MedicalPolicy = (typeof MEDICAL_POLICIES)[number];
export const MEDICAL_POLICY_NAMES: Record<MedicalPolicy, string> = {
  none: '不接受护理',
  noMedicine: '护理但不用药',
  herbal: '允许草药',
};
export const MEDICAL_CARE_WORK = 200;
export const INFECTION_TEND_DURATION = (15 * DAY) / 24;
export const INFECTION_TEND_OVERLAP = (3 * DAY) / 24;
export interface WoundInfectionRisk {
  woundId: number;
  state: 'pending' | 'ineligible' | 'failed' | 'infected' | 'legacy';
  checkAt: number | null;
  /** Second trial is sampled once. It is never a UI diagnosis. */
  roll: number;
  roomFactor: number;
}
export interface WoundInfection {
  id: number;
  part: BodyPartId;
  createdTick: number;
  severity: number;
  /** Fixed factor used when this is the first surviving infection of the Def. */
  immunityFactor: number;
  tendQuality: number | null;
  tendUntil: number;
}
export interface MedicalTreatment {
  tick: number;
  doctorId: number;
  medicine: 'herb' | null;
  recordIds: number[];
  qualities: number[];
  roomFactor: number;
}
export interface MedicalState {
  policy: MedicalPolicy;
  bedRest: boolean;
  risks: WoundInfectionRisk[];
  infections: WoundInfection[];
  immunity: number;
  lastTend: MedicalTreatment | null;
}
type Patient = Pick<Pawn, 'trauma' | 'medical'>;
const clamp = (n: number, min = 0, max = 1) => Math.max(min, Math.min(max, n));
export function medicalRandom(seed: number, pawnId: number, recordId: number, stream: number) {
  let h = Math.imul(seed ^ pawnId, 0x45d9f3b) ^ Math.imul(recordId, 0x27d4eb2d);
  h ^= Math.imul(stream, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
export function initialMedical(): MedicalState {
  return {
    policy: 'herbal',
    bedRest: true,
    risks: [],
    infections: [],
    immunity: 0,
    lastTend: null,
  };
}
export function infectionStage(severity: number): string {
  return severity >= 0.87 ? '极重' : severity >= 0.78 ? '危重' : severity >= 0.33 ? '严重' : '轻微';
}
export function infectionCanTend(infection: WoundInfection, immunity: number, tick: number) {
  return immunity < 1 && infection.tendUntil - tick < INFECTION_TEND_OVERLAP;
}
export function needsMedicalTending(p: Patient, tick: number): boolean {
  return (
    tendableInjuries(p.trauma).length > 0 ||
    p.medical.infections.some((i) => infectionCanTend(i, p.medical.immunity, tick))
  );
}
export function medicalNeedsRest(p: Pick<Pawn, 'medical'>): boolean {
  return p.medical.bedRest && p.medical.infections.length > 0;
}
export function infectionEffects(medical?: MedicalState) {
  const infections = medical?.infections ?? [];
  return {
    pain: infections.reduce(
      (n, i) =>
        n +
        (i.severity >= 0.87 ? 0.85 : i.severity >= 0.78 ? 0.12 : i.severity >= 0.33 ? 0.08 : 0.05),
      0,
    ),
    consciousnessOffset: infections.reduce(
      (n, i) => n + (i.severity >= 0.78 && i.severity < 0.87 ? -0.05 : 0),
      0,
    ),
    consciousnessMax: infections.some((i) => i.severity >= 0.87) ? 0.1 : Infinity,
    breathingOffset: -0.05 * infections.filter((i) => i.severity >= 0.87).length,
    lethal: infections.some((i) => i.severity >= 1),
  };
}
/** Linear native curves clamp outside their listed domains. */
export function infectionTrialChance(wound: Injury, roomFactor: number): number {
  const severityFactor = 0.1 + 0.9 * clamp((wound.severity - 1) / 11);
  return (
    severityFactor *
    (wound.tendQuality === null ? 1 : roomFactor * (0.7 - 0.3 * clamp(wound.tendQuality)))
  );
}
export function infectionRoomFactor(cleanliness: number): number {
  return cleanliness <= 0 ? 0.5 + 0.1 * clamp(-cleanliness, 0, 5) : 0.5 - 0.3 * clamp(cleanliness);
}
export function trackInfectionRisks(p: Patient, seed: number, pawnId: number, tick: number): void {
  const ids = new Set(p.trauma.wounds.map((w) => w.id));
  p.medical.risks = p.medical.risks.filter((r) => ids.has(r.woundId));
  const tracked = new Set(p.medical.risks.map((r) => r.woundId));
  for (const w of p.trauma.wounds) {
    if (tracked.has(w.id)) continue;
    const chance =
      w.kind === 'bite' ? 0.3 : ['cut', 'stab', 'gunshot', 'crush'].includes(w.kind) ? 0.15 : 0;
    const eligible =
      chance > 0 && !BODY_PARTS[w.part].solid && medicalRandom(seed, pawnId, w.id, 1) <= chance;
    p.medical.risks.push({
      woundId: w.id,
      state: eligible ? 'pending' : 'ineligible',
      checkAt: eligible
        ? Math.max(0, tick - w.ageTicks) +
          3000 +
          Math.floor(medicalRandom(seed, pawnId, w.id, 2) * 6001)
        : null,
      roll: medicalRandom(seed, pawnId, w.id, 3),
      roomFactor: 1,
    });
  }
  p.medical.infections = p.medical.infections.filter((i) => !isPartMissing(p.trauma, i.part));
}
export interface MedicalAdvanceContext {
  seed: number;
  pawnId: number;
  food: number;
  rest: number;
  resting: boolean;
  inBed: boolean;
  bloodFiltration: number;
  allocId: () => number;
}
/** Native stat factors for the current adult cohort. No age/genes/traits. */
export function immunityGainSpeed(
  context: Omit<MedicalAdvanceContext, 'seed' | 'pawnId' | 'allocId'>,
): number {
  const food = context.food <= 0 ? 0.7 : context.food < 12 ? 0.9 : 1;
  const rest = context.rest < 1 ? 0.8 : context.rest < 14 ? 0.92 : context.rest < 28 ? 0.96 : 1;
  // Ordinary bed inherits 1.07 through SansComfortBedBase. Its medical flag
  // does not turn it into a hospital bed (1.11).
  return (
    Math.max(0, 0.5 + 0.5 * context.bloodFiltration) *
    food *
    rest *
    (context.resting ? 1.1 : 1) *
    (context.inBed ? 1.07 : 1)
  );
}
export function advanceMedical(p: Patient, tick: number, context: MedicalAdvanceContext): void {
  trackInfectionRisks(p, context.seed, context.pawnId, tick);
  for (const risk of p.medical.risks) {
    if (risk.state !== 'pending' || tick < risk.checkAt!) continue;
    const w = p.trauma.wounds.find((w) => w.id === risk.woundId)!;
    risk.state = 'failed';
    if (
      1 - clamp(p.medical.immunity / 0.6) <= 0.001 ||
      p.medical.infections.some((i) => i.part === w.part)
    )
      continue;
    if (risk.roll >= infectionTrialChance(w, risk.roomFactor)) continue;
    risk.state = 'infected';
    const id = context.allocId();
    p.medical.infections.push({
      id,
      part: w.part,
      createdTick: tick,
      severity: 0.001,
      immunityFactor: 0.8 + medicalRandom(context.seed, context.pawnId, id, 4) * 0.4,
      tendQuality: null,
      tendUntil: 0,
    });
  }
  if (p.medical.infections.length) {
    const immune = p.medical.immunity >= 1;
    for (const i of p.medical.infections) {
      const tended = i.tendUntil > tick ? -0.53 * (i.tendQuality ?? 0) : 0;
      i.severity = clamp(i.severity + ((immune ? -0.7 : 0.84) + tended) / DAY);
    }
    if (p.medical.infections.some((i) => i.severity >= 1)) return;
    p.medical.infections = p.medical.infections.filter((i) => i.severity > 0);
  }
  // Hediffs disappear before the shared per-Def immunity record is updated.
  const first = p.medical.infections[0];
  p.medical.immunity = clamp(
    p.medical.immunity +
      (first ? 0.6441 * immunityGainSpeed(context) * first.immunityFactor : -0.4) / DAY,
  );
}
type TreatmentTarget = {
  id: number;
  severity: number;
  priority: number;
  wound?: TraumaRecord;
  infection?: WoundInfection;
};
function treatmentCandidates(p: Patient, tick: number): TreatmentTarget[] {
  return [
    ...tendableInjuries(p.trauma).map((w) => ({
      id: w.id,
      severity: 'severity' in w ? w.severity : BODY_PARTS[w.part].hitPoints,
      priority: injuryBleedRate(w) * 1.5,
      wound: w,
    })),
    ...p.medical.infections
      .filter((i) => infectionCanTend(i, p.medical.immunity, tick))
      .map((i) => ({
        id: i.id,
        severity: i.severity,
        priority: i.severity >= 0.78 ? 1 : 0.025,
        infection: i,
      })),
  ].sort((a, b) => b.priority - a.priority || b.severity - a.severity || a.id - b.id);
}
function selectTreatment(candidates: TreatmentTarget[], medicine: boolean): TreatmentTarget[] {
  const first = candidates[0];
  if (!first) return [];
  const targets = [first];
  if (medicine && first.wound && 'severity' in first.wound) {
    let severity = first.severity;
    for (const c of candidates.slice(1)) {
      if (c.wound && 'severity' in c.wound && severity + c.severity <= 20) {
        targets.push(c);
        severity += c.severity;
      }
    }
  }
  return targets;
}
export function medicineNeeded(p: Patient, tick: number): number {
  let candidates = treatmentCandidates(p, tick),
    count = 0;
  while (candidates.length) {
    const batch = new Set(selectTreatment(candidates, true).map((r) => r.id));
    candidates = candidates.filter((r) => !batch.has(r.id));
    count++;
  }
  return count;
}
export function tendMedical(
  p: Patient,
  options: {
    seed: number;
    pawnId: number;
    doctorId: number;
    tick: number;
    doctorQuality: number;
    medicine: boolean;
    roomFactor: number;
  },
): MedicalTreatment | null {
  const targets = selectTreatment(treatmentCandidates(p, options.tick), options.medicine);
  if (!targets.length) return null;
  trackInfectionRisks(p, options.seed, options.pawnId, options.tick);
  const base = clamp(options.doctorQuality * (options.medicine ? 0.6 : 0.3), 0, 0.7);
  const result: MedicalTreatment = {
    tick: options.tick,
    doctorId: options.doctorId,
    medicine: options.medicine ? 'herb' : null,
    recordIds: [],
    qualities: [],
    roomFactor: options.roomFactor,
  };
  for (const target of targets) {
    const q = clamp(
      base +
        medicalRandom(options.seed, options.doctorId, target.id, options.tick + 10) * 0.5 -
        0.25,
      0,
      0.7,
    );
    if (target.wound) {
      target.wound.tendQuality = q;
      if ('isFresh' in target.wound) target.wound.isFresh = false;
      const risk = p.medical.risks.find((r) => r.woundId === target.id);
      if (risk) risk.roomFactor = options.roomFactor;
    } else {
      target.infection!.tendQuality = q;
      target.infection!.tendUntil =
        Math.max(options.tick, target.infection!.tendUntil) + INFECTION_TEND_DURATION;
    }
    result.recordIds.push(target.id);
    result.qualities.push(q);
  }
  p.medical.lastTend = result;
  return result;
}
