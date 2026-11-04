import { EggDetails } from './AnimalPanel';
import { BatchDurability } from './ItemCondition';
import { EGG_BOX_RULES, type EggBox } from './eggBoxes';
import { remainingRotDays, rotLimit, rotRateAtTemperature } from './preservation';
import { RESOURCE_NAMES, type Pos, type VoxelCommand, type VoxelSnapshot } from './types';

export function EggBoxPanel({ box, snapshot, temperature, command, focus }: {
  box: EggBox; snapshot: VoxelSnapshot; temperature: number;
  command: (command: VoxelCommand) => void; focus?: (pos: Pos) => void;
}) {
  const amount = box.eggs?.amount ?? 0;
  const worker = !box.forbidden ? snapshot.pawns.find(p => !p.dead && !p.downed && p.phase === 'eggBox' && p.eggBoxTask?.boxId === box.id) : undefined, task = worker?.eggBoxTask;
  const adjacent = worker && worker.z === box.z && Math.abs(worker.x - box.x) + Math.abs(worker.y - box.y) <= 1;
  const collecting = !!worker && worker.phase === 'eggBox' && !worker.path.length && adjacent;
  const damage = snapshot.fireDamage.find(d => d.kind === 'eggBox' && d.targetId === box.id);
  const hitPoints = damage?.hitPoints ?? EGG_BOX_RULES.maxHitPoints;
  const days = box.eggs ? remainingRotDays(box.eggs) : null, limit = box.eggs ? rotLimit(box.eggs) : null;
  const rate = rotRateAtTemperature(temperature);
  return <section className="voxel-egg-box" data-testid="egg-box-panel" data-egg-box-id={box.id} data-forbidden={box.forbidden}>
    <div className="voxel-info-row"><b>木制蛋箱</b><span>{amount} / {EGG_BOX_RULES.capacity} 枚</span></div>
    <label>箱内鸡蛋<progress aria-label="蛋箱容量" value={amount} max={EGG_BOX_RULES.capacity} /></label>
    <small>达到 {EGG_BOX_RULES.emptyAt} 枚时自动安排搬运，也可提前请求清空。收蛋需要开启「搬运」分工、可达通路和可用仓位。</small>
    <p data-testid="egg-box-status">{box.forbidden ? '蛋箱已禁止：停止自动产入和取出，箱内孵化与温度变化继续。'
      : !amount ? '空蛋箱，等待母鸡前来下蛋。'
        : task && worker ? collecting ? `${worker.name} · 正在收蛋` : `${worker.name} · 前往收蛋`
          : box.emptyRequested ? '已请求提前清空，等待搬运工与可用仓位。'
            : amount >= EGG_BOX_RULES.emptyAt ? '已达到自动收蛋阈值，等待搬运工与可用仓位。'
              : '尚未达到自动收蛋阈值，可继续积攒或提前清空。'}</p>
    {task && worker && <label>收蛋工作 {Math.round(task.progress / EGG_BOX_RULES.emptyWork * 100)}%
      <progress aria-label="蛋箱收蛋工作进度" value={task.progress} max={EGG_BOX_RULES.emptyWork} />
    </label>}
    <div className="voxel-egg-box-actions">
      <button aria-label={box.emptyRequested ? '取消提前清空蛋箱' : '请求提前清空蛋箱'} aria-pressed={box.emptyRequested}
        disabled={!box.emptyRequested && (!amount || box.forbidden)}
        onClick={() => command({ type: 'eggBoxEmpty', boxId: box.id, enabled: !box.emptyRequested })}>
        {box.emptyRequested ? '取消提前清空' : '提前清空'}
      </button>
      <button aria-label={box.forbidden ? '允许使用蛋箱' : '禁止使用蛋箱'} aria-pressed={box.forbidden}
        onClick={() => command({ type: 'eggBoxForbid', boxId: box.id, forbidden: !box.forbidden })}>{box.forbidden ? '允许使用' : '禁止使用'}</button>
    </div>
    {box.eggs && <div className="voxel-egg-box-contents" data-testid="egg-box-contents" data-resource={box.eggs.resource}>
      <b>{RESOURCE_NAMES[box.eggs.resource]} × {box.eggs.amount}</b>
      <EggDetails batch={box.eggs} temperature={temperature} />
      <BatchDurability batch={box.eggs} name="箱内鸡蛋" />
      {days !== null && limit !== null && <div className="voxel-food-condition">
        <label>腐坏进度<progress aria-label="箱内鸡蛋腐坏进度" value={box.eggs.rotProgress ?? 0} max={limit} /></label>
        <small>{temperature.toFixed(1)}°C · {rate === 0 ? `腐坏暂停，回到常温后约剩 ${days.toFixed(2)} 日`
          : `按当前温度预计 ${Math.max(0, days / rate).toFixed(2)} 日后腐坏`}</small>
      </div>}
      <small>箱内蛋受到防风化保护，仍会孵化、遭受温度损伤或按温度腐坏。孵出的雏鸡出现在附近。</small>
    </div>}
    <label>建筑耐久 {Math.ceil(hitPoints)} / {EGG_BOX_RULES.maxHitPoints}
      <progress aria-label="蛋箱建筑耐久" value={hitPoints} max={EGG_BOX_RULES.maxHitPoints} />
    </label>
    <small>占地一格、顶部开放，可以站上。建造需要 {EGG_BOX_RULES.cost.wood} 木材；请放在殖民地母鸡可达的位置。同一箱只接纳同一种鸡蛋。</small>
    <div className="voxel-egg-box-actions">
      {focus && <button onClick={() => focus(box)}>定位蛋箱</button>}
      <button aria-label="拆除这个蛋箱" onClick={() => command({ type: 'designate', tool: 'remove', from: { x: box.x, y: box.y, z: box.z } })}>拆除蛋箱</button>
    </div>
  </section>;
}
