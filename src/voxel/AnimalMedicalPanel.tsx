import { DAY, RESOURCE_NAMES, type Pawn, type Pos, type Tool, type VoxelSnapshot, type WildAnimal } from './types';
import { ANIMAL_MEDICAL_RULES, ANIMAL_PART_NAMES, animalMedicalSummary, animalNeedsHospital, type AnimalBed } from './animalMedical';
import { MEDICAL_POLICIES, MEDICAL_POLICY_NAMES, type MedicalPolicy } from './medicine';
import { healthSummary } from './survival';
import type { PenCommand } from './PenPanel';

const percent = (value: number) => `${(value * 100).toFixed(1)}%`;
const woundNames = { cut: '割伤', bruise: '挫伤', burn: '烧伤' };
const actionNames = { rescue: '救助搬运', tend: '护理伤口', feed: '喂食患者' };
const same = (a: Pos, b: Pos) => a.x === b.x && a.y === b.y && a.z === b.z;
const available = (p: Pawn, tick: number) => p.faction === 'colony' && !p.dead && !p.downed && !p.drafted &&
  p.carriedBy === null && p.carryingPawnId === null && p.psyche.breakUntil <= tick &&
  healthSummary(p).manipulation > 0 && healthSummary(p).moving > .15;
const freeBeds = (s: VoxelSnapshot, patient?: WildAnimal) => s.animalBeds.filter(b => !s.fires.some(f => same(f, b)) &&
  !s.animals.some(a => a !== patient && !a.dead && (a.medical.bedId === b.id || same(a, b))) &&
  !s.pawns.some(p => p.animalCareTask?.animalId !== patient?.id && p.animalCareTask?.bedId === b.id));

/** Snapshot state only: these indicators never advance treatment or healing. */
export function AnimalMedicalFacts({ animal: a }: { animal: WildAnimal }) {
  const summary = animalMedicalSummary(a), m = a.medical;
  return <div className="voxel-animal-medical-facts" data-testid="animal-medical-facts" data-downed={m.downed} data-carried-by={m.carriedBy ?? 'none'}>
    <b>{a.dead ? '已死亡' : m.carriedBy !== null ? '正在被搬运' : m.downed ? '倒地，无法自行行动' : a.phase === 'medicalRest' ? '医疗休养中' : summary.injured ? '受伤' : '无可见伤势'}</b>
    <small>疼痛 {percent(summary.pain)} · 移动能力 {percent(summary.moving)}</small>
    <small>失血 {percent(m.bloodLoss)} · 失血速度 {percent(summary.bleeding)} / 日</small>
    {summary.needsTending && <small className="voxel-pen-warning">有未护理伤口{summary.bleeding > 0 ? '，仍在出血' : ''}</small>}
    {m.bedId !== null && <small>已安排医疗睡眠点 #{m.bedId}</small>}
  </div>;
}

export function AnimalCareStatus({ animal: a, snapshot: s }: { animal: WildAnimal; snapshot: VoxelSnapshot }) {
  const worker = s.pawns.find(p => p.animalCareTask?.animalId === a.id), task = worker?.animalCareTask;
  if (!worker || !task) return null;
  const phase = task.stage === 'fetch' ? task.action === 'feed' ? '前往取食物' : '前往取草药'
    : task.stage === 'approach' ? '前往患者身边' : task.stage === 'carry' ? '抱往动物医疗睡眠点' : actionNames[task.action];
  return <div className="voxel-animal-care-status" data-testid="animal-care-status" data-worker-id={worker.id} data-stage={task.stage}>
    <b>{worker.name} · {phase}</b>
    {worker.cargo && <small>实际携带 {RESOURCE_NAMES[worker.cargo.resource]} × {worker.cargo.amount}</small>}
    {task.bedId !== null && <small>目的地：动物医疗睡眠点 #{task.bedId}</small>}
    {task.stage === 'work' && task.action !== 'rescue' && <label>{actionNames[task.action]}进度
      <progress aria-label="动物医疗工作进度" value={task.progress} max={task.action === 'feed' ? ANIMAL_MEDICAL_RULES.feedWork : ANIMAL_MEDICAL_RULES.work} />
    </label>}
    <small>{worker.reason}</small>
  </div>;
}

export function AnimalCareActions({ animal: a, snapshot: s, command }: { animal: WildAnimal; snapshot: VoxelSnapshot; command: PenCommand }) {
  if (a.dead) return null;
  const summary = animalMedicalSummary(a), workers = s.pawns.filter(p => available(p, s.tick) && (p.priorities.care > 0 || p.priorities.handle > 0));
  const beds = freeBeds(s, a).length, onBed = s.animalBeds.some(b => b.id === a.medical.bedId && same(a, b));
  const intentReason = a.hunt ? '请先取消狩猎标记' : a.slaughter ? '请先取消待宰标记' : a.releaseMarked ? '请先取消放归标记' : '';
  const rescueReason = intentReason || (a.medical.carriedBy !== null ? '正在被搬运' : !a.medical.downed ? '只有倒地动物需要搬运救助' : onBed ? '已经在医疗睡眠点' : beds === 0 ? '没有空闲动物医疗睡眠点' : '');
  const tendReason = intentReason || (a.medical.policy === 'none' ? '护理政策为不接受护理' : !summary.needsTending ? '没有未护理伤口' : a.medical.carriedBy !== null ? '等待搬运完成' : '');
  const feedReason = intentReason || (!onBed ? '患者需要先在医疗睡眠点休养' : a.hunger >= 45 ? '饱食尚未低于 45%' : a.medical.carriedBy !== null ? '等待搬运完成' : '');
  return <details className="voxel-animal-care-actions"><summary>指定护理人员</summary>
    {!workers.length && <small>没有能行动且开启「医护」或「饲养」分工的殖民者。</small>}
    {rescueReason && <small>搬运：{rescueReason}</small>}{tendReason && <small>护理：{tendReason}</small>}{feedReason && <small>喂食：{feedReason}</small>}
    {workers.map(p => <div className="voxel-animal-care-worker" key={p.id}>
      <b>{p.name} · 医疗 {p.skills.medicine.level} 级</b>
      <div><button aria-label={`${p.name} 救助动物 #${a.id}`} title={rescueReason || '将倒地动物搬到可达的空闲医疗睡眠点'} disabled={!!rescueReason}
        onClick={() => void command({ type: 'animalCare', pawnId: p.id, animalId: a.id, action: 'rescue' })}>搬运救助</button>
      <button aria-label={`${p.name} 护理动物 #${a.id}`} title={p.priorities.care === 0 ? '请先开启医护分工' : tendReason || '前往取药或徒手护理'} disabled={p.priorities.care === 0 || !!tendReason}
        onClick={() => void command({ type: 'animalCare', pawnId: p.id, animalId: a.id, action: 'tend' })}>护理伤口</button>
      <button aria-label={`${p.name} 喂食动物 #${a.id}`} title={feedReason || '取食物并喂给休养中的患者'} disabled={!!feedReason}
        onClick={() => void command({ type: 'animalCare', pawnId: p.id, animalId: a.id, action: 'feed' })}>喂食患者</button></div>
      {p.priorities.care === 0 && <small>仅开启饲养，可搬运与喂食；护理伤口需开启医护。</small>}
    </div>)}
    <small>执行前还会检查通路、活动范围、药物和食物；指定操作成功后开始实际工作。</small>
  </details>;
}

export function AnimalMedicalDetails({ animal: a, snapshot: s, command }: { animal: WildAnimal; snapshot: VoxelSnapshot; command: PenCommand }) {
  if (a.dead) return null;
  return <section className="voxel-animal-medical" data-testid="animal-medical-details">
    <h3>动物医疗</h3><AnimalMedicalFacts animal={a} /><AnimalCareStatus animal={a} snapshot={s} />
    <label>护理政策<select aria-label={`动物 #${a.id} 护理政策`} value={a.medical.policy}
      onChange={e => void command({ type: 'animalMedicalPolicy', animalId: a.id, policy: e.target.value as MedicalPolicy })}>
      {MEDICAL_POLICIES.map(policy => <option key={policy} value={policy}>{MEDICAL_POLICY_NAMES[policy]}</option>)}
    </select></label>
    {a.faction !== 'colony' && <>
      <button aria-label={`${a.medical.rescue ? '取消' : '标记'}救助动物 #${a.id}`} aria-pressed={a.medical.rescue}
        onClick={() => void command({ type: 'animalRescue', animalId: a.id, enabled: !a.medical.rescue })}>{a.medical.rescue ? '取消救助护理' : '标记救助护理'}</button>
      <small>救助不改变{a.faction === 'trader' ? '商队' : '野生'}归属，也不会直接治愈或驯服。标记后可自动安排；也可直接指定人员。取消会中断救助，保留当前位置和已取药食。</small>
    </>}
    <details open={a.medical.wounds.length > 0}><summary>伤口 · {a.medical.wounds.length} 处</summary>
      {!a.medical.wounds.length && <small>没有已记录的伤口。</small>}
      {a.medical.wounds.map(w => <div key={w.id} data-wound-id={w.id}>
        <b>{ANIMAL_PART_NAMES[w.part]} · {woundNames[w.kind]}</b>
        <small>损伤 {w.severity.toFixed(2)} · 已持续 {(w.ageTicks / DAY).toFixed(2)} 日</small>
        <small>{w.tended === null ? '未护理' : `已护理 · 质量 ${percent(w.tended)}`}</small>
      </div>)}
    </details>
    <AnimalCareActions animal={a} snapshot={s} command={command} />
    <small>护理伤口使用「医护」分工；搬运与喂食可使用「医护」或「饲养」。护理止血后仍需逐渐恢复，睡眠点有助休养。「不接受护理」只禁止伤口护理，不禁止搬运和喂食。</small>
  </section>;
}

export function AnimalBedDetails({ bed, snapshot: s, command, focus }: { bed: AnimalBed; snapshot: VoxelSnapshot; command: PenCommand; focus: (pos: Pos) => void }) {
  const patient = s.animals.find(a => !a.dead && a.medical.bedId === bed.id);
  const worker = s.pawns.find(p => p.animalCareTask?.bedId === bed.id);
  return <section className="voxel-animal-bed" data-testid="animal-bed-details" data-bed-id={bed.id}>
    <b>动物医疗睡眠点 #{bed.id}</b><small>位置 {bed.x}, {bed.y} · 第 {bed.z} 层</small>
    <small>{patient ? `${same(patient, bed) ? '患者' : '已预约患者'}：${patient.name} #${patient.id}` : worker ? `已预约：${worker.name}正在搬运患者` : s.animals.some(a => !a.dead && same(a, bed)) ? '动物正在占用此位置' : '空闲，等待动物患者'}</small>
    {patient && <button onClick={() => focus(patient)}>查看患者 #{patient.id}</button>}
    <button aria-label={`定位动物医疗睡眠点 #${bed.id}`} onClick={() => focus({ ...bed, animalBedId: bed.id } as Pos)}>定位睡眠点</button>
    <button aria-label={`移除动物医疗睡眠点 #${bed.id}`} onClick={() => void command({ type: 'animalBedRemove', bedId: bed.id })}>移除睡眠点</button>
    <small>零建材、一格医疗睡眠点。移除不会删除患者；先保留安全地面与护理通路。</small>
  </section>;
}

export function AnimalMedicalPanel({ snapshot: s, command, choose, focus, selectAnimal }: {
  snapshot: VoxelSnapshot; command: PenCommand; choose: (tool: Tool) => void; focus: (pos: Pos) => void; selectAnimal: (animal: WildAnimal) => void;
}) {
  const patients = s.animals.filter(animalNeedsHospital);
  return <div className="voxel-animal-medical-panel" data-testid="animal-medical-panel">
    <p>动物患者 {patients.length} 只 · 空闲医疗睡眠点 {freeBeds(s).length} / {s.animalBeds.length}</p>
    <button onClick={() => choose('animalBed')}>放置动物医疗睡眠点</button>
    <small>在可达地面画格即可放置，不消耗建材。治疗需医护分工；野生或商队患者需要标记救助，或直接指定人员开始本次救助。</small>
    {patients.map(a => <section key={a.id}><button onClick={() => selectAnimal(a)}>{a.name} #{a.id} · 查看患者</button>
      <AnimalMedicalFacts animal={a} /><AnimalCareStatus animal={a} snapshot={s} />
    </section>)}
    <h3>动物医疗睡眠点</h3>
    {!s.animalBeds.length && <small>尚未放置睡眠点，倒地动物仍可在原地接受伤口护理。</small>}
    {s.animalBeds.map(bed => <AnimalBedDetails key={bed.id} bed={bed} snapshot={s} command={command} focus={focus} />)}
  </div>;
}
