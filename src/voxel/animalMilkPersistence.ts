import type { VoxelSave } from './types';

/** Inspect original input before historical migrations invoke today's defaults.
 * Field-aware recursion also catches hidden batch/cost/filter/task payloads. */
export function rejectLegacyMilk(old: Record<string, any>, sourceVersion: number): void {
  if (sourceVersion >= 49) return;
  const visit = (value: unknown): void => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      if (value.includes('milk') || value.includes('dromedary')) throw new Error('旧版本混入奶或单峰驼筛选');
      for (const entry of value) visit(entry);
      return;
    }
    for (const [key, entry] of Object.entries(value)) {
      if (['milkFullness','milk','dromedary'].includes(key) ||
          (key === 'resource' && entry === 'milk') || (key === 'species' && entry === 'dromedary') ||
          (key === 'action' && entry === 'milk') || (key === 'kind' && ['milked','milkFailed'].includes(entry as string)))
        throw new Error('旧版本混入产奶字段');
      visit(entry);
    }
  };
  visit(old);
}
export function migrateMilk(old: Record<string, any>, sourceVersion: number): void {
  if (sourceVersion >= 49) return;
  for (const a of old.animals ?? []) a.milkFullness = 0;
  for (const m of old.penMarkers ?? []) {
    if (!m.filter || typeof m.filter !== 'object') throw new Error('旧版圈地筛选无效');
    m.filter.dromedary = false;
  }
  for (const ledger of [old.stats?.produced,old.stats?.consumed,old.stats?.destroyed,old.stats?.spoiled,old.trade?.imported,old.trade?.exported]) {
    if (!ledger || typeof ledger !== 'object') throw new Error('旧版资源账本缺失');
    ledger.milk = 0;
  }
}
export function validateMilk(d: VoxelSave): void {
  for (const a of d.animals) if (!Number.isFinite(a.milkFullness) || a.milkFullness < 0 || a.milkFullness > 1 ||
      ((a.species !== 'dromedary' || a.sex !== 'female') && a.milkFullness !== 0)) throw new Error('动物奶量无效');
}
