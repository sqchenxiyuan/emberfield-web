import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { BoxGeometry, Color, Euler, Matrix4, Quaternion, Raycaster, Scene, Vector3 } from 'three';
import { AnimalDetails } from '../src/voxel/AnimalPanel';
import { AnimalBedDetails, AnimalCareActions, AnimalCareStatus, AnimalMedicalDetails, AnimalMedicalFacts, AnimalMedicalPanel } from '../src/voxel/AnimalMedicalPanel';
import { ANIMAL_MEDICAL_RULES, initialAnimalMedical, type AnimalBed } from '../src/voxel/animalMedical';
import { initialAnimalState } from '../src/voxel/husbandry';
import { freshBatch } from '../src/voxel/preservation';
import { makeFire } from '../src/voxel/fire';
import { VoxelRenderer } from '../src/voxel/renderer';
import { VoxelSimulation } from '../src/voxel/world';
import { DAY, at, type VoxelCommand, type VoxelSnapshot, type WildAnimal } from '../src/voxel/types';

let initial: VoxelSnapshot;
beforeAll(() => { initial = new VoxelSimulation(73129, { hilliness: 'flat' }, false, 2).snapshot(); });
afterEach(() => vi.unstubAllGlobals());
const controls = { selectedPenId: null, selectedAreaId: null, editingArea: false, showPen: () => {}, showArea: () => {}, editArea: () => {} };
const makeBed = (): AnimalBed => ({ id: 700, x: 12, y: 12, z: 8 });
function patient(extra: Partial<WildAnimal> = {}): WildAnimal {
  return { ...initialAnimalState(101, 'alpaca', 0), id: 101, species: 'alpaca', name: '羊驼', x: 12, y: 12, z: 8,
    faction: 'colony', sex: 'female', ageTicks: DAY * 5, growth: 1, health: 60, hunger: 35, dead: false,
    hunt: false, phase: 'roam', moveTick: 0, decisionTick: 0, fleeUntil: 0, threatId: null, retryTick: 0, rotProgress: 0,
    medical: { ...initialAnimalMedical(), bloodLoss: .2, nextWoundId: 2,
      wounds: [{ id: 1, part: 'frontLeft', kind: 'cut', severity: 15, tended: null, ageTicks: DAY / 2 }] }, ...extra };
}
function snapshot(a = patient()): VoxelSnapshot {
  const s = structuredClone(initial); s.animals = [a]; s.animalBeds = [makeBed()]; s.speed = 0;
  s.pawns.forEach((p, i) => { p.priorities.care = i === 0 ? 2 : 0; p.priorities.handle = i === 1 ? 2 : 0;
    p.drafted = false; p.downed = false; p.dead = false; p.carriedBy = null; p.carryingPawnId = null; p.psyche.breakUntil = 0;
    p.phase = 'idle'; p.path = []; p.cargo = null; delete p.animalCareTask; });
  return s;
}
function elements(node: unknown): ReactElement<any>[] {
  if (!node || typeof node !== 'object') return [];
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!('props' in node)) return [];
  const element = node as ReactElement<any>;
  return [element, ...elements(element.props.children)];
}
const command = vi.fn<(c: VoxelCommand) => Promise<{ ok: boolean; message: string }>>(async () => ({ ok: true, message: 'ok' }));

describe('animal medical UI without a browser', () => {
  it('shows actual wounds, blood loss, pain, movement and tending quality separately from health', () => {
    const s = snapshot(), a = s.animals[0];
    const html = renderToStaticMarkup(<AnimalMedicalDetails animal={a} snapshot={s} command={command} />);
    expect(html).toContain('疼痛 30.0%'); expect(html).toContain('移动能力 75.0%');
    expect(html).toContain('失血 20.0%'); expect(html).toContain('失血速度 80.0% / 日');
    expect(html).toContain('左前肢 · 割伤'); expect(html).toContain('损伤 15.00'); expect(html).toContain('已持续 0.50 日');
    expect(html).toContain('有未护理伤口，仍在出血');
    a.medical.wounds[0].tended = .55;
    const tended = renderToStaticMarkup(<AnimalMedicalDetails animal={a} snapshot={s} command={command} />);
    expect(tended).toContain('已护理 · 质量 55.0%'); expect(tended).toContain('失血速度 0.0% / 日');
    expect(a.health).toBe(60);
  });
  it('dispatches policy and foreign rescue changes without altering ownership or curing the animal', () => {
    const s = snapshot(patient({ faction: 'trader' })), a = s.animals[0], before = structuredClone(a);
    const tree = () => elements(AnimalMedicalDetails({ animal: a, snapshot: s, command }));
    tree().find(e => e.type === 'select')!.props.onChange({ target: { value: 'noMedicine' } });
    expect(command).toHaveBeenLastCalledWith({ type: 'animalMedicalPolicy', animalId: a.id, policy: 'noMedicine' });
    tree().find(e => e.props['aria-label'] === '标记救助动物 #101')!.props.onClick();
    expect(command).toHaveBeenLastCalledWith({ type: 'animalRescue', animalId: 101, enabled: true });
    expect(a).toEqual(before);
    a.medical.rescue = true;
    tree().find(e => e.props['aria-label'] === '取消救助动物 #101')!.props.onClick();
    expect(command).toHaveBeenLastCalledWith({ type: 'animalRescue', animalId: 101, enabled: false });
    const html = renderToStaticMarkup(<AnimalDetails animal={a} snapshot={s} command={command} focus={() => {}} penControls={controls} />);
    expect(html).toContain('商队动物'); expect(html).toContain('救助不改变商队归属');
    expect(html).not.toContain('aria-label="标记待宰此动物"'); expect(html).not.toContain('aria-label="标记驯服此动物"');
  });
  it('separates doctor tending from handler rescue/feed and explains unavailable actions', () => {
    const s = snapshot(), a = s.animals[0], doctor = s.pawns[0], handler = s.pawns[1];
    const buttons = () => elements(AnimalCareActions({ animal: a, snapshot: s, command }));
    const button = (name: string, action: string) => buttons().find(e => e.props['aria-label'] === `${name} ${action}动物 #101`)!.props;
    expect(button(handler.name, '护理').disabled).toBe(true); expect(button(doctor.name, '护理').disabled).toBe(false);
    button(doctor.name, '护理').onClick(); expect(command).toHaveBeenLastCalledWith({ type: 'animalCare', pawnId: doctor.id, animalId: 101, action: 'tend' });
    expect(button(handler.name, '救助').disabled).toBe(true);
    a.medical.downed = true; a.medical.bloodLoss = .65; a.medical.policy = 'none';
    expect(button(doctor.name, '护理').disabled).toBe(true); expect(button(handler.name, '救助').disabled).toBe(false);
    button(handler.name, '救助').onClick(); expect(command).toHaveBeenLastCalledWith({ type: 'animalCare', pawnId: handler.id, animalId: 101, action: 'rescue' });
    a.medical.bedId = 700; a.phase = 'medicalRest';
    a.x = 13;
    expect(button(handler.name, '救助').disabled).toBe(false); expect(button(handler.name, '喂食').disabled).toBe(true);
    a.x = 12;
    expect(button(handler.name, '救助').disabled).toBe(true); expect(button(handler.name, '喂食').disabled).toBe(false);
    button(handler.name, '喂食').onClick(); expect(command).toHaveBeenLastCalledWith({ type: 'animalCare', pawnId: handler.id, animalId: 101, action: 'feed' });
    a.hunger = 60; expect(button(handler.name, '喂食').title).toContain('饱食尚未低于');
    a.medical.bedId = null; s.animalBeds = [];
    expect(button(handler.name, '救助').title).toContain('没有空闲动物医疗睡眠点');
  });
  it('shows fetch, approach, carrying and real work progress with actual held resources', () => {
    const s = snapshot(), a = s.animals[0], p = s.pawns[0];
    p.animalCareTask = { animalId: a.id, action: 'tend', stage: 'fetch', bedId: null, sourceId: 800, amount: 1, progress: 0 };
    const html = () => renderToStaticMarkup(<AnimalCareStatus animal={a} snapshot={s} />);
    expect(html()).toContain('前往取草药'); expect(html()).not.toContain('<progress');
    p.animalCareTask.stage = 'approach'; p.cargo = freshBatch('herb', 1);
    expect(html()).toContain('前往患者身边'); expect(html()).toContain('实际携带 草药 × 1');
    p.animalCareTask.stage = 'work'; p.animalCareTask.progress = 37;
    expect(html()).toContain(`aria-label="动物医疗工作进度" value="37" max="${ANIMAL_MEDICAL_RULES.work}"`);
    p.animalCareTask.action = 'feed'; expect(html()).toContain(`max="${ANIMAL_MEDICAL_RULES.feedWork}"`);
    p.animalCareTask.action = 'rescue'; p.animalCareTask.stage = 'carry'; p.animalCareTask.bedId = 700;
    expect(html()).toContain('抱往动物医疗睡眠点'); expect(html()).not.toContain('<progress');
  });
  it('lists available beds and patients, dispatching placement/removal/identity-specific focus', () => {
    const s = snapshot(), a = s.animals[0], bed = s.animalBeds[0], choose = vi.fn(), focus = vi.fn();
    a.x = 13;
    const panel = () => renderToStaticMarkup(<AnimalMedicalPanel snapshot={s} command={command} choose={choose} focus={focus} selectAnimal={() => {}} />);
    expect(panel()).toContain('动物患者 1 只'); expect(panel()).toContain('空闲医疗睡眠点 1 / 1');
    elements(AnimalMedicalPanel({ snapshot: s, command, choose, focus, selectAnimal: () => {} })).find(e => e.type === 'button')!.props.onClick();
    expect(choose).toHaveBeenCalledWith('animalBed');
    a.medical.bedId = bed.id;
    const tree = elements(AnimalBedDetails({ bed, snapshot: s, command, focus }));
    tree.find(e => e.props['aria-label'] === '定位动物医疗睡眠点 #700')!.props.onClick();
    expect(focus).toHaveBeenLastCalledWith({ ...bed, animalBedId: 700 });
    tree.find(e => e.props['aria-label'] === '移除动物医疗睡眠点 #700')!.props.onClick();
    expect(command).toHaveBeenLastCalledWith({ type: 'animalBedRemove', bedId: 700 });
    expect(panel()).toContain('空闲医疗睡眠点 0 / 1'); expect(panel()).toContain('已预约患者'); expect(s.animals).toHaveLength(1);
    a.medical.bedId = null; a.x = bed.x;
    expect(panel()).toContain('空闲医疗睡眠点 0 / 1'); expect(panel()).toContain('动物正在占用此位置');
    a.x = 13; s.fires.push(makeFire(701, bed, s.tick, 'spread'));
    expect(panel()).toContain('空闲医疗睡眠点 0 / 1');
  });
  it('distinguishes downed, carried and bed-rest patients without treating a rescue mark as healing', () => {
    const a = patient(); a.medical.downed = true; a.medical.bloodLoss = .65;
    const html = () => renderToStaticMarkup(<AnimalMedicalFacts animal={a} />);
    expect(html()).toContain('倒地，无法自行行动');
    a.medical.carriedBy = 23; expect(html()).toContain('正在被搬运');
    a.medical.carriedBy = null; a.medical.downed = false; a.phase = 'medicalRest'; a.medical.bedId = 700;
    expect(html()).toContain('医疗休养中'); expect(html()).toContain('已安排医疗睡眠点 #700');
    a.medical.bedId = null; expect(html()).toContain('医疗休养中'); expect(html()).not.toContain('医疗睡眠点 #');
    expect(a.medical.wounds).toHaveLength(1); expect(a.health).toBe(60);
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
describe('animal medical geometry without a GPU', () => {
  it('renders a ground-level one-cell medical spot and preserves its separate selection identity', () => {
    const s = snapshot(), bed = s.animalBeds[0], r = rendererHarness(s); s.pawns = []; s.animals = [];
    const parts = r.animalBedParts(bed);
    expect(parts).toHaveLength(7);
    expect(parts.every((p: any) => p.x - p.sx / 2 >= bed.x && p.x + p.sx / 2 <= bed.x + 1 &&
      p.y - p.sy / 2 >= bed.y && p.y + p.sy / 2 <= bed.y + 1 && p.z + p.sz / 2 < bed.z + .1)).toBe(true);
    r.updateAnimalBeds(); expect(r.batches.get('animal-medical-beds').mesh.count).toBe(7);
    r.ray.set(new Vector3(bed.x + .93, bed.z + 3, bed.y + .93), new Vector3(0, -1, 0));
    expect(r.inspect(1, 1)).toEqual({ x: bed.x, y: bed.y, z: bed.z, animalBedId: bed.id });
    s.animals = [patient()]; r.highlight({ ...bed, animalBedId: bed.id }); expect(r.selectedAnimalId).toBeNull();
    dispose(r);
  });
  it('lays a living downed animal on its actual cell and restores its posture after recovery', () => {
    const s = snapshot(), a = s.animals[0], r = rendererHarness(s); a.medical.downed = true; a.phase = 'downed';
    const v = r.makeAnimal(a); r.animalVisuals.set(a.id, v); v.from.x -= 4; v.duration = 1000;
    r.animateAnimals(0);
    expect(v.body.rotation.z).toBe(Math.PI / 2); expect(v.medicalMark.visible).toBe(true);
    expect(v.root.position.toArray()).toEqual([a.x + .5, a.z, a.y + .5]);
    expect(v.root.userData.animalMedical.downed).toBe(true); expect(a.dead).toBe(false);
    a.medical = initialAnimalMedical(); a.health = 75; a.phase = 'roam'; v.duration = 0; r.animateAnimals(1000);
    expect(v.body.rotation.z).toBe(0); expect(v.body.position.x).toBe(0); expect(v.medicalMark.visible).toBe(false);
    dispose(r);
  });
  it('keeps a mobile medical patient walking until its last step to the bed is rendered', () => {
    const s = snapshot(), a = s.animals[0], r = rendererHarness(s);
    a.phase = 'medicalRest'; a.medical.bedId = 700; a.path = [at(makeBed())];
    const v = r.makeAnimal(a); r.animalVisuals.set(a.id, v);
    v.from.set(10.5, 8, 12.5); v.to.set(11.5, 8, 12.5); v.start = 0; v.duration = 1000;
    r.animateAnimals(500);
    expect(v.root.position.toArray()).toEqual([11, 8, 12.5]); expect(v.body.rotation.z).toBe(0);
    expect(v.legs.every((l: any) => l.visible)).toBe(true);
    a.path = []; v.from.copy(v.to); v.to.set(12.5, 8, 12.5); v.start = 1000;
    r.animateAnimals(1500); expect(v.body.rotation.z).toBe(0); expect(v.root.position.x).toBe(12);
    r.animateAnimals(2000); expect(v.body.rotation.z).toBe(Math.PI / 2);
    expect(v.root.position.toArray()).toEqual([12.5, 8, 12.5]); dispose(r);
  });
  it('carries the existing animal visual with the actual worker and releases it at the real dropped cell', () => {
    const s = snapshot(), a = s.animals[0], p = s.pawns[0], r = rendererHarness(s);
    Object.assign(p, { x: 12, y: 13, z: 8, phase: 'animalCare', path: [at({ x: 13, y: 13, z: 8 })],
      animalCareTask: { animalId: a.id, action: 'rescue', stage: 'carry', bedId: 700, sourceId: null, amount: 0, progress: 0 } });
    a.medical.carriedBy = p.id; a.medical.downed = true; a.phase = 'carried';
    const pv = r.makePawn(p), av = r.makeAnimal(a); r.pawnVisuals.set(p.id, pv); r.animalVisuals.set(a.id, av); r.scene.add(pv.root, av.root);
    pv.from.set(12.5, 8, 13.5); pv.to.set(13.5, 8, 13.5); pv.start = 0; pv.duration = 1000;
    r.animatePawns(500); r.animateAnimals(500); pv.root.updateMatrixWorld(true);
    expect(av.root.position.distanceTo(pv.root.localToWorld(new Vector3(0, .85, .48)))).toBeLessThan(1e-9);
    expect(av.root.userData.animalMedical.carriedBy).toBe(p.id); expect(pv.root.userData.animalCare.stage).toBe('carry');
    expect(r.animalVisuals.size).toBe(1); expect(av.legs.every((l: any) => !l.visible)).toBe(true);
    a.medical.carriedBy = null; a.phase = 'downed'; a.x = 14; delete p.animalCareTask; p.phase = 'idle';
    r.animatePawns(1000); r.animateAnimals(1000);
    expect(av.root.position.toArray()).toEqual([14.5, 8, 12.5]); expect(av.root.userData.animalMedical.carriedBy).toBeNull();
    expect(pv.root.userData.animalCare).toBeNull(); dispose(r);
  });
  it('animates actual tending/feeding progress and clears work pose on approach, policy change or cancellation', () => {
    const s = snapshot(), a = s.animals[0], p = s.pawns[0], r = rendererHarness(s);
    Object.assign(p, { x: 11, y: 12, z: 8, phase: 'animalCare', path: [], cargo: freshBatch('herb', 1),
      animalCareTask: { animalId: a.id, action: 'tend', stage: 'work', bedId: null, sourceId: 800, amount: 1, progress: 30 } });
    const v = r.makePawn(p); r.pawnVisuals.set(p.id, v); r.animatePawns(0);
    const pose = () => [v.leftArm.rotation.x, v.rightArm.rotation.x, v.torso.rotation.x, v.head.rotation.x];
    const first = pose(); expect(v.root.userData.animalCare.progress).toBe(30);
    s.tick += 200; r.animatePawns(10000); expect(pose()).toEqual(first);
    p.animalCareTask!.progress = 60; r.animatePawns(10000); expect(pose()).not.toEqual(first);
    p.animalCareTask!.stage = 'approach'; r.animatePawns(10000); expect(v.root.userData.animalCare).toBeNull();
    p.animalCareTask!.stage = 'work'; a.medical.policy = 'none'; r.animatePawns(10000); expect(v.root.userData.animalCare).toBeNull();
    p.animalCareTask!.action = 'feed'; p.cargo = freshBatch('grain', 1); r.animatePawns(10000);
    expect(v.root.userData.animalCare.action).toBe('feed');
    delete p.animalCareTask; p.phase = 'idle'; r.animatePawns(10000); expect(v.root.userData.animalCare).toBeNull(); dispose(r);
  });
});
