import { useEffect, useRef, useState } from 'react';
import { APPAREL_DEFS, APPAREL_NAMES } from './apparel';
import { STONECUTTING } from './crafting';
import { SIMPLE_MEAL } from './farming';
import { armorResearchReason, toolResearchReason, weaponResearchReason } from './research';
import {
  MAX_PRODUCTION_AMOUNT, MAX_PRODUCTION_BILLS, makeProductionBill, productionJobRecipe,
  type ProductionBill, type ProductionQueue, type ProductionRecipe,
} from './productionBills';
import { SMITHY_FUEL_CAPACITY, SMITHY_REFUEL_AT, WEAPON_BENCH_NAMES } from './weaponProduction';
import { WEAPON_DEFS, WEAPON_NAMES, type WeaponKind } from './weapons';
import {
  RESOURCE_NAMES, stonecutterInteraction, tailorInteraction, weaponBenchInteraction,
  type ApparelKind, type ArmorKind, type Counts, type Job, type Pos, type VoxelCommand, type VoxelSnapshot,
} from './types';

type BillPatch = Partial<Pick<ProductionBill, 'mode' | 'remaining' | 'target' | 'suspended' | 'pauseWhenSatisfied' | 'resumeBelow'>>;
const same = (a: Pos, b: Pos) => a.x === b.x && a.y === b.y && a.z === b.z;
const materials = (cost: Readonly<Partial<Counts>>) => Object.entries(cost)
  .map(([resource, amount]) => `${amount} ${RESOURCE_NAMES[resource as keyof Counts]}`).join(' + ');

function recipeDetails(recipe: ProductionRecipe, snapshot: VoxelSnapshot) {
  if (recipe === 'cook') return { name: '烹饪简餐', unit: '份',
    description: `${SIMPLE_MEAL.ingredients} 生肉或谷物 + ${SIMPLE_MEAL.wood} 木材 → ${SIMPLE_MEAL.output} 简餐`,
    note: '优先使用易坏的肉，也可混合谷物。', research: null };
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
function BillNumber({ label, value, max = MAX_PRODUCTION_AMOUNT, commit }: {
  label: string; value: number; max?: number; commit: (value: number) => void;
}) {
  const [draft, setDraft] = useState(String(value)), editing = useRef(false), dirty = useRef(false);
  useEffect(() => { if (!editing.current) setDraft(String(value)); }, [value]);
  return <input type="number" aria-label={label} min={0} max={max} step={1} inputMode="numeric" value={draft}
    onFocus={() => { editing.current = true; dirty.current = false; }} onChange={event => { dirty.current = true; setDraft(event.target.value); }}
    onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); } }}
    onBlur={event => {
      editing.current = false;
      if (!dirty.current) { setDraft(String(value)); return; }
      const number = Number(event.currentTarget.value);
      if (!event.currentTarget.value.trim() || !Number.isSafeInteger(number)) { setDraft(String(value)); return; }
      const next = Math.max(0, Math.min(max, number)); setDraft(String(next)); if (next !== value) commit(next);
    }} />;
}

function BillRow({ bill, index, total, job, snapshot, update, move, remove }: {
  bill: ProductionBill; index: number; total: number; job: Job | undefined; snapshot: VoxelSnapshot;
  update: (patch: BillPatch) => void; move: (direction: -1 | 1) => void; remove: () => void;
}) {
  const recipe = recipeDetails(bill.recipe, snapshot);
  const status = bill.suspended ? { key: 'suspended', text: '手动暂停' }
    : job ? { key: 'active', text: job.progress > 0 ? '当前批次加工中' : '等待备料与开工' }
    : bill.mode === 'count' && bill.remaining === 0 ? { key: 'completed', text: '次数已完成' }
    : bill.mode === 'target' && bill.waiting ? { key: 'waiting', text: '等库存降至恢复线' }
    : recipe.research ? { key: 'research', text: '等待研究' }
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
    <button data-testid="bill-suspend" aria-pressed={bill.suspended} onClick={() => update({ suspended: !bill.suspended })}>
      {bill.suspended ? '恢复账单' : '暂停账单'}</button>
    {job && <div className="voxel-production-progress" data-testid="bill-progress" data-job-id={job.id}>
      <div><span>当前批次</span><b>{Math.min(100, Math.floor(job.progress / Math.max(1, job.work) * 100))}%</b></div>
      <progress aria-label="账单加工进度" value={job.progress} max={Math.max(1, job.work)} />
      {job.reason && <small data-testid="bill-work-reason">{job.reason}</small>}
      {Object.entries(job.cost).length > 0 && <small>已运原料：{Object.entries(job.cost)
        .map(([resource, amount]) => `${RESOURCE_NAMES[resource as keyof Counts]} ${job.delivered[resource as keyof Counts] ?? 0}/${amount}`).join(' · ')}</small>}
    </div>}
    {recipe.research && <small className="voxel-production-research" data-testid="bill-research-lock">{recipe.research}，完成后才能开工。</small>}
    <details className="voxel-production-recipe"><summary>配方与要求</summary><small>{recipe.description}</small><small>{recipe.note}</small></details>
  </li>;
}

export function ProductionBillsPanel({ benchId, snapshot, command }: {
  benchId: number; snapshot: VoxelSnapshot; command: (command: VoxelCommand) => void;
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
      update={patch => command({ type: 'productionBillUpdate', benchId, billId: bill.id, patch })}
      move={direction => command({ type: 'productionBillMove', benchId, billId: bill.id, direction })}
      remove={() => command({ type: 'productionBillDelete', benchId, billId: bill.id })} />)}</ol>
      : <p data-testid="production-bills-empty">没有生产账单。添加一个配方后，殖民者才会在这里开工。</p>}
    <small>需要开启「{stove || butcher ? '烹饪' : '加工'}」分工，并留出原料和成品通路。{stand && `操作位 (${stand.x}, ${stand.y}) · Z ${stand.z}。`}</small>
    <details className="voxel-production-help"><summary>库存与暂停规则</summary>
      <small>库存目标统计全营地成品，包括携带、穿戴或装备的物品。安排新批次时会计入正在制作的产量，避免重复补产；暂停后的恢复线只看已经做好的实物。</small>
      <small>次数在成品落地后扣减。修改目标或调整顺序不打断当前批次；手动暂停或删除会取消该账单的加工，并退回已经运来的原料。</small>
    </details>
  </section>;
}
