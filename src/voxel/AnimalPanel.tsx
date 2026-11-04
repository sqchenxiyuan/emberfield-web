import { useState } from 'react';
import { DAY, type HandleTask, type Pawn, type Pos, type Tool, type VoxelSnapshot, type WildAnimal } from './types';
import { ANIMAL_DEFS, ANIMAL_PHASE_NAMES } from './wildlife';
import { ANIMAL_HUSBANDRY, HUSBANDRY_RULES, animalLifeStage } from './husbandry';
import { isRangedKind } from './ranged';
import { weaponName } from './weapons';
import { ItemCondition } from './ItemCondition';
import { AnimalPenControls, PenPanel, type PenCommand, type PenControls } from './PenPanel';
import { AutoSlaughterPanel } from './AutoSlaughterPanel';

type Command = PenCommand;
const availableHunters = (s: VoxelSnapshot) => s.pawns.filter(p => p.faction === 'colony' &&
  !p.dead && !p.downed && !p.drafted && p.psyche.breakUntil <= s.tick &&
  p.priorities.hunt > 0 && p.weapon && isRangedKind(p.weapon.kind));
const levelName = (z: number, base: number) => z === base ? '营地基准层' : z < base ? `基准层下 ${base - z}` : `基准层上 +${z - base}`;
const lifeNames = { baby: '幼崽', juvenile: '幼年', adult: '成年' };
const actionNames: Record<HandleTask['action'], string> = { tame: '尝试驯服', maintain: '维持温顺', feed: '喂食', slaughter: '手动宰杀', autoSlaughter: '自动宰杀', release: '放归' };
const stageNames: Record<HandleTask['stage'], string> = { fetch: '取食物', approach: '接近动物', interact: '本次互动' };
const percent = (value: number) => `${Math.round(value * 100)}%`;

function AnimalFacts({ animal: a }: { animal: WildAnimal }) {
  return <div className="voxel-animal-facts" data-testid="animal-facts" data-sex={a.sex}
    data-growth={a.growth} data-pregnancy={a.pregnancy?.progress ?? 'none'} data-faction={a.faction}>
    <small>{a.sex === 'male' ? '雄性' : '雌性'} · {lifeNames[animalLifeStage(a)]} · 日龄 {(a.ageTicks / DAY).toFixed(1)} 天</small>
    {!a.dead && <>
      <small>饱食 {Math.round(a.hunger)}%{a.malnutrition > 0 ? ` · 营养不良 ${percent(a.malnutrition)}` : ''}</small>
      {a.growth < 1 && <label>成长 {percent(a.growth)}<progress aria-label="动物成长" value={a.growth} max={1} /></label>}
      {a.pregnancy && <label>孕期 {percent(a.pregnancy.progress)}<progress aria-label="动物孕期" value={a.pregnancy.progress} max={1} /></label>}
      {a.faction === 'colony' && ANIMAL_HUSBANDRY[a.species].tamenessDecays && <small>温顺度 {a.tameness} / {HUSBANDRY_RULES.tamenessMax} · 需要定期照料</small>}
    </>}
  </div>;
}

function AnimalStatus({ animal: a, snapshot: s }: { animal: WildAnimal; snapshot: VoxelSnapshot }) {
  const handler = s.pawns.find(p => p.handleTask?.animalId === a.id), task = handler?.handleTask;
  const roper = s.pawns.find(p => p.ropeTask?.animalId === a.id), rope = roper?.ropeTask;
  const ropeStages = { approach: '接近动物', attach: '套绳', lead: '牵往圈地', detach: '解绳' };
  const hunter = s.pawns.find(p => p.phase === 'hunt' && p.attackTargetId === a.id);
  const autoSlaughter = !a.dead && s.autoSlaughterStatus.targets.includes(a.id);
  return <div className="voxel-animal-status" data-testid="animal-status" data-handler-id={roper?.id ?? handler?.id ?? 'none'} data-stage={rope?.stage ?? task?.stage ?? 'none'}>
    <p>{rope && roper ? `${roper.name} · ${ropeStages[rope.stage]} · ${s.penMarkers.find(p => p.id === rope.penId)?.name ?? '圈地'}` : task && handler ? `${handler.name} · ${actionNames[task.action]} · ${stageNames[task.stage]}` : hunter ? `${hunter.name} · ${hunter.reason}` : a.reason}</p>
    {rope && roper && <small>{roper.reason}</small>}
    {task && handler && <small>{handler.reason}</small>}
    {autoSlaughter && <small className="voxel-auto-slaughter-warning" data-testid="animal-auto-slaughter">自动待宰 · 超过已生效配额</small>}
    {!a.dead && a.slaughter && <small>手动待宰标记已开启</small>}
    {a.tame && !a.dead && <small>需要动物技能 {ANIMAL_HUSBANDRY[a.species].minSkill}；每次互动独立尝试，可能失败。</small>}
    {a.tame && !task && a.nextInteractionTick > s.tick && <small>下次可互动：约 {Math.max(1, Math.ceil((a.nextInteractionTick - s.tick) / DAY * 24 * 60))} 游戏分钟后</small>}
  </div>;
}

function AnimalOrders({ animal: a, command, detail = false }: { animal: WildAnimal; command: Command; detail?: boolean }) {
  if (a.dead) return null;
  const suffix = detail ? '此动物' : ` ${a.name}`;
  return <div className="voxel-animal-orders">
    {a.faction === 'wild' ? <>
      <button aria-label={`${a.tame ? '取消驯服' : '标记驯服'}${suffix}`} aria-pressed={a.tame}
        onClick={() => command({ type: 'animalOrder', animalId: a.id, order: 'tame', enabled: !a.tame })}>{a.tame ? '取消驯服' : '标记驯服'}</button>
      <button aria-label={`${a.hunt ? '取消狩猎' : '标记狩猎'}${suffix}`} aria-pressed={a.hunt}
        onClick={() => command({ type: 'hunt', animalId: a.id, enabled: !a.hunt })}>{a.hunt ? '取消狩猎' : '标记狩猎'}</button>
    </> : <>
      <button aria-label={`${a.slaughter ? '取消待宰' : '标记待宰'}${suffix}`} aria-pressed={a.slaughter}
        onClick={() => command({ type: 'animalOrder', animalId: a.id, order: 'slaughter', enabled: !a.slaughter })}>{a.slaughter ? '取消待宰' : '标记待宰'}</button>
      <button aria-label={`${a.releaseMarked ? '取消放归' : '标记放归'}${suffix}`} aria-pressed={a.releaseMarked}
        onClick={() => command({ type: 'animalOrder', animalId: a.id, order: 'release', enabled: !a.releaseMarked })}>{a.releaseMarked ? '取消放归' : '标记放归'}</button>
    </>}
  </div>;
}

export function AnimalDetails({ animal, snapshot: s, command, focus, penControls }: {
  animal: WildAnimal; snapshot: VoxelSnapshot; command: Command; focus: (pos: Pos) => void; penControls: PenControls;
}) {
  return <section className="voxel-animal-detail" data-testid="animal-detail" data-animal-id={animal.id}>
    <div className="voxel-info-row"><b>{ANIMAL_DEFS[animal.species].name} · {animal.faction === 'colony' ? '殖民地动物' : '野生'}</b><span>{ANIMAL_PHASE_NAMES[animal.phase]}</span></div>
    <label>健康 {Math.ceil(animal.health)} / {ANIMAL_DEFS[animal.species].health}<progress aria-label="动物健康" value={animal.health} max={ANIMAL_DEFS[animal.species].health} /></label>
    <AnimalFacts animal={animal} />
    <small>位置 {animal.x}, {animal.y} · Z {animal.z}</small>
    {animal.dead ? <><p>等待附近空位放下尸体；尸体需要搬到屠宰点加工。</p>
      <ItemCondition condition={s.environment.items.find(item => item.entity === 'carcass' && item.id === animal.id)} name={`${ANIMAL_DEFS[animal.species].name}尸体`} />
    </> : <>
      <AnimalStatus animal={animal} snapshot={s} /><AnimalOrders animal={animal} command={command} detail />
      <AnimalPenControls animal={animal} snapshot={s} command={command} controls={penControls} />
      <small>{animal.faction === 'colony' ? '待宰和放归都要由饲养员实际前往执行。宰杀产生尸体，再由烹饪分工搬到屠宰点加工。' : '驯服与狩猎只能选择一项。猎人实际靠近并射击，取消不能召回已发射的弹丸。'}</small>
    </>}
    <button onClick={() => focus(animal)}>定位这只动物</button>
  </section>;
}

export function AnimalPanel({ snapshot: s, selectedAnimalId, baseLevel, command, choose, focus, selectAnimal, selectPawn, close, penControls }: {
  snapshot: VoxelSnapshot; selectedAnimalId: number | null; baseLevel: number; command: Command;
  choose: (tool: Tool) => void; focus: (pos: Pos) => void; selectAnimal: (animal: WildAnimal) => void;
  selectPawn: (pawn: Pawn) => void; close: () => void; penControls: PenControls;
}) {
  const [tab, setTab] = useState<'animals' | 'pens' | 'autoSlaughter'>('animals');
  const hunters = availableHunters(s), craftingSpot = s.weaponBenches.find(b => b.kind === 'craftingSpot');
  const domestic = s.animals.filter(a => !a.dead && a.faction === 'colony'), wild = s.animals.filter(a => !a.dead && a.faction === 'wild');
  const groups = [{ name: '殖民地动物', animals: domestic, key: 'colony' }, { name: '野生动物', animals: wild, key: 'wild' }, { name: '尸体等待落地', animals: s.animals.filter(a => a.dead), key: 'dead' }];
  return <aside className="voxel-wildlife-drawer" aria-label="动物与饲养" data-testid="wildlife-panel">
    <div className="voxel-wildlife-heading"><h2>动物与饲养</h2><button aria-label="关闭野生动物面板" onClick={close}>×</button></div>
    <div className="voxel-animal-tabs" role="tablist" aria-label="动物管理分类">
      <button role="tab" aria-selected={tab === 'animals'} aria-controls="animal-management-tab" onClick={() => setTab('animals')}>动物</button>
      <button role="tab" aria-selected={tab === 'pens'} aria-controls="pen-management-tab" onClick={() => setTab('pens')}>圈地与范围</button>
      <button role="tab" aria-selected={tab === 'autoSlaughter'} aria-controls="auto-slaughter-tab" onClick={() => setTab('autoSlaughter')}>自动宰杀</button>
    </div>
    {tab === 'autoSlaughter' ? <div id="auto-slaughter-tab" role="tabpanel"><AutoSlaughterPanel snapshot={s} command={command} selectAnimal={selectAnimal} /></div> : tab === 'pens' ? <div id="pen-management-tab" role="tabpanel"><PenPanel snapshot={s} command={command} choose={choose} focus={focus} controls={penControls} /></div> : <div id="animal-management-tab" role="tabpanel">
    <p>{domestic.length} 只殖民地动物 · {wild.length} 只野生动物 · {hunters.length} 位可用远程猎人</p>
    <details className="voxel-wildlife-guide"><summary>驯服、饲养与繁殖</summary>
      <ol><li>种植稻谷并等候收获。开启人物的饲养分工，安排动物技能达标的殖民者。</li><li>标记野生动物驯服；饲养员携食物接近并互动，失败后会等候下次尝试。</li><li>动物寻找实际的草、作物和地面食物；可用仓储区集中投放谷物。草被吃掉后需要重新生长。</li><li>饱食的成年同种雌雄动物靠近后可自然交配。饥饿拖慢成长和孕期，严重营养不良可能流产。</li></ol>
      <small>兔需要维持温顺，可跨围栏、穿未锁的门，并可分配活动范围；鹿需要围栏圈养，由饲养员经栏门牵入。动物不能爬梯，请保留地面通路和足够食物。</small>
      <div><button onClick={() => choose('farm')}>规划农田</button><button onClick={() => choose('stock')}>规划食物仓储</button></div>
    </details>
    <details className="voxel-wildlife-workers" data-testid="animal-handlers"><summary>饲养分工与动物技能</summary>
      {s.pawns.filter(p => p.faction === 'colony').map(p => <div className="voxel-animal-handler" key={p.id} data-handler-id={p.id}>
        <button onClick={() => selectPawn(p)}>{p.name}</button>
        <small>动物 {p.skills.animals.level} 级{p.dead ? ' · 已死亡' : p.downed ? ' · 倒地' : p.drafted ? ' · 征召中' : ''}{p.ropeTask ? ' · 牵引动物' : p.handleTask ? ` · ${actionNames[p.handleTask.action]}` : ''}</small>
        <label>饲养优先级<select aria-label={`${p.name} 饲养优先级`} value={p.priorities.handle} disabled={p.dead}
          onChange={e => command({ type: 'priority', pawnId: p.id, work: 'handle', value: Number(e.target.value) })}>
          {[0, 1, 2, 3, 4].map(value => <option key={value} value={value}>{value === 0 ? '停用' : value}</option>)}
        </select></label>
      </div>)}
    </details>
    <div className="voxel-wildlife-list" role="list" aria-label="地图上的动物">
      {groups.map(group => <div key={group.key} data-animal-group={group.key}>
        <h3>{group.name} · {group.animals.length}</h3>
        {!group.animals.length && group.key !== 'dead' && <small>{group.key === 'colony' ? '尚无殖民地动物，先标记野生动物尝试驯服。' : '地图上暂时没有野生动物。'}</small>}
        {group.animals.map(animal => <section role="listitem" key={animal.id} className={selectedAnimalId === animal.id ? 'selected' : ''} data-animal-id={animal.id} data-faction={animal.faction}>
          <div><b>{animal.name}</b><span>{ANIMAL_PHASE_NAMES[animal.phase]}</span></div>
          <small>{ANIMAL_DEFS[animal.species].name} · 健康 {Math.ceil(animal.health)} / {ANIMAL_DEFS[animal.species].health} · {levelName(animal.z, baseLevel)}</small>
          <AnimalFacts animal={animal} /><AnimalStatus animal={animal} snapshot={s} />
          <AnimalPenControls animal={animal} snapshot={s} command={command} controls={penControls} />
          <div className="voxel-animal-row-actions"><button aria-label={`定位 ${animal.name}`} onClick={() => selectAnimal(animal)}>定位</button><AnimalOrders animal={animal} command={command} /></div>
        </section>)}
      </div>)}
    </div>
    <details className="voxel-wildlife-guide"><summary>从狩猎到餐桌</summary>
      <ol><li>在制作点制作短弓，或取得枪械，为殖民者装备。</li><li>开启人物的狩猎分工，标记动物；猎人会靠近、瞄准并射击。</li><li>划定屠宰点，开启烹饪分工；尸体搬入加工为生肉。</li><li>生肉可食用，也可在灶台与谷物混合做简餐；肉和尸体应及时冷藏。</li></ol>
      <div><button onClick={() => craftingSpot ? focus(craftingSpot) : choose('craftingSpot')}>{craftingSpot ? '查看制作点' : '建造制作点'}</button>
        <button onClick={() => choose('butcherSpot')}>规划屠宰点</button></div>
      <small>饥饿或疲劳可能打断狩猎，满足需求后会重新安排。取消狩猎不能召回已发射的弹丸。</small>
    </details>
    <details className="voxel-wildlife-workers"><summary>猎人分工与装备</summary>
      {s.pawns.filter(p => p.faction === 'colony').map(p => <div key={p.id}>
        <button onClick={() => selectPawn(p)}>{p.name}</button>
        <small>{p.weapon ? weaponName(p.weapon) : '未装备武器'} · {p.priorities.hunt ? `狩猎优先级 ${p.priorities.hunt}` : '狩猎已停用'}{p.drafted ? ' · 征召中' : ''}</small>
      </div>)}
    </details>
    <details className="voxel-wildlife-workers"><summary>屠宰点 · {s.butcherSpots.length} 处</summary>
      {s.butcherSpots.map(spot => <div key={spot.id}><button onClick={() => focus(spot)}>定位屠宰点 {spot.id}</button><small>{spot.paused ? '已暂停' : '自动加工开启'} · Z {spot.z}</small></div>)}
    </details>
    <details className="voxel-wildlife-workers" data-testid="husbandry-log"><summary>饲养记录 · {s.husbandryLog.length}</summary>
      <ol>{s.husbandryLog.slice(-12).reverse().map((entry, i) => <li key={`${entry.tick}-${entry.kind}-${entry.animalId}-${i}`}><small>第 {(entry.tick / DAY).toFixed(1)} 天 · {entry.message}</small></li>)}</ol>
    </details>
    </div>}
  </aside>;
}
