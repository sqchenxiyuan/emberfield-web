import {
  initialMedical,
  MEDICAL_POLICIES,
  INFECTION_TEND_DURATION,
  INFECTION_TEND_OVERLAP,
  type MedicalState,
} from './medicine';
import { validBodyPart, isPartMissing } from './anatomy';
import type { VoxelSave } from './types';

export function rejectLegacyMedicineFields(old: Record<string, any>) {
  if (old.version >= 19) return;
  const people = Array.isArray(old.pawns) ? old.pawns : [];
  const batches = [...(Array.isArray(old.items) ? old.items : []), ...people.map((p) => p?.cargo)];
  if (
    people.some(
      (p) =>
        p &&
        (Object.hasOwn(p, 'medical') ||
          Object.hasOwn(p, 'careMedicineId') ||
          p.carePhase === 'tendFetch'),
    ) ||
    batches.some((b) => b?.resource === 'herb') ||
    Object.values(old.stats ?? {}).some(
      (v) => v && typeof v === 'object' && Object.hasOwn(v, 'herb'),
    ) ||
    [...(old.farms ?? []), ...(old.crops ?? [])].some(
      (c) => c?.crop === 'healroot' || c?.kind === 'healroot',
    ) ||
    (old.stockpiles ?? []).some((s: any) => s?.accepts?.includes('herb')) ||
    (old.jobs ?? []).some(
      (j: any) =>
        j &&
        (Object.hasOwn(j, 'cropKind') ||
          Object.hasOwn(j.cost ?? {}, 'herb') ||
          Object.hasOwn(j.delivered ?? {}, 'herb')),
    )
  )
    throw new Error('旧存档包含新版医药或药根字段');
}
export function migrateMedicineFields(old: Record<string, any>) {
  if (old.version !== 18) return;
  if (!Array.isArray(old.pawns) || !old.stats) throw new Error('旧医药迁移数据无效');
  for (const p of old.pawns) {
    if (!p?.trauma || !Array.isArray(p.trauma.wounds)) throw new Error('旧伤口数据无效');
    p.medical = initialMedical();
    // There is no historical infecter state in v18. Do not retroactively roll
    // a new disease onto a previously saved wound, or invent prior room data.
    p.medical.risks = p.trauma.wounds.map((w: { id: number }) => ({
      woundId: w.id,
      state: 'legacy',
      checkAt: null,
      roll: 0,
      roomFactor: 1,
    }));
    p.careMedicineId = null;
  }
  for (const name of ['produced', 'consumed', 'spoiled', 'destroyed']) {
    if (!old.stats[name] || typeof old.stats[name] !== 'object') throw new Error('旧物资账本无效');
    old.stats[name].herb = 0;
  }
  old.version = 19;
}
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const exact = (v: object, keys: string[]) =>
  Object.keys(v).length === keys.length && keys.every((k) => Object.hasOwn(v, k));
const integer = (v: unknown): v is number =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const range = (v: unknown, min: number, max: number): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
/** Schema, object identity, retained random factors and timer invariants. World
 * placement and the physical medicine reservation are validated by world.ts. */
export function validateMedicineState(d: VoxelSave): void {
  const identity = (v: unknown): v is number => integer(v) && v > 0 && v < d.nextId;
  for (const p of d.pawns) {
    const m = p.medical as MedicalState;
    if (
      !object(m) ||
      !exact(m, ['policy', 'bedRest', 'risks', 'infections', 'immunity', 'lastTend']) ||
      !MEDICAL_POLICIES.includes(m.policy) ||
      typeof m.bedRest !== 'boolean' ||
      !range(m.immunity, 0, 1) ||
      !Array.isArray(m.risks) ||
      m.risks.length > 1024 ||
      !Array.isArray(m.infections) ||
      m.infections.length > 64 ||
      (p.careMedicineId !== null && !identity(p.careMedicineId))
    )
      throw new Error('医疗状态无效');
    const riskIds = new Set<number>();
    for (const r of m.risks) {
      if (
        !object(r) ||
        !exact(r, ['woundId', 'state', 'checkAt', 'roll', 'roomFactor']) ||
        !identity(r.woundId) ||
        riskIds.has(r.woundId) ||
        !p.trauma.wounds.some((w) => w.id === r.woundId) ||
        !['pending', 'ineligible', 'failed', 'infected', 'legacy'].includes(r.state) ||
        !range(r.roll, 0, 1) ||
        r.roll >= 1 ||
        !range(r.roomFactor, 0.2, 1) ||
        (['pending', 'failed', 'infected'].includes(r.state)
          ? !integer(r.checkAt) ||
            r.checkAt > d.tick + 9000 ||
            (r.state === 'pending' ? !p.dead && r.checkAt < d.tick : r.checkAt > d.tick)
          : r.checkAt !== null) ||
        (r.state === 'legacy' && r.roll !== 0)
      )
        throw new Error('伤口感染检查状态无效');
      riskIds.add(r.woundId);
    }
    if (riskIds.size !== p.trauma.wounds.length) throw new Error('伤口感染检查记录缺失');
    const parts = new Set<string>(),
      ids = new Set<number>();
    for (const i of m.infections) {
      if (
        !object(i) ||
        !exact(i, [
          'id',
          'part',
          'createdTick',
          'severity',
          'immunityFactor',
          'tendQuality',
          'tendUntil',
        ]) ||
        !identity(i.id) ||
        ids.has(i.id) ||
        !validBodyPart(i.part) ||
        parts.has(i.part) ||
        isPartMissing(p.trauma, i.part) ||
        !integer(i.createdTick) ||
        i.createdTick > d.tick ||
        !range(i.severity, 0, 1) ||
        i.severity <= 0 ||
        !range(i.immunityFactor, 0.8, 1.2) ||
        !integer(i.tendUntil) ||
        i.tendUntil > d.tick + INFECTION_TEND_DURATION + INFECTION_TEND_OVERLAP ||
        (i.tendQuality === null
          ? i.tendUntil !== 0
          : !range(i.tendQuality, 0, 0.7) || i.tendUntil === 0)
      )
        throw new Error('感染病情、部位或免疫因子无效');
      ids.add(i.id);
      parts.add(i.part);
    }
    const last = m.lastTend;
    if (
      last !== null &&
      (!object(last) ||
        !exact(last, ['tick', 'doctorId', 'medicine', 'recordIds', 'qualities', 'roomFactor']) ||
        !integer(last.tick) ||
        last.tick > d.tick ||
        !d.pawns.some((q) => q.id === last.doctorId) ||
        ![null, 'herb'].includes(last.medicine) ||
        !Array.isArray(last.recordIds) ||
        !last.recordIds.length ||
        last.recordIds.length > 1024 ||
        last.recordIds.some((id) => !identity(id)) ||
        new Set(last.recordIds).size !== last.recordIds.length ||
        !Array.isArray(last.qualities) ||
        last.qualities.length !== last.recordIds.length ||
        last.qualities.some((q) => !range(q, 0, 0.7)) ||
        !range(last.roomFactor, 0.2, 1))
    )
      throw new Error('护理历史无效');
  }
}
