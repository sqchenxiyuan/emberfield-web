import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { BoxGeometry, Color, Euler, Matrix4, Quaternion, Raycaster, Scene, Vector3 } from 'three';
import { AnimalDetails, EggDetails } from '../src/voxel/AnimalPanel';
import { AnimalPenControls, PenDetails } from '../src/voxel/PenPanel';
import { ProductionBillsPanel } from '../src/voxel/ProductionBillsPanel';
import { ShelfPanel } from '../src/voxel/ShelfPanel';
import { makeProductionBill } from '../src/voxel/productionBills';
import { initialPenFilter } from '../src/voxel/pens';
import { autoSlaughterSelection, defaultAutoSlaughter } from '../src/voxel/autoSlaughter';
import { initialAnimalState } from '../src/voxel/husbandry';
import { EGG_RULES } from '../src/voxel/animalEggs';
import { VoxelRenderer } from '../src/voxel/renderer';
import { VoxelSimulation } from '../src/voxel/world';
import { DAY, type Cargo, type VoxelSnapshot, type WildAnimal } from '../src/voxel/types';

const command = vi.fn(async () => ({ ok: true, message: 'ok' }));
const controls = { selectedPenId: null, selectedAreaId: null, editingArea: false, showPen: () => {}, showArea: () => {}, editArea: () => {} };
let initial: VoxelSnapshot;
beforeAll(() => { initial = new VoxelSimulation(73129, { hilliness: 'flat' }, false, 2).snapshot(); });
afterEach(() => vi.unstubAllGlobals());
function chicken(extra: Partial<WildAnimal> = {}): WildAnimal {
  return { ...initialAnimalState(101, 'chicken', 0), id: 101, species: 'chicken', name: '母鸡', x: 12, y: 12, z: 8,
    faction: 'colony', sex: 'female', ageTicks: 5 * DAY, growth: 1, health: 20, hunger: 90, dead: false,
    hunt: false, phase: 'roam', moveTick: 0, decisionTick: 0, fleeUntil: 0, threatId: null, retryTick: 0, rotProgress: 0,
    eggProgress: .6, fertilizationCount: 1, eggFatherId: 102, layProgress: 0, ...extra };
}
function snapshot(a = chicken()): VoxelSnapshot {
  const s = structuredClone(initial); s.animals = [a];
  s.autoSlaughter = defaultAutoSlaughter(); s.autoSlaughterStatus = autoSlaughterSelection(s.autoSlaughter, s.animals);
  return s;
}
const details = (s: VoxelSnapshot) => renderToStaticMarkup(<AnimalDetails animal={s.animals[0]} snapshot={s} command={command} focus={() => {}} penControls={controls} />);
const fertile = (): Cargo => ({ resource: 'eggFertilized', amount: 1,
  hatcher: { progress: .4, temperatureDamage: .2, motherId: 101, fatherId: 102, faction: 'colony' } });

describe('chicken and egg management without a browser', () => {
  it('shows autonomous laying and real fertilization for both colony and wild hens', () => {
    for (const faction of ['colony', 'wild'] as const) {
      const html = details(snapshot(chicken({ faction })));
      expect(html).toContain('aria-label="鸡肖像"');
      expect(html).toContain('aria-label="动物产蛋进度" value="0.6" max="1"');
      expect(html).toContain('受精余量 1 枚'); expect(html).toContain('不需要饲养员');
      expect(html).toContain('下一枚为受精蛋');
    }
    expect(details(snapshot(chicken({ fertilizationCount: 0, eggFatherId: null })))).toContain('下一枚为未受精蛋');
  });
  it('explains rooster and juvenile eligibility, hunger and actual laying/full-ground waiting', () => {
    const male = details(snapshot(chicken({ sex: 'male' })));
    expect(male).toContain('公鸡不产蛋'); expect(male).not.toContain('aria-label="动物产蛋进度"');
    expect(details(snapshot(chicken({ growth: .2 })))).toContain('母雏鸡成年后开始产蛋');
    expect(details(snapshot(chicken({ hunger: 0 })))).toContain('饥饿使产蛋暂停');
    const s = snapshot(chicken({ phase: 'layEgg', eggProgress: 1, layProgress: EGG_RULES.layWork / 2 }));
    expect(details(s)).toContain(`aria-label="本次下蛋工作进度" value="${EGG_RULES.layWork / 2}" max="${EGG_RULES.layWork}"`);
    s.animals[0].layProgress = EGG_RULES.layWork;
    expect(details(s)).toContain('下蛋完成，等待放置空间');
  });
  it('offers chicken pen admission and physical rope management', () => {
    const s = snapshot(), marker = { id: 500, name: '鸡舍', x: 12, y: 15, z: 8, filter: initialPenFilter() };
    s.penMarkers = [marker];
    expect(renderToStaticMarkup(<PenDetails marker={marker} snapshot={s} command={command} focus={() => {}} controls={controls} />))
      .toContain('aria-label="鸡舍 接纳鸡" checked=""');
    const html = renderToStaticMarkup(<AnimalPenControls animal={s.animals[0]} snapshot={s} command={command} controls={controls} />);
    expect(html).toContain('牵引目的地'); expect(html).toContain('鸡需要围栏圈养'); expect(html).not.toContain('活动范围');
  });
  it('distinguishes edible eggs, viable eggs, thermal damage and inherited offspring faction', () => {
    const egg = fertile();
    const render = (temperature: number) => renderToStaticMarkup(<EggDetails batch={egg} temperature={temperature} />);
    expect(render(21)).toContain('aria-label="受精蛋孵化进度" value="0.4" max="1"');
    expect(render(21)).toContain('aria-label="受精蛋温度损伤" value="0.2" max="1"');
    expect(render(21)).toContain('殖民地雏鸡'); expect(render(21)).toContain('母鸡 #101');
    expect(render(0)).toContain('data-unsafe-temperature="false"'); expect(render(50)).toContain('data-unsafe-temperature="false"');
    expect(render(-1)).toContain('data-unsafe-temperature="true"'); expect(render(51)).toContain('data-unsafe-temperature="true"');
    expect(render(-1)).toContain('避免冷冻');
    egg.hatcher!.faction = 'wild'; expect(render(21)).toContain('野生雏鸡');
    expect(render(21)).not.toContain('data-testid="egg-hatch-waiting"');
    egg.hatcher!.progress = 1;
    expect(render(21)).toContain('孵化完成，等待附近空位或动物容量');
    expect(render(21)).not.toContain('等待落地');
    const edible = renderToStaticMarkup(<EggDetails batch={{ resource: 'eggUnfertilized', amount: 2 }} temperature={-5} />);
    expect(edible).toContain('不能孵化'); expect(edible).not.toContain('aria-label="受精蛋孵化进度"');
    expect(renderToStaticMarkup(<EggDetails batch={{ resource: 'grain', amount: 2 }} temperature={21} />)).toBe('');
  });
  it('defaults new cooking bills to edible eggs and exposes an explicit fertile-egg opt-in', () => {
    const s = snapshot(), bill = makeProductionBill('bill:1', 'cook');
    s.stoves = [{ id: 201, x: 13, y: 12, z: 8, target: 10, paused: false }];
    s.productionQueues = [{ benchId: 201, bills: [bill] }];
    const render = () => renderToStaticMarkup(<ProductionBillsPanel benchId={201} snapshot={s} command={() => {}} />);
    expect(render()).toContain('aria-label="允许未受精蛋" checked=""');
    expect(render()).not.toContain('aria-label="允许受精蛋" checked=""');
    expect(render()).toContain('勾选受精蛋会消耗可孵化的蛋');
    bill.policy.allowedFood = ['eggFertilized'];
    expect(render()).toContain('aria-label="允许受精蛋" checked=""');
    expect(render()).not.toContain('aria-label="允许未受精蛋" checked=""');
  });
  it('lets a dedicated shelf accept fertile eggs independently', () => {
    const s = snapshot(); s.shelves = [{ id: 601, kind: 'smallShelf', axis: 'x', x: 13, y: 12, z: 8, settings: { priority: 2, accepts: ['eggFertilized'] } }];
    const html = renderToStaticMarkup(<ShelfPanel shelfId={601} snapshot={s} command={() => {}} />);
    expect(html).toContain('aria-label="货架收纳鸡蛋（受精）" checked=""');
    expect(html).not.toContain('aria-label="货架收纳鸡蛋（未受精）" checked=""');
  });
});

// Actual Three geometry and pose methods; inert texture canvases, no window/GPU.
function rendererHarness(s: VoxelSnapshot) {
  vi.stubGlobal('OffscreenCanvas', class { constructor(public width: number, public height: number) {} getContext() { return null; } });
  const renderer = Object.create(VoxelRenderer.prototype) as any;
  Object.assign(renderer, {
    data: s, disposed: false, entitiesDirty: false, width: 800, height: 600, level: 8, snapshotAt: 0,
    materialPool: new Set(), geometryPool: new Set(), box: new BoxGeometry(1, 1, 1), scene: new Scene(), color: new Color(),
    pawnVisuals: new Map(), animalVisuals: new Map(), terrainMeshes: new Map(), inspectBatches: new Map(), stackHeights: new Map(), batches: new Map(),
    ray: new Raycaster(), selectedAnimalId: null, explored: () => true, pick: () => null,
    translation: new Vector3(), scale: new Vector3(), quaternion: new Quaternion(), euler: new Euler(), matrix: new Matrix4(),
    workMotes: { count: 0, instanceMatrix: {} }, animateRopes: () => {},
  });
  for (const method of ['animateStoves', 'animateWeaponBenches', 'animateFires', 'animateWeather', 'animateDevices', 'animateCombat']) renderer[method] = () => {};
  return renderer;
}
function dispose(renderer: any) {
  for (const material of renderer.materialPool) { material.map?.dispose(); material.dispose(); }
  for (const geometry of renderer.geometryPool) geometry.dispose(); renderer.box.dispose();
  for (const batch of renderer.batches.values()) batch.mesh.dispose();
}

describe('chicken geometry and task-driven laying without a GPU', () => {
  it('has two legs, wings and a comb, remains selectable, and visibly scales chicks', () => {
    const a = chicken(), renderer = rendererHarness(snapshot(a)), visual = renderer.makeAnimal(a);
    renderer.animalVisuals.set(a.id, visual); renderer.scene.add(visual.root); renderer.animateAnimals(0);
    expect(visual.legs).toHaveLength(2); expect(visual.wings).toHaveLength(2); expect(visual.comb.visible).toBe(true);
    expect(visual.body.getObjectByName('chicken-left-wing')).toBeDefined();
    renderer.ray.set(new Vector3(a.x + 3, a.z + .4, a.y + .5), new Vector3(-1, 0, 0));
    expect(renderer.inspect(1, 1)).toEqual({ x: a.x, y: a.y, z: a.z, animalId: a.id });
    a.growth = 0; renderer.animateAnimals(0);
    expect(visual.body.scale.x).toBe(.45); expect(visual.comb.visible).toBe(false); expect(visual.feathers.color.getHex()).toBe(0xf4d568);
    dispose(renderer);
  });
  it('moves laying posture only when actual work advances and stops on waiting or cancellation', () => {
    const a = chicken({ phase: 'layEgg', eggProgress: 1, layProgress: 20 }), s = snapshot(a), renderer = rendererHarness(s), visual = renderer.makeAnimal(a);
    renderer.animalVisuals.set(a.id, visual); renderer.animateAnimals(0);
    const pose = () => [visual.body.position.y, visual.head.rotation.x, ...visual.wings.map((wing: any) => wing.rotation.z)];
    const first = pose(); s.tick += 1000; renderer.animateAnimals(9999); expect(pose()).toEqual(first);
    a.layProgress = 40; renderer.animateAnimals(9999); expect(pose()).not.toEqual(first);
    a.layProgress = EGG_RULES.layWork; renderer.animateAnimals(9999);
    expect(visual.root.userData.eggLaying).toEqual({ progress: EGG_RULES.layWork, waitingForSpace: true });
    const waiting = pose(); renderer.animateAnimals(20000); expect(pose()).toEqual(waiting);
    a.phase = 'roam'; renderer.animateAnimals(20000);
    expect(visual.root.userData.eggLaying).toBeNull(); expect(visual.body.rotation.x).toBe(0); expect(visual.legs.every((leg: any) => leg.visible)).toBe(true);
    dispose(renderer);
  });
  it('renders and picks rounded eggs independently of box piles and preserves fertile identity in cargo', () => {
    const s = snapshot(); s.animals = []; s.pawns = []; const renderer = rendererHarness(s);
    const eggs = [{ ...fertile(), id: 701, x: 13, y: 12, z: 8 }, { resource: 'eggUnfertilized' as const, amount: 3, id: 702, x: 15, y: 12, z: 8 }];
    renderer.updateEggItems(eggs);
    const shells = renderer.batches.get('loose-eggs').mesh, spots = renderer.batches.get('fertilized-egg-spots').mesh;
    expect(shells.geometry.type).toBe('IcosahedronGeometry'); expect(shells.count).toBe(6);
    const colorA = new Color(), colorB = new Color(); shells.getColorAt(0, colorA); shells.getColorAt(3, colorB); expect(colorA.getHex()).not.toBe(colorB.getHex());
    const transform = new Matrix4(); spots.getMatrixAt(0, transform); expect(transform.elements[0]).toBeGreaterThan(0);
    spots.getMatrixAt(3, transform); expect(transform.elements[0]).toBe(0);
    renderer.ray.set(new Vector3(13.32, 11, 12.38), new Vector3(0, -1, 0));
    expect(renderer.inspect(1, 1)).toEqual({ x: 13, y: 12, z: 8 });
    const p = structuredClone(initial.pawns[0]); Object.assign(p, { cargo: fertile(), phase: 'idle', path: [], drafted: false });
    s.pawns = [p]; const visual = renderer.makePawn(p); renderer.pawnVisuals.set(p.id, visual); renderer.animatePawns(0);
    expect(visual.cargoEggs.eggFertilized.visible).toBe(true); expect(visual.cargo.visible).toBe(false);
    expect(visual.cargoEggs.eggFertilized.children.filter((egg: any) => egg.visible)).toHaveLength(1);
    expect(visual.cargoCarcasses.chicken.children).toHaveLength(10);
    p.cargo = { resource: 'eggUnfertilized', amount: 2 }; renderer.animatePawns(0);
    expect(visual.cargoEggs.eggFertilized.visible).toBe(false); expect(visual.cargoEggs.eggUnfertilized.visible).toBe(true);
    dispose(renderer);
  });
});
