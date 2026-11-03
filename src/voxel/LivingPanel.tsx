import { DAY, RESOURCE_NAMES, type Pawn, type Pos, type VoxelCommand, type VoxelSnapshot } from './types';
import { LIVING_BUILDINGS, LIVING_RULES, LIVING_ROLE_NAMES, IMPRESSIVENESS_NAMES, livingThoughts,
  tableCells, type DiningTable, type DiningChair, type RoomLivingSummary } from './living';

const minutes = (ticks: number) => Math.max(1, Math.ceil(ticks / DAY * 24 * 60));

export function LivingPanel({ pawn, snapshot, focus }: { pawn: Pawn; snapshot: VoxelSnapshot; focus: (p: Pos) => void }) {
  const state = pawn.living, meal = state.mealTask;
  const chair = snapshot.chairs.find(c => c.id === meal?.chairId);
  const table = snapshot.tables.find(t => t.id === meal?.tableId);
  return <section className="voxel-living-panel" data-testid="living-panel" data-pawn-id={pawn.id}>
    <div className="voxel-info-row"><b>日常生活</b><span>舒适 {Math.round(state.comfort)}%</span></div>
    <progress aria-label={`${pawn.name} 舒适度`} value={state.comfort} max={100} />
    <small>实际睡床或坐餐椅会恢复舒适；离开家具后逐渐下降。</small>
    {pawn.eating && <div className="voxel-recreation-status" data-testid="dining-status" data-stage={meal?.stage ?? 'fetch'}
      data-chair-id={meal?.chairId ?? ''} data-table-id={meal?.tableId ?? ''}>
      <b>{!meal ? '寻找食物' : meal.stage === 'travel' ? '携带食物前往用餐' : chair ? '坐下用餐' : table ? '站在桌边用餐' : '就地用餐'} · {RESOURCE_NAMES[pawn.eating]}</b>
      <small>{pawn.reason}</small>
      {meal?.stage === 'chew' && <progress aria-label="用餐进度" value={meal.progress} max={LIVING_RULES.chewTicks} />}
      {chair && <small>座位已预约，其他人会寻找空位。</small>}
      {meal && !table && <small>没有可用的餐桌，正在原地进食。</small>}
      {table && <button onClick={() => focus(table)}>定位用餐桌</button>}
    </div>}
    <div className="voxel-living-memories" data-testid="living-memories">
      <b>生活记忆</b>
      {state.memories.filter(m => m.expires > snapshot.tick).length === 0 && <small>尚无有效的用餐或居住记忆。</small>}
      {state.memories.filter(m => m.expires > snapshot.tick).map(m => {
        const thought = livingThoughts({ ...state, comfort: 50, memories: [m] }, snapshot.tick)[0];
        return thought ? <div key={m.kind} data-memory={m.kind} data-expires={m.expires}>
          <span>{thought.label}</span><b className={thought.value < 0 ? 'negative' : 'positive'}>{thought.value > 0 ? '+' : ''}{thought.value}</b>
          <small>剩余 {minutes(m.expires - snapshot.tick)} 游戏分钟</small>
        </div> : null;
      })}
      <small>后来用餐有桌子，也要等先前“没有桌子吃饭”的记忆自然消退。</small>
    </div>
  </section>;
}

export function RoomLivingDetails({ room }: { room?: RoomLivingSummary }) {
  if (!room) return null;
  return <section className="voxel-room-living" data-testid="room-living-detail" data-room-id={room.id} data-role={room.role}>
    <div className="voxel-info-row"><b>{LIVING_ROLE_NAMES[room.role]}</b><span>{room.outdoor ? '室外环境' : `${IMPRESSIVENESS_NAMES[room.stage]} · ${room.impressiveness.toFixed(1)}`}</span></div>
    <dl><div><dt>空间</dt><dd>{room.space.toFixed(1)}</dd></div><div><dt>财富</dt><dd>{room.wealth.toFixed(1)}</dd></div>
      <div><dt>美观</dt><dd>{room.beauty.toFixed(2)}</dd></div><div><dt>清洁</dt><dd>{room.cleanliness.toFixed(2)}</dd></div></dl>
    <small>{room.outdoor ? '室外不会产生室内用餐或卧室体验。' : '家具、空间与地面环境共同影响房间体验；实际吃完饭或睡足一段时间后形成记忆。'}</small>
  </section>;
}

export function DiningFurnitureDetails({ table, chair, snapshot, focus, command }: {
  table?: DiningTable; chair?: DiningChair; snapshot: VoxelSnapshot; focus: (p: Pos) => void; command: (c: VoxelCommand) => void;
}) {
  const item = table ?? chair!;
  const users = snapshot.pawns.filter(p => p.living.mealTask && (table ? p.living.mealTask.tableId === table.id : p.living.mealTask.chairId === chair!.id));
  const touching = (c: Pos, t: DiningTable) => tableCells(t).some(p => p.z === c.z && Math.abs(p.x - c.x) + Math.abs(p.y - c.y) === 1);
  const seats = table ? snapshot.chairs.filter(c => touching(c, table)) : [];
  const tables = chair ? snapshot.tables.filter(t => touching(chair, t)) : [];
  return <section className="voxel-living-panel" data-testid="dining-furniture-detail" data-kind={table ? 'table' : 'chair'} data-furniture-id={item.id}>
    <b>{table ? '木制餐桌' : '木制餐椅'} · 占地 {table ? '2' : '1'} 格</b>
    <small>建造消耗 {LIVING_BUILDINGS[table ? 'table' : 'chair'].cost.wood} 木材</small>
    <p>{table ? `相邻餐椅 ${seats.length} 把。留出进入座位的通路，殖民者会带餐就座。` : tables.length ? '相邻餐桌可用；殖民者就座时朝向桌面。' : '紧贴餐桌四周放置，才能作为用餐座位。'}</p>
    <div data-testid="dining-seat-users">{users.length ? users.map(p => <button key={p.id} onClick={() => focus(p)}>{p.name} · {p.living.mealTask?.stage === 'travel' ? '前往座位' : '正在用餐'}</button>) : <small>当前无人预约或使用</small>}</div>
    <small>{table ? '餐桌会阻挡通行，不能在桌面堆放仓储物资。' : '可以穿过餐椅，不能在椅子位置堆放物资。'}</small>
    <button onClick={() => command({ type: 'designate', tool: 'remove', from: item })}>拆除{table ? '餐桌' : '餐椅'}</button>
  </section>;
}
