import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { BoxGeometry, Color, Euler, Matrix4, Quaternion, Raycaster, Scene, Vector3 } from 'three';
import { EggBoxPanel } from '../src/voxel/EggBoxPanel';
import { EGG_BOX_RULES, type EggBox } from '../src/voxel/eggBoxes';
import { freshFertilizedEggs } from '../src/voxel/animalEggs';
import { freshBatch } from '../src/voxel/preservation';
import { initialAnimalState } from '../src/voxel/husbandry';
import { VoxelRenderer } from '../src/voxel/renderer';
import { VoxelSimulation } from '../src/voxel/world';
import { DAY, at, type VoxelCommand, type VoxelSnapshot, type WildAnimal } from '../src/voxel/types';

let initial: VoxelSnapshot;
beforeAll(() => { initial = new VoxelSimulation(73129, { hilliness: 'flat' }, false, 2).snapshot(); });
afterEach(() => vi.unstubAllGlobals());
const makeBox = (patch: Partial<EggBox> = {}): EggBox => ({ id: 700, x: 13, y: 12, z: 8, eggs: null, emptyRequested: false, forbidden: false, ...patch });
function snapshot(box = makeBox()) { const s = structuredClone(initial); s.eggBoxes = [box]; s.animals = []; return s; }
const panel = (s: VoxelSnapshot, temperature = 21) => renderToStaticMarkup(<EggBoxPanel box={s.eggBoxes[0]} snapshot={s} temperature={temperature} command={() => {}} />);
function elements(node: unknown): ReactElement<any>[] {
  if (!node || typeof node !== 'object') return [];
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!('props' in node)) return [];
  const element = node as ReactElement<any>;
  return [element, ...elements(element.props.children)];
}

describe('egg-box management without a browser', () => {
  it('shows actual capacity, automatic threshold and the hauling requirement', () => {
    const s = snapshot(), empty = panel(s);
    expect(empty).toContain(`aria-label="蛋箱容量" value="0" max="${EGG_BOX_RULES.capacity}"`);
    expect(empty).toContain('空蛋箱，等待母鸡'); expect(empty).toContain(`达到 ${EGG_BOX_RULES.emptyAt} 枚`);
    expect(empty).toContain('「搬运」分工'); expect(empty).toContain(`${EGG_BOX_RULES.cost.wood} 木材`);
    expect(empty).not.toContain('data-testid="egg-box-contents"');
    s.eggBoxes[0].eggs = freshBatch('eggUnfertilized', EGG_BOX_RULES.emptyAt - 1);
    expect(panel(s)).toContain('尚未达到自动收蛋阈值');
    s.eggBoxes[0].eggs.amount++;
    expect(panel(s)).toContain('已达到自动收蛋阈值');
  });
  it('dispatches early-empty, cancel, forbid, allow and dismantle commands for this box', () => {
    const box = makeBox({ eggs: freshBatch('eggUnfertilized', 3) }), s = snapshot(box), command = vi.fn<(c: VoxelCommand) => void>();
    const button = (label: string) => elements(EggBoxPanel({ box, snapshot: s, temperature: 21, command }))
      .find(element => element.type === 'button' && element.props['aria-label'] === label)!.props;
    button('请求提前清空蛋箱').onClick(); expect(command).toHaveBeenLastCalledWith({ type: 'eggBoxEmpty', boxId: box.id, enabled: true });
    box.emptyRequested = true;
    expect(panel(s)).toContain('已请求提前清空');
    button('取消提前清空蛋箱').onClick(); expect(command).toHaveBeenLastCalledWith({ type: 'eggBoxEmpty', boxId: box.id, enabled: false });
    button('禁止使用蛋箱').onClick(); expect(command).toHaveBeenLastCalledWith({ type: 'eggBoxForbid', boxId: box.id, forbidden: true });
    box.forbidden = true;
    button('允许使用蛋箱').onClick(); expect(command).toHaveBeenLastCalledWith({ type: 'eggBoxForbid', boxId: box.id, forbidden: false });
    button('拆除这个蛋箱').onClick(); expect(command).toHaveBeenLastCalledWith({ type: 'designate', tool: 'remove', from: { x: box.x, y: box.y, z: box.z } });
    box.emptyRequested = false;
    expect(button('请求提前清空蛋箱').disabled).toBe(true);
    box.forbidden = false; box.eggs = null;
    expect(button('请求提前清空蛋箱').disabled).toBe(true);
  });
  it('shows contained incubation and thermal damage even while forbidden, separately from building damage', () => {
    const egg = freshFertilizedEggs(7, 'colony'); egg.hatcher!.progress = .6; egg.hatcher!.temperatureDamage = .2;
    const box = makeBox({ eggs: egg, forbidden: true }), s = snapshot(box); s.items = [];
    s.fireDamage = [{ ...box, key: `eggBox:${box.id}`, kind: 'eggBox', targetId: box.id, hitPoints: 21, maxHitPoints: EGG_BOX_RULES.maxHitPoints }];
    const html = panel(s, -3);
    expect(html).toContain('鸡蛋（受精） × 7'); expect(html).toContain('data-forbidden="true"');
    expect(html).toContain('孵化与温度变化继续');
    expect(html).toContain('aria-label="受精蛋孵化进度" value="0.6"');
    expect(html).toContain('aria-label="受精蛋温度损伤" value="0.2"');
    expect(html).toContain('data-unsafe-temperature="true"');
    expect(html).toContain('aria-label="蛋箱建筑耐久" value="21"');
    expect(html).toContain('aria-label="箱内鸡蛋物资耐久" value="20"');
    expect(html).not.toContain('aria-label="箱内鸡蛋腐坏进度"');
  });
  it('shows edible-egg spoilage and actual approach versus collection work', () => {
    const box = makeBox({ eggs: { ...freshBatch('eggUnfertilized', 20), rotProgress: DAY } }), s = snapshot(box), p = s.pawns[0];
    Object.assign(p, { x: box.x - 1, y: box.y, z: box.z, phase: 'eggBox', eggBoxTask: { boxId: box.id, progress: 12 }, path: [] });
    expect(panel(s)).toContain('aria-label="箱内鸡蛋腐坏进度"');
    expect(panel(s)).toContain('正在收蛋');
    expect(panel(s)).toContain(`aria-label="蛋箱收蛋工作进度" value="12" max="${EGG_BOX_RULES.emptyWork}"`);
    p.path = [at({ x: box.x - 1, y: box.y, z: box.z })]; p.eggBoxTask!.progress = 0;
    expect(panel(s)).toContain('前往收蛋');
    box.forbidden = true;
    expect(panel(s)).not.toContain('aria-label="蛋箱收蛋工作进度"');
  });
});

function rendererHarness(s: VoxelSnapshot) {
  vi.stubGlobal('OffscreenCanvas', class { constructor(public width: number, public height: number) {} getContext() { return null; } });
  const r = Object.create(VoxelRenderer.prototype) as any;
  Object.assign(r, {
    data: s, disposed: false, entitiesDirty: false, width: 800, height: 600, level: 8, snapshotAt: 0,
    materialPool: new Set(), geometryPool: new Set(), box: new BoxGeometry(1, 1, 1), scene: new Scene(), color: new Color(),
    pawnVisuals: new Map(), animalVisuals: new Map(), terrainMeshes: new Map(), inspectBatches: new Map(), stackHeights: new Map(), batches: new Map(),
    ray: new Raycaster(), selectedAnimalId: null, explored: () => true, pick: () => null,
    translation: new Vector3(), scale: new Vector3(), quaternion: new Quaternion(), euler: new Euler(), matrix: new Matrix4(),
    workMotes: { count: 0, instanceMatrix: {} }, animateRopes: () => {}, updateCursor: () => {},
  });
  for (const method of ['animateStoves', 'animateWeaponBenches', 'animateFires', 'animateWeather', 'animateDevices', 'animateCombat']) r[method] = () => {};
  return r;
}
function dispose(r: any) {
  for (const material of r.materialPool) { material.map?.dispose(); material.dispose(); }
  for (const geometry of r.geometryPool) geometry.dispose(); r.box.dispose();
  for (const batch of r.batches.values()) batch.mesh.dispose();
}

describe('egg-box physical rendering without a GPU', () => {
  it('renders an open one-cell box, exact contained egg count and selectable fertile shells', () => {
    const box = makeBox({ eggs: freshFertilizedEggs(7, 'colony') }), s = snapshot(box), r = rendererHarness(s);
    s.pawns = []; r.updateEggBoxes();
    const parts = r.eggBoxParts(box);
    expect(parts.every((p: any) => p.x - p.sx / 2 >= box.x && p.x + p.sx / 2 <= box.x + 1 && p.y - p.sy / 2 >= box.y && p.y + p.sy / 2 <= box.y + 1)).toBe(true);
    expect(parts.filter((p: any) => p.z > box.z + .2 && p.sx > .5 && p.sy > .5)).toHaveLength(0);
    const shells = r.batches.get('egg-box-eggs').mesh, spots = r.batches.get('egg-box-fertile-spots').mesh, transform = new Matrix4();
    let visible = 0; for (let i = 0; i < shells.count; i++) { shells.getMatrixAt(i, transform); if (transform.elements[0] > 0) visible++; }
    expect(visible).toBe(7); spots.getMatrixAt(0, transform); expect(transform.elements[0]).toBeGreaterThan(0);
    r.ray.set(new Vector3(box.x + .24, box.z + 3, box.y + .24), new Vector3(0, -1, 0));
    expect(r.inspect(1, 1)).toEqual({ x: box.x, y: box.y, z: box.z, eggBoxId: box.id });
    box.eggs = null; box.forbidden = true; r.updateEggBoxes();
    shells.getMatrixAt(0, transform); expect(transform.elements[0]).toBe(0);
    expect(r.batches.get('egg-box-forbidden').mesh.count).toBe(2);
    dispose(r);
  });
  it('keeps box selection distinct from a chicken sharing its cell', () => {
    const box = makeBox(), s = snapshot(box), r = rendererHarness(s);
    s.animals = [{ ...initial.animals[0], ...initialAnimalState(101, 'chicken', 0), id: 101, species: 'chicken', name: '母鸡', growth: 1, sex: 'female', phase: 'roam', x: box.x, y: box.y, z: box.z }];
    const visual = r.makeAnimal(s.animals[0]); r.animalVisuals.set(101, visual); r.scene.add(visual.root); r.updateEggBoxes();
    r.ray.set(new Vector3(box.x + .10, box.z + 3, box.y + .5), new Vector3(0, -1, 0));
    expect(r.inspect(1, 1)).toEqual({ x: box.x, y: box.y, z: box.z, eggBoxId: box.id });
    r.ray.set(new Vector3(box.x + .5, box.z + 3, box.y + .5), new Vector3(0, -1, 0));
    expect(r.inspect(1, 1)).toEqual({ x: box.x, y: box.y, z: box.z, animalId: 101 });
    r.highlight({ x: box.x, y: box.y, z: box.z }); expect(r.selectedAnimalId).toBe(101);
    r.highlight({ x: box.x, y: box.y, z: box.z, eggBoxId: box.id });
    expect(r.selectedAnimalId).toBeNull();
    dispose(r);
  });
  it('drives the gathering pose only from real collection work and clears it on approach, forbidden state or cancellation', () => {
    const box = makeBox({ eggs: freshBatch('eggUnfertilized', 20) }), s = snapshot(box), p = s.pawns[0], r = rendererHarness(s);
    Object.assign(p, { x: box.x - 1, y: box.y, z: box.z, phase: 'eggBox', path: [], cargo: null, drafted: false,
      eggBoxTask: { boxId: box.id, progress: 5 } });
    const visual = r.makePawn(p); r.pawnVisuals.set(p.id, visual); r.animatePawns(0);
    expect(visual.root.userData.eggBoxCollecting).toEqual({ boxId: box.id, progress: 5, waiting: false });
    const pose = () => [visual.leftArm.rotation.x, visual.rightArm.rotation.x, visual.torso.rotation.x, visual.head.rotation.x];
    const first = pose(); s.tick += 100; r.animatePawns(5000); expect(pose()).toEqual(first);
    p.eggBoxTask!.progress = 15; r.animatePawns(5000); expect(pose()).not.toEqual(first);
    p.eggBoxTask!.progress = EGG_BOX_RULES.emptyWork; r.animatePawns(5000);
    expect(visual.root.userData.eggBoxCollecting.waiting).toBe(true);
    p.path = [at({ x: box.x - 1, y: box.y, z: box.z })]; r.animatePawns(5000); expect(visual.root.userData.eggBoxCollecting).toBeNull();
    p.path = []; box.forbidden = true; r.animatePawns(5000); expect(visual.root.userData.eggBoxCollecting).toBeNull();
    box.forbidden = false; delete p.eggBoxTask; p.phase = 'idle'; r.animatePawns(5000); expect(visual.root.userData.eggBoxCollecting).toBeNull();
    dispose(r);
  });
  it('keeps a hen walking to the box out of the laying pose until she arrives', () => {
    const box = makeBox(), s = snapshot(box), r = rendererHarness(s);
    const a: WildAnimal = { ...initial.animals[0], ...initialAnimalState(101, 'chicken', 0), id: 101, species: 'chicken', name: '母鸡',
      x: box.x, y: box.y, z: box.z, sex: 'female', growth: 1, phase: 'layEgg', eggProgress: 1, layProgress: 0,
      goal: { kind: 'layEggBox', id: box.id }, path: [at(box)] };
    s.animals = [a]; const visual = r.makeAnimal(a); r.animalVisuals.set(a.id, visual); r.animateAnimals(0);
    expect(visual.root.userData.eggLaying).toBeNull(); expect(visual.legs.every((leg: any) => leg.visible)).toBe(true);
    a.path = []; a.layProgress = 20; r.animateAnimals(0);
    expect(visual.root.userData.eggLaying.progress).toBe(20); expect(visual.legs.every((leg: any) => !leg.visible)).toBe(true);
    dispose(r);
  });
});
