import { useState } from 'react';
import { medicalNeedsRest } from './medicine';
import { healthSummary } from './survival';
import { RESOURCE_NAMES, at, type Pawn, type Pos, type VoxelCommand, type VoxelSnapshot } from './types';

type Command = (command: VoxelCommand) => void;
type PrisonFoodSnapshot = Pick<VoxelSnapshot, 'tick' | 'pawns' | 'beds'>;
export interface PrisonFoodPanelProps {
  pawn: Pawn;
  snapshot: PrisonFoodSnapshot;
  command: Command;
  focus?: (target: Pos) => void;
}

function canDeliver(pawn: Pawn, tick: number): boolean {
  return pawn.faction === 'colony' && !pawn.dead && !pawn.downed && !pawn.drafted &&
    pawn.carriedBy === null && pawn.carryingPawnId === null && pawn.psyche.breakUntil <= tick &&
    healthSummary(pawn).moving > .15 && healthSummary(pawn).manipulation > 0;
}

/** Shared by the prisoner inspector and its existing care controls. */
export function PrisonFoodAction({ prisoner, worker, snapshot, command }: {
  prisoner: Pawn; worker: Pawn | undefined; snapshot: PrisonFoodSnapshot; command: Command;
}) {
  const feeding = prisoner.downed || medicalNeedsRest(prisoner);
  const bed = snapshot.beds.find(b => b.id === prisoner.prisoner?.bedId && b.prisoner && b.owner === prisoner.id);
  const occupied = snapshot.pawns.some(p => p.prisonFoodTask?.prisonerId === prisoner.id ||
    p.patientId === prisoner.id || p.wardenTask?.prisonerId === prisoner.id);
  const enabled = !!worker && canDeliver(worker, snapshot.tick) && prisoner.faction === 'prisoner' &&
    !prisoner.dead && !!prisoner.prisoner && !prisoner.prisoner.releasing &&
    (prisoner.prisoner.policy !== 'release' || prisoner.downed) && prisoner.carriedBy === null &&
    (feeding ? prisoner.food <= 26 : prisoner.food < 26) && !!bed && !occupied && (!feeding || at(prisoner) === at(bed));
  return <button type="button" data-testid="prison-food-action" disabled={!enabled} onClick={() => {
    if (!enabled || !worker) return;
    command(feeding ? { type: 'care', pawnId: worker.id, patientId: prisoner.id, action: 'feed' }
      : { type: 'prisonFoodDeliver', pawnId: worker.id, prisonerId: prisoner.id });
  }}>{feeding ? '优先卧床喂食' : '优先送餐'}</button>;
}

function DeliveryStatus({ worker, pawns, focus }: { worker: Pawn; pawns: Pawn[]; focus?: (target: Pos) => void }) {
  const task = worker.prisonFoodTask;
  if (!task) return null;
  const recipient = pawns.find(p => p.id === task.prisonerId);
  return <div className="voxel-prison-food-progress" data-testid="prison-food-task" data-worker-id={worker.id} data-prisoner-id={task.prisonerId}>
    <b>{worker.name} → {recipient?.name ?? '囚犯'}：{task.stage === 'fetch' ? '正在取餐' : '正在送往牢房'}</b>
    <small>{RESOURCE_NAMES[task.resource]} × {task.amount} · 落点 {task.target.x}, {task.target.y} · Z {task.target.z}</small>
    {focus && <button type="button" onClick={() => focus(task.target)}>定位送餐落点</button>}
  </div>;
}

export function PrisonFoodPanel({ pawn, snapshot, command, focus }: PrisonFoodPanelProps) {
  const [selectedWorkerId, setSelectedWorkerId] = useState<number | null>(null);
  if (pawn.faction === 'colony') return pawn.prisonFoodTask
    ? <section className="voxel-prison-food" data-testid="prison-food-worker"><DeliveryStatus worker={pawn} pawns={snapshot.pawns} focus={focus} /></section>
    : null;
  if (pawn.faction !== 'prisoner' || !pawn.prisoner) return null;
  const eligible = snapshot.pawns.filter(p => canDeliver(p, snapshot.tick));
  const selected = eligible.find(p => p.id === selectedWorkerId) ?? eligible[0];
  const active = snapshot.pawns.find(p => p.prisonFoodTask?.prisonerId === pawn.id);
  const feeder = snapshot.pawns.find(p => p.patientId === pawn.id && p.carePhase?.startsWith('feed'));
  const feeding = pawn.downed || medicalNeedsRest(pawn);
  const bed = snapshot.beds.find(b => b.id === pawn.prisoner!.bedId && b.prisoner && b.owner === pawn.id);
  const released = pawn.prisoner.releasing || (pawn.prisoner.policy === 'release' && !pawn.downed);
  return <section className="voxel-prison-food" data-testid="prison-food-controls" aria-label={`${pawn.name} 的送餐管理`}>
    <b>囚犯供餐</b>
    {active && <DeliveryStatus worker={active} pawns={snapshot.pawns} focus={focus} />}
    {feeder && <small data-testid="prison-food-feeding">{feeder.name}正在取餐或卧床喂食。</small>}
    <label>{feeding ? '喂食同伴' : '送餐看守'}<select aria-label={`${pawn.name} 的供餐执行者`} value={selected?.id ?? ''}
      disabled={pawn.dead || released || !selected} onChange={event => setSelectedWorkerId(Number(event.target.value))}>
      {!selected && <option value="">暂无可行动同伴</option>}
      {eligible.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
    </select></label>
    <PrisonFoodAction prisoner={pawn} worker={selected} snapshot={snapshot} command={command} />
    {pawn.dead ? <small>已死亡，停止供餐。</small>
      : released ? <small>正在安排释放，停止普通供餐；倒地时仍可卧床喂食。</small>
      : !bed ? <small>请先为囚犯安排位于封闭牢房内的囚犯床。</small>
      : feeding ? <small>当前需要卧床喂食；请先让囚犯回到分配的床位，或安排同伴救援。</small>
      : pawn.food >= 26 ? <small>当前无需送餐，饥饿时再安排。</small>
      : <small>看守把真实食物带到牢房放下，囚犯会自行走去取餐，有可用餐位时就座，再咀嚼进食。</small>}
    <small>开启狱卒分工后自动供餐；牢房已有足够可用食物时，不会重复送餐。</small>
    <small>供餐选食遵守囚犯饮食政策；囚犯自行取食不受该政策限制。</small>
  </section>;
}
