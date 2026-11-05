import { DAY, RESOURCE_NAMES, type Pawn, type VoxelCommand, type VoxelSnapshot, type WildAnimal } from './types';
import { ANIMAL_HUSBANDRY } from './husbandry';
import { animalNeedsHospital } from './animalMedical';
import { animalEnvironmentEffects } from './animalEnvironment';
import {
  ANIMAL_TRAINING_RULES, TRAINABLES, TRAINABLE_NAMES, TRAINING_STEPS, TRAINING_PREREQUISITES,
  animalTrainable, animalSkillAvailable, animalBodySize, animalMasterEligible, type Trainable,
} from './animalTraining';

type Command = (command: VoxelCommand) => void;

export function LabradorPortrait() {
  return <svg className="voxel-animal-portrait" viewBox="0 0 88 68" role="img" aria-label="拉布拉多犬肖像">
    <rect x="1" y="1" width="86" height="66" rx="5" fill="#243434" />
    <path d="m22 34-12-9-3 5 14 13v17h7l3-14h20l3 14h7l-1-21 6-9-2-13-14-2-7 16Z" fill="#d4ad68" />
    <path d="m60 25 18 5-1 8-15 2-8-11Z" fill="#e8c993" />
    <path d="m49 19 10 1-3 23-8-4Z" fill="#a87d45" />
    <circle cx="65" cy="27" r="2" fill="#352e26" /><path d="m76 30 6 1-1 6-5 1Z" fill="#352e26" />
  </svg>;
}

/** Trade receipts render only the saved animal, never today's world or master. */
export function AnimalTrainingFacts({ animal: a }: { animal: WildAnimal }) {
  if (!animalTrainable(a.species)) return null;
  const learned = TRAINABLES.filter(skill => a.training.learned[skill]);
  return <div className="voxel-animal-training-facts" data-testid="animal-training-facts">
    <small>已掌握：{learned.length ? learned.map(skill => TRAINABLE_NAMES[skill]).join('、') : '尚无训练技能'}</small>
    {TRAINABLES.filter(skill => a.training.steps[skill] > 0).map(skill => <small key={skill}>
      {TRAINABLE_NAMES[skill]} {a.training.steps[skill]} / {TRAINING_STEPS[skill]}
      {a.training.learned[skill] && a.training.steps[skill] < TRAINING_STEPS[skill] ? ' · 已掌握，待巩固' : ''}
    </small>)}
  </div>;
}

function trainingReason(a: WildAnimal, skill: Trainable): string {
  if (a.training.steps[skill] === TRAINING_STEPS[skill]) return '已完成；保留训练安排可在遗忘后补训';
  if (a.tameness < 1) return '需要先恢复温顺';
  if (skill === 'rescue' && animalBodySize(a) < ANIMAL_TRAINING_RULES.rescueBodySize ||
      skill === 'haul' && animalBodySize(a) < ANIMAL_TRAINING_RULES.haulBodySize) return '体型尚小，成长后才能训练';
  const prerequisite = TRAINING_PREREQUISITES[skill];
  if (prerequisite && (!a.training.learned[prerequisite] || a.training.steps[prerequisite] < TRAINING_STEPS[prerequisite]))
    return `先完成${TRAINABLE_NAMES[prerequisite]}训练；勾选时会一并安排`;
  return a.training.learned[skill] ? '仍可使用，等待补训巩固' : a.training.wanted[skill] ? '已安排，等待饲养员训练' : '尚未安排训练';
}

export function AnimalCooperationStatus({ animal: a, snapshot: s }: { animal: WildAnimal; snapshot: VoxelSnapshot }) {
  if (!animalTrainable(a.species) || a.dead || a.faction !== 'colony') return null;
  const trainer = s.pawns.find(p => !p.dead && !p.downed && !p.drafted && p.phase === 'animalTrain' && p.animalTrainTask?.animalId === a.id);
  const task = trainer?.animalTrainTask;
  const work = a.work;
  const person = (id: number) => s.pawns.find(p => p.id === id)?.name ?? `居民 #${id}`;
  return <div className="voxel-animal-cooperation-status" data-testid="animal-cooperation-status" data-animal-id={a.id}>
    {task && trainer && <div data-testid="animal-training-task" data-trainer-id={trainer.id} data-stage={task.stage}>
      <b>{trainer.name} · 训练{TRAINABLE_NAMES[task.trainable]} · {task.stage === 'fetch' ? '取训练食物' : task.stage === 'approach' ? '接近动物' : '训练互动'}</b>
      <small>{RESOURCE_NAMES[task.resource]} × {task.amount} · {trainer.reason}</small>
      {task.stage === 'work' && <label>本次互动<progress aria-label="本次动物训练进度" max={ANIMAL_TRAINING_RULES.work} value={task.progress} /></label>}
    </div>}
    {work && <small data-testid="animal-work" data-kind={work.kind}>
      {work.kind === 'follow' ? `跟随 ${person(work.masterId)}` : work.kind === 'attack' ? `协同攻击 ${person(work.targetId)}`
        : work.kind === 'rescue' ? `${work.stage === 'carry' ? '正送往床位' : '前往救援'} · ${person(work.patientId)}`
          : `${work.stage === 'fetch' ? '前往取货' : '送往仓储'} · ${RESOURCE_NAMES[work.resource]} × ${work.amount}`}
    </small>}
    {a.cargo && <small data-testid="animal-cargo">实际携带：{RESOURCE_NAMES[a.cargo.resource]} × {a.cargo.amount}{!work ? ' · 等待放下' : ''}</small>}
    {!task && a.nextInteractionTick > s.tick && TRAINABLES.some(skill => a.training.wanted[skill] && a.training.steps[skill] < TRAINING_STEPS[skill]) &&
      <small>下次可训练：约 {Math.ceil((a.nextInteractionTick - s.tick) / DAY * 24 * 60)} 游戏分钟后</small>}
  </div>;
}

export function AnimalTrainingDetails({ animal: a, snapshot: s, command }: { animal: WildAnimal; snapshot: VoxelSnapshot; command: Command }) {
  if (!animalTrainable(a.species)) return null;
  if (a.dead || a.faction !== 'colony') return <AnimalTrainingFacts animal={a} />;
  const masters = s.pawns.filter(p => animalMasterEligible(p, a));
  const master = masters.find(p => p.id === a.training.masterId);
  const obedient = animalSkillAvailable(a, 'obedience');
  const handlers = s.pawns.filter(p => p.faction === 'colony' && !p.dead && p.priorities.handle > 0 && p.skills.animals.level >= ANIMAL_HUSBANDRY[a.species].minSkill);
  return <section className="voxel-animal-training" data-testid="animal-training-details" data-animal-id={a.id}>
    <h3>训练与协作</h3>
    <small>安排后由饲养员携食物前来尝试，每次成功推进一步。已掌握的技能会逐步遗忘，可保留安排持续补训。</small>
    <small>训练会在互动途中和结束时各喂一次，失败也会消耗食物；取消时保留尚未吃掉的部分。</small>
    {TRAINABLES.map(skill => <div className="voxel-animal-training-skill" key={skill} data-trainable={skill}>
      <label><input type="checkbox" aria-label={`${a.name} 训练${TRAINABLE_NAMES[skill]}`} checked={a.training.wanted[skill]}
        onChange={e => command({ type: 'animalTraining', animalId: a.id, trainable: skill, wanted: e.target.checked })} />
        {TRAINABLE_NAMES[skill]} · {a.training.steps[skill]} / {TRAINING_STEPS[skill]}{a.training.learned[skill] ? ' · 已掌握' : ''}</label>
      <small>{trainingReason(a, skill)}</small>
    </div>)}
    {!handlers.length && <small>需要开启殖民者的饲养分工，并满足动物技能要求。</small>}
    <label>主人<select aria-label={`${a.name} 主人`} value={a.training.masterId ?? ''} disabled={!obedient && a.training.masterId === null}
      onChange={e => command({ type: 'animalMaster', animalId: a.id, pawnId: e.target.value === '' ? null : Number(e.target.value) })}>
      <option value="">未指派</option>
      {a.training.masterId !== null && !master && <option value={a.training.masterId}>原主人不可用</option>}
      {masters.map(p => <option key={p.id} value={p.id} disabled={!obedient}>{p.name}{p.downed ? ' · 倒地' : ''}</option>)}
    </select></label>
    {!obedient && <small>首次学会服从时自动指派训练者为主人，之后可改派主人和设置跟随。</small>}
    {(['drafted', 'fieldwork'] as const).map(when => <label key={when}>
      <input type="checkbox" aria-label={`${a.name} ${when === 'drafted' ? '征召时跟随' : '野外工作时跟随'}`}
        disabled={(!obedient || !master) && !(when === 'drafted' ? a.training.followDrafted : a.training.followFieldwork)}
        checked={when === 'drafted' ? a.training.followDrafted : a.training.followFieldwork}
        onChange={e => command({ type: 'animalFollow', animalId: a.id, when, enabled: e.target.checked })} />
      {when === 'drafted' ? '主人征召时跟随' : '主人野外工作时跟随'}
    </label>)}
    <small>学会救援、搬运后会自行寻找合适任务；主人征召后的“释放攻击”可扩大跟随和协同防御范围。</small>
    <AnimalCooperationStatus animal={a} snapshot={s} />
    <small>{a.reason}</small>
  </section>;
}

export function AnimalTrainingPanel({ snapshot: s, command, selectAnimal }: { snapshot: VoxelSnapshot; command: Command; selectAnimal: (a: WildAnimal) => void }) {
  const animals = s.animals.filter(a => !a.dead && a.faction === 'colony' && animalTrainable(a.species));
  return <div className="voxel-animal-training-panel" data-testid="animal-training-panel">
    <p>从商队购入拉布拉多犬，安排饲养员训练服从，再训练释放攻击、救援或搬运。</p>
    {!animals.length && <small>目前没有可训练的殖民地犬。</small>}
    {animals.map(a => <div key={a.id}><button onClick={() => selectAnimal(a)}>查看 {a.name}</button><AnimalTrainingDetails animal={a} snapshot={s} command={command} /></div>)}
  </div>;
}

export function AnimalsReleaseControl({ pawn: p, snapshot: s, command }: { pawn: Pawn; snapshot: VoxelSnapshot; command: Command }) {
  if (p.faction !== 'colony' || p.dead || p.downed || p.carriedBy !== null || !p.drafted) return null;
  const assigned = s.animals.filter(a => !a.dead && a.faction === 'colony' && a.training.masterId === p.id);
  if (!assigned.length && !p.animalsReleased) return null;
  const ready = assigned.filter(a => a.training.followDrafted && animalSkillAvailable(a, 'obedience') && animalSkillAvailable(a, 'release') &&
    !a.medical.downed && a.medical.carriedBy === null && !animalNeedsHospital(a) && !animalEnvironmentEffects(a).ill &&
    !a.hunt && !a.slaughter && !a.releaseMarked && a.tameness > 0);
  return <div className="voxel-animals-release" data-testid="animals-release-control">
    <button aria-pressed={p.animalsReleased} disabled={p.psyche.breakUntil > s.tick || !p.animalsReleased && !ready.length}
      onClick={() => command({ type: 'animalsRelease', pawnId: p.id, enabled: !p.animalsReleased })}>
      {p.animalsReleased ? '收拢动物' : '释放攻击'}
    </button>
    <small>{ready.length} 只可行动、已学会释放攻击且开启征召跟随的动物。</small>
    <small>释放后扩大主人附近的跟随和协同防御范围，动物自行选择威胁；收拢后恢复近身跟随。</small>
  </div>;
}

export function AnimalRescueStatus({ pawn, snapshot: s }: { pawn: Pawn; snapshot: VoxelSnapshot }) {
  const carrier = s.animals.find(a => !a.dead && a.id === pawn.carriedBy && a.work?.kind === 'rescue' && a.work.stage === 'carry' && a.work.patientId === pawn.id);
  return carrier ? <small data-testid="animal-rescue-patient">{carrier.name} 正在把 {pawn.name} 送往床位。</small> : null;
}
