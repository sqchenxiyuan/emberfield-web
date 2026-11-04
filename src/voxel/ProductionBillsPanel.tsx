import { useEffect, useRef, useState } from 'react';
import { APPAREL_DEFS, APPAREL_NAMES } from './apparel';
import { STONECUTTING } from './crafting';
import { SIMPLE_MEAL } from './farming';
import { armorResearchReason, toolResearchReason, weaponResearchReason } from './research';
import {
  MAX_PRODUCTION_AMOUNT, MAX_PRODUCTION_BILLS, makeProductionBill, productionJobRecipe,
  type ProductionBill, type ProductionPolicy, type ProductionQueue, type ProductionRecipe,
} from './productionBills';
import { SMITHY_FUEL_CAPACITY, SMITHY_REFUEL_AT, WEAPON_BENCH_NAMES } from './weaponProduction';
import { WEAPON_DEFS, WEAPON_NAMES, type WeaponKind } from './weapons';
import { ANIMAL_DEFS } from './wildlife';
import { locatedUnfinished, unfinishedName, unfinishedPercent, unfinishedStatus, unfinishedWorkReason, type LocatedUnfinished } from './unfinishedView';
import { ProductionDeliveryStatus, ProductionOutputPanel } from './ProductionOutputPanel';
import {
  RESOURCE_NAMES, stonecutterInteraction, tailorInteraction, weaponBenchInteraction,
  type AnimalSpecies, type ApparelKind, type ArmorKind, type Counts, type Job, type Pos, type VoxelCommand, type VoxelSnapshot,
} from './types';

type BillPatch = Partial<Pick<ProductionBill, 'mode' | 'remaining' | 'target' | 'suspended' | 'pauseWhenSatisfied' | 'resumeBelow' | 'policy' | 'output'>>;
const FOOD_TYPES = ['grain', 'meat', 'milk'] as const;
const FOOD_NAMES = { grain: '谷物', meat: '生肉', milk: '奶' };
const CARCASS_SPECIES = Object.keys(ANIMAL_DEFS) as AnimalSpecies[];
const same = (a: Pos, b: Pos) => a.x === b.x && a.y === b.y && a.z === b.z;
const materials = (cost: Readonly<Partial<Counts>>) => Object.entries(cost)
  .map(([resource, amount]) => `${amount} ${RESOURCE_NAMES[resource as keyof Counts]}`).join(' + ');
const emptyIngredientFilter = (bill: ProductionBill) => bill.recipe === 'cook' && bill.policy.allowedFood.length === 0
  ? '未允许任何食材' : bill.recipe === 'butcher' && bill.policy.allowedCarcasses.length === 0 ? '未允许任何动物尸体' : null;

function recipeDetails(recipe: ProductionRecipe, snapshot: VoxelSnapshot) {
  if (recipe === 'cook') return { name: '烹饪简餐', unit: '份',
    description: `${SIMPLE_MEAL.ingredients} 生肉、奶或谷物 + ${SIMPLE_MEAL.wood} 木材 → ${SIMPLE_MEAL.output} 简餐`,
    note: '按允许食材优先使用肉，再用奶和谷物；可混合备料。', research: null };
  if (recipe === 'butcher') return { name: '屠宰动物', unit: '份生肉',
    description: '1 具完整动物尸体 → 生肉', note: '每次处理一具尸体，产肉量随动物和加工者变化。', research: null };
  if (recipe === 'stonecut') return { name: '切割花岗岩砖', unit: '块',
    description: `${STONECUTTING.input} 花岗岩块 → ${STONECUTTING.output} 花岗岩砖`,
    note: '按整批加工，最后一批可能超过库存目标。', research: toolResearchReason(snapshot.research, 'stonecutter') };
  if (recipe.startsWith('smith:')) {
    const kind = recipe.slice(6) as WeaponKind, definition = WEAPON_DEFS[kind];
    return { name: WEAPON_NAMES[kind], unit: '件', description: `${materials(definition.cost)} → 1 ${WEAPON_NAMES[kind]}`,
      note: definition.sourceCraftingLevel ? `需要工艺 ${definition.sourceCraftingLevel} 级。` : '需要开启加工分工。',
      research: weaponResearchReason(snapshot.research, kind) };
  }
  const armor = recipe.startsWith('armorsmith:'), kind = recipe.slice(armor ? 11 : 10) as ApparelKind;
  const definition = APPAREL_DEFS[kind];
  return { name: APPAREL_NAMES[kind], unit: '件', description: `${materials(definition.cost)} → 1 ${APPAREL_NAMES[kind]}`,
    note: definition.sourceCraftingLevel ? `需要工艺 ${definition.sourceCraftingLevel} 级。` : '需要开启加工分工。',
    research: armor ? armorResearchReason(snapshot.research, kind as ArmorKind) : toolResearchReason(snapshot.research, 'tailor') };
}

/** Commit on blur or Enter so a running snapshot cannot interrupt number entry. */
function BillNumber({ label, value, min = 0, max = MAX_PRODUCTION_AMOUNT, commit }: {
  label: string; value: number; min?: number; max?: number; commit: (value: number) => void;
}) {
  const [draft, setDraft] = useState(String(value)), editing = useRef(false), dirty = useRef(false);
  useEffect(() => { if (!editing.current) setDraft(String(value)); }, [value]);
  return <input type="number" aria-label={label} min={min} max={max} step={1} inputMode="numeric" value={draft}
    onFocus={() => { editing.current = true; dirty.current = false; }} onChange={event => { dirty.current = true; setDraft(event.target.value); }}
    onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); } }}
    onBlur={event => {
      editing.current = false;
      if (!dirty.current) { setDraft(String(value)); return; }
      const number = Number(event.currentTarget.value);
      if (!event.currentTarget.value.trim() || !Number.isSafeInteger(number)) { setDraft(String(value)); return; }
      const next = Math.max(min, Math.min(max, number)); setDraft(String(next)); if (next !== value) commit(next);
    }} />;
}

function BillPolicy({ bill, snapshot, update }: {
  bill: ProductionBill; snapshot: VoxelSnapshot; update: (patch: BillPatch) => void;
}) {
  const policy = bill.policy, culinary = bill.recipe === 'cook' || bill.recipe === 'butcher';
  const skill = culinary ? 'cooking' : 'crafting', skillName = culinary ? '烹饪' : '工艺';
  const work = culinary ? 'cook' : 'craft', workName = culinary ? '烹饪' : '加工';
  const workers = snapshot.pawns.filter(pawn => pawn.faction === 'colony' && !pawn.dead);
  const worker = workers.find(pawn => pawn.id === policy.workerId);
  const missingWorker = policy.workerId !== null && !worker;
  const updatePolicy = (patch: Partial<ProductionPolicy>) => update({ policy: { ...policy, ...patch } });
  const emptyFilter = emptyIngredientFilter(bill);
  return <details className="voxel-production-policy" data-testid="bill-policy">
    <summary>分工与原料</summary>
    <div className="voxel-production-policy-body">
      <label className="voxel-production-policy-worker">执行工人<select aria-label="账单执行工人" value={policy.workerId ?? 'any'}
        onChange={event => updatePolicy({ workerId: event.target.value === 'any' ? null : Number(event.target.value) })}>
        <option value="any">任何符合条件的殖民者</option>
        {missingWorker && <option value={policy.workerId!} disabled>原指定工人 #{policy.workerId}（不可用）</option>}
        {workers.map(pawn => <option key={pawn.id} value={pawn.id}>
          {pawn.name} · {skillName} {pawn.skills[skill].level} 级{pawn.priorities[work] > 0 ? '' : ` · 未开启${workName}`}
        </option>)}
      </select></label>
      {policy.workerId === null ? <>
        <div className="voxel-production-policy-skills">
          <label>最低{skillName}<BillNumber label="最低技能等级" value={policy.skillMin} max={20}
            commit={skillMin => updatePolicy({ skillMin, skillMax: Math.max(policy.skillMax, skillMin) })} /></label>
          <label>最高{skillName}<BillNumber label="最高技能等级" value={policy.skillMax} max={20}
            commit={skillMax => updatePolicy({ skillMax, skillMin: Math.min(policy.skillMin, skillMax) })} /></label>
        </div>
        <small>只接受{skillName} {policy.skillMin}～{policy.skillMax} 级的工人；还需开启「{workName}」分工并满足配方要求。</small>
      </> : <small data-testid="bill-policy-worker-note" className={missingWorker || !worker?.priorities[work] ? 'voxel-production-policy-warning' : undefined}>
        {worker ? `${worker.name} · ${skillName} ${worker.skills[skill].level} 级${worker.priorities[work] > 0 ? '' : ` · 未开启「${workName}」分工`}`
          : '原指定工人不可用，请重新选择。'}
        {worker && '。指定工人不受技能区间筛选，仍需满足配方的技能要求并开启对应分工。'}
      </small>}
      <label>取料范围<select aria-label="取料范围" value={policy.ingredientRadius === null ? 'unlimited' : 'radius'}
        onChange={event => updatePolicy({ ingredientRadius: event.target.value === 'unlimited' ? null : policy.ingredientRadius ?? 100 })}>
        <option value="unlimited">不限距离</option><option value="radius">限制半径</option>
      </select></label>
      {policy.ingredientRadius !== null && <label>搜索半径（格）<BillNumber label="原料搜索半径" value={policy.ingredientRadius} min={3} max={100}
        commit={ingredientRadius => updatePolicy({ ingredientRadius })} /></label>}
      <small data-testid="bill-policy-radius-note">{policy.ingredientRadius === null ? '取料不限制距离，仍需能走到原料旁。'
        : `以工作台为中心，只从三维直线距离小于 ${policy.ingredientRadius} 格的位置取料，包含高度差；这不是行走路程。`}</small>
      {bill.recipe === 'cook' ? <fieldset data-testid="bill-food-filter"><legend>允许的食材</legend>
        {FOOD_TYPES.map(resource => <label key={resource} className="voxel-production-check"><input type="checkbox"
          aria-label={`允许${FOOD_NAMES[resource]}`} checked={policy.allowedFood.includes(resource)} onChange={event => {
            const checked = event.target.checked;
            updatePolicy({ allowedFood: FOOD_TYPES.filter(value => value === resource ? checked : policy.allowedFood.includes(value)) });
          }} />{FOOD_NAMES[resource]}</label>)}
        <small>木材是配方必需原料，不受食材勾选影响；取料半径仍适用。</small>
        <small>奶可直接饮用，也可在此勾选用于简餐；未冷藏会腐坏。</small>
      </fieldset> : bill.recipe === 'butcher' ? <fieldset data-testid="bill-carcass-filter"><legend>允许的动物尸体</legend>
        {CARCASS_SPECIES.map(species => <label key={species} className="voxel-production-check"><input type="checkbox"
          aria-label={`允许${ANIMAL_DEFS[species].name}尸体`} checked={policy.allowedCarcasses.includes(species)} onChange={event => {
            const checked = event.target.checked;
            updatePolicy({ allowedCarcasses: CARCASS_SPECIES.filter(value => value === species ? checked : policy.allowedCarcasses.includes(value)) });
          }} />{ANIMAL_DEFS[species].name}尸体</label>)}
      </fieldset> : <small data-testid="bill-fixed-ingredients">本配方使用固定原料，不能取消其中的材料；取料半径仍适用。具体用量见「配方与要求」。</small>}
      {emptyFilter && <small className="voxel-production-policy-warning" data-testid="bill-policy-empty-ingredients">
        {emptyFilter}，后续批次会缺料等待。重新允许至少一种后才能备料。</small>}
      <small className="voxel-production-policy-timing" data-testid="bill-policy-timing">
        已领取的批次保留原取料规则，正在加工的工人继续工作。下一次接手按新的工人限制判断。
        {(bill.recipe.startsWith('smith:') || bill.recipe.startsWith('tailoring:') || bill.recipe.startsWith('armorsmith:')) && '已有未完成品只能由原作者续作，改变工人限制不会更换作者。'}</small>
    </div>
  </details>;
}

function BillRow({ bill, index, total, job, unfinished, snapshot, update, move, remove, focus }: {
  bill: ProductionBill; index: number; total: number; job: Job | undefined; snapshot: VoxelSnapshot;
  unfinished: LocatedUnfinished[];
  focus?: (pos: Pos) => void;
  update: (patch: BillPatch) => void; move: (direction: -1 | 1) => void; remove: () => void;
}) {
  const recipe = recipeDetails(bill.recipe, snapshot);
  const currentPiece = unfinished.find(entry => entry.piece.id === job?.unfinishedId);
  const workReason = unfinishedWorkReason(job, snapshot);
  const deliveries = snapshot.pawns.filter(pawn => pawn.productionDelivery?.billId === bill.id);
  const status = deliveries.length ? { key: 'delivery', text: job ? '加工与配送中' : bill.suspended ? '账单暂停 · 配送成品中' : '成品配送中' }
    : bill.suspended ? { key: 'suspended', text: '手动暂停' }
    : unfinished.length ? { key: 'unfinished', text: unfinishedStatus(currentPiece ?? unfinished[0], snapshot) }
    : job ? { key: 'active', text: job.progress > 0 ? '当前批次加工中' : '等待备料与开工' }
    : bill.mode === 'count' && bill.remaining === 0 ? { key: 'completed', text: '次数已完成' }
    : bill.mode === 'target' && bill.waiting ? { key: 'waiting', text: '等库存降至恢复线' }
    : recipe.research ? { key: 'research', text: '等待研究' }
    : emptyIngredientFilter(bill) ? { key: 'ingredients', text: emptyIngredientFilter(bill)! }
    : bill.mode === 'target' ? { key: 'waiting', text: bill.target === 0 ? '目标为零，不开新批次' : '按库存目标等待' }
    : { key: 'ready', text: '等待安排生产' };
  return <li className="voxel-production-row" data-testid="bill-row" data-bill-id={bill.id} data-recipe={bill.recipe}
    data-bill-mode={bill.mode} data-bill-state={status.key} aria-label={`账单 ${index + 1}：${recipe.name}`}>
    <div className="voxel-production-row-title"><b>{index + 1}. {recipe.name}</b>
      <span data-testid="bill-status">{status.text}</span></div>
    <div className="voxel-production-order">
      <button aria-label="上移账单" disabled={index === 0} onClick={() => move(-1)}>↑ 上移</button>
      <button aria-label="下移账单" disabled={index === total - 1} onClick={() => move(1)}>↓ 下移</button>
      <button aria-label="删除账单" onClick={remove}>删除</button>
    </div>
    <label>重复方式<select aria-label="账单模式" value={bill.mode} onChange={event => {
      const mode = event.target.value as ProductionBill['mode'], defaults = makeProductionBill(bill.id, bill.recipe);
      if (mode === 'count') update({ mode, remaining: bill.remaining || defaults.remaining });
      else if (mode === 'target') {
        const target = bill.target || defaults.target;
        update({ mode, target, resumeBelow: Math.min(bill.resumeBelow, target) });
      } else update({ mode });
    }}><option value="count">制作指定次数</option><option value="forever">持续制作</option><option value="target">维持库存目标</option></select></label>
    {bill.mode === 'count' && <label>剩余次数<BillNumber label="剩余制作次数" value={bill.remaining}
      commit={remaining => update({ remaining })} /></label>}
    {bill.mode === 'forever' && <small>有原料和可用工人时持续制作，直到手动暂停或删除。</small>}
    {bill.mode === 'target' && <>
      <label>目标库存（{recipe.unit}）<BillNumber label="目标库存" value={bill.target}
        commit={target => update({ target, resumeBelow: Math.min(bill.resumeBelow, target) })} /></label>
      <label className="voxel-production-check"><input type="checkbox" aria-label="达到目标后暂停"
        checked={bill.pauseWhenSatisfied} onChange={event => update({ pauseWhenSatisfied: event.target.checked })} />达到目标后暂停补产</label>
      {bill.pauseWhenSatisfied && <>
        <label>恢复线（{recipe.unit}）<BillNumber label="恢复生产库存" value={bill.resumeBelow} max={bill.target}
          commit={resumeBelow => update({ resumeBelow })} /></label>
        <small>实物库存达到 {bill.target} 后等待，降至 {bill.resumeBelow} 或更少时再补产。</small>
      </>}
    </>}
    <ProductionOutputPanel bill={bill} snapshot={snapshot} update={output => update({ output })} focus={focus} />
    <button data-testid="bill-suspend" aria-pressed={bill.suspended} onClick={() => update({ suspended: !bill.suspended })}>
      {bill.suspended ? '恢复账单' : '暂停账单'}</button>
    {deliveries.map(pawn => <ProductionDeliveryStatus key={pawn.id} pawn={pawn} snapshot={snapshot} focus={focus} showWorker />)}
    {job && !currentPiece && <div className="voxel-production-progress" data-testid="bill-progress" data-job-id={job.id}>
      <div><span>当前批次</span><b>{Math.min(100, Math.floor(job.progress / Math.max(1, job.work) * 100))}%</b></div>
      <progress aria-label="账单加工进度" value={job.progress} max={Math.max(1, job.work)} />
      {job.reason && <small data-testid="bill-work-reason">{job.reason}</small>}
      {Object.entries(job.cost).length > 0 && <small>已运原料：{Object.entries(job.cost)
        .map(([resource, amount]) => `${RESOURCE_NAMES[resource as keyof Counts]} ${job.delivered[resource as keyof Counts] ?? 0}/${amount}`).join(' · ')}</small>}
    </div>}
    {unfinished.map(entry => <div key={entry.piece.id} className="voxel-production-progress voxel-production-unfinished"
      data-testid="bill-unfinished" data-unfinished-id={entry.piece.id} data-forbidden={!!entry.batch.forbidden}>
      <small>{unfinishedName(entry.piece)}</small>
      <div data-testid="bill-progress" data-job-id={entry.piece.id === job?.unfinishedId ? job?.id : undefined}>
        <span>已保存的工量</span><b>{unfinishedPercent(entry.piece)}%</b>
      </div>
      <progress aria-label="账单加工进度" value={entry.piece.progress} max={Math.max(1, entry.piece.workTotal)} />
      <small data-testid="bill-unfinished-status">{unfinishedStatus(entry, snapshot)}</small>
      {entry.piece.id === job?.unfinishedId && workReason && <small data-testid="bill-work-reason">{workReason}</small>}
      <small>原料已保存在这件物品中。{entry.carrier ? `由 ${entry.carrier.name} 携带` : `位置 (${entry.pos.x}, ${entry.pos.y}) · Z ${entry.pos.z}`}。</small>
      {focus && <button data-testid="bill-focus-unfinished" onClick={() => focus(entry.pos)}>查看未完成品</button>}
    </div>)}
    {recipe.research && <small className="voxel-production-research" data-testid="bill-research-lock">{recipe.research}，完成后才能开工。</small>}
    <BillPolicy bill={bill} snapshot={snapshot} update={update} />
    <details className="voxel-production-recipe"><summary>配方与要求</summary><small>{recipe.description}</small><small>{recipe.note}</small></details>
  </li>;
}

export function ProductionBillsPanel({ benchId, snapshot, command, focus }: {
  benchId: number; snapshot: VoxelSnapshot; command: (command: VoxelCommand) => void; focus?: (pos: Pos) => void;
}) {
  const [chosen, choose] = useState<ProductionRecipe | ''>('');
  const queue: ProductionQueue | undefined = snapshot.productionQueues.find(queue => queue.benchId === benchId);
  const stove = snapshot.stoves.find(bench => bench.id === benchId), butcher = snapshot.butcherSpots.find(bench => bench.id === benchId);
  const stonecutter = snapshot.stonecutters.find(bench => bench.id === benchId), tailor = snapshot.tailors.find(bench => bench.id === benchId);
  const weaponBench = snapshot.weaponBenches.find(bench => bench.id === benchId), bench = stove ?? butcher ?? stonecutter ?? tailor ?? weaponBench;
  if (!queue || !bench) return null;
  const available: ProductionRecipe[] = stove ? ['cook'] : butcher ? ['butcher'] : stonecutter ? ['stonecut']
    : tailor ? tailor.bills.map(bill => `tailoring:${bill.kind}` as ProductionRecipe)
    : weaponBench ? [...weaponBench.bills.map(bill => `smith:${bill.kind}` as ProductionRecipe),
      ...weaponBench.armorBills.map(bill => `armorsmith:${bill.kind}` as ProductionRecipe)] : [];
  const selected = available.find(recipe => recipe === chosen) ?? available[0];
  const selectedDetails = selected ? recipeDetails(selected, snapshot) : null;
  const title = stove ? '灶台' : butcher ? '屠宰点' : stonecutter ? '切石台' : tailor ? '裁缝台' : WEAPON_BENCH_NAMES[weaponBench!.kind];
  const stand = stonecutter ? stonecutterInteraction(stonecutter) : tailor ? tailorInteraction(tailor) : weaponBench ? weaponBenchInteraction(weaponBench) : null;
  const jobs = snapshot.jobs.filter(job => !job.cancelled && same(job, bench) && productionJobRecipe(job));
  const activeJob = (bill: ProductionBill) => jobs.find(job => job.billId === bill.id || (job.billId === undefined
    && productionJobRecipe(job) === bill.recipe && queue.bills.find(candidate => candidate.recipe === bill.recipe)?.id === bill.id));
  const unfinished = locatedUnfinished(snapshot);
  return <section className="voxel-bill voxel-production-bills" data-testid="production-bills" data-bench-id={benchId}>
    <div className="voxel-production-heading"><b>{title} · 生产账单</b><span>{queue.bills.length} / {MAX_PRODUCTION_BILLS}</span></div>
    <small>按列表顺序安排可执行的账单；同一配方可添加多张，分别设定次数或库存目标。</small>
    {weaponBench?.kind === 'smithy' && <small data-testid="smithy-fuel">燃料 {weaponBench.fuel.toFixed(1)} / {SMITHY_FUEL_CAPACITY} 木材 · 加工时消耗，低于 {SMITHY_REFUEL_AT} 自动补充</small>}
    {weaponBench?.kind === 'machining' && <div className="voxel-bench-power" data-testid="machining-power">
      <div className="voxel-info-row"><b>{weaponBench.power?.reason ?? '等待供电'}</b><span>{weaponBench.power?.powered ? '350 W' : '未供电'}</span></div>
      <small>{weaponBench.power?.networkId == null ? '未连接电网' : `电网 ${weaponBench.power.networkId + 1}`} · 停电保留当前批次，恢复供电后继续。</small>
      <button aria-pressed={!!weaponBench.power?.on} onClick={() => command({ type: 'benchPower', benchId, on: !weaponBench.power?.on })}>
        {weaponBench.power?.on ? '关闭机械台电源' : '打开机械台电源'}</button>
    </div>}
    {stove && <small data-testid="kitchen-sanitation-note">保持厨房清洁并安排合适的厨师，可降低烹饪风险。把厨房划入家园范围并开启清洁分工。</small>}
    <form className="voxel-production-add" onSubmit={event => { event.preventDefault();
      if (selected && queue.bills.length < MAX_PRODUCTION_BILLS) command({ type: 'productionBillAdd', benchId, recipe: selected });
    }}>
      <label>添加配方<select aria-label="添加生产配方" value={selected ?? ''} disabled={!selected} onChange={event => choose(event.target.value as ProductionRecipe)}>
        {available.map(recipe => <option key={recipe} value={recipe}>{recipeDetails(recipe, snapshot).name}</option>)}
      </select></label>
      {selectedDetails && <><small>{selectedDetails.description}</small>{selectedDetails.research && <small className="voxel-production-research">{selectedDetails.research}，可以先安排账单。</small>}</>}
      <button type="submit" data-testid="production-bill-add" disabled={!selected || queue.bills.length >= MAX_PRODUCTION_BILLS}>
        {queue.bills.length >= MAX_PRODUCTION_BILLS ? `已达 ${MAX_PRODUCTION_BILLS} 张账单上限` : '添加账单 · 默认制作 1 次'}</button>
    </form>
    {queue.bills.length ? <ol className="voxel-production-list" aria-label="生产账单顺序">{queue.bills.map((bill, index) => <BillRow
      key={bill.id} bill={bill} index={index} total={queue.bills.length} snapshot={snapshot} job={activeJob(bill)}
      unfinished={unfinished.filter(entry => entry.piece.boundBillId === bill.id)}
      focus={focus}
      update={patch => command({ type: 'productionBillUpdate', benchId, billId: bill.id, patch })}
      move={direction => command({ type: 'productionBillMove', benchId, billId: bill.id, direction })}
      remove={() => command({ type: 'productionBillDelete', benchId, billId: bill.id })} />)}</ol>
      : <p data-testid="production-bills-empty">没有生产账单。添加一个配方后，殖民者才会在这里开工。</p>}
    <small>需要开启「{stove || butcher ? '烹饪' : '加工'}」分工，并留出原料和成品通路。{stand && `操作位 (${stand.x}, ${stand.y}) · Z ${stand.z}。`}</small>
    <details className="voxel-production-help"><summary>库存与暂停规则</summary>
      <small>库存目标统计全营地成品，包括携带、穿戴或装备的物品。安排新批次时会计入正在制作的产量，避免重复补产；暂停后的恢复线只看已经做好的实物。</small>
      <small>次数在成品落地后扣减。修改目标或调整顺序不打断当前批次；手动暂停或删除会停止加工。</small>
      <small>衣物、武器和护甲一旦开始加工，就会留下保存原料和进度的未完成品。暂停保留绑定，删除解除绑定；原作者可在兼容工作台接续同配方账单。需要退回原料时，选中这件物品并取消加工。</small>
      <small>尚未形成未完成品的已运原料，以及烹饪、屠宰、切石批次，会在手动暂停或删除时退回。</small>
    </details>
  </section>;
}
