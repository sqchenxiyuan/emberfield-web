import { resolveWorldSite, type WorldSite } from './regions';

/** Historical saves contain their actual edited terrain. No region is inferred
 * from a local seed, and a relabeled new save must not erase its identity. */
export function rejectLegacyWorldSite(raw: Record<string, any>, sourceVersion: number): void {
  if (sourceVersion < 35 && Object.hasOwn(raw, 'worldSite'))
    throw new Error('旧版本存档包含新版地区身份字段');
}

/** Resolve only the chosen tile; never generate a region map or local terrain
 * while checking a saved colony. null explicitly means a free-form old camp. */
export function validateWorldSiteIdentity(raw: Record<string, any>): WorldSite | null {
  if (!Object.hasOwn(raw, 'worldSite')) throw new Error('存档缺少地区身份字段');
  if (raw.worldSite === null) return null;
  const resolved = resolveWorldSite(raw.worldSite);
  if (raw.generator !== resolved.generator || raw.seed !== resolved.seed || !raw.settings ||
      typeof raw.settings !== 'object' || Array.isArray(raw.settings) ||
      Object.keys(raw.settings).length !== Object.keys(resolved.settings).length ||
      Object.entries(resolved.settings).some(([key, value]) => !Object.hasOwn(raw.settings, key) || raw.settings[key] !== value))
    throw new Error('地区身份与地图种子、气候配置或生成器不一致');
  return resolved.site;
}
