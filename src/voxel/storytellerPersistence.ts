import { Block, type VoxelSave } from './types';
import { STORY_INTERVAL, adaptationAfterLoss } from './storytellerRules';
import { DIFFICULTIES, INTRO_INTERVAL, RAID_COST, cycleAt, cycleHits } from './storyteller';
import { validWeapon } from './weapons';

export function rejectLegacyStorytellerFields(old: Record<string, any>) {
  if (old.version < 20 && (Object.hasOwn(old, 'storyteller') || Object.hasOwn(old, 'structureKinds')))
    throw new Error('旧存档包含新版叙事日历或结构身份');
}
const finite = (n: unknown, min: number, max = 1e12): n is number => typeof n === 'number' && Number.isFinite(n) && n >= min && n <= max;
const integer = (n: unknown, min: number, max = Number.MAX_SAFE_INTEGER): n is number => finite(n, min, max) && Number.isSafeInteger(n);
const keys = (value: unknown, allowed: string[]) => !!value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === allowed.length && Object.keys(value).every(key => allowed.includes(key));
const fail = () => { throw new Error('叙事日历、财富历史或伤亡记录无效'); };

export function validateStoryteller(save: VoxelSave, blocks: Uint8Array, structures: Uint8Array) {
  const s = save.storyteller, interval = Math.floor(save.tick / STORY_INTERVAL);
  if (!keys(s, ['kind', 'difficulty', 'adaptationDays', 'lastInterval', 'cycle', 'cycleHits', 'introHandled', 'legacyRaidAt', 'events', 'losses']) ||
    s.kind !== 'cassandra' || !DIFFICULTIES.includes(s.difficulty) || !finite(s.adaptationDays, -60, 100) ||
    !integer(s.lastInterval, 0) || s.lastInterval > interval || interval - s.lastInterval > 1 ||
    s.cycle !== cycleAt(s.lastInterval) || !Array.isArray(s.cycleHits) ||
    JSON.stringify(s.cycleHits) !== JSON.stringify(cycleHits(save.seed, s.cycle)) ||
    typeof s.introHandled !== 'boolean' || s.introHandled !== (s.lastInterval >= INTRO_INTERVAL) ||
    (s.legacyRaidAt !== null && !integer(s.legacyRaidAt, 0)) ||
    !Array.isArray(s.events) || s.events.length > 32 || !Array.isArray(s.losses) || s.losses.length > 32) fail();
  for (let i = 0; i < structures.length; i++)
    if (structures[i] && blocks[i] !== Block.Wood && blocks[i] !== Block.Masonry)
      throw new Error('结构身份与实际方块不一致');
  const lossIds = new Set<string>();
  for (const l of s.losses) {
    if (!keys(l, ['tick', 'pawnId', 'kind', 'population', 'before', 'after']) ||
      !integer(l.tick, 0, save.tick) || !integer(l.pawnId, 1, save.nextId - 1) ||
      !['downed', 'lost'].includes(l.kind) || !integer(l.population, 0, 3) ||
      !finite(l.before, -60, 100) || !finite(l.after, -60, 100) ||
      l.after !== adaptationAfterLoss(l.before, l.kind, l.population) || lossIds.has(`${l.tick}:${l.pawnId}`)) fail();
    lossIds.add(`${l.tick}:${l.pawnId}`);
  }
  let previousTick = -1;
  for (const e of s.events) {
    if (!keys(e, ['tick', 'source', 'outcome', 'reason', 'threat', 'budget', 'spent', 'remainder', 'members']) ||
      !integer(e.tick, 0, save.tick) || e.tick < previousTick || !['intro', 'cycle', 'legacy'].includes(e.source) ||
      !['spawned', 'skipped'].includes(e.outcome) || typeof e.reason !== 'string' || e.reason.length > 200 ||
      !finite(e.budget, 0, 10000) || !finite(e.spent, 0, e.budget) || !finite(e.remainder, 0, e.budget) ||
      Math.abs(e.budget - e.spent - e.remainder) > 1e-7 || !Array.isArray(e.members) || e.members.length > 16 ||
      (e.outcome === 'spawned') !== (e.members.length > 0)) fail();
    previousTick = e.tick;
    const t = e.threat;
    if (!keys(t, ['wealth', 'totalWealth', 'storytellerWealth', 'wealthPoints', 'populationPoints', 'population',
      'adaptationDays', 'adaptationRawFactor', 'adaptationFactor', 'difficultyFactor', 'settlementFactor', 'minimumPoints', 'unclampedPoints', 'points']) ||
      !keys(t.wealth, ['items', 'buildings', 'pawns']) || !Object.values(t.wealth).every(v => finite(v, 0)) ||
      !Object.entries(t).every(([k, v]) => ['wealth', 'population'].includes(k) || finite(v, k === 'adaptationDays' ? -60 : 0)) ||
      !Array.isArray(t.population) || t.population.length > 3 ||
      t.population.some(p => !keys(p, ['id', 'health', 'points']) || !integer(p.id, 1, save.nextId - 1) || !finite(p.health, 0, 1) || !finite(p.points, 0, 200)) ||
      Math.abs(t.totalWealth - t.wealth.items - t.wealth.buildings - t.wealth.pawns) > 1e-6 ||
      Math.abs(t.storytellerWealth - t.wealth.items - .5 * t.wealth.buildings - t.wealth.pawns) > 1e-6) fail();
    const memberIds = new Set<number>();
    for (const m of e.members) {
      if (!keys(m, ['pawnId', 'kind', 'cost', 'weapon']) || !integer(m.pawnId, 1, save.nextId - 1) || memberIds.has(m.pawnId) ||
        !Object.hasOwn(RAID_COST, m.kind) || m.cost !== RAID_COST[m.kind] || !validWeapon(m.weapon)) fail();
      memberIds.add(m.pawnId);
    }
    if (e.spent !== e.members.reduce((n, m) => n + m.cost, 0)) fail();
  }
}
