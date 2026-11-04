import { BatchDurability } from './ItemCondition';
import { locatedUnfinished, unfinishedName, unfinishedPercent, unfinishedRecipeName, unfinishedStatus, unfinishedWorkReason } from './unfinishedView';
import { RESOURCE_NAMES, type Cargo, type Pawn, type Pos, type VoxelCommand, type VoxelSnapshot } from './types';

export function UnfinishedPanel({ batch, snapshot, command, focus, carrier }: {
  batch: Cargo; snapshot: VoxelSnapshot; command: (c: VoxelCommand) => void; focus?: (pos: Pos) => void; carrier?: Pawn;
}) {
  const piece = batch.unfinished;
  if (!piece) return null;
  const entry = locatedUnfinished(snapshot).find(entry => entry.piece.id === piece.id);
  const creator = snapshot.pawns.find(pawn => pawn.id === piece.creatorId);
  const queue = snapshot.productionQueues.find(queue => queue.bills.some(bill => bill.id === piece.boundBillId));
  const billIndex = queue?.bills.findIndex(bill => bill.id === piece.boundBillId) ?? -1;
  const bill = queue?.bills[billIndex];
  const bench = queue && [...snapshot.tailors, ...snapshot.weaponBenches].find(bench => bench.id === queue.benchId);
  const job = snapshot.jobs.find(job => !job.cancelled && job.unfinishedId === piece.id);
  const workReason = unfinishedWorkReason(job, snapshot);
  const carrying = carrier ?? entry?.carrier;
  return <section className="voxel-unfinished" data-testid="unfinished-detail" data-unfinished-id={piece.id}
    data-forbidden={!!batch.forbidden} data-carrier-id={carrying?.id}>
    <div className="voxel-info-row"><b>加工中的独立物品</b><span>#{piece.id}</span></div>
    <small data-testid="unfinished-recipe">配方：{unfinishedRecipeName(piece.recipe)}</small>
    <small data-testid="unfinished-creator">原作者：{piece.creatorName} · #{piece.creatorId}
      {!creator ? ' · 已离开营地' : creator.dead ? ' · 已死亡' : creator.faction !== 'colony' ? ' · 已不属于营地' : ''}</small>
    <div className="voxel-unfinished-progress" data-testid="unfinished-progress" data-progress={piece.progress} data-work={piece.workTotal}>
      <div><span>已完成工量</span><b>{unfinishedPercent(piece)}%</b></div>
      <progress aria-label="未完成品加工进度" value={piece.progress} max={Math.max(1, piece.workTotal)} />
    </div>
    {entry && <small className="voxel-unfinished-status" data-testid="unfinished-status">{unfinishedStatus(entry, snapshot)}</small>}
    {workReason && <small data-testid="unfinished-work-reason">{workReason}</small>}
    <small data-testid="unfinished-binding">{bill ? `绑定账单：第 ${billIndex + 1} 张 · ${unfinishedRecipeName(bill.recipe)}${bill.suspended ? '（暂停）' : ''}`
      : '未绑定账单：原作者可在兼容工作台接续同配方账单。'}</small>
    {entry && <small data-testid="unfinished-location">{carrying ? `由 ${carrying.name} 携带` : '地面或仓位'} · ({entry.pos.x}, {entry.pos.y}) · Z {entry.pos.z}</small>}
    <div className="voxel-unfinished-materials" data-testid="unfinished-materials"><b>已投入的原料</b>
      {piece.ingredients.map((ingredient, index) => <div key={index} data-resource={ingredient.resource} data-amount={ingredient.amount}>
        <small>{RESOURCE_NAMES[ingredient.resource]} × {ingredient.amount}</small>
        <BatchDurability batch={ingredient} name={RESOURCE_NAMES[ingredient.resource]} />
      </div>)}
    </div>
    <small>这件物品保存原料和进度，只能由原作者继续加工；重新领取时还需满足账单的工人限制。暂停或删除账单不会拆散它。</small>
    <div className="voxel-unfinished-actions">
      {creator && !creator.dead && focus && <button onClick={() => focus(creator)} data-testid="unfinished-focus-creator">定位原作者</button>}
      {bench && focus && <button onClick={() => focus(bench)} data-testid="unfinished-focus-bench">定位工作台</button>}
      <button data-testid="unfinished-forbid" aria-pressed={!!batch.forbidden}
        onClick={() => command({ type: 'unfinishedForbid', unfinishedId: piece.id, forbidden: !batch.forbidden })}>
        {batch.forbidden ? '允许搬运与续作' : '禁止搬运与续作'}</button>
    </div>
    <details className="voxel-unfinished-cancel"><summary>取消加工</summary>
      <small>拆散{unfinishedName(piece)}，丢弃已有加工进度。本版本会退回全部已投入原料。</small>
      <button data-testid="unfinished-cancel" onClick={() => command({ type: 'unfinishedCancel', unfinishedId: piece.id })}>取消加工并退回原料</button>
    </details>
  </section>;
}
