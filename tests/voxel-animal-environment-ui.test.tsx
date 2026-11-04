import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { AnimalDetails, AnimalPanel, AnimalTradeDetails } from '../src/voxel/AnimalPanel';
import { AnimalCareActions, AnimalMedicalDetails, AnimalMedicalPanel } from '../src/voxel/AnimalMedicalPanel';
import { AnimalEnvironmentFacts } from '../src/voxel/AnimalEnvironmentFacts';
import { animalTemperatureRange } from '../src/voxel/animalEnvironment';
import { initialAnimalMedical } from '../src/voxel/animalMedical';
import { initialAnimalState } from '../src/voxel/husbandry';
import { ANIMAL_DEFS } from '../src/voxel/wildlife';
import { VoxelSimulation } from '../src/voxel/world';
import { DAY, type AnimalSpecies, type VoxelCommand, type VoxelSnapshot, type WildAnimal } from '../src/voxel/types';

let initial: VoxelSnapshot;
beforeAll(() => { initial = new VoxelSimulation(73129, { hilliness: 'flat' }, false, 2).snapshot(); });
const command = vi.fn<(c: VoxelCommand) => Promise<{ ok: boolean; message: string }>>(async () => ({ ok: true, message: 'ok' }));
const controls = { selectedPenId: null, selectedAreaId: null, editingArea: false, showPen: () => {}, showArea: () => {}, editArea: () => {} };
function animal(species: AnimalSpecies = 'chicken', extra: Partial<WildAnimal> = {}): WildAnimal {
  return { ...initialAnimalState(101, species, 0), id: 101, species, name: ANIMAL_DEFS[species].name,
    x: 12, y: 12, z: 8, faction: 'colony', sex: 'female', ageTicks: DAY * 5, growth: 1,
    health: ANIMAL_DEFS[species].health, hunger: 35, dead: false, hunt: false, phase: 'roam',
    moveTick: 0, decisionTick: 0, fleeUntil: 0, threatId: null, retryTick: 0, rotProgress: 0,
    medical: initialAnimalMedical(), environment: { hypothermia: 0, heatstroke: 0 }, ...extra };
}
function snapshot(a = animal()): VoxelSnapshot {
  const s = structuredClone(initial); s.animals = [a]; s.speed = 0; s.temperature = -90;
  s.animalBeds = [{ id: 700, x: 12, y: 13, z: 8 }];
  s.pawns.forEach((p, i) => { p.priorities.care = i === 0 ? 2 : 0; p.priorities.handle = i === 1 ? 2 : 0;
    p.drafted = false; p.downed = false; p.dead = false; p.carriedBy = null; p.carryingPawnId = null;
    p.psyche.breakUntil = 0; p.phase = 'idle'; p.path = []; p.cargo = null; delete p.animalCareTask; });
  return s;
}
function elements(node: unknown): ReactElement<any>[] {
  if (!node || typeof node !== 'object') return [];
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!('props' in node)) return [];
  const element = node as ReactElement<any>;
  return [element, ...elements(element.props.children)];
}

describe('animal environmental survival UI without a browser', () => {
  it('shows each species comfort and tolerance ranges while keeping a healthy state distinct from wounds', () => {
    for (const species of ['hare', 'deer', 'alpaca', 'dromedary', 'chicken'] as const) {
      const a = animal(species), range = animalTemperatureRange(a);
      const html = renderToStaticMarkup(<AnimalEnvironmentFacts animal={a} />);
      expect(html).toContain(`舒适温度 ${range.comfortableMin}～${range.comfortableMax}°C`);
      expect(html).toContain(`耐受温度 ${range.safeMin}～${range.safeMax}°C`);
      expect(html).toContain('失温 0.0% · 中暑 0.0%'); expect(html).toContain('尚无失温或中暑');
      expect(html).toContain('data-ill="false"'); expect(html).not.toContain('需要改善环境');
      expect(html).not.toContain('当前位置');
    }
  });

  it('shows real hypothermia and heatstroke severity and the environmental recovery requirement', () => {
    const a = animal('alpaca', { environment: { hypothermia: .33, heatstroke: .12 } }), s = snapshot(a);
    const before = structuredClone(s);
    const html = renderToStaticMarkup(<AnimalMedicalDetails animal={a} snapshot={s} command={command} />);
    expect(html).toContain('失温 33.0% · 中暑 12.0%'); expect(html).toContain('环境病症，需要改善环境');
    expect(html).toContain('搬运到适温的动物医疗睡眠点'); expect(html).toContain('不靠草药治疗');
    expect(html).toContain('烧伤仍需护理伤口'); expect(html).toContain('没有已记录的伤口');
    expect(html).not.toContain('无可见伤势'); expect(s).toEqual(before);
  });

  it('includes temperature-only patients in the medical list without requiring an injury or scalar health loss', () => {
    const a = animal('chicken', { environment: { hypothermia: .2, heatstroke: 0 } }), s = snapshot(a);
    const html = renderToStaticMarkup(<AnimalMedicalPanel snapshot={s} command={command} choose={() => {}} focus={() => {}} selectAnimal={() => {}} />);
    expect(html).toContain('动物患者 1 只'); expect(html).toContain('鸡 #101 · 查看患者');
    expect(html).toContain('失温 20.0%'); expect(a.health).toBe(ANIMAL_DEFS.chicken.health);
    const overview = renderToStaticMarkup(<AnimalPanel snapshot={s} command={command} choose={() => {}} focus={() => {}} selectAnimal={() => {}}
      selectedAnimalId={null} baseLevel={8} selectPawn={() => {}} close={() => {}} penControls={controls} />);
    expect(overview).toContain('失温 20.0%'); expect(overview).toContain('环境病症，需要改善环境');
    a.environment.hypothermia = 0;
    const healthy = renderToStaticMarkup(<AnimalMedicalPanel snapshot={s} command={command} choose={() => {}} focus={() => {}} selectAnimal={() => {}} />);
    expect(healthy).toContain('动物患者 0 只');
  });

  it('does not offer medicine for temperature-only disease but permits actual rescue and tending existing burns', () => {
    const a = animal('chicken', { environment: { hypothermia: .8, heatstroke: 0 } }), s = snapshot(a), p = s.pawns[0];
    a.medical.downed = true; a.phase = 'downed';
    const buttons = () => elements(AnimalCareActions({ animal: a, snapshot: s, command }));
    const button = (action: string) => buttons().find(e => e.props['aria-label'] === `${p.name} ${action}动物 #101`)!.props;
    expect(button('护理').disabled).toBe(true); expect(button('护理').title).toBe('没有未护理伤口');
    expect(button('救助').disabled).toBe(false);
    button('救助').onClick();
    expect(command).toHaveBeenLastCalledWith({ type: 'animalCare', pawnId: p.id, animalId: a.id, action: 'rescue' });
    a.medical.wounds.push({ id: 1, part: 'body', kind: 'burn', severity: 2, tended: null, ageTicks: 0 }); a.medical.nextWoundId = 2;
    expect(button('护理').disabled).toBe(false);
    const html = renderToStaticMarkup(<AnimalMedicalDetails animal={a} snapshot={s} command={command} />);
    expect(html).toContain('躯干 · 烧伤');
  });

  it('preserves wild and caravan ownership and displays disease in both inspection and trade details', () => {
    for (const faction of ['wild', 'trader'] as const) {
      const a = animal('dromedary', { faction, environment: { hypothermia: 0, heatstroke: .25 } }), s = snapshot(a);
      const html = renderToStaticMarkup(<AnimalDetails animal={a} snapshot={s} command={command} focus={() => {}} penControls={controls} />);
      expect(html).toContain(`救助不改变${faction === 'trader' ? '商队' : '野生'}归属`);
      expect(html).toContain('中暑 25.0%'); expect(html).toContain('标记救助护理');
      const traded = renderToStaticMarkup(<AnimalTradeDetails animal={a} />);
      expect(traded).toContain('中暑 25.0%'); expect(a.faction).toBe(faction);
    }
  });

  it('allows moving a downed patient away from a bed that cannot support recovery', () => {
    const a = animal('chicken', { environment: { hypothermia: .8, heatstroke: 0 } }), s = snapshot(a), p = s.pawns[0];
    a.medical.downed = true; a.medical.bedId = 700; a.phase = 'medicalRest'; a.y = 13;
    s.animalBeds.push({ id: 701, x: 12, y: 14, z: 8 });
    const rescue = (localTemperature?: number) => elements(AnimalCareActions({ animal: a, snapshot: s, command, localTemperature }))
      .find(e => e.props['aria-label'] === `${p.name} 救助动物 #101`)!.props;
    const range = animalTemperatureRange(a);
    expect(rescue().disabled).toBe(false);
    expect(rescue(range.comfortableMin).disabled).toBe(false);
    expect(rescue(range.comfortableMin + 1).disabled).toBe(true);
    const html = renderToStaticMarkup(<AnimalEnvironmentFacts animal={a} localTemperature={range.comfortableMin} />);
    expect(html).toContain('当前温度不适合病情恢复');
  });

  it('uses an explicit local reading and never substitutes snapshot outdoor temperature for an indoor animal', () => {
    const a = animal(), s = snapshot(a);
    const render = (localTemperature?: number) => renderToStaticMarkup(<AnimalDetails animal={a} snapshot={s} command={command} focus={() => {}} penControls={controls} localTemperature={localTemperature} />);
    expect(render()).not.toContain('当前位置'); expect(render()).not.toContain('-90.0°C');
    expect(render(Number.NaN)).not.toContain('当前位置'); expect(render(Infinity)).not.toContain('当前位置');
    expect(render(22)).toContain('当前位置 22.0°C · 温度舒适'); expect(render(22)).not.toContain('-90.0°C');
    const range = animalTemperatureRange(a);
    expect(render(range.safeMin - 1)).toContain('超出耐受范围');
    expect(render((range.comfortableMin + range.safeMin) / 2)).toContain('超出舒适范围');
  });

  it('explains shelter navigation without presenting a reservation as completed recovery', () => {
    const a = animal('chicken', { environment: { hypothermia: .2, heatstroke: 0 }, phase: 'shelter' });
    const html = renderToStaticMarkup(<AnimalEnvironmentFacts animal={a} />);
    expect(html).toContain('正在前往适温或避火的位置'); expect(html).toContain('活动范围和通路');
    expect(html).toContain('失温 20.0%'); expect(html).toContain('逐渐恢复');
    a.faction = 'wild'; a.goal = { kind: 'climateExit', id: 123 };
    const exit = renderToStaticMarkup(<AnimalEnvironmentFacts animal={a} />);
    expect(exit).toContain('正在离开不适温地区'); expect(exit).not.toContain('正在前往适温或避火的位置');
  });
});
