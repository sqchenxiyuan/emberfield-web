import { BUILDINGS } from './defs';
import { HOUR, type Pawn, type World } from './types';

/** Only exposes work at its actual work site; delivery and travel are not labor. */
export function laborActivity(p: Pawn, w: World) {
  const j = p.job;
  if (!j || p.dead || p.downed || j.path.length || !['mine', 'cut', 'build', 'grow', 'cook', 'craft', 'research'].includes(j.kind)) return null;
  if (j.kind === 'build' && j.stage !== 2 && j.stage !== 3) return null;
  if ((j.kind === 'cook' || j.kind === 'craft') && j.stage === 0 && j.item) return null;
  let x = j.x, y = j.y, progress = j.total > 0 ? j.progress / j.total : 0;
  if (j.kind === 'mine' || j.kind === 'cut') {
    const target = w.nature.find((n) => n.id === j.target && n.amount > 0);
    if (!target) return null;
    x = target.x; y = target.y;
  } else if (j.kind !== 'grow') {
    const b = w.buildings.find((b) => b.id === j.target);
    if (!b) return null;
    x = b.x; y = b.y;
    if (j.kind === 'build' && j.stage === 2) progress = b.progress / (BUILDINGS[b.kind].work * HOUR);
  }
  if (Math.abs(p.x - x) + Math.abs(p.y - y) > 1.1) return null;
  return { x, y, progress: Math.min(1, Math.max(0, progress)), kind: j.kind };
}
