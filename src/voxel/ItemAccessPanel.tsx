import type { Stack, VoxelCommand } from './types';

export function ItemAccessPanel({ item, command }: {
  item: Stack; command: (command: VoxelCommand) => void;
}) {
  return <section className="voxel-item-access" data-testid="item-access" data-item-id={item.id} data-forbidden={!!item.forbidden}>
    <div className="voxel-item-access-controls">
      <span>{item.forbidden ? '× 已禁止取用' : '✓ 允许取用'}</span>
      <button data-testid="item-forbid" aria-pressed={!!item.forbidden}
        onClick={() => command({ type: 'itemForbidden', itemId: item.id, forbidden: !item.forbidden })}>
        {item.forbidden ? '允许取用' : '禁止取用'}
      </button>
    </div>
    <small>禁止普通搬运、进食和原料取用。物品仍在原处，仍计入库存与财富，也可出售。</small>
    {(item.weapon || item.apparel) && <small>明确安排装备或穿戴会解除这件物品的禁止，并允许居民前往区域外取用；途中重新分配允许区域仍可能中断任务。</small>}
    {item.furniture && <small>重新安装也需要取用这件家具，请先解除禁止。</small>}
    {item.unfinished && <small>未完成品被禁止时，原作者也会停止续作；允许后可重新领取。</small>}
  </section>;
}
