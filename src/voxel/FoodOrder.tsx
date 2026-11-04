import { useState } from 'react';
import { FOOD_POLICY_RESOURCES } from './foodPolicies';
import { healthSummary } from './survival';
import type { Pawn, Stack, VoxelCommand } from './types';

export interface FoodOrderProps {
  item: Stack;
  pawns: Pawn[];
  tick: number;
  preferredPawnId?: number | null;
  command: (command: VoxelCommand) => void;
}

export function FoodOrder({ item, pawns, tick, preferredPawnId, command }: FoodOrderProps) {
  const [chosen, choose] = useState<number | null>(preferredPawnId ?? null);
  if (!FOOD_POLICY_RESOURCES.some(resource => resource === item.resource) || item.amount <= 0) return null;
  const eligible = pawns.filter(p => p.faction === 'colony' && !p.dead && !p.downed && !p.drafted &&
    p.carriedBy === null && p.psyche.breakUntil <= tick && p.phase !== 'mental' && healthSummary(p).moving > 0);
  const selected = eligible.find(p => p.id === chosen) ?? eligible[0];
  return <div className="voxel-food-order" data-testid="food-order-controls">
    <label>食用者<select aria-label="食用者" value={selected?.id ?? ''} disabled={!selected} onChange={event => choose(Number(event.target.value))}>
      {!selected && <option value="">暂无可行动同伴</option>}
      {eligible.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
    </select></label>
    <button type="button" disabled={!selected} onClick={() => selected && command({ type: 'ingest', pawnId: selected.id, stackId: item.id })}>前往食用</button>
    <small>本次指令覆盖饮食政策，并解除这堆食物的禁止取用。居民会实际前往取食；饮食政策保持不变。</small>
  </div>;
}
