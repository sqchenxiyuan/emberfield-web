import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { AutoSlaughterPanel, parseAutoSlaughterDraft, type AutoSlaughterDraft } from '../src/voxel/AutoSlaughterPanel';
import { AnimalDetails, AnimalPanel } from '../src/voxel/AnimalPanel';
import { AUTO_SLAUGHTER_SPECIES, autoSlaughterSelection, defaultAutoSlaughter } from '../src/voxel/autoSlaughter';
import { initialAnimalState } from '../src/voxel/husbandry';
import { VoxelSimulation } from '../src/voxel/world';
import { DAY, type VoxelSnapshot, type WildAnimal } from '../src/voxel/types';

const blank: AutoSlaughterDraft = { total: '', male: '', female: '', youngMale: '', youngFemale: '', allowPregnant: false };
const command = vi.fn(async () => ({ ok: true, message: 'ok' }));
const penControls = { selectedPenId: null, selectedAreaId: null, editingArea: false,
  showPen: () => {}, showArea: () => {}, editArea: () => {} };
let initialSnapshot: VoxelSnapshot;
beforeAll(() => { initialSnapshot = new VoxelSimulation(73129, { hilliness: 'flat' }, false, 2).snapshot(); });
function animal(id: number, extra: Partial<WildAnimal> = {}): WildAnimal {
  return { ...initialAnimalState(id, 'deer', 0), id, species: 'deer', name: `鹿 ${id}`, x: 12, y: 12, z: 8,
    faction: 'colony', sex: 'male', ageTicks: 5 * DAY, growth: 1, health: 65, hunger: 90, dead: false,
    hunt: false, phase: 'roam', moveTick: 0, decisionTick: 0, fleeUntil: 0, threatId: null, retryTick: 0, rotProgress: 0, ...extra };
}
function snapshot(animals: WildAnimal[] = []): VoxelSnapshot {
  const autoSlaughter = defaultAutoSlaughter();
  return { ...initialSnapshot, pawns: initialSnapshot.pawns.map(pawn => ({ ...pawn })), animals, autoSlaughter,
    autoSlaughterStatus: autoSlaughterSelection(autoSlaughter, animals) };
}

describe('auto slaughter quota input boundary', () => {
  it('distinguishes an empty unlimited field from a deliberate zero and preserves pregnancy intent', () => {
    expect(parseAutoSlaughterDraft(blank)).toEqual(defaultAutoSlaughter().deer);
    expect(parseAutoSlaughterDraft({ ...blank, total: ' 0 ', male: '128', allowPregnant: true })).toEqual({
      total: 0, male: 128, female: null, youngMale: null, youngFemale: null, allowPregnant: true,
    });
  });
  it('rejects invalid partial edits instead of converting them into an executable quota', () => {
    for (const invalid of ['-', '-1', '1.5', '1e2', 'Infinity', 'NaN', '129', 'abc', '1 0'])
      expect(parseAutoSlaughterDraft({ ...blank, youngFemale: invalid }), invalid).toBeNull();
  });
});

describe('auto slaughter server-rendered management UI', () => {
  it('starts with unlimited inputs, protected pregnancies, and explicit inactive apply buttons', () => {
    command.mockClear();
    const html = renderToStaticMarkup(<AutoSlaughterPanel snapshot={snapshot()} command={command} selectAnimal={() => {}} />);
    expect(html.match(/placeholder="不限"/g)).toHaveLength(AUTO_SLAUGHTER_SPECIES.length * 5);
    expect(html.match(/type="submit" disabled=""/g)).toHaveLength(AUTO_SLAUGHTER_SPECIES.length);
    expect(html).toContain('0 表示该类一只不留');
    expect(html).toContain('允许自动宰杀怀孕动物');
    expect(html).not.toContain('checked=""');
    expect(command).not.toHaveBeenCalled();
  });
  it('separates physical population, eligible counts, protected pregnancies and selected animals', () => {
    const s = snapshot([animal(101, { name: '年长雄鹿', ageTicks: 8 * DAY, slaughter: true }),
      animal(102, { name: '幼年雄鹿', growth: .2 }),
      animal(103, { name: '孕鹿', sex: 'female', pregnancy: { fatherId: 101, progress: .5 } }),
      animal(104, { name: '放归鹿', releaseMarked: true })]);
    s.autoSlaughter.deer.total = 1;
    s.autoSlaughterStatus = autoSlaughterSelection(s.autoSlaughter, s.animals);
    const html = renderToStaticMarkup(<AutoSlaughterPanel snapshot={s} command={command} selectAnimal={() => {}} />);
    expect(html).toContain('殖民地存活 4 只 · 自动待宰 1 只');
    expect(html).toContain('孕期保护 1 只 · 放归中 1 只');
    expect(html).toContain('<output aria-label="鹿 总数 当前与上限">2 / 1</output>');
    expect(html).toContain('年长雄鹿');
    expect(html).toContain('同时手动待宰');
    expect(html).not.toContain('>孕鹿</button>');
    expect(html).not.toContain('>放归鹿</button>');
    expect(html).toContain('取消手动标记不会解除配额选中的自动待宰');
  });
  it('shows the automatic job without presenting it as a manual designation in details and the animal list', () => {
    const a = animal(201, { name: '配额待宰鹿' }), s = snapshot([a]);
    s.autoSlaughter.deer.total = 0;
    s.autoSlaughterStatus = autoSlaughterSelection(s.autoSlaughter, s.animals);
    s.pawns[0].handleTask = { animalId: a.id, action: 'autoSlaughter', stage: 'approach', foodId: null, amount: 0, feedings: 0, progress: 0 };
    const details = renderToStaticMarkup(<AnimalDetails animal={a} snapshot={s} command={command} focus={() => {}} penControls={penControls} />);
    expect(details).toContain('自动宰杀 · 接近动物');
    expect(details).toContain('自动待宰 · 超过已生效配额');
    expect(details).toContain('aria-label="标记待宰此动物" aria-pressed="false"');
    expect(details).not.toContain('手动待宰标记已开启');
    const list = renderToStaticMarkup(<AnimalPanel snapshot={s} selectedAnimalId={a.id} baseLevel={8} command={command}
      choose={() => {}} focus={() => {}} selectAnimal={() => {}} selectPawn={() => {}} close={() => {}} penControls={penControls} />);
    expect(list).toContain('aria-controls="auto-slaughter-tab"');
    expect(list).toContain('自动待宰 · 超过已生效配额');
  });
  it('retains the selected count when an animal is outside the currently visible snapshot', () => {
    const s = snapshot([animal(301)]);
    s.autoSlaughter.deer.total = 0;
    s.autoSlaughterStatus = autoSlaughterSelection(s.autoSlaughter, s.animals);
    s.animals = [];
    const html = renderToStaticMarkup(<AutoSlaughterPanel snapshot={s} command={command} selectAnimal={() => {}} />);
    expect(html).toContain('当前自动待宰 · 1 只');
    expect(html).toContain('另有 1 只当前不可定位的自动待宰动物。');
  });
});
