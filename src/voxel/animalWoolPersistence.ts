import type { VoxelSave } from './types';
import { defaultProductionQueue, type ProductionHost } from './productionBills';

/** Original input is checked before old migrations can introduce current defaults. */
export function rejectLegacyWool(old: Record<string, any>, sourceVersion: number): void {
  if (sourceVersion >= 50) return;
  const visit = (value: unknown): void => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      if (value.includes('alpacaWool') || value.includes('alpaca')) throw new Error('旧版本混入羊毛或羊驼筛选');
      value.forEach(visit); return;
    }
    for (const [key, entry] of Object.entries(value)) {
      if (['woolGrowth', 'alpacaWool', 'alpaca', 'allowedTextiles'].includes(key) ||
          (['resource', 'material'].includes(key) && entry === 'alpacaWool') ||
          (key === 'species' && entry === 'alpaca') || (key === 'action' && entry === 'shear') ||
          (key === 'kind' && ['sheared', 'shearFailed'].includes(entry as string)))
        throw new Error('旧版本混入剪毛或衣物材料字段');
      visit(entry);
    }
  };
  visit(old);
}

export function migrateWool(old: Record<string, any>, sourceVersion: number): void {
  if (sourceVersion >= 50) return;
  for (const a of old.animals ?? []) a.woolGrowth = 0;
  for (const marker of old.penMarkers ?? []) marker.filter.alpaca = false;
  for (const ledger of [old.stats?.produced, old.stats?.consumed, old.stats?.destroyed, old.stats?.spoiled,
    old.trade?.imported, old.trade?.exported]) {
    if (!ledger || typeof ledger !== 'object') throw new Error('旧版资源账本缺失');
    ledger.alpacaWool = 0;
  }
  // A bench may still use the legacy implicit bills instead of a stored queue.
  // Materialize those identities so loading cannot silently broaden cloth-only
  // recipes when today's default policy starts accepting new textiles.
  for (const tailor of old.tailors ?? []) {
    if (!Array.isArray(old.productionQueues)) throw new Error('旧版生产账单缺失');
    if (old.productionQueues.some((q: any) => q.benchId === tailor.id)) continue;
    const queue = defaultProductionQueue(old as ProductionHost, tailor.id);
    if (!queue) throw new Error('旧版裁缝账单缺失');
    for (const bill of queue.bills) bill.policy.allowedCarcasses = bill.policy.allowedCarcasses.filter(s => s !== 'alpaca');
    old.productionQueues.push(queue);
    for (const job of old.jobs ?? []) if (job.kind === 'tailoring' && !job.cancelled && job.billId === undefined &&
        job.x === tailor.x && job.y === tailor.y && job.z === tailor.z)
      job.billId = `legacy:${tailor.id}:tailoring:${job.apparelKind}`;
  }
  // Every persisted policy, including a frozen job or physical unfinished item,
  // retains its old cloth-only choice. Pre-policy saves receive that same choice.
  const visit = (value: any): void => {
    if (!value || typeof value !== 'object') return;
    if (!Array.isArray(value) && Object.hasOwn(value, 'allowedFood') && Object.hasOwn(value, 'allowedCarcasses'))
      value.allowedTextiles = ['cloth'];
    Object.values(value).forEach(visit);
  };
  visit(old);
}

export function validateWool(d: VoxelSave): void {
  for (const a of d.animals) if (!Number.isFinite(a.woolGrowth) || a.woolGrowth < 0 || a.woolGrowth > 1 ||
      (a.species !== 'alpaca' && a.woolGrowth !== 0)) throw new Error('动物毛量无效');
}
