import { APPAREL_NAMES } from './apparel';
import { WEAPON_NAMES, type WeaponKind } from './weapons';
import type { ProductionRecipe } from './productionBills';
import type { ApparelKind, Cargo, Job, Pawn, Pos, UnfinishedPiece, VoxelSnapshot } from './types';

export interface LocatedUnfinished {
  batch: Cargo;
  piece: UnfinishedPiece;
  pos: Pos;
  carrier?: Pawn;
}

export function unfinishedRecipeName(recipe: ProductionRecipe): string {
  if (recipe.startsWith('smith:')) return WEAPON_NAMES[recipe.slice(6) as WeaponKind];
  if (recipe.startsWith('tailoring:') || recipe.startsWith('armorsmith:'))
    return APPAREL_NAMES[recipe.slice(recipe.indexOf(':') + 1) as ApparelKind];
  return recipe === 'cook' ? '简餐' : recipe === 'butcher' ? '生肉' : '花岗岩砖';
}

export const unfinishedName = (piece: UnfinishedPiece) => `未完成的${unfinishedRecipeName(piece.recipe)} #${piece.id}`;
export const unfinishedPercent = (piece: UnfinishedPiece) => Math.max(0, Math.min(100, Math.floor(piece.progress / Math.max(1, piece.workTotal) * 100)));

/** An active worker's current activity supersedes the job's earlier wait reason. */
export const unfinishedWorkReason = (job: Job | undefined, snapshot: VoxelSnapshot) => job
  ? snapshot.pawns.find(pawn => pawn.id === job.owner && pawn.jobId === job.id)?.reason ?? job.reason : null;

/** Only physical containers own a piece. Job references must not duplicate it. */
export function locatedUnfinished(snapshot: VoxelSnapshot): LocatedUnfinished[] {
  const result: LocatedUnfinished[] = [];
  for (const batch of snapshot.items) if (batch.unfinished && batch.amount > 0)
    result.push({ batch, piece: batch.unfinished, pos: batch });
  for (const carrier of snapshot.pawns) if (carrier.cargo?.unfinished && carrier.cargo.amount > 0)
    result.push({ batch: carrier.cargo, piece: carrier.cargo.unfinished, pos: carrier, carrier });
  return result;
}

export function unfinishedStatus(entry: LocatedUnfinished, snapshot: VoxelSnapshot): string {
  const { batch, piece, carrier } = entry;
  if (batch.forbidden) return '已禁止搬运和续作';
  const creator = snapshot.pawns.find(pawn => pawn.id === piece.creatorId);
  if (!creator || creator.dead || creator.faction !== 'colony') return `原作者 ${piece.creatorName} 不可用，其他人不能续作`;
  const bill = snapshot.productionQueues.flatMap(queue => queue.bills).find(bill => bill.id === piece.boundBillId);
  if (bill?.suspended) return '账单已暂停，保留物品与进度';
  if (carrier) return `${carrier.name} 携带中 · 仅 ${piece.creatorName} 可续作`;
  const job = snapshot.jobs.find(job => !job.cancelled && job.unfinishedId === piece.id);
  if (job && job.owner === creator.id && creator.jobId === job.id && creator.phase === 'work' && !creator.path.length)
    return `${piece.creatorName} 正在加工`;
  if (!bill) return `未绑定账单 · 等待 ${piece.creatorName} 接续同配方`;
  return `等待原作者 ${piece.creatorName} 续作`;
}
