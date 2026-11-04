import { tableCells } from './living';
import { shelfCells, isShelfKind } from './shelves';
import { bedCells, deviceCells, stonecutterCells, researchBenchCells,
  type Job, type Pos, type DeviceKind } from './types';
import type { BurnTargetKind } from './fire';

/** Only ordinary building construction owns a destructible frame. Terrain
 * frames, empty plans, mining, production and reinstalling a packed original
 * have different lifecycles. Delivered inputs remain physical until completion. */
export function isConstructionFrame(job: Job): boolean {
  return !job.cancelled && !job.constructionFailure && ['shelf', 'smallShelf', 'table', 'chair', 'bed', 'door', 'stove',
    'stonecutter', 'tailor', 'smithy', 'machining', 'researchBench', 'horseshoePin',
    'generator', 'solar', 'battery', 'heater', 'cooler', 'wire', 'wall', 'ladder',
    'fence', 'fenceGate', 'penMarker', 'sandbag'].includes(job.kind) &&
    Object.values(job.delivered).some(amount => amount !== undefined && amount > 0);
}
export function frameBuildingKind(job: Job): Exclude<BurnTargetKind, 'frame'> {
  if (['generator', 'solar', 'battery', 'heater', 'cooler'].includes(job.kind)) return 'device';
  if (job.kind === 'smithy' || job.kind === 'machining') return 'weaponBench';
  if (job.kind === 'wall' || job.kind === 'sandbag') return 'block';
  return job.kind as Exclude<BurnTargetKind, 'frame'>;
}
export function constructionFrameCells(job: Job): Pos[] {
  const p = { x:job.x, y:job.y, z:job.z, axis:job.axis ?? 'x' };
  if (isShelfKind(job.kind)) return shelfCells({ ...p, kind:job.kind });
  if (job.kind === 'table') return tableCells(p);
  if (job.kind === 'bed') return bedCells(p);
  if (job.kind === 'researchBench') return researchBenchCells(p);
  if (['stonecutter', 'tailor', 'smithy', 'machining'].includes(job.kind)) return stonecutterCells(p);
  if (frameBuildingKind(job) === 'device') return deviceCells({ ...p, kind:job.kind as DeviceKind });
  if (job.kind === 'wall' || job.kind === 'door') return [p, { ...p, z:p.z+1 }];
  return [p];
}
/** Provisional material behavior follows the existing completed Web buildings. */
export function constructionFrameFlammability(job: Job): number {
  if (job.material === 'stone' || job.kind === 'sandbag') return 0;
  if (job.kind === 'wire') return .2;
  return frameBuildingKind(job) === 'device' ? .3 : .8;
}
