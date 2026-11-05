import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { BoxGeometry, Color, Euler, Matrix4, Quaternion, Raycaster, Scene, Vector3 } from 'three';
import { AnimalDetails, AnimalTradeDetails } from '../src/voxel/AnimalPanel';
import { AnimalTrainingDetails, AnimalTrainingPanel, AnimalCooperationStatus, AnimalsReleaseControl, AnimalRescueStatus } from '../src/voxel/AnimalTrainingPanel';
import { AnimalPenControls } from '../src/voxel/PenPanel';
import { ANIMAL_TRAINING_RULES, TRAINABLES, TRAINING_STEPS } from '../src/voxel/animalTraining';
import { initialAnimalState } from '../src/voxel/husbandry';
import { VoxelRenderer } from '../src/voxel/renderer';
import { VoxelSimulation } from '../src/voxel/world';
import { DAY, type Pawn, type VoxelCommand, type VoxelSnapshot, type WildAnimal } from '../src/voxel/types';

let initial: VoxelSnapshot;
beforeAll(() => { initial = new VoxelSimulation(73129, { hilliness: 'flat' }, false, 2).snapshot(); });
const command = vi.fn<(c: VoxelCommand) => void>();
const controls = { selectedPenId: null, selectedAreaId: null, editingArea: false, showPen: () => {}, showArea: () => {}, editArea: () => {} };
beforeEach(() => command.mockClear());
afterEach(() => vi.unstubAllGlobals());

function dog(extra: Partial<WildAnimal> = {}): WildAnimal {
  return { ...initialAnimalState(901, 'labrador', 0), id: 901, species: 'labrador', name: '麦穗', x: 12, y: 12, z: 8,
    faction: 'colony', sex: 'female', ageTicks: 8 * DAY, growth: 1, health: 75, hunger: 90, dead: false, tameness: 1,
    hunt: false, phase: 'roam', moveTick: 0, decisionTick: 0, fleeUntil: 0, threatId: null, retryTick: 0, rotProgress: 0, ...extra };
}
function fixture() {
  const s = structuredClone(initial), a = dog(), p = s.pawns[0];
  Object.assign(p, { x: 11, y: 12, z: 8, name: '林禾', faction: 'colony', phase: 'idle', path: [], destination: null,
    drafted: false, downed: false, dead: false, carriedBy: null, carryingPawnId: null, cargo: null, animalsReleased: false });
  p.psyche.breakUntil = 0; p.skills.animals.level = 10; p.priorities.handle = 2;
  delete p.animalTrainTask;
  s.pawns = [p]; s.animals = [a]; s.speed = 0;
  return { s, a, p };
}
function learn(a: WildAnimal, ...skills: typeof TRAINABLES[number][]) {
  for (const skill of skills) { a.training.learned[skill] = true; a.training.steps[skill] = TRAINING_STEPS[skill]; }
}
function elements(node: unknown): ReactElement<any>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!node || typeof node !== 'object' || !('props' in node)) return [];
  const e = node as ReactElement<any>; return [e, ...elements(e.props.children)];
}
const html = (s: VoxelSnapshot) => renderToStaticMarkup(<AnimalTrainingDetails animal={s.animals[0]} snapshot={s} command={command} />);
const tree = (s: VoxelSnapshot) => elements(AnimalTrainingDetails({ animal: s.animals[0], snapshot: s, command }));
const field = (s: VoxelSnapshot, label: string) => tree(s).find(e => e.props['aria-label'] === label)!;

describe('animal training and cooperation UI without a browser', () => {
  it('queues individual skills with prerequisites visible and keeps requests separate from completed steps', () => {
    const { s, a } = fixture(), before = structuredClone(a);
    expect(html(s)).toContain('先完成服从训练'); expect(html(s)).toContain('首次学会服从时自动指派训练者');
    field(s, '麦穗 训练搬运').props.onChange({ target: { checked: true } });
    expect(command).toHaveBeenCalledExactlyOnceWith({ type: 'animalTraining', animalId: a.id, trainable: 'haul', wanted: true });
    expect(a).toEqual(before); expect(field(s, '麦穗 主人').props.disabled).toBe(true);
  });
  it('distinguishes learned but decaying skills from incomplete learning and shows growth restrictions', () => {
    const { s, a } = fixture(); learn(a, 'obedience', 'rescue'); a.training.steps.rescue = 1;
    expect(html(s)).toContain('救援 · 1 / 2 · 已掌握'); expect(html(s)).toContain('仍可使用，等待补训巩固');
    a.training.learned.rescue = false; expect(html(s)).not.toContain('救援 · 1 / 2 · 已掌握');
    a.growth = 0; expect(html(s)).toContain('体型尚小，成长后才能训练');
  });
  it('assigns and clears a master without implicitly enabling follow and retains a temporarily downed master', () => {
    const { s, a, p } = fixture(); learn(a, 'obedience');
    field(s, '麦穗 主人').props.onChange({ target: { value: String(p.id) } });
    expect(command).toHaveBeenLastCalledWith({ type: 'animalMaster', animalId: a.id, pawnId: p.id });
    a.training.masterId = p.id; p.downed = true;
    expect(html(s)).toContain('林禾 · 倒地'); expect(field(s, '麦穗 征召时跟随').props.checked).toBe(false);
    field(s, '麦穗 主人').props.onChange({ target: { value: '' } });
    expect(command).toHaveBeenLastCalledWith({ type: 'animalMaster', animalId: a.id, pawnId: null });
  });
  it('dispatches independent follow preferences for the correct animal', () => {
    const { s, a, p } = fixture(); learn(a, 'obedience'); a.training.masterId = p.id;
    for (const [label, when] of [['征召时跟随', 'drafted'], ['野外工作时跟随', 'fieldwork']] as const) {
      const control = field(s, `麦穗 ${label}`); expect(control.props.disabled).toBe(false);
      control.props.onChange({ target: { checked: true } });
      expect(command).toHaveBeenLastCalledWith({ type: 'animalFollow', animalId: a.id, when, enabled: true });
    }
    a.training.masterId = null; expect(field(s, '麦穗 征召时跟随').props.disabled).toBe(true);
  });
  it('can clear an old master and disable desired follow after obedience is lost', () => {
    const { s, a, p } = fixture(); a.training.masterId = p.id; a.training.followDrafted = true;
    expect(field(s, '麦穗 主人').props.disabled).toBe(false);
    const follow = field(s, '麦穗 征召时跟随'); expect(follow.props.disabled).toBe(false);
    follow.props.onChange({ target: { checked: false } });
    expect(command).toHaveBeenLastCalledWith({ type: 'animalFollow', animalId: a.id, when: 'drafted', enabled: false });
    field(s, '麦穗 主人').props.onChange({ target: { value: '' } });
    expect(command).toHaveBeenLastCalledWith({ type: 'animalMaster', animalId: a.id, pawnId: null });
  });
  it('shows the real trainer, stage, remaining food and progress without leaking another animal task', () => {
    const { s, a, p } = fixture();
    p.phase = 'animalTrain'; p.animalTrainTask = { animalId: a.id, trainable: 'obedience', sourceId: null, resource: 'grain', amount: 2, stage: 'work', progress: 30 };
    const status = () => renderToStaticMarkup(<AnimalCooperationStatus animal={a} snapshot={s} />);
    expect(status()).toContain('林禾 · 训练服从 · 训练互动'); expect(status()).toContain('value="30"');
    p.animalTrainTask.animalId++; expect(status()).not.toContain('本次动物训练进度');
    p.animalTrainTask.animalId = a.id; p.animalTrainTask.stage = 'fetch';
    expect(status()).toContain('取训练食物'); expect(status()).not.toContain('本次动物训练进度');
    p.drafted = true; expect(status()).not.toContain('data-trainer-id');
  });
  it('explains missing handlers and interaction cooldown without claiming work is happening', () => {
    const { s, a, p } = fixture(); p.priorities.handle = 0; a.training.wanted.obedience = true; a.nextInteractionTick = s.tick + DAY / 4;
    expect(html(s)).toContain('需要开启殖民者的饲养分工'); expect(html(s)).toContain('下次可训练');
    expect(html(s)).not.toContain('本次动物训练进度');
  });
  it('shows actual cargo even after cancellation and resolves rescue identity from the correct patient', () => {
    const { s, a, p } = fixture(); a.cargo = { resource: 'wood', amount: 7 };
    const status = () => renderToStaticMarkup(<AnimalCooperationStatus animal={a} snapshot={s} />);
    expect(status()).toContain('实际携带：木材 × 7'); expect(status()).toContain('等待放下');
    a.work = { kind: 'rescue', patientId: p.id, bedId: 700, stage: 'carry' }; p.carriedBy = a.id;
    expect(status()).toContain('正送往床位 · 林禾');
    expect(renderToStaticMarkup(<AnimalRescueStatus pawn={p} snapshot={s} />)).toContain('麦穗 正在把 林禾');
    p.carriedBy = a.id + 1; expect(renderToStaticMarkup(<AnimalRescueStatus pawn={p} snapshot={s} />)).toBe('');
  });
  it('keeps trade snapshots read-only and independent of current learned skills or master', () => {
    const { s, a, p } = fixture(); learn(a, 'obedience', 'haul'); a.training.masterId = p.id;
    const receipt = structuredClone(a), before = structuredClone(receipt);
    a.training.learned.haul = false; a.training.masterId = null;
    const result = renderToStaticMarkup(<AnimalTradeDetails animal={receipt} />);
    expect(result).toContain('已掌握：服从、搬运'); expect(result).not.toContain('<select'); expect(result).not.toContain('林禾');
    expect(receipt).toEqual(before); expect(s.animals[0].training.learned.haul).toBe(false);
  });
  it('offers editing only for living colony dogs and integrates their portrait and allowed area', () => {
    const { s, a } = fixture();
    const details = renderToStaticMarkup(<AnimalDetails animal={a} snapshot={s} command={async () => ({ ok: true, message: '' })} focus={() => {}} penControls={controls} />);
    expect(details).toContain('拉布拉多犬肖像'); expect(details).toContain('训练与协作');
    const area = renderToStaticMarkup(<AnimalPenControls animal={a} snapshot={s} command={async () => ({ ok: true, message: '' })} controls={controls} />);
    expect(area).toContain('麦穗 活动范围'); expect(area).not.toContain('牵引目的地');
    for (const faction of ['trader', 'wild'] as const) { a.faction = faction; expect(html(s)).not.toContain('<input'); }
    a.faction = 'colony'; a.dead = true; expect(html(s)).not.toContain('<input');
    expect(renderToStaticMarkup(<AnimalTrainingPanel snapshot={s} command={command} selectAnimal={() => {}} />)).toContain('目前没有可训练');
  });
  it('requires learned release and drafted follow, sends only a master toggle, and allows recall', () => {
    const { s, a, p } = fixture(); p.drafted = true; a.training.masterId = p.id; learn(a, 'obedience', 'release');
    const button = () => elements(AnimalsReleaseControl({ pawn: p, snapshot: s, command })).find(e => e.type === 'button')!;
    expect(button().props.disabled).toBe(true); a.training.followDrafted = true; expect(button().props.disabled).toBe(false);
    button().props.onClick(); expect(command).toHaveBeenLastCalledWith({ type: 'animalsRelease', pawnId: p.id, enabled: true });
    p.animalsReleased = true; a.medical.downed = true; expect(button().props.disabled).toBe(false);
    button().props.onClick(); expect(command).toHaveBeenLastCalledWith({ type: 'animalsRelease', pawnId: p.id, enabled: false });
    expect(renderToStaticMarkup(<AnimalsReleaseControl pawn={p} snapshot={s} command={command} />)).toContain('动物自行选择威胁');
    p.drafted = false; expect(AnimalsReleaseControl({ pawn: p, snapshot: s, command })).toBeNull();
  });
});

function rendererHarness(s: VoxelSnapshot) {
  vi.stubGlobal('OffscreenCanvas', class { constructor(public width: number, public height: number) {} getContext() { return null; } });
  const r = Object.create(VoxelRenderer.prototype) as any;
  Object.assign(r, { data: s, disposed: false, entitiesDirty: false, width: 800, height: 600, level: 8, snapshotAt: 0,
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

describe('dog geometry and real task poses without a GPU', () => {
  it('has four paws, short muzzle, drooping ears and a tail, and preserves selection identity', () => {
    const { s, a } = fixture(), r = rendererHarness(s), v = r.makeAnimal(a); r.animalVisuals.set(a.id, v); r.scene.add(v.root); r.animateAnimals(0);
    expect(v.legs).toHaveLength(4); expect(v.head.getObjectByName('labrador-muzzle')).toBeDefined();
    expect(v.head.getObjectByName('labrador-left-ear').position.y).toBeLessThan(0);
    expect(v.tail.name).toBe('labrador-tail'); expect(v.antlers.visible).toBe(false);
    r.ray.set(new Vector3(a.x + 3, a.z + .64, a.y + .85), new Vector3(-1, 0, 0));
    expect(r.inspect(1, 1)).toMatchObject({ animalId: a.id });
    expect(v.cargoModels['carcass:labrador'].children).toHaveLength(10); dispose(r);
  });
  it('renders actual cargo and clears stale models, including carcasses and limited visible eggs', () => {
    const { s, a } = fixture(), r = rendererHarness(s), v = r.makeAnimal(a); r.animalVisuals.set(a.id, v);
    a.cargo = { resource: 'wood', amount: 7 }; r.animateAnimals(0); expect(v.cargo.visible).toBe(true);
    expect(v.root.userData.cargo).toEqual(a.cargo);
    a.cargo = { resource: 'carcass', amount: 1, carcass: { animalId: 1200, species: 'labrador' } }; r.animateAnimals(0);
    expect(v.cargo.visible).toBe(false); expect(v.cargoModels['carcass:labrador'].visible).toBe(true);
    a.cargo = { resource: 'eggUnfertilized', amount: 2 }; r.animateAnimals(0);
    expect(v.cargoModels['carcass:labrador'].visible).toBe(false);
    expect(v.cargoModels.eggUnfertilized.children.map((e: any) => e.visible)).toEqual([true, true, false]);
    a.work = null; r.animateAnimals(0); expect(v.cargoModels.eggUnfertilized.visible).toBe(true);
    a.cargo = null; r.animateAnimals(0); expect(Object.values(v.cargoModels).every((m: any) => !m.visible)).toBe(true);
    expect(v.root.userData.cargo).toBeNull(); dispose(r);
  });
  it('drives both training poses from the actual adjacent work and resets on travel, cancellation or missing food', () => {
    const { s, a, p } = fixture(); a.training.wanted.obedience = true;
    Object.assign(p, { phase: 'animalTrain', cargo: { resource: 'grain', amount: 4, crop: 'rice' },
      animalTrainTask: { animalId: a.id, trainable: 'obedience', sourceId: null, resource: 'grain', amount: 4, stage: 'work', progress: 30 } });
    const r = rendererHarness(s), pv = r.makePawn(p), av = r.makeAnimal(a); r.pawnVisuals.set(p.id, pv); r.animalVisuals.set(a.id, av);
    const animate = () => { r.animatePawns(0); r.animateAnimals(0); };
    animate(); expect(pv.root.userData.animalTraining.animalId).toBe(a.id); expect(av.root.userData.animalTraining.trainerId).toBe(p.id);
    const pose = () => [pv.rightArm.rotation.x, av.head.rotation.x, av.tail.rotation.y]; const first = pose();
    s.tick += 100; animate(); expect(pose()).toEqual(first);
    p.animalTrainTask!.progress = 60; p.animalTrainTask!.amount = 2; p.cargo!.amount = 2; animate(); expect(pose()).not.toEqual(first);
    pv.from.x -= 1; pv.duration = 1000; pv.start = 0; animate();
    expect(pv.root.userData.animalTraining).toBeNull(); expect(av.root.userData.animalTraining).toBeNull();
    pv.duration = 0;
    p.animalTrainTask!.stage = 'approach'; animate(); expect(pv.root.userData.animalTraining).toBeNull(); expect(av.root.userData.animalTraining).toBeNull();
    p.animalTrainTask!.stage = 'work'; p.cargo = null; animate(); expect(pv.root.userData.animalTraining).toBeNull();
    delete p.animalTrainTask; p.phase = 'idle'; animate(); expect(av.tail.rotation.y).toBe(0); dispose(r);
  });
  it('attaches the single existing rescued pawn after dog interpolation and drops at its real cell', () => {
    const { s, a, p } = fixture(); p.downed = true; p.carriedBy = a.id; p.sleepBedId = null;
    a.work = { kind: 'rescue', patientId: p.id, bedId: 700, stage: 'carry' }; a.phase = 'rescue';
    const r = rendererHarness(s), pv = r.makePawn(p), av = r.makeAnimal(a); r.pawnVisuals.set(p.id, pv); r.animalVisuals.set(a.id, av);
    r.scene.add(pv.root, av.root); av.from.set(12.5, 8, 12.5); av.to.set(13.5, 8, 12.5); av.start = 0; av.duration = 1000;
    r.animatePawns(500); r.animateAnimals(500);
    expect(pv.root.position.toArray()).toEqual([13, 8, 12.5]); expect(pv.root.userData.animalCarrier).toBe(a.id);
    expect(r.pawnVisuals.size).toBe(1); expect(pv.shadow.visible).toBe(false);
    p.carriedBy = null; p.x = 15; p.y = 12; pv.from.set(15.5, 8, 12.5); pv.to.copy(pv.from); pv.duration = 0; a.work = null;
    r.animatePawns(1000); r.animateAnimals(1000);
    expect(pv.root.position.toArray()).toEqual([15.5, 8, 12.5]); expect(pv.root.userData.animalCarrier).toBeNull(); dispose(r);
  });
  it('never attaches a patient using a stale or wrong carrier reference', () => {
    const { s, a, p } = fixture(); p.downed = true; p.carriedBy = a.id + 1; p.sleepBedId = null;
    a.work = { kind: 'rescue', patientId: p.id, bedId: 700, stage: 'carry' };
    const r = rendererHarness(s), pv = r.makePawn(p), av = r.makeAnimal(a); r.pawnVisuals.set(p.id, pv); r.animalVisuals.set(a.id, av);
    r.animatePawns(0); const before = pv.root.position.clone(); r.animateAnimals(0);
    expect(pv.root.position.equals(before)).toBe(true); expect(pv.root.userData.animalCarrier).toBeNull(); dispose(r);
  });
});
