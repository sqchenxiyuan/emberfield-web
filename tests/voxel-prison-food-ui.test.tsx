import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PrisonFoodAction, PrisonFoodPanel } from '../src/voxel/PrisonFoodPanel';
import { initialPrisoner } from '../src/voxel/prisoners';
import { RESOURCE_NAMES, type Bed, type Pawn, type VoxelCommand, type VoxelSnapshot } from '../src/voxel/types';
import { VoxelSimulation } from '../src/voxel/world';

let initialPawn: Pawn;
beforeAll(() => { initialPawn = new VoxelSimulation(73129, { hilliness: 'flat' }, false, 2).pawns[0]; });
const command = vi.fn<(c: VoxelCommand) => void>();
beforeEach(() => command.mockClear());
type Snapshot = Pick<VoxelSnapshot, 'tick' | 'pawns' | 'beds'>;
function pawn(extra: Partial<Pawn> = {}): Pawn {
  const p = { ...structuredClone(initialPawn), name: '林禾', faction: 'colony' as const, dead: false,
    downed: false, drafted: false, carriedBy: null, carryingPawnId: null, patientId: null, carePhase: null,
    wardenTask: null, prisoner: null, food: 95 };
  // Each actor starts from an inactive identity; a worker's live delivery
  // must never leak into another actor created for the same UI fixture.
  delete p.prisonFoodTask;
  return Object.assign(p, extra);
}
function fixture() {
  const worker = pawn();
  const prisoner = pawn({ id: worker.id + 20, name: '陈序', faction: 'prisoner', food: 20,
    x: 22, y: 20, z: 8, prisoner: initialPrisoner(0, 900) });
  const bed: Bed = { id: 900, x: 22, y: 20, z: 8, axis: 'x', quality: 2, medical: false, prisoner: true, owner: prisoner.id };
  const snapshot: Snapshot = { tick: 100, pawns: [worker, prisoner], beds: [bed] };
  return { worker, prisoner, snapshot, bed };
}
function panel(p: Pawn, snapshot: Snapshot) {
  return renderToStaticMarkup(<PrisonFoodPanel pawn={p} snapshot={snapshot} command={command} />);
}
function action(prisoner: Pawn, worker: Pawn | undefined, snapshot: Snapshot) {
  return PrisonFoodAction({ prisoner, worker, snapshot, command });
}
function button(html: string, label: string) {
  return html.match(new RegExp(`<button[^>]*>${label}</button>`))?.[0];
}
function elements(node: unknown): ReactElement<any>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!node || typeof node !== 'object' || !('props' in node)) return [];
  const e = node as ReactElement<any>; return [e, ...elements(e.props.children)];
}
function capture(render: () => ReactElement | null) {
  let tree: ReactElement | null = null;
  function Captured() { tree = render(); return tree; }
  const html = renderToStaticMarkup(<Captured />);
  return { html, elements: elements(tree) };
}

describe('physical prisoner food delivery UI without a browser', () => {
  it('offers real delivery for a hungry healthy prisoner and explains the separate self-eating loop', () => {
    const { prisoner, snapshot } = fixture(), before = structuredClone(snapshot), html = panel(prisoner, snapshot);
    expect(html).toContain('aria-label="陈序 的供餐执行者"'); expect(html).toContain('送餐看守');
    expect(button(html, '优先送餐')).not.toContain('disabled');
    expect(html).toContain('看守把真实食物带到牢房放下'); expect(html).toContain('囚犯会自行走去取餐');
    expect(html).toContain('有可用餐位时就座，再咀嚼进食');
    expect(html).toContain('开启狱卒分工后自动供餐'); expect(html).toContain('牢房已有足够可用食物时，不会重复送餐');
    expect(html).toContain('供餐选食遵守囚犯饮食政策；囚犯自行取食不受该政策限制');
    expect(html).not.toContain('type="checkbox"'); expect(html).not.toContain('allowFood');
    expect(snapshot).toEqual(before); expect(command).not.toHaveBeenCalled();
  });

  it('dispatches only the delivery command for the chosen worker and prisoner without changing their policies or inventory', () => {
    const { worker, prisoner, snapshot } = fixture(), before = structuredClone(snapshot);
    const other = pawn({ id: worker.id + 1, name: '许安' }); snapshot.pawns.push(other);
    const button = action(prisoner, other, snapshot); expect(button.props.disabled).toBe(false); button.props.onClick();
    expect(command).toHaveBeenCalledExactlyOnceWith({ type: 'prisonFoodDeliver', pawnId: other.id, prisonerId: prisoner.id });
    expect(snapshot.pawns.slice(0, 2)).toEqual(before.pawns); expect(snapshot.beds).toEqual(before.beds);
  });

  it('does not require a healthy recipient to stand on the bed but requires bedside position for feeding', () => {
    const { worker, prisoner, snapshot, bed } = fixture(); prisoner.x += 2;
    expect(action(prisoner, worker, snapshot).props.disabled).toBe(false);
    prisoner.downed = true;
    let button = action(prisoner, worker, snapshot); expect(button.props.children).toBe('优先卧床喂食');
    expect(button.props.disabled).toBe(true); button.props.onClick(); expect(command).not.toHaveBeenCalled();
    prisoner.x = bed.x; button = action(prisoner, worker, snapshot); expect(button.props.disabled).toBe(false); button.props.onClick();
    expect(command).toHaveBeenCalledExactlyOnceWith({ type: 'care', pawnId: worker.id, patientId: prisoner.id, action: 'feed' });
    expect(panel(prisoner, snapshot)).toContain('当前需要卧床喂食');
  });

  it('routes infection bed rest through existing feeding even when the prisoner is not downed', () => {
    const { worker, prisoner, snapshot } = fixture(); prisoner.medical.bedRest = true;
    prisoner.medical.infections.push({ id: 910, part: 'leftArm', severity: .1, createdTick: 0, immunityFactor: 1, tendQuality: null, tendUntil: 0 });
    const button = action(prisoner, worker, snapshot); expect(button.props.children).toBe('优先卧床喂食');
    expect(button.props.disabled).toBe(false); button.props.onClick();
    expect(command).toHaveBeenCalledExactlyOnceWith({ type: 'care', pawnId: worker.id, patientId: prisoner.id, action: 'feed' });
    const html = panel(prisoner, snapshot); expect(html).toContain('喂食同伴'); expect(html).toContain('当前需要卧床喂食');
    expect(html).not.toContain('囚犯会自行走去取餐');
    prisoner.medical.bedRest = false; expect(action(prisoner, worker, snapshot).props.children).toBe('优先送餐');
  });

  it('stops release-policy supply except for a downed prisoner, and never feeds a released or deceased prisoner', () => {
    const { worker, prisoner, snapshot } = fixture(); prisoner.prisoner!.policy = 'release';
    let button = action(prisoner, worker, snapshot); expect(button.props.disabled).toBe(true); button.props.onClick();
    expect(panel(prisoner, snapshot)).toContain('正在安排释放，停止普通供餐');
    prisoner.medical.bedRest = true;
    prisoner.medical.infections.push({ id: 910, part: 'leftArm', severity: .1, createdTick: 0, immunityFactor: 1, tendQuality: null, tendUntil: 0 });
    expect(action(prisoner, worker, snapshot).props.disabled).toBe(true);
    prisoner.downed = true; button = action(prisoner, worker, snapshot);
    expect(button.props.disabled).toBe(false); button.props.onClick();
    expect(command).toHaveBeenCalledExactlyOnceWith({ type: 'care', pawnId: worker.id, patientId: prisoner.id, action: 'feed' });
    command.mockClear(); prisoner.prisoner!.releasing = true;
    button = action(prisoner, worker, snapshot); expect(button.props.disabled).toBe(true); button.props.onClick();
    prisoner.prisoner!.releasing = false; prisoner.dead = true;
    button = action(prisoner, worker, snapshot); expect(button.props.disabled).toBe(true); button.props.onClick();
    expect(panel(prisoner, snapshot)).toContain('已死亡，停止供餐'); expect(command).not.toHaveBeenCalled();
  });

  it('uses the hungry threshold and refuses supply without an owned prisoner bed or while the recipient is carried', () => {
    const { worker, prisoner, snapshot, bed } = fixture(); prisoner.food = 25.99;
    expect(action(prisoner, worker, snapshot).props.disabled).toBe(false);
    prisoner.food = 26; expect(action(prisoner, worker, snapshot).props.disabled).toBe(true);
    expect(panel(prisoner, snapshot)).toContain('当前无需送餐'); prisoner.food = 20;
    for (const alteration of [{ prisoner: false }, { owner: null }, { owner: worker.id }]) {
      const snapshotWithoutBed = { ...snapshot, beds: [{ ...bed, ...alteration }] };
      expect(action(prisoner, worker, snapshotWithoutBed).props.disabled).toBe(true);
      expect(panel(prisoner, snapshotWithoutBed)).toContain('请先为囚犯安排位于封闭牢房内的囚犯床');
    }
    prisoner.carriedBy = worker.id; expect(action(prisoner, worker, snapshot).props.disabled).toBe(true);
  });

  it('offers only able colony workers, independent of automatic warden priority', () => {
    const { worker, prisoner, snapshot } = fixture(); worker.priorities.warden = 0;
    const excluded = [
      { faction: 'prisoner' as const }, { faction: 'raider' as const }, { faction: 'trader' as const }, { dead: true },
      { downed: true }, { drafted: true }, { carriedBy: 50 }, { carryingPawnId: prisoner.id },
      { psyche: { ...structuredClone(worker.psyche), breakUntil: snapshot.tick + 1 } },
    ].map((extra, i) => pawn({ ...extra, id: worker.id + i + 100, name: `不可执行 ${i}` }));
    snapshot.pawns = [...excluded, worker, prisoner]; const html = panel(prisoner, snapshot);
    expect(html).toContain(`<option value="${worker.id}" selected="">林禾</option>`);
    for (const p of excluded) {
      expect(html).not.toContain(`<option value="${p.id}"`);
      const button = action(prisoner, p, snapshot); expect(button.props.disabled).toBe(true); button.props.onClick();
    }
    expect(button(html, '优先送餐')).not.toContain('disabled'); expect(command).not.toHaveBeenCalled();
    snapshot.pawns = [...excluded, prisoner]; const empty = panel(prisoner, snapshot);
    expect(empty).toContain('暂无可行动同伴'); expect(button(empty, '优先送餐')).toContain('disabled=""');
    const noWorker = action(prisoner, undefined, snapshot); noWorker.props.onClick(); expect(command).not.toHaveBeenCalled();
  });

  it('shows actual fetching and delivering actors without inventing tasks on other residents', () => {
    const { worker, prisoner, snapshot } = fixture();
    worker.prisonFoodTask = { prisonerId: prisoner.id, sourceId: 901, resource: 'meal', amount: 2,
      target: { x: 24, y: 20, z: 8 }, stage: 'fetch' };
    const other = pawn({ id: worker.id + 1, name: '许安' }); snapshot.pawns.push(other);
    for (const p of [worker, prisoner]) {
      const html = panel(p, snapshot); expect(html).toContain('林禾 → 陈序：正在取餐');
      expect(html).toContain(`${RESOURCE_NAMES.meal} × 2`); expect(html).toContain('落点 24, 20 · Z 8');
      expect(html).toContain(`data-worker-id="${worker.id}"`); expect(html).toContain(`data-prisoner-id="${prisoner.id}"`);
    }
    expect(panel(other, snapshot)).toBe(''); expect(other.prisonFoodTask).toBeUndefined();
    expect(button(panel(prisoner, snapshot), '优先送餐')).toContain('disabled=""');
    worker.prisonFoodTask.stage = 'deliver'; worker.prisonFoodTask.sourceId = null;
    expect(panel(worker, snapshot)).toContain('林禾 → 陈序：正在送往牢房');
    delete worker.prisonFoodTask;
    expect(panel(worker, snapshot)).toBe(''); expect(panel(prisoner, snapshot)).not.toContain('data-testid="prison-food-task"');
  });

  it('focuses the actual delivery target from the worker status', () => {
    const { worker, prisoner, snapshot } = fixture(), target = { x: 24, y: 20, z: 8 }, focus = vi.fn();
    worker.prisonFoodTask = { prisonerId: prisoner.id, sourceId: null, resource: 'food', amount: 1, target, stage: 'deliver' };
    const tree = capture(() => PrisonFoodPanel({ pawn: worker, snapshot, command, focus })).elements;
    const status = tree.find(e => typeof e.type === 'function' && e.props.worker)!;
    const statusTree = capture(() => (status.type as (props: any) => ReactElement)(status.props)).elements;
    statusTree.find(e => e.props.children === '定位送餐落点')!.props.onClick();
    expect(focus).toHaveBeenCalledExactlyOnceWith(target); expect(command).not.toHaveBeenCalled();
  });

  it('does not duplicate a delivery while the recipient has medical care or a warden visit in progress', () => {
    const { worker, prisoner, snapshot } = fixture();
    const doctor = pawn({ id: worker.id + 1, name: '许安', patientId: prisoner.id, carePhase: 'feedApproach' }); snapshot.pawns.push(doctor);
    expect(panel(prisoner, snapshot)).toContain('许安正在取餐或卧床喂食');
    let button = action(prisoner, worker, snapshot); expect(button.props.disabled).toBe(true); button.props.onClick();
    doctor.patientId = null; doctor.carePhase = null;
    doctor.wardenTask = { prisonerId: prisoner.id, bedId: null, stage: 'talkApproach', progress: 0 };
    button = action(prisoner, worker, snapshot); expect(button.props.disabled).toBe(true); button.props.onClick();
    doctor.wardenTask = null; expect(action(prisoner, worker, snapshot).props.disabled).toBe(false);
    expect(command).not.toHaveBeenCalled();
  });

  it('does not show prisoner supply management for unrelated visitors or malformed prisoner identities', () => {
    const { worker, snapshot } = fixture();
    expect(panel(worker, snapshot)).toBe('');
    for (const faction of ['raider', 'trader', 'prisoner'] as const) expect(panel(pawn({ faction }), snapshot)).toBe('');
  });
});
