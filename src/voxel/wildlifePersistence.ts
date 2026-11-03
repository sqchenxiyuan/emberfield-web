import { DAY, type VoxelSave } from './types';
import { ANIMAL_DEFS, ANIMAL_PHASE_NAMES, WILDLIFE } from './wildlife';
import { isRangedKind } from './ranged';

export function migrateWildlife(old: Record<string, any>) {
  if (old.version !== 21) return;
  if (old.animals !== undefined || old.butcherSpots !== undefined ||
      old.items?.some((b: any) => ['meat', 'carcass'].includes(b?.resource)) ||
      old.jobs?.some((j: any) => ['butcher', 'butcherSpot'].includes(j?.kind)))
    throw new Error('旧存档包含新版动物字段');
  old.animals = [];
  old.butcherSpots = [];
  for (const p of old.pawns) p.priorities.hunt = p.faction === 'colony' ? 2 : 0;
  for (const key of ['produced', 'consumed', 'spoiled', 'destroyed']) {
    if (!old.stats?.[key]) throw new Error('旧物资账本无效');
    old.stats[key].meat = 0;
    old.stats[key].carcass = 0;
  }
  for (const ledger of [old.trade?.imported, old.trade?.exported]) {
    if (!ledger) throw new Error('旧贸易账本无效');
    ledger.meat = 0; ledger.carcass = 0;
  }
  // Only old accept-everything zones gain the new resources. Selective stores keep their filters.
  for (const stock of old.stockpiles) if (stock.accepts.length === 13)
    stock.accepts.push('meat', 'carcass');
  old.version = 22;
}

export function validateWildlife(d: VoxelSave, usedIds: Set<number>, equipmentIds: Set<number>) {
  const integer = (n: unknown) => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0;
  const identity = (n: number) => integer(n) && n > 0 && n < d.nextId;
  for (const a of d.animals) {
    if (!Object.hasOwn(ANIMAL_DEFS, a.species) || a.name !== ANIMAL_DEFS[a.species].name ||
        !Object.hasOwn(ANIMAL_PHASE_NAMES, a.phase) || typeof a.hunt !== 'boolean' || typeof a.dead !== 'boolean' ||
        !Number.isFinite(a.health) || a.health < 0 || a.health > ANIMAL_DEFS[a.species].health ||
        !Number.isFinite(a.hunger) || a.hunger < 0 || a.hunger > 100 ||
        a.dead !== (a.health === 0) || a.dead !== (a.phase === 'dead') || (a.dead && a.hunt) ||
        ![a.moveTick, a.decisionTick, a.fleeUntil, a.retryTick].every(integer) ||
        (a.threatId !== null && !identity(a.threatId)) ||
        !Number.isFinite(a.rotProgress) || a.rotProgress < 0 || a.rotProgress >= WILDLIFE.carcassRotDays * DAY ||
        (!a.dead && a.rotProgress !== 0) ||
        (a.carcassHitPoints !== undefined && (!a.dead || !Number.isInteger(a.carcassHitPoints) ||
          a.carcassHitPoints < 1 || a.carcassHitPoints > 100))) throw new Error('野生动物状态无效');
  }
  for (const b of d.butcherSpots) if (typeof b.paused !== 'boolean') throw new Error('屠宰点状态无效');
  for (const batch of [...d.items, ...d.pawns.flatMap(p => p.cargo ? [p.cargo] : []),
    ...d.jobs.flatMap(j => j.deliveredBatches)]) {
    if (!batch.carcass) continue;
    const id = batch.carcass.animalId;
    if (!identity(id) || usedIds.has(id) || equipmentIds.has(id)) throw new Error('动物尸体身份重复或无效');
    usedIds.add(id);
  }
  const targets = new Set<number>();
  for (const p of d.pawns) if (p.phase === 'hunt') {
    if (p.faction !== 'colony' || p.drafted || p.dead || p.downed || p.carriedBy !== null ||
        p.cargo || p.jobId !== null || p.carePhase !== null || p.apparelTask || p.weaponTask ||
        !p.weapon || !isRangedKind(p.weapon.kind) || p.weaponDropPending || !p.priorities.hunt ||
        !d.animals.some(a => a.id === p.attackTargetId && !a.dead && a.hunt) || targets.has(p.attackTargetId!))
      throw new Error('狩猎任务或猎物预留无效');
    targets.add(p.attackTargetId!);
  }
}
