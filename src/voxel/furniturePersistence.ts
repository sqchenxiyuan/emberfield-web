const record = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
const list = (v: unknown): any[] => Array.isArray(v) ? v : [];
const collections = ['beds', 'tables', 'chairs'] as const;
function fail(reason: string): never { throw new Error('家具品质存档无效：' + reason); }

/** Inspect untouched source data before older migrations add current defaults.
 * Existing genuine saves receive Normal once; there is no quality reroll. */
export function rejectLegacyFurnitureFields(old: Record<string, any>, sourceVersion = old.version): void {
  if (sourceVersion >= 33) return;
  if (collections.some(key => list(old[key]).some(item => record(item) && Object.hasOwn(item, 'quality'))))
    fail('旧版本包含新版家具品质字段');
}

/** Run after living/social migrations. Do not change existing damage, meals,
 * reservations, owners or construction jobs while adding Normal quality. */
export function migrateFurniture(old: Record<string, any>, sourceVersion: number): void {
  if (sourceVersion >= 33) return;
  if (collections.some(key => !Array.isArray(old[key]) || old[key].some((item: unknown) => !record(item))))
    fail('旧家具列表无效');
  for (const key of collections) for (const item of old[key]) item.quality = 2;
}

/** Furniture geometry and exact entity fields remain owned by the established
 * bed/living validators; only the persisted quality value is checked here. */
export function validateFurniture(d: Record<string, any>): void {
  for (const key of collections) {
    if (!Array.isArray(d[key])) fail('家具列表缺失');
    for (const item of d[key]) if (!record(item) || !Object.hasOwn(item, 'quality') ||
        !Number.isInteger(item.quality) || item.quality < 0 || item.quality > 6)
      fail('品质必须是0到6的整数');
  }
}
