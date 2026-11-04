import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { BoxGeometry, Color, Group, Raycaster, Scene, Vector3 } from 'three';
import { AnimalDetails } from '../src/voxel/AnimalPanel';
import { AnimalPenControls, PenDetails } from '../src/voxel/PenPanel';
import { ProductionBillsPanel } from '../src/voxel/ProductionBillsPanel';
import { makeProductionBill } from '../src/voxel/productionBills';
import { initialPenFilter } from '../src/voxel/pens';
import { autoSlaughterSelection, defaultAutoSlaughter } from '../src/voxel/autoSlaughter';
import { initialAnimalState } from '../src/voxel/husbandry';
import { MILK_RULES } from '../src/voxel/animalMilk';
import { VoxelRenderer } from '../src/voxel/renderer';
import { VoxelSimulation } from '../src/voxel/world';
import { DAY, type VoxelSnapshot, type WildAnimal } from '../src/voxel/types';

const command = vi.fn(async () => ({ ok: true, message: 'ok' }));
const controls = { selectedPenId: null, selectedAreaId: null, editingArea: false, showPen: () => {}, showArea: () => {}, editArea: () => {} };
let initial: VoxelSnapshot;
beforeAll(() => { initial = new VoxelSimulation(73129, { hilliness: 'flat' }, false, 2).snapshot(); });
afterEach(() => vi.unstubAllGlobals());
function camel(extra: Partial<WildAnimal> = {}): WildAnimal {
  return { ...initialAnimalState(101, 'dromedary', 0), id: 101, species: 'dromedary', name: '雌性单峰驼', x: 12, y: 12, z: 8,
    faction: 'colony', sex: 'female', ageTicks: 5 * DAY, growth: 1, health: 100, hunger: 90, dead: false,
    hunt: false, phase: 'roam', moveTick: 0, decisionTick: 0, fleeUntil: 0, threatId: null, retryTick: 0, rotProgress: 0,
    milkFullness: .25, ...extra };
}
function snapshot(a: WildAnimal): VoxelSnapshot {
  const s = structuredClone(initial);
  s.animals = [a]; s.autoSlaughter = defaultAutoSlaughter(); s.autoSlaughterStatus = autoSlaughterSelection(s.autoSlaughter, s.animals);
  return s;
}
const details = (s: VoxelSnapshot) => renderToStaticMarkup(<AnimalDetails animal={s.animals[0]} snapshot={s} command={command} focus={() => {}} penControls={controls} />);

describe('animal milk management without a browser', () => {
  it('shows actual milk fullness, a dromedary portrait and the harvesting conditions', () => {
    const html = details(snapshot(camel()));
    expect(html).toContain('aria-label="单峰驼肖像"');
    expect(html).toContain('aria-label="动物蓄奶进度" value="0.25" max="1"');
    expect(html).toContain('约 2 天'); expect(html).toContain('18 份奶');
    expect(html).toContain('无需怀孕或分娩');
    expect(html).toContain('失败会损失本轮奶量');
    expect(html).toContain('饥饿会减慢或暂停产奶');
  });
  it('does not show active milk production for males, young animals or wildlife', () => {
    for (const [change, explanation] of [
      [{ sex: 'male' }, '雄性单峰驼不产奶'], [{ growth: .3 }, '雌性幼驼成年后开始产奶'],
      [{ faction: 'wild' }, '驯服后，成年雌性单峰驼才能产奶'],
    ] as const) {
      const html = details(snapshot(camel(change)));
      expect(html).toContain(explanation);
      expect(html).not.toContain('aria-label="动物蓄奶进度"');
    }
    expect(details(snapshot(camel({ species: 'deer' })))).not.toContain('data-testid="animal-milk"');
  });
  it('separates automatic waiting, real work progress, full-ground waiting and pending slaughter', () => {
    const s = snapshot(camel({ milkFullness: 1 })), p = s.pawns[0];
    expect(details(s)).toContain('等待开启「饲养」分工');
    p.handleTask = { animalId: 101, action: 'milk', stage: 'interact', foodId: null, amount: 0, feedings: 0, progress: 200 };
    expect(details(s)).toContain('aria-label="本次挤奶工作进度" value="200" max="400"');
    p.handleTask.progress = MILK_RULES.work;
    expect(details(s)).toContain('挤奶完成，等待放置空间');
    p.handleTask = null; s.autoSlaughter.dromedary.total = 0;
    s.autoSlaughterStatus = autoSlaughterSelection(s.autoSlaughter, s.animals);
    expect(details(s)).toContain('已待宰，不安排挤奶');
  });
  it('offers dromedary pen filters and rope controls rather than a hare allowed-area selector', () => {
    const s = snapshot(camel()), marker = { id: 500, name: '牧场', x: 12, y: 15, z: 8, filter: initialPenFilter() };
    s.penMarkers = [marker];
    const pen = renderToStaticMarkup(<PenDetails marker={marker} snapshot={s} command={command} focus={() => {}} controls={controls} />);
    expect(pen).toContain('aria-label="牧场 接纳单峰驼" checked=""');
    const animal = renderToStaticMarkup(<AnimalPenControls animal={s.animals[0]} snapshot={s} command={command} controls={controls} />);
    expect(animal).toContain('牵引目的地'); expect(animal).toContain('单峰驼需要围栏圈养');
    expect(animal).not.toContain('活动范围');
  });
  it('exposes milk as a recipe ingredient and dromedary carcasses for butchering', () => {
    const s = snapshot(camel()), cook = makeProductionBill('bill:1', 'cook'), butcher = makeProductionBill('bill:2', 'butcher');
    s.stoves = [{ id: 201, x: 13, y: 12, z: 8, target: 2, paused: false }];
    s.butcherSpots = [{ id: 202, x: 14, y: 12, z: 8, paused: false }];
    s.productionQueues = [{ benchId: 201, bills: [cook] }, { benchId: 202, bills: [butcher] }];
    const kitchen = renderToStaticMarkup(<ProductionBillsPanel benchId={201} snapshot={s} command={() => {}} />);
    expect(kitchen).toContain('aria-label="允许奶" checked=""');
    expect(kitchen).toContain('生肉、奶或谷物');
    cook.policy.allowedFood = ['grain'];
    expect(renderToStaticMarkup(<ProductionBillsPanel benchId={201} snapshot={s} command={() => {}} />)).not.toContain('aria-label="允许奶" checked=""');
    expect(renderToStaticMarkup(<ProductionBillsPanel benchId={202} snapshot={s} command={() => {}} />)).toContain('允许单峰驼尸体');
  });
});

// Use real Three geometry, picking and pose code; texture canvases are inert and no GPU or window is created.
function rendererHarness(s: VoxelSnapshot) {
  vi.stubGlobal('OffscreenCanvas', class { constructor(public width: number, public height: number) {} getContext() { return null; } });
  const renderer = Object.create(VoxelRenderer.prototype) as any;
  Object.assign(renderer, {
    data: s, disposed: false, entitiesDirty: false, width: 800, height: 600, level: 8, snapshotAt: 0,
    materialPool: new Set(), geometryPool: new Set(), box: new BoxGeometry(1, 1, 1), scene: new Scene(), color: new Color(),
    pawnVisuals: new Map(), animalVisuals: new Map(), terrainMeshes: new Map(), inspectBatches: new Map(),
    ray: new Raycaster(), selectedAnimalId: null, explored: () => true, pick: () => null,
    workMotes: { count: 0, instanceMatrix: {} }, animateRopes: () => {},
  });
  for (const method of ['animateStoves', 'animateWeaponBenches', 'animateFires', 'animateWeather', 'animateDevices', 'animateCombat']) renderer[method] = () => {};
  return renderer;
}
function dispose(renderer: any) {
  for (const material of renderer.materialPool) { material.map?.dispose(); material.dispose(); }
  for (const geometry of renderer.geometryPool) geometry.dispose(); renderer.box.dispose();
}

describe('dromedary geometry and task-driven milking pose without a GPU', () => {
  it('builds four long legs and one hump, and picks the actual hump geometry', () => {
    const a = camel(), renderer = rendererHarness(snapshot(a)), visual = renderer.makeAnimal(a);
    renderer.animalVisuals.set(a.id, visual); renderer.scene.add(visual.root);
    expect(visual.legs).toHaveLength(4);
    expect(visual.head.position.y).toBeGreaterThan(1);
    expect(visual.body.getObjectByName('dromedary-hump')).toBeInstanceOf(Group);
    expect(visual.legs.every((leg: Group) => leg.position.y > .7)).toBe(true);
    renderer.ray.set(new Vector3(a.x + 3, a.z + 1.35, a.y + .39), new Vector3(-1, 0, 0));
    expect(renderer.inspect(1, 1)).toEqual({ x: a.x, y: a.y, z: a.z, animalId: a.id });
    const deer = renderer.makeAnimal(camel({ species: 'deer' })), hare = renderer.makeAnimal(camel({ species: 'hare' }));
    expect(deer.body.getObjectByName('dromedary-hump')).toBeUndefined();
    expect(hare.body.getObjectByName('dromedary-hump')).toBeUndefined();
    expect(deer.head.position.y).toBe(.88); expect(hare.head.position.y).toBe(.39);
    dispose(renderer);
  });
  it('shows the milking pail only for actual adjacent work and freezes the squeeze when progress stops', () => {
    const a = camel({ milkFullness: 1 }), s = snapshot(a), p = s.pawns[0];
    Object.assign(p, { x: 11, y: 12, z: 8, phase: 'handle', path: [], cargo: null, drafted: false,
      handleTask: { animalId: a.id, action: 'milk', stage: 'interact', foodId: null, amount: 0, feedings: 0, progress: 100 } });
    const renderer = rendererHarness(s), visual = renderer.makePawn(p);
    renderer.pawnVisuals.set(p.id, visual); renderer.scene.add(visual.root);
    expect(visual.cargoCarcasses.dromedary.children).toHaveLength(10);
    renderer.animatePawns(0);
    expect(visual.milkingPail.visible).toBe(true);
    expect(visual.root.userData.milking).toEqual({ animalId: a.id, progress: 100, waitingForSpace: false });
    const firstArm = visual.rightArm.rotation.x;
    s.tick += 100; renderer.animatePawns(5000);
    expect(visual.rightArm.rotation.x).toBe(firstArm);
    p.handleTask!.progress = 130; renderer.animatePawns(5000);
    expect(visual.rightArm.rotation.x).not.toBe(firstArm);
    p.handleTask!.progress = MILK_RULES.work; renderer.animatePawns(5000);
    expect(visual.root.userData.milking.waitingForSpace).toBe(true);
    expect(visual.rightArm.rotation.x).toBe(-.45);
    p.handleTask!.stage = 'approach'; renderer.animatePawns(5000);
    expect(visual.milkingPail.visible).toBe(false);
    expect(visual.root.userData.milking).toBeNull();
    p.handleTask!.stage = 'interact'; p.x = 9; renderer.animatePawns(5000);
    expect(visual.milkingPail.visible).toBe(false);
    p.x = 11; p.handleTask = null; p.phase = 'idle'; renderer.animatePawns(5000);
    expect(visual.milkingPail.visible).toBe(false);
    dispose(renderer);
  });
});
