import { shelfCells, type Shelf } from './shelves';
import { at, emptyCounts, RESOURCE_NAMES, type Resource, type VoxelCommand, type VoxelSnapshot } from './types';

export function ShelfPanel({ shelf, snapshot, command }: {
  shelf: Shelf; snapshot: VoxelSnapshot; command: (c: VoxelCommand) => void;
}) {
  const cells = new Set(shelfCells(shelf).map(at));
  const capacity = snapshot.storageCapacity.filter(c => c.shelfId === shelf.id);
  const items = snapshot.items.filter(i => cells.has(at(i))).sort((a,b) => at(a)-at(b) || a.id-b.id);
  const set = (priority: number, accepts: Resource[]) => command({ type:'shelfStorage', shelfId:shelf.id, priority, accepts });
  return <section className="voxel-bill voxel-storage" data-testid="shelf-storage" data-shelf-id={shelf.id}>
    <b>整座货架的收纳设置</b>
    <small data-testid="shelf-capacity">已用 {items.length} / {cells.size * 3} 堆位 · 预约 {capacity.reduce((n,c)=>n+c.reservedSlots,0)} 堆位</small>
    <label>优先级 <select aria-label="货架优先级" value={shelf.settings.priority} onChange={e=>set(Number(e.target.value),shelf.settings.accepts)}>
      {['低','普通','优先','最高'].map((name,i)=><option key={i} value={i}>{name}</option>)}
    </select></label>
    <details><summary>接纳物品（{shelf.settings.accepts.length} 类）</summary><div className="voxel-storage-filters">{(Object.keys(emptyCounts()) as Resource[]).filter(r=>r!=='chunk'&&r!=='furniture').map(r=><label className="voxel-check" key={r}>
      <input type="checkbox" checked={shelf.settings.accepts.includes(r)} onChange={e=>set(shelf.settings.priority,e.target.checked?[...shelf.settings.accepts,r]:shelf.settings.accepts.filter(v=>v!==r))}/>{RESOURCE_NAMES[r]}{r==='carcass'?'（仅小型）':''}
    </label>)}</div></details>
    <small>修改筛选后，现有货物会等待搬往其他可用仓位。</small>
    {items.map(i=><div key={i.id} data-testid="shelf-stack" data-stack-id={i.id}>#{i.id} · {RESOURCE_NAMES[i.resource]} × {i.amount} · ({i.x}, {i.y}, {i.z})</div>)}
  </section>;
}
