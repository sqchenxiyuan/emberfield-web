import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { BoxGeometry, Color, Raycaster, Scene, Vector3 } from 'three';
import { AnimalDetails } from '../src/voxel/AnimalPanel';
import { AnimalPenControls, PenDetails } from '../src/voxel/PenPanel';
import { ApparelDetails, ApparelPanel } from '../src/voxel/ApparelPanel';
import { ProductionBillsPanel } from '../src/voxel/ProductionBillsPanel';
import { ShelfPanel } from '../src/voxel/ShelfPanel';
import { tradeItemName } from '../src/voxel/TradePanel';
import { makeProductionBill } from '../src/voxel/productionBills';
import { apparelStats, makeApparel } from '../src/voxel/apparel';
import { initialPenFilter } from '../src/voxel/pens';
import { autoSlaughterSelection, defaultAutoSlaughter } from '../src/voxel/autoSlaughter';
import { initialAnimalState } from '../src/voxel/husbandry';
import { WOOL_RULES } from '../src/voxel/animalWool';
import { VoxelRenderer } from '../src/voxel/renderer';
import { VoxelSimulation } from '../src/voxel/world';
import { DAY, type VoxelSnapshot, type WildAnimal } from '../src/voxel/types';

const command = vi.fn(async () => ({ ok: true, message: 'ok' }));
const controls = { selectedPenId: null, selectedAreaId: null, editingArea: false, showPen: () => {}, showArea: () => {}, editArea: () => {} };
let initial: VoxelSnapshot;
beforeAll(() => { initial = new VoxelSimulation(73129, { hilliness: 'flat' }, false, 2).snapshot(); });
afterEach(() => vi.unstubAllGlobals());
function alpaca(extra: Partial<WildAnimal> = {}): WildAnimal {
  return { ...initialAnimalState(101, 'alpaca', 0), id: 101, species: 'alpaca', name: '牧场羊驼', x: 12, y: 12, z: 8,
    faction: 'colony', sex: 'male', ageTicks: 5 * DAY, growth: 1, health: 80, hunger: 90, dead: false,
    hunt: false, phase: 'roam', moveTick: 0, decisionTick: 0, fleeUntil: 0, threatId: null, retryTick: 0, rotProgress: 0,
    woolGrowth: .25, ...extra };
}
function snapshot(a = alpaca()): VoxelSnapshot {
  const s = structuredClone(initial);
  s.animals = [a]; s.autoSlaughter = defaultAutoSlaughter(); s.autoSlaughterStatus = autoSlaughterSelection(s.autoSlaughter, s.animals);
  return s;
}
const details = (s: VoxelSnapshot) => renderToStaticMarkup(<AnimalDetails animal={s.animals[0]} snapshot={s} command={command} focus={() => {}} penControls={controls} />);

describe('wool and textile management without a browser', () => {
  it('shows actual growth, both-sex production and the path from shearing to clothes', () => {
    for (const sex of ['male', 'female'] as const) {
      const html = details(snapshot(alpaca({ sex })));
      expect(html).toContain('aria-label="羊驼肖像"');
      expect(html).toContain('aria-label="动物长毛进度" value="0.25" max="1"');
      expect(html).toContain('约 10 天'); expect(html).toContain('45 份羊驼毛');
      expect(html).toContain('成年雌雄都可产毛');
      expect(html).toContain('失败会损失本轮毛量');
      expect(html).toContain('裁缝账单勾选并制作衣物');
    }
  });
  it('explains inactive juvenile/wild animals and distinguishes actual shearing from full-ground waiting', () => {
    expect(details(snapshot(alpaca({ faction: 'wild' })))).toContain('驯服后，成年羊驼才能长毛');
    expect(details(snapshot(alpaca({ growth: .3 })))).not.toContain('aria-label="动物长毛进度"');
    const s = snapshot(alpaca({ woolGrowth: 1 })), p = s.pawns[0];
    expect(details(s)).toContain('等待开启「饲养」分工');
    p.handleTask = { animalId: 101, action: 'shear', stage: 'interact', foodId: null, amount: 0, feedings: 0, progress: 850 };
    expect(details(s)).toContain('aria-label="本次剪毛工作进度" value="850" max="1700"');
    p.handleTask.progress = WOOL_RULES.work;
    expect(details(s)).toContain('剪毛完成，等待放置空间');
    p.handleTask = null; s.autoSlaughter.alpaca.total = 0;
    s.autoSlaughterStatus = autoSlaughterSelection(s.autoSlaughter, s.animals);
    expect(details(s)).toContain('已待宰，不安排剪毛');
  });
  it('offers alpaca pen admission and rope management', () => {
    const s = snapshot(), marker = { id: 500, name: '牧场', x: 12, y: 15, z: 8, filter: initialPenFilter() };
    s.penMarkers = [marker];
    expect(renderToStaticMarkup(<PenDetails marker={marker} snapshot={s} command={command} focus={() => {}} controls={controls} />))
      .toContain('aria-label="牧场 接纳羊驼" checked=""');
    const html = renderToStaticMarkup(<AnimalPenControls animal={s.animals[0]} snapshot={s} command={command} controls={controls} />);
    expect(html).toContain('牵引目的地'); expect(html).toContain('羊驼需要围栏圈养');
    expect(html).not.toContain('活动范围');
  });
  it('shows textile filters and an empty-selection warning while retaining the single-material requirement', () => {
    const s = snapshot(), bill = makeProductionBill('bill:1', 'tailoring:parka');
    s.tailors = [{ id: 201, x: 13, y: 12, z: 8, axis: 'x', bills: [{ kind: 'parka', target: 2, paused: false }] }];
    s.productionQueues = [{ benchId: 201, bills: [bill] }];
    const render = () => renderToStaticMarkup(<ProductionBillsPanel benchId={201} snapshot={s} command={() => {}} />);
    expect(render()).toContain('aria-label="允许羊驼毛" checked=""');
    expect(render()).toContain('80 同一种布料或羊驼毛');
    expect(render()).toContain('每件衣物选一种材料，不能混料凑数');
    bill.policy.allowedTextiles = [];
    expect(render()).toContain('未允许任何纺织材料');
    expect(render()).not.toContain('aria-label="允许羊驼毛" checked=""');
    bill.policy.allowedTextiles = ['alpacaWool'];
    expect(render()).toContain('aria-label="允许羊驼毛" checked=""');
    expect(render()).not.toContain('aria-label="允许布料" checked=""');
  });
  it('shows wool material and actual insulation after wearing and in trade labels', () => {
    const piece = makeApparel(501, 'parka', 2, 'alpacaWool'), stats = apparelStats(piece), s = snapshot();
    const html = renderToStaticMarkup(<ApparelDetails piece={piece} />);
    expect(html).toContain('data-material="alpacaWool"'); expect(html).toContain('羊驼毛');
    expect(html).toContain(`隔冷 ${stats.cold.toFixed(1)}°C`);
    expect(html).not.toContain('布制');
    s.pawns[0].worn = [piece];
    expect(renderToStaticMarkup(<ApparelPanel pawn={s.pawns[0]} remove={() => {}} />)).toContain('data-material="alpacaWool"');
    expect(tradeItemName({ resource: 'apparel', amount: 1, apparel: piece })).toContain('羊驼毛');
  });
  it('exposes wool storage separately from cloth', () => {
    const s = snapshot(); s.shelves = [{ id: 601, kind: 'smallShelf', axis: 'x', x: 13, y: 12, z: 8, settings: { priority: 2, accepts: ['alpacaWool'] } }];
    const html = renderToStaticMarkup(<ShelfPanel shelfId={601} snapshot={s} command={() => {}} />);
    expect(html).toContain('aria-label="货架收纳羊驼毛" checked=""');
    expect(html).not.toContain('aria-label="货架收纳布料" checked=""');
  });
});

// Actual Three geometry and pose methods; inert texture canvases, no GPU or window.
function rendererHarness(s: VoxelSnapshot) {
  vi.stubGlobal('OffscreenCanvas', class { constructor(public width: number, public height: number) {} getContext() { return null; } });
  const renderer = Object.create(VoxelRenderer.prototype) as any;
  Object.assign(renderer, {
    data: s, disposed: false, entitiesDirty: false, width: 800, height: 600, level: 8, snapshotAt: 0,
    materialPool: new Set(), geometryPool: new Set(), box: new BoxGeometry(1, 1, 1), scene: new Scene(), color: new Color(),
    pawnVisuals: new Map(), animalVisuals: new Map(), terrainMeshes: new Map(), inspectBatches: new Map(), stackHeights: new Map(),
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

describe('alpaca geometry and task-driven shearing without a GPU', () => {
  it('picks the long neck, has four legs without a hump, and updates fleece from actual growth', () => {
    const a = alpaca({ woolGrowth: 1 }), renderer = rendererHarness(snapshot(a)), visual = renderer.makeAnimal(a);
    renderer.animalVisuals.set(a.id, visual); renderer.scene.add(visual.root);
    expect(visual.legs).toHaveLength(4); expect(visual.head.position.y).toBe(.90);
    expect(visual.body.getObjectByName('dromedary-hump')).toBeUndefined();
    renderer.ray.set(new Vector3(a.x + 3, a.z + 1.20, a.y + .80), new Vector3(-1, 0, 0));
    expect(renderer.inspect(1, 1)).toEqual({ x: a.x, y: a.y, z: a.z, animalId: a.id });
    expect(visual.fleece.visible).toBe(true); expect(visual.fleece.scale.x).toBeGreaterThan(1);
    a.woolGrowth = 0; renderer.animateAnimals(0); expect(visual.fleece.visible).toBe(false);
    a.woolGrowth = .5; renderer.animateAnimals(0); expect(visual.fleece.visible).toBe(true);
    dispose(renderer);
  });
  it('drives shears from real adjacent work and stops cycling on approach, cancellation or full-ground wait', () => {
    const a = alpaca({ woolGrowth: 1 }), s = snapshot(a), p = s.pawns[0];
    Object.assign(p, { x: 11, y: 12, z: 8, phase: 'handle', path: [], cargo: null, drafted: false,
      handleTask: { animalId: a.id, action: 'shear', stage: 'interact', foodId: null, amount: 0, feedings: 0, progress: 100 } });
    const renderer = rendererHarness(s), visual = renderer.makePawn(p);
    renderer.pawnVisuals.set(p.id, visual); renderer.scene.add(visual.root);
    expect(visual.cargoCarcasses.alpaca.children).toHaveLength(10);
    renderer.animatePawns(0); expect(visual.shears.visible).toBe(true);
    expect(visual.milkingPail.visible).toBe(false);
    expect(visual.root.userData.shearing).toEqual({ animalId: a.id, progress: 100, waitingForSpace: false });
    const first = visual.shears.children[0].rotation.y;
    s.tick += 100; renderer.animatePawns(5000); expect(visual.shears.children[0].rotation.y).toBe(first);
    p.handleTask!.progress = 130; renderer.animatePawns(5000); expect(visual.shears.children[0].rotation.y).not.toBe(first);
    p.handleTask!.progress = WOOL_RULES.work; renderer.animatePawns(5000);
    expect(visual.root.userData.shearing.waitingForSpace).toBe(true); expect(visual.shears.children[0].rotation.y).toBe(.16);
    p.handleTask!.stage = 'approach'; renderer.animatePawns(5000); expect(visual.shears.visible).toBe(false);
    p.handleTask!.stage = 'interact'; p.x = 9; renderer.animatePawns(5000); expect(visual.shears.visible).toBe(false);
    p.x = 11; p.handleTask = null; p.phase = 'idle'; renderer.animatePawns(5000);
    expect(visual.shears.visible).toBe(false); expect(visual.root.userData.shearing).toBeNull();
    dispose(renderer);
  });
  it('retains the actual wool material when updating the worn garment appearance', () => {
    const s = snapshot(), p = s.pawns[0]; s.pawns = [p]; s.animals = [];
    const renderer = rendererHarness(s);
    p.worn = [makeApparel(501, 'parka', 2, 'cloth')]; renderer.snapshot(s);
    const visual = renderer.pawnVisuals.get(p.id), clothColor = visual.apparel.coat.material.color.getHex();
    p.worn = [makeApparel(502, 'parka', 2, 'alpacaWool')]; renderer.snapshot(s);
    expect(visual.apparel.coat.visible).toBe(true);
    expect(visual.apparel.coat.material.color.getHex()).not.toBe(clothColor);
    dispose(renderer);
  });
});
