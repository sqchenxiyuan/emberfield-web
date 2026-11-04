import type { SkillSet } from './skills';
import type { Job, Counts } from './types';
import { plantRandom } from './plants';

// Starting values from the installed Core Def; kept together for later balancing.
const SUCCESS = [.75,.8,.85,.875,.9,.925,.95,.975,1,1.01,1.02,1.03,1.04,1.05,1.06,1.07,1.08,1.09,1.1,1.12,1.13] as const;
const BUILDINGS = new Set(['shelf','smallShelf','table','chair','bed','door','stove',
  'stonecutter','tailor','smithy','machining','researchBench','horseshoePin',
  'generator','solar','battery','heater','cooler','wire','wall','ladder',
  'fence','fenceGate','penMarker','sandbag','floor','bridge']);

/** Whole-project survival at unchanged worker capability, before the small
 * final-step overshoot. Higher skill can compensate for impaired capacities. */
export function constructionSuccessChance(skills: SkillSet, manipulation = 1, sight = 1): number {
  if (![manipulation,sight].every(n => Number.isFinite(n) && n >= 0)) throw new RangeError('建造能力无效');
  return Math.max(0, Math.min(1, SUCCESS[skills.construction.level] *
    (.7 + .3 * manipulation) * (.8 + .2 * Math.min(sight,1))));
}
/** Risk per actual work increment, not per wall-clock tick or worker speed. */
export function constructionFailureChance(success: number, workDelta: number, totalWork: number): number {
  if (!Number.isFinite(success) || success < 0 || success > 1 || !Number.isFinite(workDelta) ||
      workDelta < 0 || !Number.isFinite(totalWork) || totalWork <= 0) throw new RangeError('施工风险参数无效');
  return workDelta === 0 ? 0 : 1 - Math.pow(success, workDelta / totalWork);
}
export function isFailableConstruction(job: Pick<Job,'kind'|'cancelled'|'cost'>): boolean {
  return !job.cancelled && BUILDINGS.has(job.kind) && Object.values(job.cost).some(n => n !== undefined && n > 0);
}
/** Local deterministic stream; loading, rendering, idling and changing the
 * number of simulation steps per call do not draw or advance it. */
export function constructionRandom(seed: number, jobId: number, workTick: number, workerId: number, salt = 0): number {
  return plantRandom(seed, jobId, workTick, Math.imul(workerId, 7919) + 17041 + salt);
}
export function constructionSalvage(amount: number, random: number): number {
  if (!Number.isSafeInteger(amount) || amount <= 0 || !Number.isFinite(random) || random < 0 || random >= 1)
    throw new RangeError('施工余料参数无效');
  return Math.max(1, Math.floor(amount / 2) + (random < (amount / 2) % 1 ? 1 : 0));
}
export interface ConstructionFailure {
  workerId: number;
  lost: Partial<Counts>;
  /** Further loss while the already failed container waits for ground space. */
  burned?: Partial<Counts>;
}

/** A failed container is an explicit Web fallback while nearby ground is full.
 * Loss is already settled. Its remaining batches must never be worked again. */
export function validateConstructionFailure(job: Job, nextId: number): void {
  if (job.constructionFailure === undefined) return;
  const fail = () => { throw new Error('施工失败记录无效'); };
  const outcome = job.constructionFailure;
  if (!outcome || typeof outcome !== 'object' || Array.isArray(outcome) ||
      Object.keys(outcome).some(k => !['workerId','lost','burned'].includes(k)) ||
      !Object.hasOwn(outcome,'workerId') || !Object.hasOwn(outcome,'lost') ||
      !Number.isSafeInteger(outcome.workerId) || outcome.workerId <= 0 || outcome.workerId >= nextId ||
      !isFailableConstruction({...job,cancelled:false}) || job.owner !== null || job.workTicks < 1 ||
      job.progress >= job.work || job.productQuality !== undefined || !outcome.lost ||
      typeof outcome.lost !== 'object' || Array.isArray(outcome.lost)) return fail();
  if (Object.entries(outcome.lost).some(([r,n]) => !Object.hasOwn(job.cost,r) || !Number.isSafeInteger(n) || n! < 0)) return fail();
  if (Object.hasOwn(outcome,'burned') && (!outcome.burned || typeof outcome.burned !== 'object' ||
      Array.isArray(outcome.burned) || !Object.keys(outcome.burned).length || Object.entries(outcome.burned).some(([r,n]) =>
        !['wood','cloth','components'].includes(r) || !Object.hasOwn(job.cost,r) || !Number.isSafeInteger(n) || n! <= 0))) return fail();
  for (const [r,total] of Object.entries(job.cost)) {
    const resource = r as keyof Counts, lost = outcome.lost[resource] ?? 0;
    const remaining = (job.delivered[resource] ?? 0) + (outcome.burned?.[resource] ?? 0);
    if (remaining + lost !== total || remaining < Math.max(1,Math.floor(total! / 2)) ||
        remaining > Math.max(1,Math.ceil(total! / 2))) return fail();
  }
}
