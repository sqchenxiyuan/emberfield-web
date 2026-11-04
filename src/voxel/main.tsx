import React, { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { VoxelClient } from './client';
import { WorldSetup, BIOME_NAMES, HILL_NAMES } from './WorldSetup';
import { resolveWorldSite } from './regions';
import { TREE_NAMES } from './plants';
import { CROPS, NUTRITION, fertilityOf } from './farming';
import { ASSIGNMENT_NAMES } from './rest';
import { isDeviceKind } from './power';
import { rotRateAtTemperature, rotLimit, remainingRotDays } from './preservation';
import { stackLimit, carryLimit } from './logistics';
import { STONE_CONSTRUCTION } from './crafting';
import { SurvivalPanel } from './SurvivalPanel';
import { SanitationPanel, SanitationDetails, CleaningStatus } from './SanitationPanel';
import { FirePanel, FireDetails, FireDamageDetails, FireWorkStatus } from './FirePanel';
import { WeatherPanel, WeatherCellDetails } from './WeatherPanel';
import { AnimalPanel, AnimalDetails } from './AnimalPanel';
import { FenceGateDetails, PenDetails, type PenControls } from './PenPanel';
import { LivingPanel, RoomLivingDetails, DiningFurnitureDetails } from './LivingPanel';
import { SocialPanel } from './SocialPanel';
import { FurnitureDetails, CurrentFurniture, FurnitureMoveControls, FURNITURE_NAMES } from './FurniturePanel';
import { furnitureStats } from './furniture';
import { tableCells, LIVING_BUILDINGS } from './living';
import { BatchDurability, ItemCondition } from './ItemCondition';
import type { EnvironmentView } from './environment';
import { WEATHER_NAMES } from './weather';
import { needsMedicalTending } from './medicine';
import { healthSummary } from './survival';
import { SkillPanel, WorkSkill } from './SkillPanel';
import { ResearchPanel, ResearchBenchPanel } from './ResearchPanel';
import { RESEARCH_DEFS, toolResearchReason } from './research';
import { ApparelPanel, WearApparel } from './ApparelPanel';
import { TailorPanel } from './TailorPanel';
import { ArmorBenchPanel } from './ArmorPanel';
import { CombatPanel, ThreatControl, storyOpportunityText } from './CombatPanel';
import { TradePanel, TraderInspector } from './TradePanel';
import { WeaponPanel, WeaponBenchPanel, EquipWeapon } from './WeaponPanel';
import { weaponName } from './weapons';
import { WEAPON_BENCH_NAMES } from './weaponProduction';
import { APPAREL_NAMES } from './apparel';
import { ANIMAL_DEFS } from './wildlife';
import { moodView, RECREATION_NAMES, type RecreationKind } from './mood';
import { PRISON_POLICY_NAMES, PRISON_POLICIES, PRISON_RULES, type PrisonerPolicy } from './prisoners';
import {
  BLOCK_NAMES,
  JOB_NAMES,
  RESOURCE_NAMES,
  TOOL_NAMES,
  DAY,
  bedCells,
  deviceCells,
  stonecutterCells,
  stonecutterInteraction,
  tailorCells,
  researchBenchCells,
  weaponBenchCells,
  DEVICE_NAMES,
  type Assignment,
  type CropKind,
  type Pos,
  type Resource,
  type Tool,
  type Work,
  type Cargo,
  type Stockpile,
  type TreeSpecies,
  type Pawn,
} from './types';
import './style.css';
const client = new VoxelClient();
const tools: Tool[] = [
  'inspect',
  'cut',
  'mine',
  'shaft',
  'up',
  'floor',
  'wall',
  'sandbag',
  'ladder',
  'stock',
  'farm',
  'grove',
  'stove',
  'butcherSpot',
  'stonecutter',
  'tailor',
  'craftingSpot',
  'smithy',
  'machining',
  'researchBench',
  'bed',
  'table',
  'chair',
  'horseshoePin',
  'door',
  'fence',
  'fenceGate',
  'penMarker',
  'generator',
  'solar',
  'battery',
  'wire',
  'heater',
  'cooler',
  'clearZone',
  'remove',
  'cancel',
];
const icons = [
  '↖',
  '♠',
  '⛏',
  '↧',
  '↥',
  '▱',
  '▥',
  '▰',
  '☷',
  '▧',
  '♧',
  '♣',
  '♨',
  '⋈',
  '⚒',
  '✂',
  '◇',
  '⚔',
  '⚙',
  '▤',
  '▰',
  '⊤',
  '▙',
  '∩',
  '▯',
  '╫',
  '⊓',
  '⚑',
  '⚙',
  '☀',
  '▣',
  'ϟ',
  '♨',
  '❄',
  '▨',
  '⌫',
  '×',
];
const hints: Record<Tool, string> = {
  fence: '左键拖动建造直线围栏，留下栏门的位置。完工后拦住鹿，人和兔可缓慢跨越；圈地不需要屋顶。',
  fenceGate: '点击建造木制栏门，R 旋转。饲养员经栏门牵入鹿；自动开关保持圈地有效，保持敞开会打开边界。',
  penMarker: '在已围起的区域内建造圈地标记，点击查看是否封闭、现有草料和接纳筛选。标记自身不能拦住动物。',
  animalArea: '左键拖动涂绘矩形活动范围。兔会按通路返回，寻找范围内的食物与休息位置；右键结束涂绘。',
  horseshoePin: '20 木材建造一格马蹄铁桩。沿直线留出两格空地和通路，殖民者会站在两格外投掷；可在作息中安排娱乐，或在人物面板手动安排。',
  butcherSpot: '划定一格屠宰点，开启烹饪分工后自动加工可达尸体。点击点位可暂停或恢复；生肉可直接食用，也可与谷物混合做简餐。',
  craftingSpot: '一格制作点，无需建材。可制作木棒、钢匕首和短弓，加工速度为锻造台的一半。',
  smithy:
    '3×1 燃料锻造台，100 钢材。R 旋转，留出操作位；需木材燃料，可制作武器、钢头盔和研究后的钢板甲。',
  machining:
    '3×1 机械加工台，150 钢材 + 5 零件。R 旋转并留出操作位，接电后消耗 350 W；研究解锁左轮与冲锋手枪。',
  sandbag:
    '每格 5 布料。拖动铺设沙袋掩体；可跨越，基础掩护率 55%，实际效果取决于射击角度与弹道高度。',
  researchBench:
    '3×2 简易科研台，75 木材 + 25 钢材。R 旋转并留出操作位；选择研究项目并开启人物的研究分工。',
  generator: '2×2，占地需两格净空；100 钢材 + 2 零件。补充木材后发电 1000 W，每日耗木 22。',
  solar: '4×4，100 钢材 + 3 零件；峰值 1700 W，夜间停机，上方楼板按遮挡比例减产。',
  battery: '1×2，70 钢材 + 2 零件；容量 600 Wd，充电效率 50%。R 切换朝向。',
  wire: '每格 1 钢材。拖动布线；六向相邻线路可跨层连通。在梯井中逐层铺设竖直线路。',
  heater: '50 钢材 + 1 零件；工作 175 W，待机 17.5 W。同层 6 格方形范围内自动接线，需封闭房间。',
  cooler: '90 钢材 + 3 零件；工作 200 W。负 X/Y 蓝侧制冷，正 X/Y 橙侧排热，R 换轴。留出两侧风口。',
  inspect: '点击人物、动物、物资或地形查看详情。动物可逐只标记狩猎；选中人物后，可在面板中选择目标位置并下达移动。',
  cut: '点击或框选树木。幼苗没有木材，长大后产量逐渐提高；查看详情可了解当前收益，再决定何时砍伐。',
  mine: '点击或框选开凿区域，也可提前规划未知地带。工人从相邻的已知通路挖开两格高通道；打通洞穴后会显露内部。',
  shaft: '在可站立地面点击一次，向下逐格开凿三格梯井。完整入口消耗 8 木材。',
  up: '在可站立地面点击一次，向上搭建三格梯子。完整通路消耗 8 木材。',
  floor: '选择木材或石砖，拖动规划楼板。从梯子旁向外延伸，等待支撑完成。',
  wall: '选择木材或石砖，拖动连续造两格高的墙。需地板支撑，记得留出出入口。',
  ladder: '每格 2 木材。与地面或已有梯子相连后施工；角色可携带物资爬梯。',
  stock:
    '拖动划仓储，点击设置收纳物品与优先级。工人把食物搬往更高优先级的冷库；需要地板、净空与可达通路。',
  farm: '拖动划定土壤种植区，自动播种、收获并补种。稻米约 8 日首收，三人长期供给建议 110–128 格。',
  grove:
    '划定林地区并选择树种，工人自动种植，手动伐木后会补种。需合适土壤、露天空地和通路；请为树木留出空间。',
  stove: '规划灶台，消耗 20 木材。每份简餐需要 10 生食材 + 1 木材；点击灶台设置库存目标。',
  stonecutter:
    '3×1 木制切石台，75 木材 + 30 钢材。R 旋转，留出标记的操作位；1 岩块加工为 20 石砖。',
  tailor: '3×1 手工裁缝台，75 木材。R 旋转并留出操作位；种棉获得布料，再设置各类衣物的制作目标。',
  bed: '两格木床，45 木材。R 旋转朝向；点击设置主人、医疗或囚犯用途。同一封闭房间的床会一起切换囚犯用途；医疗用途可同时启用。',
  table: `两格木制餐桌，${LIVING_BUILDINGS.table.cost.wood} 木材，R 旋转。紧贴桌边放置餐椅并留出通路；殖民者会带餐前往空座。餐桌不能通行或堆放物资。`,
  chair: `一格木制餐椅，${LIVING_BUILDINGS.chair.cost.wood} 木材，R 旋转外观。餐椅与餐桌同层四向相邻即可用餐；可以穿行，前往就座时会预约位置。`,
  door: '点击放置木门，25 木材。R 旋转朝向；自动开关、保持敞开或锁定。门仍分隔两侧房间。',
  clearZone: '拖动擦除种植区、林地区和仓储；农作物会清理且没有收成，树木和已建成设施保留。',
  remove: '拆除墙、楼板、设施或梯子，回收部分材料。正在支撑人物的结构会等待人物移开。',
  cancel: '拖动取消未完成任务；已经送到工地的材料退回现场。',
};
const equal = (a: Pos, b: Pos) => a.x === b.x && a.y === b.y && a.z === b.z;
const levelName = (z: number, base = 8) =>
  z === base ? '营地基准层' : z < base ? `基准层下 ${base - z}` : `基准层上 +${z - base}`;
const STORAGE_RESOURCES = Object.keys(RESOURCE_NAMES) as Resource[];
const FOOD_RESOURCES: Resource[] = ['food', 'grain', 'meat', 'meal'];
const BUILDING_RESOURCES: Resource[] = ['wood', 'stone', 'steel', 'components', 'chunk'];
function connectedStorage(stockpiles: Stockpile[], start: Stockpile): Stockpile[] {
  const key = (p: Pos) => `${p.x}/${p.y}/${p.z}`;
  const byCell = new Map(stockpiles.map((p) => [key(p), p]));
  const result = [start],
    seen = new Set([key(start)]);
  for (let i = 0; i < result.length; i++) {
    const p = result[i];
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const next = byCell.get(key({ x: p.x + dx, y: p.y + dy, z: p.z }));
      if (next && !seen.has(key(next))) {
        seen.add(key(next));
        result.push(next);
      }
    }
  }
  return result;
}
const foodName = (batch: Cargo) =>
  batch.furniture ? `已打包${FURNITURE_NAMES[batch.furniture.kind]} #${batch.furniture.id}` : batch.carcass
    ? `${ANIMAL_DEFS[batch.carcass.species].name}尸体`
    : batch.weapon
    ? weaponName(batch.weapon)
    : batch.apparel
      ? `${batch.apparel.material === 'steel' ? '钢制' : '布制'}${APPAREL_NAMES[batch.apparel.kind]}`
      : batch.resource === 'grain' && batch.crop
        ? CROPS[batch.crop].name
        : RESOURCE_NAMES[batch.resource];
function MoodPanel({ pawn, tick, temperature, environment, pin, gatheringTable, focus }: { pawn: Pawn; tick: number; temperature: number; environment: EnvironmentView; pin?: Pos; gatheringTable?: Pos; focus: (p: Pos) => void }) {
  const [choice, setChoice] = useState<'auto' | RecreationKind>('auto');
  const view = moodView(pawn, tick, temperature), psyche = pawn.psyche, activity = psyche.recreation;
  const wet = psyche.memories.find(memory => memory.kind === 'wet' && memory.expires > tick);
  const wetting = environment.wetPawnIds.includes(pawn.id);
  const breaking = view.risk === 'break', unavailable = pawn.dead || pawn.downed || pawn.drafted || breaking;
  const remaining = (ticks: number) => `${Math.max(1, Math.ceil(ticks / DAY * 24 * 60))} 游戏分钟`;
  return <section className={`voxel-mood-panel mood-${view.risk}`} data-testid="mood-panel" data-risk={view.risk}>
    <div className="voxel-info-row"><b>心情与娱乐</b><span>{breaking ? '精神崩溃' : view.risk === 'low' ? '情绪低落' : '情绪稳定'}</span></div>
    <div className="voxel-mood-meters">
      <label>心情 {Math.round(psyche.level)}%<progress aria-label={`${pawn.name} 心情`} value={psyche.level} max={100} /></label>
      <label>娱乐 {Math.round(psyche.joy)}%<progress aria-label={`${pawn.name} 娱乐`} value={psyche.joy} max={100} /></label>
    </div>
    {breaking ? <p className="voxel-mood-warning" data-testid="mental-break-status">正在悲伤游荡，预计 {remaining(view.breakRemaining)}后恢复。期间暂不接受征召和手动工作，不能直接取消。</p>
      : view.risk === 'low' ? <p className="voxel-mood-warning">低心情持续过久可能引发精神崩溃。先检查饥饿、疲劳、疼痛与娱乐不足的原因。</p>
        : <small>心情会逐渐趋向当前环境与需求形成的目标，不会因一次操作立即回满。</small>}
    {activity && <div className="voxel-recreation-status" data-testid="recreation-status" data-kind={activity.kind} data-spot-id={activity.spotId ?? ''} data-arrived={pawn.x === activity.target.x && pawn.y === activity.target.y && pawn.z === activity.target.z && !pawn.path.length}>
      <b>{pawn.path.length ? '前往' : '正在'}{RECREATION_NAMES[activity.kind]}</b>
      <small>{pawn.reason} · 目标 {activity.target.x}, {activity.target.y} · Z {activity.target.z}</small>
      <progress aria-label="本次娱乐进度" value={Math.max(0, tick - activity.startedTick)} max={Math.max(1, activity.endTick - activity.startedTick)} />
      {activity.kind === 'social' && <small>实际坐到桌旁餐椅后恢复娱乐；附近有人能交流时，才可能自然发生互动。</small>}
    </div>}
    <details className="voxel-mood-thoughts"><summary>心情原因 · 当前目标 {Math.round(view.target)}%</summary>
      <ul>{view.thoughts.map((thought, i) => <li key={`${thought.label}-${i}`}><span>{thought.label}</span><b className={thought.value < 0 ? 'negative' : 'positive'}>{thought.value > 0 ? '+' : ''}{Number(thought.value.toFixed(1))}</b></li>)}</ul>
      <small>这些影响共同决定目标心情。吃饭、休息、处理疼痛和安排娱乐会改变实际原因。</small>
    </details>
    {(wet || wetting) && <div className="voxel-recreation-status" data-testid="wet-memory-status" data-wetting={wetting}
      data-expires={wet?.expires ?? ''} data-remaining-ticks={wet ? wet.expires - tick : 0}>
      <b>{wetting ? '正在淋雨' : '已不再淋雨'}</b>
      <small>{wet ? `淋湿影响剩余 ${remaining(wet.expires - tick)}。` : '持续淋雨会留下淋湿的心情影响。'}
        {wetting ? '继续淋雨会刷新这段时间。' : '先前淋湿的影响会在剩余时间结束后消退。'}</small>
    </div>}
    <details className="voxel-recreation-tolerance"><summary>活动耐受与恢复</summary>
      {(Object.keys(RECREATION_NAMES) as (keyof typeof RECREATION_NAMES)[]).map(kind => <label key={kind}>{RECREATION_NAMES[kind]} · 耐受 {Math.round(psyche.tolerance[kind] * 100)}%<progress aria-label={`${RECREATION_NAMES[kind]}耐受`} value={psyche.tolerance[kind]} max={1} /></label>)}
      <small>反复进行同一种活动，娱乐收益会减少；换种活动并等待一段时间，耐受会逐渐消退。</small>
      {!breaking && psyche.cooldownUntil > tick && <small>情绪恢复期：剩余 {remaining(psyche.cooldownUntil - tick)}。</small>}
    </details>
    <div className="voxel-mood-actions">
      <label className="voxel-recreation-choice">活动选择<select aria-label={`${pawn.name} 娱乐活动`} value={choice} onChange={e => setChoice(e.target.value as 'auto' | RecreationKind)}>
        <option value="auto">自动选择</option>
        {(Object.keys(RECREATION_NAMES) as RecreationKind[]).map(kind => <option key={kind} value={kind}>{RECREATION_NAMES[kind]}</option>)}
      </select></label>
      {activity ? <button disabled={unavailable} onClick={() => void client.command({ type: 'cancelRecreation', pawnId: pawn.id })}>结束本次娱乐</button>
        : <button disabled={unavailable} onClick={() => void client.command({ type: 'recreate', pawnId: pawn.id, ...(choice === 'auto' ? {} : { kind: choice }) })}>现在去娱乐</button>}
      <button onClick={() => pin ? focus(pin) : client.choose('horseshoePin')}>{pin ? '定位马蹄铁桩' : '建造马蹄铁桩'}</button>
      <button onClick={() => gatheringTable ? focus(gatheringTable) : client.choose('table')}>{gatheringTable ? '定位聚会餐桌' : '建造聚会餐桌'}</button>
    </div>
    {!environment.natureAvailable && <small data-testid="nature-weather-restriction">当前天气不适合户外散步。马蹄铁投掷仍按场地、温度和可达性安排。</small>}
    {pawn.drafted && <small>解除征召后才能安排娱乐。</small>}
  </section>;
}

function FoodCondition({ batch, temperature }: { batch: Cargo; temperature: number }) {
  const days = remainingRotDays(batch),
    limit = rotLimit(batch);
  if (days === null || limit === null)
    return batch.resource === 'food' ? (
      <small className="voxel-food-condition">包装生存口粮 · 不腐坏</small>
    ) : null;
  const rate = rotRateAtTemperature(temperature);
  return (
    <div className="voxel-food-condition" data-testid="food-condition">
      {batch.resource === 'herb' && (
        <small data-testid="herb-use">草药用于医疗护理，不能食用；冷藏可延缓腐坏。</small>
      )}
      {batch.resource === 'carcass' && <small>需在开启的屠宰点加工，不能直接食用；冷藏可延缓腐坏。</small>}
      {batch.resource === 'meat' && <small>可生吃或与谷物混合烹饪；尽快使用，或搬进冷库。</small>}
      <span>
        {temperature.toFixed(1)}°C ·{' '}
        {rate === 0 ? '冻结 · 腐坏暂停' : rate < 1 ? '冷藏 · 腐坏减缓' : '未冷藏'}
      </span>
      <progress
        aria-label={`${foodName(batch)}腐坏进度`}
        value={batch.rotProgress ?? 0}
        max={limit}
      />
      <small>
        {rate === 0
          ? `回到常温后约剩 ${days.toFixed(2)} 日`
          : `按当前温度预计 ${Math.max(0, days / rate).toFixed(2)} 日后腐坏`}
      </small>
    </div>
  );
}
async function db() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const r = indexedDB.open('emberfield-voxel', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('saves');
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
async function putSave(slot: string, value: unknown) {
  const database = await db();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = database.transaction('saves', 'readwrite');
      tx.objectStore('saves').put(value, slot);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    database.close();
  }
}
async function getSave(slot: string) {
  const database = await db();
  try {
    return await new Promise<unknown>((resolve, reject) => {
      const request = database.transaction('saves').objectStore('saves').get(slot);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } finally {
    database.close();
  }
}
function App() {
  const state = useSyncExternalStore(client.subscribe, client.snapshot),
    s = state.snapshot;
  const host = useRef<HTMLDivElement>(null),
    file = useRef<HTMLInputElement>(null);
  const [notice, setNotice] = useState(''),
    [menu, setMenu] = useState(false),
    [help, setHelp] = useState(true),
    [researchOpen, setResearchOpen] = useState(false),
    [tradeOpen, setTradeOpen] = useState(false),
    [wildlifeOpen, setWildlifeOpen] = useState(false),
    [prisonOpen, setPrisonOpen] = useState(false),
    [sanitationOpen, setSanitationOpen] = useState(false),
    [fireOpen, setFireOpen] = useState(false),
    [weatherOpen, setWeatherOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [selectedPawn, setSelectedPawn] = useState<number | null>(null),
    [selectedAnimal, setSelectedAnimal] = useState<number | null>(null),
    [selectedCarer, setSelectedCarer] = useState<number | null>(null),
    [selectedCaptor, setSelectedCaptor] = useState<number | null>(null),
    [storageConnected, setStorageConnected] = useState(true),
    [saveStatus, setSaveStatus] = useState('尚未保存');
  useEffect(() => {
    client.notice = setNotice;
    return client.mount(host.current!);
  }, []);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(''), 6000);
    return () => clearTimeout(t);
  }, [notice]);
  useEffect(() => {
    if (s?.trade.session?.stage !== 'ready' || !s.trade.quote) return;
    if (s.speed !== 0) void client.speed(0);
    setTradeOpen(true);
    setResearchOpen(false);
    setWildlifeOpen(false);
    setPrisonOpen(false);
    setSanitationOpen(false);
    setFireOpen(false);
    setWeatherOpen(false);
    setMenu(false);
  }, [s?.trade.session?.id, s?.trade.session?.stage, !!s?.trade.quote, s?.speed]);
  useEffect(() => {
    const selected = state.selected;
    const animals = client.snapshot().snapshot?.animals ?? [];
    const person = selected && client.snapshot().snapshot?.pawns.find(v => equal(v, selected) && (v.faction === 'prisoner' || (v.faction === 'raider' && v.downed && !v.dead)));
    const structure = selected && ('penMarkerId' in selected || 'fenceGateId' in selected || 'furnitureId' in selected);
    const animal = selected && !structure ? animals.find(v => 'animalId' in selected ? v.id === selected.animalId : equal(v, selected)) : undefined;
    setSelectedAnimal(current => selected && !structure && !('animalId' in selected) && animals.some(v => v.id === current && equal(v, selected)) ? current : animal?.id ?? null);
    if (animal) setSelectedPawn(null);
    else if (person) setSelectedPawn(current => client.snapshot().snapshot?.pawns.some(v => v.id === current && equal(v, selected!)) ? current : person.id);
  }, [state.selected]);
  useEffect(() => {
    if (!s || selectedAnimal === null || s.animals.some(a => a.id === selectedAnimal)) return;
    const carcass = s.items.find(i => i.carcass?.animalId === selectedAnimal);
    if (carcass) client.select(carcass);
    setSelectedAnimal(null);
  }, [s?.tick, selectedAnimal]);
  useEffect(() => {
    if (!s) return;
    if (state.selectedPenId !== null && !s.penMarkers.some(p => p.id === state.selectedPenId)) client.showPen(null);
    if (state.selectedAnimalAreaId !== null && !s.animalAreas.some(a => a.id === state.selectedAnimalAreaId)) {
      client.showAnimalArea(null);
      if (state.tool === 'animalArea') client.choose('inspect');
    }
  }, [s?.penMarkers, s?.animalAreas, state.selectedPenId, state.selectedAnimalAreaId, state.tool]);
  useEffect(() => {
    if (state.tool !== 'inspect' || !state.selected) return;
    const marker = client.snapshot().snapshot?.penMarkers.find(m => equal(m, state.selected!));
    if (marker) client.showPen(marker.id);
  }, [state.selected, state.tool]);
  useEffect(() => {
    const t = setInterval(() => {
      if (client.snapshot().snapshot?.tick)
        void client
          .export()
          .then((v) => putSave('auto', v))
          .then(() =>
            setSaveStatus(
              '自动保存 ' +
                new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }),
            ),
          )
          .catch(() => setNotice('自动保存失败，请导出存档'));
    }, 60000);
    return () => clearInterval(t);
  }, []);
  const action = async (fn: () => Promise<unknown>, message?: string) => {
    setBusy(true);
    try {
      await fn();
      if (message) setNotice(message);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const animal = s?.animals.find(v => v.id === selectedAnimal) ??
    (state.selected && !('penMarkerId' in state.selected) && !('fenceGateId' in state.selected) && !('furnitureId' in state.selected) ? s?.animals.find(v => equal(v, state.selected!)) : undefined);
  const p = animal ?? state.selected;
  const unknown = !!p && !client.exploredAt(p);
  const worldRegion = useMemo(() => s?.worldSite ? resolveWorldSite(s.worldSite).tile : null,
    [s?.worldSite?.version, s?.worldSite?.worldSeed, s?.worldSite?.tileId]);
  const spawn = s?.spawn ?? { x: 32, y: 32, z: 8 };
  const people = p ? (s?.pawns.filter((v) => equal(v, p)) ?? []) : [];
  const items = p ? (s?.items.filter((v) => equal(v, p)) ?? []) : [];
  const tree = p ? s?.trees.find((v) => equal(v, p)) : null;
  const treePlot = p ? s?.treePlots.find((v) => equal(v, p)) : null;
  const treeCondition = tree ? s?.treeConditions.find((v) => v.id === tree.id) : null;
  const farm = p ? s?.farms.find((v) => equal(v, p)) : null;
  const storage = p ? s?.stockpiles.find((v) => equal(v, p)) : null;
  const storageRegion =
    storage && s ? (storageConnected ? connectedStorage(s.stockpiles, storage) : [storage]) : [];
  const regionKeys = new Set(storageRegion.map((v) => `${v.x}/${v.y}/${v.z}`));
  const capacity = s?.storageCapacity.filter((v) => regionKeys.has(`${v.x}/${v.y}/${v.z}`)) ?? [];
  const occupiedSlots = capacity.filter((v) => v.occupied).length;
  const reservedSlots = capacity.filter((v) => v.reserved > 0).length;
  const canReceive = capacity.some((v) => Object.values(v.available).some((n) => n > 0));
  const crop = p ? s?.crops.find((v) => equal(v, p)) : null;
  const grass = p ? s?.grass.find(v => equal(v, p)) : null;
  const stove = p ? s?.stoves.find((v) => equal(v, p)) : null;
  const butcherSpot = p ? s?.butcherSpots.find(v => equal(v, p)) : null;
  const horseshoePin = p ? s?.horseshoePins.find(v => equal(v, p)) : null;
  const sandbag = p ? s?.sandbags.find((v) => equal(v, p)) : null;
  const stonecutter = p
    ? s?.stonecutters.find((v) => stonecutterCells(v).some((q) => equal(q, p)))
    : null;
  const tailor = p ? s?.tailors.find((v) => tailorCells(v).some((q) => equal(q, p))) : null;
  const researchBench = p
    ? s?.researchBenches.find((v) => researchBenchCells(v).some((q) => equal(q, p)))
    : null;
  const weaponBench = p
    ? s?.weaponBenches.find((b) => weaponBenchCells(b).some((q) => equal(q, p)))
    : null;
  const bed = p ? s?.beds.find((v) => bedCells(v).some((q) => equal(q, p))) : null;
  const table = p ? s?.tables.find(v => tableCells(v).some(q => equal(q, p))) : null;
  const chair = p ? s?.chairs.find(v => equal(v, p)) : null;
  const door = p ? s?.doors.find((v) => equal(v, p)) : null;
  const fence = p ? s?.fences.find(v => equal(v, p)) : null;
  const fenceGate = p ? s?.fenceGates.find(v => equal(v, p)) : null;
  const penMarker = p ? s?.penMarkers.find(v => equal(v, p)) : null;
  const device = p
    ? s?.devices.find((d) =>
        deviceCells(d).some((q) => q.x === p.x && q.y === p.y && (q.z === p.z || q.z + 1 === p.z)),
      )
    : null;
  const wire = p ? s?.wires.find((w) => equal(w, p)) : null;
  const network = device ? s?.networks.find((n) => n.id === device.networkId) : null;
  const room = p && !unknown ? client.roomAt(p) : null;
  const roomTemperature = room
    ? s?.roomTemperatures.find((t) => t.roomId === room.id)?.temperature
    : undefined;
  const condition = p ? s?.cropConditions.find((v) => equal(v, p)) : null;
  const jobs = p
    ? (s?.jobs.filter(
        (v) =>
          equal(v, p) ||
          ((v.kind === 'smithy' || v.kind === 'machining') &&
            weaponBenchCells({ ...v, kind: v.kind, axis: v.axis ?? 'x' }).some((q) =>
              equal(q, p),
            )) ||
          ((v.kind === 'stonecutter' || v.kind === 'stonecut') &&
            stonecutterCells({ ...v, axis: v.axis ?? 'x' }).some((q) => equal(q, p))) ||
          ((v.kind === 'tailor' || v.kind === 'tailoring') &&
            tailorCells({ ...v, axis: v.axis ?? 'x' }).some((q) => equal(q, p))) ||
          ((v.kind === 'researchBench' || v.kind === 'research') &&
            researchBenchCells(
              s?.researchBenches.find((b) => equal(b, v)) ?? { ...v, axis: v.axis ?? 'x' },
            ).some((q) => equal(q, p))) ||
          ((v.kind === 'bed' || v.furnitureKind === 'bed') && bedCells({ ...v, axis: v.axis ?? 'x' }).some((q) => equal(q, p))) ||
          ((v.kind === 'table' || v.furnitureKind === 'table') && tableCells({ ...v, axis: v.axis ?? 'x' }).some(q => equal(q, p))) ||
          (isDeviceKind(v.kind) &&
            deviceCells({ ...v, kind: v.kind, axis: v.axis ?? 'x' }).some((q) => equal(q, p))),
      ) ?? [])
    : [];
  const pawn = animal ? undefined : people.find(v => v.id === selectedPawn) ?? people.find((v) => v.faction === 'trader' || v.faction === 'prisoner' || (v.faction === 'raider' && v.downed && !v.dead)) ?? s?.pawns.find((v) => v.id === selectedPawn) ?? people[0];
  const carers =
    s?.pawns.filter(
      (v) =>
        v.faction === 'colony' &&
        !v.drafted &&
        !v.dead &&
        !v.downed &&
        v.psyche.breakUntil <= (s?.tick ?? 0) &&
        v.id !== pawn?.id &&
        healthSummary(v).manipulation > 0,
    ) ?? [];
  const carer = carers.find((v) => v.id === selectedCarer) ?? carers[0];
  const captors = s?.pawns.filter(v => v.faction === 'colony' && !v.dead && !v.downed && !v.drafted && v.carriedBy === null && v.carryingPawnId === null && v.psyche.breakUntil <= s.tick && healthSummary(v).manipulation > 0 && healthSummary(v).moving > 0) ?? [];
  const captor = captors.find(v => v.id === selectedCaptor) ?? captors[0];
  const prisoners = s?.pawns.filter(v => v.faction === 'prisoner' && !v.dead) ?? [];
  const captureTargets = s?.pawns.filter(v => v.faction === 'raider' && v.downed && !v.dead) ?? [];
  const prisonBeds = s?.beds.filter(v => v.prisoner) ?? [];
  const prisonerBed = pawn?.prisoner ? s?.beds.find(b => b.id === pawn.prisoner!.bedId) : undefined;
  const prisonerWorker = pawn ? s?.pawns.find(v => v.wardenTask?.prisonerId === pawn.id) : undefined;
  const casualties = s?.pawns.filter((v) => v.faction === 'colony' && (v.dead || v.downed)) ?? [];
  const temperatureOf = (target: Pos) => {
    const targetRoom = client.roomAt(target);
    return (
      s?.roomTemperatures.find((t) => t.roomId === targetRoom?.id)?.temperature ??
      s?.temperature ??
      21
    );
  };
  const moodByPawn = new Map(s?.pawns.filter(v => v.faction === 'colony').map(v => [v.id, moodView(v, s.tick, temperatureOf(v))]));
  const updateStorage = (priority: number, accepts: Resource[]) => {
    if (storage)
      void client.command({
        type: 'storage',
        from: storage,
        connected: storageConnected,
        priority,
        accepts,
      });
  };
  const block = p && !unknown ? client.blockAt(p) : 0;
  const title = unknown ? '未探索区域' : p
    ? (animal?.name ?? people[0]?.name ??
      penMarker?.name ?? (fenceGate ? '木制栏门' : null) ?? (fence ? '木制围栏' : null) ??
      (butcherSpot ? '屠宰点' : null) ??
      (horseshoePin ? '马蹄铁桩' : null) ??
      (device ? DEVICE_NAMES[device.kind] : null) ??
      (stonecutter ? '木制切石台' : null) ??
      (tailor ? '手工裁缝台' : null) ??
      (researchBench ? '简易科研台' : null) ??
      (weaponBench ? WEAPON_BENCH_NAMES[weaponBench.kind] : null) ??
      (sandbag ? '布制沙袋' : null) ??
      (table ? '木制餐桌' : null) ?? (chair ? '木制餐椅' : null) ??
      (bed
        ? '木床'
        : door
          ? '木门'
          : stove
            ? '烧木灶台'
            : crop
              ? CROPS[crop.kind].name
              : farm
                ? `${CROPS[farm.crop].name}种植区`
                : null) ??
      (tree
        ? TREE_NAMES[tree.species ?? 'poplar']
        : treePlot
          ? `${TREE_NAMES[treePlot.species]}林地区`
          : items[0]
            ? foodName(items[0])
            : storage
              ? '仓储区'
              : wire
                ? '电力线路'
                : client.ladderAt(p)
                  ? '梯井通路'
                  : (BLOCK_NAMES[block] ?? '地形')))
    : '营地概览';
  const focus = (target: Pos) => {
    if ('skills' in target && 'faction' in target && 'id' in target && typeof target.id === 'number') {
      setSelectedPawn(target.id);
      setSelectedAnimal(null);
    }
    client.focusOn(target);
    const selection = 'species' in target && 'id' in target ? { ...target, animalId: target.id }
      : 'filter' in target && 'id' in target ? { ...target, penMarkerId: target.id } : target;
    client.select(selection);
  };
  const penControls: PenControls = {
    selectedPenId: state.selectedPenId, selectedAreaId: state.selectedAnimalAreaId,
    editingArea: state.tool === 'animalArea', showPen: client.showPen, showArea: client.showAnimalArea,
    editArea: client.editAnimalArea,
  };
  const editingArea = s?.animalAreas.find(a => a.id === state.selectedAnimalAreaId);
  return (
    <div className="voxel-app">
      <div className="voxel-scene" ref={host} />
      <header className="voxel-header">
        <div className="voxel-brand">
          <span className="voxel-mark">✦</span>
          <div>
            <b>余烬边境</b>
            <small>EMBERFIELD · 多层试玩</small>
          </div>
        </div>
        <div className="voxel-colonists">
          {s?.pawns
            .filter((v) => v.faction === 'colony')
            .map((v) => (
              <button
                key={v.id}
                data-colonist-id={v.id}
                className={[
                  selectedPawn === v.id ? 'selected' : '',
                  v.dead ? 'is-dead' : v.downed ? 'is-downed' : '',
                  !v.dead && moodByPawn.get(v.id)?.risk === 'break' ? 'is-mental' : !v.dead && moodByPawn.get(v.id)?.risk === 'low' ? 'is-low-mood' : '',
                ].join(' ')}
                title={`${v.name} · 心情 ${Math.round(v.psyche.level)}% · 娱乐 ${Math.round(v.psyche.joy)}% · ${v.reason}`}
                onClick={() => {
                  setSelectedPawn(v.id);
                  setSelectedAnimal(null);
                  focus(v);
                }}
              >
                <i style={{ background: '#' + v.color.toString(16) }} />
                <span>
                  {v.name}
                  {v.dead ? ' · 已死亡' : v.downed ? ' · 倒地' : moodByPawn.get(v.id)?.risk === 'break' ? ' · 崩溃' : ''}
                  <small>
                    {levelName(v.z, spawn.z)} · {v.reason}
                  </small>
                </span>
                <em style={{ width: `${v.rest}%` }} />
                <em className="voxel-colonist-mood" style={{ width: `${v.psyche.level}%` }} />
              </button>
            ))}
        </div>
        <div className="voxel-header-actions">
          <button aria-label="火灾与修理" aria-expanded={fireOpen} data-testid="fire-alert" data-active-fires={s?.fires.length ?? 0}
            title={s?.fires.length ? `${s.fires.length} 处正在燃烧，点击查看火情与安排灭火` : '查看火情、灭火与修理分工'} className={s?.fires.length ? 'voxel-fire-alarm' : ''} onClick={() => {
            setFireOpen(v => !v); setWeatherOpen(false); setSanitationOpen(false); setPrisonOpen(false); setWildlifeOpen(false); setTradeOpen(false); setResearchOpen(false); client.choose('inspect');
          }}>火灾{s?.fires.length ? ` · ${s.fires.length}` : ''}</button>
          <button aria-label="卫生与清洁" aria-expanded={sanitationOpen} onClick={() => {
            setSanitationOpen(v => !v); setWeatherOpen(false); setFireOpen(false); setPrisonOpen(false); setWildlifeOpen(false); setTradeOpen(false); setResearchOpen(false); client.choose('inspect');
          }}>卫生</button>
          <button aria-label="囚犯与招募" aria-expanded={prisonOpen} onClick={() => {
            setPrisonOpen(v => !v); setWeatherOpen(false); setSanitationOpen(false); setFireOpen(false); setWildlifeOpen(false); setTradeOpen(false); setResearchOpen(false); client.choose('inspect');
          }}>囚犯{prisoners.length ? ` · ${prisoners.length}` : ''}</button>
          <button aria-label="野生动物与狩猎" aria-expanded={wildlifeOpen} onClick={() => {
            setWildlifeOpen(v => !v); setWeatherOpen(false); setPrisonOpen(false); setSanitationOpen(false); setFireOpen(false); setTradeOpen(false); setResearchOpen(false); client.choose('inspect');
          }}>动物{s?.animals.filter(a => a.faction === 'colony' && !a.dead).length ? ` · ${s.animals.filter(a => a.faction === 'colony' && !a.dead).length}` : ''}</button>
          <button
            aria-label="商队与家园"
            aria-expanded={tradeOpen}
            onClick={() => {
              setTradeOpen((value) => !value);
              setResearchOpen(false);
              setWildlifeOpen(false);
              setPrisonOpen(false);
              setSanitationOpen(false);
              setFireOpen(false);
              setWeatherOpen(false);
              client.choose('inspect');
            }}
          >
            贸易{s?.trade.caravans.length ? ` · ${s.trade.caravans.length}` : ''}
          </button>
          <button
            aria-label="研究科技"
            aria-expanded={researchOpen}
            onClick={() => { setResearchOpen((v) => !v); setWeatherOpen(false); setTradeOpen(false); setWildlifeOpen(false); setPrisonOpen(false); setSanitationOpen(false); setFireOpen(false); }}
            title={
              s?.research.current
                ? `正在研究：${RESEARCH_DEFS[s.research.current].name}`
                : '选择营地研究项目'
            }
          >
            研究
          </button>
          <button onClick={() => setHelp((v) => !v)} aria-label="玩法指引">
            ?
          </button>
          <button
            onClick={() => {
              void client.speed(0);
              setMenu(true);
            }}
          >
            菜单与存档
          </button>
        </div>
      </header>
      <aside className="voxel-resources">
        <span className="voxel-kicker">营地物资</span>
        {(Object.keys(RESOURCE_NAMES) as Resource[]).map((r) => (
          <div key={r} data-resource={r}>
            <span>{RESOURCE_NAMES[r]}</span>
            <strong>{s?.inventory[r] ?? 0}</strong>
            <small>入库 {s?.stored[r] ?? 0}</small>
          </div>
        ))}
        <p>包括散落、携带、穿戴和工地材料。入库不代表受到屋顶或室内保护。</p>
        {!!s?.environment.items.some(item => item.rate > 0) && <p data-testid="deteriorating-inventory-summary">
          {s.environment.items.filter(item => item.rate > 0).length} 处地面物资正在环境劣化；选中物资查看耐久与原因。
        </p>}
        {s && (
          <button
            className="voxel-storyteller-open"
            aria-label="查看财富与压力"
            onClick={() => {
              void client.speed(0);
              setMenu(true);
            }}
          >
            财富与压力
            <small>估值 {s.storyteller.threat.totalWealth.toLocaleString('zh-CN', { maximumFractionDigits: 0 })}</small>
          </button>
        )}
        {s &&
          (s.combat.enabled ||
            s.pawns.some((v) => v.faction === 'raider' && !v.dead && !v.downed)) && (
            <details open data-testid="raid-status">
              <summary>营地安全</summary>
              <small>{storyOpportunityText(s)}</small>
              {s.pawns
                .filter((v) => v.faction === 'raider' && !v.dead)
                .map((v) => (
                  <button
                    key={v.id}
                    onClick={() => {
                      setSelectedPawn(v.id);
                      focus(v);
                    }}
                  >
                    {v.name}
                    {v.downed ? ' · 倒地' : ' · 敌对'}
                  </button>
                ))}
            </details>
          )}
      </aside>
      <div className="voxel-layer-control">
        <button onClick={() => client.view({ level: state.level + 1 })} aria-label="上移一层">
          ＋
        </button>
        <div>
          <b>{levelName(state.level, spawn.z)}</b>
          <small>工作高度 Z {state.level} / 14</small>
        </div>
        <button onClick={() => client.view({ level: state.level - 1 })} aria-label="下移一层">
          −
        </button>
        <span />
        {[
          ['地下', Math.max(1, spawn.z - 3)],
          ['地表', spawn.z],
          ['二层', Math.min(14, spawn.z + 3)],
          ['总览', 14],
        ].map(([label, z]) => (
          <button
            key={label}
            className={state.level === z ? 'active' : ''}
            onClick={() => client.view({ level: Number(z) })}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="voxel-camera">
        <button
          title="向左旋转 Q"
          onClick={() => client.view({ rotation: state.rotation - Math.PI / 2 })}
        >
          ↶
        </button>
        <button title="返回营地" onClick={() => client.home()}>
          ⌖
        </button>
        <button
          title="向右旋转 E"
          onClick={() => client.view({ rotation: state.rotation + Math.PI / 2 })}
        >
          ↷
        </button>
      </div>
      {help && !researchOpen && !wildlifeOpen && !prisonOpen && !tradeOpen && !sanitationOpen && !fireOpen && !weatherOpen && (
        <aside className="voxel-guide">
          <div className="voxel-panel-title">
            <span className="voxel-kicker">从地表到地下</span>
            <button onClick={() => setHelp(false)} aria-label="收起指引">
              ×
            </button>
          </div>
          <h2>把营地向上、向下延伸。</h2>
          <ol>
            <li>
              <b>采木</b>
              <span>选「伐木」，点击长成的树；幼苗没有木材。</span>
              <button
                onClick={() => {
                  client.choose('cut');
                  const harvestable = new Set(
                    s?.treeConditions.filter((t) => t.yield > 0).map((t) => t.id),
                  );
                  const nearest = [...(s?.trees ?? [])]
                    .filter((t) => harvestable.has(t.id))
                    .sort(
                      (a, b) =>
                        Math.hypot(a.x - spawn.x, a.y - spawn.y) -
                        Math.hypot(b.x - spawn.x, b.y - spawn.y),
                    )[0];
                  if (nearest) focus(nearest);
                  else setNotice('目前没有能产木材的树，请等待生长或规划林地区');
                }}
              >
                定位树木
              </button>
            </li>
            <li>
              <b>打开地下</b>
              <span>选「下挖梯井」，在地面点击。完成后切到地下，挖掘矿石。</span>
              <button
                onClick={() => {
                  client.choose('shaft');
                  focus(s?.generator === 1 ? { x: 33, y: 32, z: 8 } : spawn);
                }}
              >
                定位建议入口
              </button>
            </li>
            <li>
              <b>建设楼上</b>
              <span>选「向上搭梯」。梯子完成后切二层，从梯旁铺楼板，留两格净空。</span>
              <button
                onClick={() => {
                  client.choose('up');
                  focus(s?.generator === 1 ? { x: 31, y: 30, z: 8 } : { ...spawn, x: spawn.x + 1 });
                }}
              >
                定位上行位置
              </button>
            </li>
          </ol>
          <p className="voxel-guide-note">
            也可在土壤上划种植区、建灶台。稻米约 8
            日首收，初始口粮需节约使用。采钢矿与机械矿后可建发电机和冷暖设备；研究可解锁电池、太阳能与锻造，跨层供电需要连续电线。
          </p>
          <div className="voxel-progress">
            <span>
              已伐木 <b>{s?.stats.cut ?? 0}</b>
            </span>
            <span>
              挖开 <b>{s?.stats.mined ?? 0}</b>
            </span>
            <span>
              已施工 <b>{s?.stats.built ?? 0}</b>
            </span>
          </div>
        </aside>
      )}
      <section className="voxel-inspector" data-testid="voxel-inspector">
        <div className="voxel-panel-title">
          <span className="voxel-kicker">
            {p ? `${p.x}, ${p.y} · Z ${p.z}` : '三名幸存者 / 新的边境'}
          </span>
          {p && (
            <button
              onClick={() => {
                client.select(null);
                setSelectedPawn(null);
              }}
              aria-label="清除选择"
            >
              ×
            </button>
          )}
        </div>
        <h2>{title}</h2>
        {!p && <p>点击地图查看物资、人物与施工进度。先规划，再让殖民者工作。</p>}
        {!p && s && (
          <p>
            累计腐坏：谷物 {s.stats.spoiled.grain} · 生肉 {s.stats.spoiled.meat} · 尸体 {s.stats.spoiled.carcass} · 简餐 {s.stats.spoiled.meal}
            。食品需搬入有供电、温度达标的封闭冷库。
          </p>
        )}
        {!p && s?.settings && (
          <p data-testid="current-world-settings">
            {s.generator === 1
              ? '旧版地形'
              : `${BIOME_NAMES[s.settings.biome]} · ${HILL_NAMES[s.settings.hilliness]}`}{' '}
            · 种子 {s.seed}
            {s.generator !== 1 && (
              <>
                {' '}
                · 年均 {s.settings.meanTemperature}°C · 降雨 {s.settings.rainfall} mm
              </>
            )}
          </p>
        )}
        {!p && s && <p data-testid="current-world-site" data-world-seed={s.worldSite?.worldSeed} data-region-id={s.worldSite?.tileId}>
          {s.worldSite && worldRegion ? `世界种子 ${s.worldSite.worldSeed} · 地区 #${s.worldSite.tileId} · 坐标 (${worldRegion.x}, ${worldRegion.y})` : '自定义或历史营地 · 未绑定世界地区'}
        </p>}
        {s?.generator === 3 && <p className="voxel-exploration-status" data-testid="exploration-status">
          永久探索 · 深色区域尚未发现。开凿梯井或打通岩壁后，地下空间才会显露；切层只改变视图。
        </p>}
        {unknown && p && <section className="voxel-unexplored-detail" data-testid="unexplored-detail">
          <p>这里尚未探索。内部地形、矿藏和空间情况未知，暂时不能建造。</p>
          <small>可规划探索开凿；工人需要先到达相邻的已知通路。已发现的区域会永久保留。</small>
          <button data-testid="exploration-designate" onClick={() => void client.command({ type: 'designate', tool: 'mine', from: p })}>规划探索开凿</button>
          {jobs.length > 0 && <><p data-testid="exploration-queued">已规划 {jobs.length} 项探索工作</p>
            <button onClick={() => void client.command({ type: 'designate', tool: 'cancel', from: p })}>取消此处探索工作</button></>}
        </section>}
        {!unknown && <>
        {p && (
          <p>
            {block
              ? BLOCK_NAMES[block]
              : client.ladderAt(p)
                ? '可携货爬行的梯子'
                : client.blockAt({ ...p, z: p.z - 1 })
                  ? '有地板支撑的空间'
                  : '空中或开口'}{' '}
            · {levelName(p.z, spawn.z)}
          </p>
        )}
        {animal && s && <AnimalDetails animal={animal} snapshot={s} command={client.command} focus={focus} penControls={penControls} />}
        {penMarker && s && <PenDetails marker={penMarker} snapshot={s} command={client.command} focus={focus} controls={penControls} />}
        {fenceGate && s && <FenceGateDetails gate={fenceGate} tick={s.tick} command={client.command} />}
        {fence && <p data-testid="fence-detail">围栏可拦住鹿。人和兔可缓慢跨越；完整圈地需要连接围栏、栏门和内部标记。使用拆除工具可移除这段围栏。</p>}
        {grass && <section className="voxel-animal-detail" data-testid="grass-detail" data-growth={grass.growth}>
          <label>野草 · 生长 {Math.round(grass.growth * 100)}%<progress aria-label="野草生长" value={grass.growth} max={1} /></label>
          <small>动物可自行寻找草地。取食会减少这里的草，之后随光照和温度恢复。</small>
        </section>}
        {tree && treeCondition && (
          <div className="voxel-tree-detail" data-testid="tree-detail">
            <div className="voxel-info-row">
              <span>
                {tree.planted ? '人工种植' : '野生'} · {treeCondition.mature ? '成熟' : '成长中'}
              </span>
              <b>{(tree.growth * 100).toFixed(1)}%</b>
            </div>
            <progress aria-label="树木生长" value={tree.growth} max={1} />
            <div className="voxel-info-row">
              <span>当前砍伐产出</span>
              <b>木材 × {treeCondition.yield}</b>
            </div>
            <p>
              {treeCondition.reason} · 树龄 {treeCondition.ageDays.toFixed(1)} 日
            </p>
            <small>
              肥力 {Math.round(treeCondition.fertility * 100)}% · 光照{' '}
              {Math.round(treeCondition.light * 100)}% · {treeCondition.temperature.toFixed(1)}°C
              <br />
              健康 {Math.round(tree.health * 100)}% · 健康成熟时 {tree.wood} 木材
            </small>
            {treeCondition.yield === 0 && <p>现在砍伐只会清除树苗，不产木材。</p>}
            <button
              onClick={() => void client.command({ type: 'designate', tool: 'cut', from: tree })}
            >
              {treeCondition.yield ? '标记砍伐' : '清除树苗'}
            </button>
          </div>
        )}
        {treePlot && (
          <div className="voxel-tree-detail" data-testid="grove-detail">
            <b>{TREE_NAMES[treePlot.species]}林地区</b>
            <p>{tree ? '保留生长，砍伐后自动补种。' : '等待工人种植。'} 相邻树位需要间隔一格。</p>
            <small>取消林地会停止补植，保留已长出的树木。</small>
            <button
              onClick={() =>
                void client.command({ type: 'designate', tool: 'clearZone', from: treePlot })
              }
            >
              取消这格林地
            </button>
          </div>
        )}
        {p &&
          (() => {
            const ground = block || client.blockAt({ ...p, z: p.z - 1 });
            const fertility = fertilityOf(ground);
            return fertility > 0 ? (
              <p data-testid="ground-fertility">
                {BLOCK_NAMES[ground]} · 肥力 {Math.round(fertility * 100)}%
                {fertility < 0.7 ? ' · 不适合普通农作物' : ''}
              </p>
            ) : null;
          })()}
        {room && (
          <div className="voxel-room-detail">
            <b>{room.outdoor ? '室外连通空间' : '封闭房间'}</b>
            <p>
              {room.volume} 格体积 · {room.floorCells} 格地面 · Z {room.minZ}–{room.maxZ} ·{' '}
              {(roomTemperature ?? s?.temperature ?? 21).toFixed(1)}°C
            </p>
            <small>按实际六向空气连通判断；视图切层不改变房间。</small>
          </div>
        )}
        {room && s && <RoomLivingDetails room={s.roomLiving.find(r => r.id === room.id)} />}
        {p && s && !weatherOpen && <WeatherCellDetails snapshot={s} pos={p} indoors={room?.outdoor === false} />}
        {p && s && <FireDetails snapshot={s} pos={p} preferredPawnId={selectedPawn} temperature={temperatureOf(p)} command={c => void client.command(c)} />}
        {p && s && <FireDamageDetails snapshot={s} pos={p} preferredPawnId={selectedPawn} command={c => void client.command(c)} />}
        {p && s && <SanitationDetails snapshot={s} pos={p} roomId={room?.id} preferredPawnId={selectedPawn}
          command={c => void client.command(c)} />}
        {sandbag && (
          <section className="voxel-bill" data-testid="sandbag-detail">
            <b>布制沙袋</b>
            <p>耐久 {sandbag.hitPoints} / 300 · 基础掩护率 55%</p>
            <small>
              站在掩体背后相邻格可获得掩护。斜向、高处弹道和近距离射击会改变效果；沙袋可被命中损坏。
            </small>
          </section>
        )}
        {device && (
          <div className="voxel-bill" data-testid="device-detail">
            <div className="voxel-info-row">
              <span>运行状态</span>
              <b>{device.reason}</b>
            </div>
            <p>
              {device.powered ? `${Math.abs(device.watts).toFixed(1)} W` : '未供电'} ·{' '}
              {device.networkId === null ? '未接线' : `电网 ${device.networkId + 1}`}
            </p>
            {device.kind === 'generator' && (
              <p>
                木燃料 {device.fuel.toFixed(1)} / 75 · 每日消耗 22
                <br />
                低于 22.5 自动补料；内部燃料不计入营地木材。
              </p>
            )}
            {device.kind === 'battery' && (
              <>
                <progress aria-label="电池储能" value={device.energy} max={600} />
                <p>{device.energy.toFixed(2)} / 600 Wd · 充电效率 50% · 自耗 5 W</p>
              </>
            )}
            {(device.kind === 'heater' || device.kind === 'cooler') && (
              <label>
                目标温度
                <select
                  aria-label="目标温度"
                  value={device.target}
                  onChange={(e) =>
                    void client.command({
                      type: 'device',
                      deviceId: device.id,
                      on: device.on,
                      target: Number(e.target.value),
                    })
                  }
                >
                  {Array.from({ length: 101 }, (_, i) => i - 50).map((t) => (
                    <option key={t} value={t}>
                      {t}°C
                    </option>
                  ))}
                </select>
              </label>
            )}
            {device.kind === 'cooler' && (
              <p>
                蓝侧：{device.axis.toUpperCase()}− 制冷 · 橙侧：{device.axis.toUpperCase()}+
                排热。封堵任一风口会进入待机。
              </p>
            )}
            <button
              onClick={() =>
                void client.command({
                  type: 'device',
                  deviceId: device.id,
                  on: !device.on,
                  target: device.target,
                })
              }
            >
              {device.on ? '关闭设备' : '开启设备'}
            </button>
            {network && (
              <p>
                电网发电 {network.generatedW.toFixed(0)} W · 使用 {network.usedW.toFixed(1)} / 需求{' '}
                {network.demandW.toFixed(1)} W<br />
                储能 {network.storedWd.toFixed(1)} / {network.capacityWd} Wd
              </p>
            )}
          </div>
        )}
        {wire && !device && (
          <p>电线沿 X/Y/Z 六个方向接通相邻线路和电源设施；断开一格会重新划分电网。</p>
        )}
        {storage && (
          <div className="voxel-bill voxel-storage" data-testid="storage-settings">
            <b>仓储设置</b>
            <div className="voxel-storage-capacity" data-testid="storage-capacity">
              <span>
                仓位 {occupiedSlots} / {capacity.length} 已占用
              </span>
              <progress
                value={occupiedSlots}
                max={Math.max(1, capacity.length)}
                aria-label="仓位占用"
              />
              <small>
                空格 {capacity.length - occupiedSlots} · 运输预留 {reservedSlots} 格
              </small>
              <small>
                {canReceive
                  ? '仍可接收物品，工人需要可达通路。'
                  : '当前设置下没有可接收空间，可扩建仓储或调整筛选。'}
              </small>
            </div>
            <label>
              优先级
              <select
                aria-label="仓储优先级"
                value={storage.priority}
                onChange={(e) => updateStorage(Number(e.target.value), storage.accepts)}
              >
                {['低', '普通', '优先', '最高'].map((name, priority) => (
                  <option key={priority} value={priority}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
            <label className="voxel-check">
              <input
                type="checkbox"
                checked={storageConnected}
                onChange={(e) => setStorageConnected(e.target.checked)}
              />
              应用到同层相连仓储
            </label>
            <div className="voxel-storage-presets">
              <button onClick={() => updateStorage(storage.priority, STORAGE_RESOURCES)}>
                收纳全部
              </button>
              <button onClick={() => updateStorage(storage.priority, FOOD_RESOURCES)}>
                仅收食物
              </button>
              <button onClick={() => updateStorage(storage.priority, BUILDING_RESOURCES)}>
                仅收建材
              </button>
              <button onClick={() => updateStorage(storage.priority, ['cloth', 'apparel'])}>
                布料与衣物
              </button>
              <button onClick={() => updateStorage(storage.priority, ['herb'])}>仅收草药</button>
              <button onClick={() => updateStorage(storage.priority, ['meat', 'carcass'])}>肉类与尸体</button>
              <button onClick={() => updateStorage(storage.priority, [])}>停止收纳</button>
            </div>
            <div className="voxel-storage-filters">
              {STORAGE_RESOURCES.map((resource) => (
                <label className="voxel-check" key={resource}>
                  <input
                    type="checkbox"
                    aria-label={`收纳${RESOURCE_NAMES[resource]}`}
                    checked={storage.accepts.includes(resource)}
                    onChange={(e) =>
                      updateStorage(
                        storage.priority,
                        e.target.checked
                          ? [...storage.accepts, resource]
                          : storage.accepts.filter((r) => r !== resource),
                      )
                    }
                  />
                  {RESOURCE_NAMES[resource]}
                </label>
              ))}
            </div>
            <small>
              每格一堆，同类且同品种可以补满；衣物和尸体每格一件。工人优先使用更高优先级的合格仓位；满仓时等待空位。冷库还需封闭房间与制冷供电。
            </small>
          </div>
        )}
        {s && (bed || table || chair) && <FurnitureDetails kind={bed ? 'bed' : table ? 'table' : 'chair'} item={(bed ?? table ?? chair)!} snapshot={s} />}
        {s && (bed || table || chair) && <FurnitureMoveControls kind={bed ? 'bed' : table ? 'table' : 'chair'} item={(bed ?? table ?? chair)!} snapshot={s}
          begin={client.beginFurniturePlacement} command={c => void client.command(c)} focus={focus} />}
        {s && (table || chair) && <DiningFurnitureDetails table={table ?? undefined} chair={chair ?? undefined} snapshot={s}
          focus={focus} command={c => void client.command(c)} />}
        {bed && (
          <div className="voxel-bill" data-testid="bed-detail">
            <label className="voxel-check">
              <input type="checkbox" aria-label="囚犯床" checked={bed.prisoner} onChange={e => void client.command({ type: 'bedPrisoner', bedId: bed.id, prisoner: e.target.checked })} />
              囚犯床
            </label>
            <small data-testid="prison-bed-room">{bed.prisoner ? '囚犯专用 · ' : ''}{room && !room.outdoor ? '当前位于封闭房间；切换会同时更改这个房间内的床位。' : '当前未形成封闭房间，尚不满足囚禁条件。'}囚犯床需要完整墙体、屋顶和可达通路；医疗用途可以同时启用。</small>
            <label>
              床位用途
              <select
                aria-label="床位用途"
                value={bed.medical ? 'medical' : 'sleep'}
                onChange={(e) =>
                  void client.command({
                    type: 'bedMedical',
                    bedId: bed.id,
                    medical: e.target.value === 'medical',
                  })
                }
              >
                <option value="sleep">日常睡眠</option>
                <option value="medical">医疗床</option>
              </select>
            </label>
            <label>
              床位主人
              <select
                aria-label="床位主人"
                disabled={bed.medical || bed.prisoner}
                value={bed.owner ?? ''}
                onChange={(e) =>
                  void client.command({
                    type: 'bedOwner',
                    bedId: bed.id,
                    pawnId: e.target.value === '' ? null : Number(e.target.value),
                  })
                }
              >
                <option value="">{bed.prisoner ? '俘虏时自动分配' : '未分配（可自动认领）'}</option>
                {s?.pawns
                  .filter((p) => !p.dead && (p.faction === 'colony' || p.id === bed.owner))
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
              </select>
            </label>
            <p>
              占地两格
              <br />
              {s?.pawns.find((p) => p.sleepBedId === bed.id)?.reason ?? '当前无人使用'}
            </p>
            {bed.medical && (
              <small>医疗床供救援与休养使用，不分配固定主人。请留出入口和适宜温度。</small>
            )}
            {bed.prisoner && <small>已安置：{s?.pawns.filter(v => v.prisoner?.bedId === bed.id && !v.dead).map(v => v.name).join('、') || '暂无囚犯'}。普通殖民者不会认领囚犯床。</small>}
          </div>
        )}
        {door && (
          <div className="voxel-bill">
            <label>
              门状态
              <select
                aria-label="门状态"
                value={door.mode}
                onChange={(e) =>
                  void client.command({
                    type: 'door',
                    doorId: door.id,
                    mode: e.target.value as typeof door.mode,
                  })
                }
              >
                <option value="auto">自动开关</option>
                <option value="open">保持敞开</option>
                <option value="locked">锁定禁止通行</option>
              </select>
            </label>
            <p>两格高 · 门口有人或物资时不能关门。打开仍保留房间边界。</p>
          </div>
        )}
        {farm && condition && (
          <div className="voxel-farm-detail" data-testid="farm-detail">
            <div className="voxel-info-row">
              <span>本轮生长</span>
              <b>{crop ? `${(crop.growth * 100).toFixed(1)}%` : '等待播种'}</b>
            </div>
            <progress value={crop?.growth ?? 0} max={1} aria-label="作物生长" />
            <p>
              {condition.reason} · 肥力 {Math.round(condition.fertility * 100)}% · 光照{' '}
              {Math.round(condition.light * 100)}% · {condition.temperature.toFixed(1)}°C
            </p>
            <p>
              下次播种：{CROPS[farm.crop].name} · 成熟收获 {CROPS[crop?.kind ?? farm.crop].yield}{' '}
              {(crop?.kind ?? farm.crop) === 'cotton'
                ? '布料；不能食用。'
                : (crop?.kind ?? farm.crop) === 'healroot'
                  ? '草药；用于医疗，不能食用。'
                  : '生食材。'}
              上方楼板会遮光。
            </p>
            {CROPS[farm.crop].minSkill > 0 && (
              <small data-testid="crop-sowing-skill">
                播种需要种植 {CROPS[farm.crop].minSkill} 级；收获不受此等级限制。
              </small>
            )}
          </div>
        )}
        {stove && (
          <div className="voxel-bill">
            <p>
              10 生肉或谷物 + 1 木材 → 1 简餐
              <br />
              全营地简餐低于目标时制作，含在制数量。优先使用易坏的肉，可与谷物混合配料。
            </p>
            <small data-testid="kitchen-sanitation-note">保持厨房清洁并安排合适的厨师，可降低烹饪风险。查看上方房间洁净度，把厨房划入家园范围并开启清洁分工。</small>
            <label>
              库存目标
              <select
                aria-label="简餐库存目标"
                value={stove.target}
                onChange={(e) =>
                  void client.command({
                    type: 'bill',
                    stoveId: stove.id,
                    target: Number(e.target.value),
                    paused: stove.paused,
                  })
                }
              >
                {[...new Set([0, 1, 5, 10, 20, 40, stove.target])]
                  .sort((a, b) => a - b)
                  .map((n) => (
                    <option key={n} value={n}>
                      {n} 份
                    </option>
                  ))}
              </select>
            </label>
            <button
              onClick={() =>
                void client.command({
                  type: 'bill',
                  stoveId: stove.id,
                  target: stove.target,
                  paused: !stove.paused,
                })
              }
            >
              {stove.paused ? '恢复烹饪' : '暂停烹饪'}
            </button>
          </div>
        )}
        {butcherSpot && <section className="voxel-bill" data-testid="butcher-bill">
          <b>{butcherSpot.paused ? '屠宰已暂停' : '自动屠宰已开启'}</b>
          <p>开启烹饪分工的殖民者会取来可达的完整尸体，在这里加工成生肉。请留出附近落地空间。</p>
          <button onClick={() => void client.command({ type: 'butcherBill', spotId: butcherSpot.id, paused: !butcherSpot.paused })}>{butcherSpot.paused ? '恢复屠宰' : '暂停屠宰'}</button>
          <small>暂停会取消当前加工并安全退回尸体；空间被堵时，尸体保留在任务中等待。</small>
        </section>}
        {horseshoePin && <section className="voxel-bill" data-testid="horseshoe-detail">
          <b>马蹄铁投掷</b>
          <p>殖民者会走到木桩两格外投掷，中间一格需要保持畅通。可在人物面板安排娱乐，或把作息时段设为娱乐。</p>
          <small>{s?.pawns.filter(v => v.psyche.recreation?.spotId === horseshoePin.id).map(v => `${v.name} · ${v.reason}`).join('；') || '当前无人使用。保留周围空地与通路。'}</small>
          <small>重复同一种活动会积累耐受，减少娱乐收益；也可进行户外散步。</small>
        </section>}
        {stonecutter && (
          <div className="voxel-bill" data-testid="stonecutting-bill">
            <p>
              1 花岗岩块 → 20 花岗岩砖
              <br />
              全营地石砖低于目标时加工，计入正在加工的批次；每批可能超过目标。修改目标后当前批次继续完成，下一批按新目标判断。
            </p>
            <label>
              石砖库存目标
              <select
                aria-label="石砖库存目标"
                value={stonecutter.target}
                onChange={(e) =>
                  void client.command({
                    type: 'stoneBill',
                    stonecutterId: stonecutter.id,
                    target: Number(e.target.value),
                    paused: stonecutter.paused,
                  })
                }
              >
                {[...new Set([0, 20, 40, 75, 100, 200, 500, stonecutter.target])]
                  .sort((a, b) => a - b)
                  .map((n) => (
                    <option key={n} value={n}>
                      {n} 块
                    </option>
                  ))}
              </select>
            </label>
            <button
              onClick={() =>
                void client.command({
                  type: 'stoneBill',
                  stonecutterId: stonecutter.id,
                  target: stonecutter.target,
                  paused: !stonecutter.paused,
                })
              }
            >
              {stonecutter.paused ? '恢复切石' : '暂停切石'}
            </button>
            <small>
              需要「加工」工作与可达操作位：{stonecutterInteraction(stonecutter).x},{' '}
              {stonecutterInteraction(stonecutter).y} · Z {stonecutter.z}。每次只搬 1
              岩块，完成后石砖落在附近。
            </small>
          </div>
        )}
        {tailor && s && (
          <TailorPanel
            key={tailor.id}
            tailor={tailor}
            snapshot={s}
            update={(kind, target, paused) =>
              void client.command({ type: 'tailorBill', tailorId: tailor.id, kind, target, paused })
            }
          />
        )}
        {researchBench && s && (
          <ResearchBenchPanel
            bench={researchBench}
            snapshot={s}
            openResearch={() => { setResearchOpen(true); setSanitationOpen(false); setFireOpen(false); }}
          />
        )}
        {weaponBench && s && (
          <WeaponBenchPanel
            key={weaponBench.id}
            bench={weaponBench}
            snapshot={s}
            command={(c) => void client.command(c)}
          />
        )}
        {weaponBench?.kind === 'smithy' && s && (
          <ArmorBenchPanel
            key={`armor-${weaponBench.id}`}
            bench={weaponBench}
            snapshot={s}
            command={(c) => void client.command(c)}
          />
        )}
        {items.map((i) => (
          <div className="voxel-item-detail" key={i.id} data-testid="item-detail">
            <div className="voxel-info-row">
              <span>
                {foodName(i)}
                {NUTRITION[i.resource] ? ` · 营养 ${NUTRITION[i.resource]}/份` : ''}
              </span>
              <b>× {i.amount}</b>
            </div>
            <small className="voxel-stack-limit" data-testid="stack-capacity">
              每堆上限 {stackLimit(i.resource)} · 剩余 {stackLimit(i.resource) - i.amount}
            </small>
            <FoodCondition batch={i} temperature={temperatureOf(i)} />
            <ItemCondition condition={s?.environment.items.find(item => item.entity === 'stack' && item.id === i.id)} name={foodName(i)} />
            {i.furniture && s && <div data-testid="packed-furniture" data-furniture-id={i.furniture.id} data-stack-id={i.id}>
              <FurnitureDetails kind={i.furniture.kind} item={i.furniture} snapshot={s} packed />
              <FurnitureMoveControls kind={i.furniture.kind} item={i.furniture} snapshot={s} packed begin={client.beginFurniturePlacement}
                command={c => void client.command(c)} focus={focus} />
            </div>}
            {i.carcass && <div className="voxel-carcass-detail" data-testid="carcass-detail">
              <small>来源动物 #{i.carcass.animalId} · 完整{ANIMAL_DEFS[i.carcass.species].name}尸体</small>
              <button onClick={() => { client.choose('butcherSpot'); setNotice('在可达地面划定屠宰点，再开启人物的烹饪分工。'); }}>建造屠宰点</button>
            </div>}
            {i.weapon && s && (
              <EquipWeapon
                item={i}
                pawns={s.pawns}
                preferredPawnId={selectedPawn}
                command={(c) => void client.command(c)}
              />
            )}
            {i.apparel && s && (
              <WearApparel
                piece={i.apparel}
                pawns={s.pawns.filter((v) => v.faction === 'colony')}
                preferredPawnId={selectedPawn}
                wear={(pawnId, apparelId) =>
                  void client.command({ type: 'wear', pawnId, apparelId })
                }
              />
            )}
          </div>
        ))}
        {jobs.map((j) => (
          <div className="voxel-job" key={j.id}>
            <div>
              <b>
                {JOB_NAMES[j.kind]}
                {j.material === 'stone' ? ' · 石砖' : ''}
              </b>
              <span>{Math.min(100, Math.floor((j.progress / j.work) * 100))}%</span>
            </div>
            <progress value={j.progress} max={j.work} />
            <small>
              {j.reason}
              {(Object.keys(j.cost) as Resource[])
                .map((r) => ` · ${RESOURCE_NAMES[r]} ${j.delivered[r] ?? 0}/${j.cost[r]}`)
                .join('')}
            </small>
            {j.furnitureId !== undefined && <button data-testid="furniture-job-cancel" data-furniture-id={j.furnitureId}
              onClick={() => void client.command({ type: 'cancelFurnitureMove', furnitureId: j.furnitureId! })}>取消这件家具的搬装任务</button>}
            {j.deliveredBatches.map((batch, i) => (
              <div key={i} data-testid="delivered-food">
                <small>
                  已配送 {foodName(batch)} × {batch.amount}
                </small>
                <FoodCondition batch={batch} temperature={temperatureOf(j)} />
                <BatchDurability batch={batch} name={foodName(batch)} />
              </div>
            ))}
          </div>
        ))}
        {pawn?.faction === 'trader' && (
          <TraderInspector pawn={pawn} openTrade={() => { setTradeOpen(true); setResearchOpen(false); setPrisonOpen(false); setSanitationOpen(false); setFireOpen(false); client.choose('inspect'); }} />
        )}
        {pawn && pawn.faction !== 'trader' && (
          <div className="voxel-pawn-detail">
            <div className="voxel-info-row">
              <b>{pawn.name}</b>
              <span>{pawn.reason}</span>
            </div>
            {pawn.faction === 'raider' && pawn.downed && !pawn.dead && <section className="voxel-capture-panel" data-testid="capture-controls">
              <b>俘虏倒地敌人</b>
              <p>未征召的殖民者会前来抱起伤员，送到可用囚犯床。先准备封闭房间中的囚犯床，并及时安排护理。</p>
              <label>执行俘虏<select aria-label="俘虏执行者" value={captor?.id ?? ''} disabled={!captors.length} onChange={e => setSelectedCaptor(Number(e.target.value))}>
                {!captors.length && <option value="">暂无可行动的殖民者</option>}
                {captors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
              </select></label>
              <button disabled={!captor || pawn.carriedBy !== null || !prisonBeds.length} onClick={() => captor && void client.command({ type: 'capture', pawnId: captor.id, targetId: pawn.id })}>俘虏并送往囚犯床</button>
              {!captors.length && <small>需要未征召、能移动和操作且没有精神崩溃的殖民者；请先解除征召。</small>}
              {!prisonBeds.length && <small>尚无囚犯床。建造木床后勾选“囚犯床”。</small>}
              {prisonerWorker && <small>{prisonerWorker.name} · {prisonerWorker.reason}</small>}
            </section>}
            {pawn.faction === 'prisoner' && pawn.prisoner && <section className="voxel-prisoner-detail" data-testid="prisoner-detail" data-prisoner-id={pawn.id}>
              <div className="voxel-info-row"><b>囚犯 · {pawn.name}</b><span>{pawn.prisoner.releasing ? '正在办理释放' : pawn.downed ? '受伤倒地' : '囚禁中'}</span></div>
              <div className="voxel-info-row"><span>抵抗</span><b data-testid="prisoner-resistance">{pawn.prisoner.resistance.toFixed(1)}</b></div>
              <progress aria-label="囚犯抵抗" value={pawn.prisoner.resistance} max={PRISON_RULES.maxResistance} />
              <label>囚犯政策<select aria-label="囚犯政策" value={pawn.prisoner.policy} disabled={pawn.dead || pawn.prisoner.releasing} onChange={e => void client.command({ type: 'prisonerPolicy', prisonerId: pawn.id, policy: e.target.value as PrisonerPolicy })}>
                {PRISON_POLICIES.map(policy => <option value={policy} key={policy}>{PRISON_POLICY_NAMES[policy]}</option>)}
              </select></label>
              <p>{pawn.prisoner.policy === 'maintain' ? '维持囚禁、食物和护理，不安排招募交谈。' : pawn.prisoner.policy === 'release' ? '等待狱卒安排释放，之后离开殖民地。' : pawn.prisoner.resistance > 0 ? pawn.prisoner.policy === 'reduceResistance' ? '狱卒通过实际交谈降低抵抗；归零后停止，不会自动招募。' : '狱卒通过实际交谈降低抵抗；本次抵抗归零后，需再进行一次招募交谈。' : pawn.prisoner.policy === 'recruit' ? '抵抗已归零，等待下次招募交谈。' : '抵抗已归零，降低抵抗任务已完成；此政策不会自动招募。'}</p>
              <small>{prisonerWorker ? `${prisonerWorker.name} · ${prisonerWorker.reason}` : pawn.prisoner.policy === 'recruit' || (pawn.prisoner.policy === 'reduceResistance' && pawn.prisoner.resistance > 0) ? pawn.prisoner.nextInteractionTick > (s?.tick ?? 0) ? `下次交谈约 ${Math.ceil((pawn.prisoner.nextInteractionTick - (s?.tick ?? 0)) / DAY * 24 * 60)} 游戏分钟后可安排。` : '已到交谈时机，等待开启狱卒分工的殖民者。' : '需要时由狱卒安排照料。'}</small>
              <small data-testid="prisoner-last-interaction">上次结果：{pawn.prisoner.lastInteraction || '尚未交谈'}</small>
              <small>位置 {pawn.x}, {pawn.y} · Z {pawn.z} · 俘虏于第 {Math.floor(pawn.prisoner.capturedTick / DAY) + 1} 日</small>
              {prisonerBed ? <button onClick={() => focus(prisonerBed)}>定位分配的囚犯床</button> : <small>未分配有效囚犯床，请检查房间与床位。</small>}
              <small>囚犯保留伤情和需求，可以被护理与喂食；招募后才能像殖民者一样征召、分工和安排作息。</small>
            </section>}
            {pawn.faction === 'colony' && <MoodPanel pawn={pawn} tick={s?.tick ?? 0} temperature={temperatureOf(pawn)}
              environment={s!.environment}
              pin={s?.horseshoePins.toSorted((a, b) => Math.abs(a.x - pawn.x) + Math.abs(a.y - pawn.y) + Math.abs(a.z - pawn.z) - Math.abs(b.x - pawn.x) - Math.abs(b.y - pawn.y) - Math.abs(b.z - pawn.z))[0]}
              gatheringTable={s?.tables.filter(t => t.gathering).toSorted((a, b) => Math.abs(a.x - pawn.x) + Math.abs(a.y - pawn.y) + Math.abs(a.z - pawn.z) - Math.abs(b.x - pawn.x) - Math.abs(b.y - pawn.y) - Math.abs(b.z - pawn.z))[0]}
              focus={focus} />}
            {pawn.faction === 'colony' && s && <LivingPanel pawn={pawn} snapshot={s} focus={focus} />}
            {s && <CurrentFurniture pawn={pawn} snapshot={s} focus={focus} />}
            {s && (pawn.faction === 'colony' || pawn.social.memories.length > 0) && <SocialPanel key={`social-${pawn.id}`} pawn={pawn} snapshot={s} focus={focus} />}
            {s && <CleaningStatus pawn={pawn} snapshot={s} command={c => void client.command(c)} />}
            {s && <FireWorkStatus pawn={pawn} snapshot={s} command={c => void client.command(c)} />}
            <SurvivalPanel
              pawn={pawn}
              pawns={s?.pawns ?? []}
              beds={s?.beds ?? []}
              temperature={temperatureOf(pawn)}
              tick={s?.tick ?? 0}
              command={(c) => void client.command(c)}
            />
            {s && (
              <CombatPanel
                key={pawn.id}
                pawn={pawn}
                pawns={s.pawns}
                snapshot={s}
                blockAt={(cell) => client.blockAt(cell)}
                command={(c) => void client.command(c)}
              />
            )}
            <fieldset className="voxel-readonly-equipment" disabled={pawn.faction === 'prisoner'}>
            <ApparelPanel
              pawn={pawn}
              remove={(apparelId) =>
                void client.command({ type: 'removeApparel', pawnId: pawn.id, apparelId })
              }
            />
            </fieldset>
            <WeaponPanel pawn={pawn} command={(c) => void client.command(c)} />
            {(pawn.faction === 'colony' || pawn.faction === 'prisoner') &&
              !pawn.dead &&
              (pawn.downed || needsMedicalTending(pawn, s?.tick ?? 0) || (pawn.faction === 'prisoner' && pawn.food < 26)) && (
                <div className="voxel-care-actions" data-testid="care-controls">
                  <label>
                    安排同伴
                    <select
                      aria-label="医护人员"
                      value={carer?.id ?? ''}
                      disabled={!carers.length}
                      onChange={(e) => setSelectedCarer(Number(e.target.value))}
                    >
                      {!carers.length && <option value="">暂无可行动的同伴</option>}
                      {carers.map((v) => (
                        <option key={v.id} value={v.id}>
                          {v.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div>
                    <button
                      disabled={!carer || !pawn.downed || pawn.carriedBy !== null}
                      onClick={() =>
                        carer &&
                        void client.command({
                          type: 'care',
                          pawnId: carer.id,
                          patientId: pawn.id,
                          action: 'rescue',
                        })
                      }
                    >
                      优先救援
                    </button>
                    <button
                      disabled={
                        !carer ||
                        (pawn.faction === 'colony' && !pawn.downed) ||
                        (pawn.faction === 'prisoner' ? pawn.food >= 26 : pawn.food > 26) ||
                        pawn.carriedBy !== null ||
                        (pawn.faction === 'prisoner' ? !prisonerBed || !equal(pawn, prisonerBed) : pawn.sleepBedId === null)
                      }
                      onClick={() =>
                        carer &&
                        void client.command({
                          type: 'care',
                          pawnId: carer.id,
                          patientId: pawn.id,
                          action: 'feed',
                        })
                      }
                    >
                      优先喂食
                    </button>
                    <button
                      disabled={
                        !carer ||
                        pawn.drafted ||
                        pawn.carriedBy !== null ||
                        pawn.medical.policy === 'none' ||
                        !needsMedicalTending(pawn, s?.tick ?? 0)
                      }
                      onClick={() =>
                        carer &&
                        void client.command({
                          type: 'care',
                          pawnId: carer.id,
                          patientId: pawn.id,
                          action: 'tend',
                        })
                      }
                    >
                      优先护理
                    </button>
                  </div>
                  <small>
                    {pawn.medical.policy === 'none'
                      ? '当前医疗政策禁止护理；可在健康面板调整。'
                      : '同伴会按患者政策取药并实际前往；缺少通路、床位或物资时会说明原因。'}
                  </small>
                </div>
              )}
            <div className="voxel-needs">
              <label>
                饱食 {Math.round(pawn.food)}%
                {pawn.food <= 0
                  ? ' · 饥荒'
                  : pawn.food < 12
                    ? ' · 急饿'
                    : pawn.food < 24
                      ? ' · 饥饿'
                      : ''}
                <progress value={pawn.food} max={100} />
              </label>
              <label>
                精力 {Math.round(pawn.rest)}%
                <progress value={pawn.rest} max={100} />
              </label>
            </div>
            {pawn.cargo && (
              <div data-testid="carried-food">
                <p>
                  携带 {foodName(pawn.cargo)} × {pawn.cargo.amount} /{' '}
                  {carryLimit(pawn.cargo.resource)}
                </p>
                <FoodCondition batch={pawn.cargo} temperature={temperatureOf(pawn)} />
                <BatchDurability batch={pawn.cargo} name={foodName(pawn.cargo)} />
                {pawn.cargo.furniture && s && <div data-testid="carried-furniture" data-furniture-id={pawn.cargo.furniture.id}>
                  <FurnitureDetails kind={pawn.cargo.furniture.kind} item={pawn.cargo.furniture} snapshot={s} packed />
                  <FurnitureMoveControls kind={pawn.cargo.furniture.kind} item={pawn.cargo.furniture} snapshot={s} packed begin={client.beginFurniturePlacement}
                    command={c => void client.command(c)} focus={focus} />
                </div>}
              </div>
            )}
            <SkillPanel pawn={pawn} />
            <div className="voxel-priorities">
              {(
                [
                  'firefight',
                  'care',
                  'warden',
                  'dig',
                  'cut',
                  'build',
                  'haul',
                  'clean',
                  'grow',
                  'cook',
                  'hunt',
                  'handle',
                  'craft',
                  'research',
                ] as Work[]
              ).map((w, i) => (
                <label key={w}>
                  {['灭火', '医护', '狱卒', '挖掘', '伐木', '施工', '搬运', '清洁', '种植', '烹饪', '狩猎', '饲养', '加工', '研究'][i]}
                  <WorkSkill pawn={pawn} work={w} />
                  <select
                    aria-label={`${pawn.name} ${w}优先级`}
                    disabled={pawn.dead || pawn.faction !== 'colony'}
                    value={pawn.priorities[w]}
                    onChange={(e) =>
                      void client.command({
                        type: 'priority',
                        pawnId: pawn.id,
                        work: w,
                        value: Number(e.target.value),
                      })
                    }
                  >
                    {[0, 1, 2, 3, 4].map((n) => (
                      <option key={n} value={n}>
                        {n === 0 ? '停用' : n}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
            <small>
              普通工作按 1～4 排序；医护开启后优先处理急救。0 停用自动工作，仍可手动安排救援。
            </small>
            <details className="voxel-schedule">
              <summary>24 小时作息 · 点击调整</summary>
              <div>
                {pawn.schedule.map((a, h) => (
                  <label key={h}>
                    {String(h).padStart(2, '0')}
                    <select
                      aria-label={`${pawn.name} ${h}点作息`}
                      disabled={pawn.dead || pawn.faction !== 'colony'}
                      value={a}
                      onChange={(e) =>
                        void client.command({
                          type: 'schedule',
                          pawnId: pawn.id,
                          hour: h,
                          assignment: e.target.value as Assignment,
                        })
                      }
                    >
                      {(Object.keys(ASSIGNMENT_NAMES) as Assignment[]).map((k) => (
                        <option key={k} value={k}>
                          {ASSIGNMENT_NAMES[k]}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
              <small>自由时按需要工作、休息和娱乐；娱乐时段优先找活动，工作和睡眠时段不主动娱乐。饥饿、疲劳等急需仍会中断活动。</small>
            </details>
            <button
              disabled={
                pawn.dead ||
                pawn.downed ||
                pawn.faction !== 'colony' ||
                pawn.drafted ||
                pawn.psyche.breakUntil > (s?.tick ?? 0) ||
                pawn.rest >= 75 ||
                pawn.phase === 'rest' ||
                pawn.phase === 'sleepTravel'
              }
              onClick={() => void client.command({ type: 'rest', pawnId: pawn.id })}
            >
              现在去睡觉
            </button>
            {p && !equal(p, pawn) && (
              <button
                className="voxel-primary"
                disabled={pawn.dead || pawn.downed || pawn.faction !== 'colony' || pawn.psyche.breakUntil > (s?.tick ?? 0)}
                onClick={() => void client.command({ type: 'move', pawnId: pawn.id, target: p })}
              >
                让 {pawn.name} 前往选中位置
              </button>
            )}
          </div>
        )}
        </>}
        {p && (
          <button className="voxel-text-button" onClick={() => client.focusOn(p)}>
            ⌖ 对焦此处
          </button>
        )}
      </section>
      {casualties.length > 0 && (
        <aside className="voxel-survival-alert" aria-label="健康警报">
          <strong>
            {casualties.every((v) => v.dead) &&
            casualties.length === s?.pawns.filter((v) => v.faction === 'colony').length
              ? '营地已无人存活'
              : '同伴需要关注'}
          </strong>
          {casualties.map((v) => (
            <button
              key={v.id}
              onClick={() => {
                setSelectedPawn(v.id);
                focus(v);
              }}
            >
              {v.name} · {v.dead ? '已死亡' : v.carriedBy !== null ? '救援中' : '倒地'}
            </button>
          ))}
        </aside>
      )}
      <div className="voxel-coordinates">
        <span>
          {state.worker ? '独立渲染线程' : '兼容渲染'} · {String(state.metrics.backend ?? 'WebGL2')}
        </span>
        <span>
          {Math.round(Number(state.metrics.fps ?? 0))} FPS · {s?.jobs.length ?? 0} 项规划
        </span>
      </div>
      <footer className="voxel-footer">
        <div className="voxel-tool-hint">
          <span className="voxel-kicker">
            {state.furniturePlacement ? `安装 ${FURNITURE_NAMES[state.furniturePlacement.kind]} #${state.furniturePlacement.furnitureId} · ${furnitureStats(state.furniturePlacement.kind, state.furniturePlacement.quality).qualityName}` : TOOL_NAMES[state.tool]}
            {([
              'bed',
              'table',
              'chair',
              'door',
              'fenceGate',
              'stonecutter',
              'tailor',
              'smithy',
              'machining',
              'researchBench',
            ].includes(state.tool) ||
              isDeviceKind(state.tool) || state.furniturePlacement) && (
              <button onClick={() => client.rotatePlan()} aria-label="旋转建造朝向">
                朝向 {state.axis.toUpperCase()} · R
              </button>
            )}
            {state.furniturePlacement && <button data-testid="furniture-placement-cancel" onClick={client.endFurniturePlacement}>退出选址 · Esc</button>}
            {state.tool === 'farm' && (
              <select
                aria-label="种植作物"
                value={state.crop}
                onChange={(e) => client.chooseCrop(e.target.value as CropKind)}
              >
                {(Object.keys(CROPS) as CropKind[]).map((k) => (
                  <option key={k} value={k}>
                    {CROPS[k].name}
                  </option>
                ))}
              </select>
            )}
            {state.tool === 'grove' && (
              <select
                aria-label="种植树种"
                value={state.treeSpecies}
                onChange={(e) => client.chooseTree(e.target.value as TreeSpecies)}
              >
                {(Object.keys(TREE_NAMES) as TreeSpecies[]).map((k) => (
                  <option key={k} value={k}>
                    {TREE_NAMES[k]}
                  </option>
                ))}
              </select>
            )}
            {['wall', 'floor'].includes(state.tool) && (
              <select
                aria-label="建造材料"
                value={state.material}
                onChange={(e) => client.chooseMaterial(e.target.value as 'wood' | 'stone')}
              >
                <option value="wood">木材</option>
                <option value="stone">花岗岩砖</option>
              </select>
            )}
            {state.tool === 'animalArea' && <span className="voxel-area-toolbar" data-testid="area-edit-toolbar">
              <b>{editingArea?.name ?? '请选择活动范围'}</b>
              <button aria-pressed={!state.animalAreaErase} disabled={!editingArea} onClick={() => editingArea && client.editAnimalArea(editingArea.id)}>涂绘</button>
              <button aria-pressed={state.animalAreaErase} disabled={!editingArea} onClick={() => editingArea && client.editAnimalArea(editingArea.id, true)}>擦除</button>
              <button onClick={() => client.choose('inspect')}>结束</button>
            </span>}
            {state.placementPreview && <small data-testid="placement-preview-info">
              {state.furniturePlacement ? '安装预览' : state.placementPreview.tool === 'animalArea' ? state.animalAreaErase ? '擦除' : '涂绘' : '规划'} · {['bed', 'table'].includes(state.placementPreview.tool) ? 2 : (Math.abs(state.placementPreview.to.x - state.placementPreview.from.x) + 1) * (Math.abs(state.placementPreview.to.y - state.placementPreview.from.y) + 1)} 格
            </small>}
          </span>
          <p>
            {state.furniturePlacement ? '点击空地确认安装位置。R 旋转，[ / ] 或楼层按钮可跨层选址；工人需要可达通路。Esc 仅退出选址。' : state.tool === 'farm' && state.crop === 'healroot'
              ? `拖动划定药根种植区。播种需要种植 ${CROPS.healroot.minSkill} 级，收获不受此等级限制；成熟产出草药，不能食用，可存入冷库。`
              : hints[state.tool]}
            {(state.tool === 'floor' || state.tool === 'wall') &&
              ` 每格 ${state.material === 'stone' ? STONE_CONSTRUCTION[state.tool].cost : state.tool === 'wall' ? 6 : 3} ${state.material === 'stone' ? '花岗岩砖' : '木材'}。`}
          </p>
          {state.furniturePlacement?.reason && <small className="voxel-placement-error" data-testid="furniture-placement-error">{state.furniturePlacement.reason}</small>}
          <small>Q / E 旋转 · [ / ] 切层 · 中键拖转 · 滚轮缩放 · WASD 平移 · 右键退出工具</small>
        </div>
        <div className="voxel-bottom-row">
          <nav>
            {tools.map((t, i) => (
              <button
                key={t}
                className={state.tool === t ? 'active' : ''}
                title={(s && toolResearchReason(s.research, t)) || hints[t]}
                disabled={!!s && !!toolResearchReason(s.research, t)}
                aria-label={TOOL_NAMES[t]}
                onClick={() => client.choose(t)}
              >
                <span>{icons[i]}</span>
                {TOOL_NAMES[t]}
              </button>
            ))}
          </nav>
          <div className="voxel-time">
            <small>
              第 {Math.floor((s?.tick ?? 0) / DAY) + 1} 日 ·{' '}
              {String(Math.floor(s?.hour ?? 8)).padStart(2, '0')}:
              {String(Math.floor(((s?.hour ?? 8) % 1) * 60)).padStart(2, '0')} ·{' '}
              <button className="voxel-weather-button" aria-label="天气与环境" aria-expanded={weatherOpen}
                data-testid="weather-status" data-weather-kind={s?.weather.kind ?? 'clear'} onClick={() => {
                  setWeatherOpen(v => !v); setFireOpen(false); setSanitationOpen(false); setPrisonOpen(false);
                  setWildlifeOpen(false); setTradeOpen(false); setResearchOpen(false); client.choose('inspect');
                }}>{s ? WEATHER_NAMES[s.weather.kind] : '天气'} · {Math.round(s?.temperature ?? 21)}°C</button>
            </small>
            <div>
              {[0, 1, 2, 3].map((v) => (
                <button
                  key={v}
                  aria-label={v === 0 ? '暂停' : `${v}倍速`}
                  className={s?.speed === v ? 'active' : ''}
                  onClick={() => void client.speed(v)}
                >
                  {v === 0 ? 'Ⅱ' : `${v}×`}
                </button>
              ))}
            </div>
          </div>
        </div>
      </footer>
      {!state.ready && <div className="voxel-loading">正在生成三维山谷…</div>}
      {researchOpen && s && (
        <ResearchPanel
          snapshot={s}
          command={(c) => void client.command(c)}
          close={() => setResearchOpen(false)}
        />
      )}
      {sanitationOpen && s && <SanitationPanel snapshot={s} selectedPos={unknown ? null : state.selected}
        focus={target => { setSelectedAnimal(null); setSelectedPawn(null); focus(target); }}
        selectPawn={person => { setSelectedAnimal(null); setSelectedPawn(person.id); focus(person); }}
        command={c => void client.command(c)} close={() => setSanitationOpen(false)} />}
      {fireOpen && s && <FirePanel snapshot={s} selectedPos={unknown ? null : state.selected}
        focus={target => { setSelectedAnimal(null); setSelectedPawn(null); focus(target); }}
        selectPawn={person => { setSelectedAnimal(null); setSelectedPawn(person.id); focus(person); }}
        command={c => void client.command(c)} close={() => setFireOpen(false)} />}
      {weatherOpen && s && <WeatherPanel snapshot={s} selectedPos={unknown ? null : state.selected}
        selectedIndoors={!unknown && !!state.selected && client.roomAt(state.selected)?.outdoor === false}
        focus={target => { setSelectedAnimal(null); setSelectedPawn(null); focus(target); }} close={() => setWeatherOpen(false)} />}
      {prisonOpen && s && <aside className="voxel-prison-drawer" aria-label="囚犯与招募" data-testid="prison-panel">
        <div className="voxel-prison-heading"><h2>囚犯与招募</h2><button aria-label="关闭囚犯面板" onClick={() => setPrisonOpen(false)}>×</button></div>
        <p>{prisoners.length} 名囚犯 · {prisonBeds.length} 张囚犯床 · {captors.filter(v => v.priorities.warden > 0).length} 位可用狱卒</p>
        <details className="voxel-prison-guide" open><summary>从俘虏到殖民者</summary>
          <ol><li>建好封闭有屋顶的房间，把床设为囚犯床。</li><li>选择倒地且存活的敌人，由未征召的殖民者实际抱到床上。</li><li>照料食物与伤势，开启狱卒分工并选择囚犯政策。</li><li>招募政策先降低抵抗；抵抗归零后的下一次招募交谈会使其加入。</li></ol>
          <button onClick={() => { client.choose('bed'); setPrisonOpen(false); }}>建造木床</button>
          <small>“降低抵抗”归零后会停止，不会自行招募。招募完成后，新成员出现在上方殖民者栏。</small>
        </details>
        <div className="voxel-prison-list" role="list" aria-label="囚犯名单">
          {!prisoners.length && <p>目前没有囚犯。</p>}
          {prisoners.map(person => <section role="listitem" key={person.id} data-prisoner-row={person.id} className={selectedPawn === person.id ? 'selected' : ''}>
            <div><b>{person.name}</b><span>{person.prisoner?.releasing ? '正在释放' : person.downed ? '倒地' : '囚禁中'}</span></div>
            <small>饱食 {Math.round(person.food)}% · 抵抗 {person.prisoner?.resistance.toFixed(1) ?? '—'} · {person.prisoner ? PRISON_POLICY_NAMES[person.prisoner.policy] : ''}</small>
            <small>{person.reason}</small>
            <button aria-label={`查看囚犯 ${person.name} #${person.id}`} onClick={() => { setSelectedPawn(person.id); setSelectedAnimal(null); focus(person); }}>查看与定位</button>
          </section>)}
        </div>
        <details className="voxel-prison-list" open={captureTargets.length > 0}><summary>可俘虏的倒地敌人 · {captureTargets.length}</summary>
          {captureTargets.map(person => <section key={person.id} data-capture-target={person.id}>
            <b>{person.name}</b><small>意识 {Math.round(healthSummary(person).consciousness * 100)}% · {levelName(person.z, spawn.z)} · {person.carriedBy === null ? '等待救治或俘虏' : '正在被搬运'}</small>
            <button aria-label={`查看倒地敌人 ${person.name} #${person.id}`} onClick={() => { setSelectedPawn(person.id); setSelectedAnimal(null); focus(person); }}>选择并安排俘虏</button>
          </section>)}
        </details>
        <details className="voxel-prison-list"><summary>床位设置 · {s.beds.length}</summary>
          {!s.beds.length && <p>先建造木床，再选择囚犯用途。</p>}
          {s.beds.map(b => <section key={b.id}>
            <button onClick={() => { setSelectedPawn(null); setSelectedAnimal(null); focus(b); }}>{b.prisoner ? '囚犯床' : '木床'} #{b.id}{b.medical ? ' · 医疗' : ''}</button>
            <small>{client.roomAt(b)?.outdoor === false ? '封闭房间' : '尚未形成封闭房间'} · Z {b.z}</small>
          </section>)}
        </details>
        <details className="voxel-prison-list"><summary>狱卒分工与社交</summary>
          {s.pawns.filter(v => v.faction === 'colony' && !v.dead).map(person => <section key={person.id}>
            <button onClick={() => { setSelectedPawn(person.id); setSelectedAnimal(null); focus(person); }}>{person.name}</button>
            <small>社交 {person.skills.social.level} · {person.priorities.warden > 0 ? `狱卒优先级 ${person.priorities.warden}` : '狱卒已停用'}{person.drafted ? ' · 请先解除征召' : ''}</small>
          </section>)}
        </details>
      </aside>}
      {wildlifeOpen && s && <AnimalPanel snapshot={s} selectedAnimalId={selectedAnimal} baseLevel={spawn.z}
        command={client.command} choose={tool => client.choose(tool)} penControls={penControls}
        focus={pos => { setSelectedAnimal(null); focus(pos); }}
        selectAnimal={target => { setSelectedAnimal(target.id); setSelectedPawn(null); focus(target); }}
        selectPawn={person => { setSelectedAnimal(null); setSelectedPawn(person.id); focus(person); }}
        close={() => setWildlifeOpen(false)} />}
      {s && (tradeOpen || s.trade.session?.stage === 'ready') && (
        <TradePanel
          snapshot={s}
          selectedPos={unknown ? null : p}
          selectedPawnId={selectedPawn}
          command={(command) => client.command(command)}
          speed={(value) => client.speed(value)}
          focus={(trader) => { setSelectedPawn(trader.id); focus(trader); }}
          close={() => setTradeOpen(false)}
        />
      )}
      {notice && (
        <div role="status" className="voxel-toast">
          {notice}
        </div>
      )}
      {menu && (
        <div className="voxel-modal-backdrop">
          <section role="dialog" aria-modal="true" className="voxel-modal">
            <button
              className="voxel-modal-close"
              aria-label="关闭菜单"
              onClick={() => setMenu(false)}
            >
              ×
            </button>
            <span className="voxel-kicker">CAMP RECORDS</span>
            <h2>留下这座立体营地。</h2>
            <p>
              体素存档与二维营地分别保存。每分钟自动保存；浏览器清理数据会删除本地存档，请定期导出。
            </p>
            <div className="voxel-save-actions">
              <button
                disabled={busy}
                onClick={() =>
                  void action(async () => {
                    await putSave('manual', await client.export());
                    setSaveStatus('手动保存成功');
                  }, '手动存档已保存')
                }
              >
                保存营地
              </button>
              <button
                disabled={busy}
                onClick={() =>
                  void action(async () => {
                    const save = await getSave('manual');
                    if (!save) throw new Error('还没有手动存档');
                    await client.import(save);
                    setMenu(false);
                  })
                }
              >
                读取营地
              </button>
              <button
                disabled={busy}
                onClick={() =>
                  void action(async () => {
                    const save = await getSave('auto');
                    if (!save) throw new Error('还没有自动存档');
                    await client.import(save);
                    setMenu(false);
                  })
                }
              >
                读取自动存档
              </button>
              <button
                disabled={busy}
                onClick={() =>
                  void action(async () => {
                    const save = await client.export(),
                      url = URL.createObjectURL(
                        new Blob([JSON.stringify(save)], { type: 'application/json' }),
                      ),
                      a = document.createElement('a');
                    a.href = url;
                    a.download = `emberfield-voxel-${save.seed}-${save.tick}.json`;
                    a.click();
                    setTimeout(() => URL.revokeObjectURL(url), 1000);
                  })
                }
              >
                导出体素存档
              </button>
              <button disabled={busy} onClick={() => file.current?.click()}>
                导入体素存档
              </button>
              <input
                ref={file}
                type="file"
                accept=".json"
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f)
                    void action(async () => {
                      if (f.size > 4 * 1024 * 1024) throw new Error('存档超过 4 MiB 上限');
                      await client.import(JSON.parse(await f.text()));
                      setMenu(false);
                    });
                  e.target.value = '';
                }}
              />
            </div>
            <p className="voxel-kicker">{saveStatus}</p>
            {s && <ThreatControl snapshot={s} command={(c) => void client.command(c)} />}
            <WorldSetup
              client={client}
              busy={busy}
              create={async (seed, settings, site) => {
                await action(async () => {
                  if (site) await client.newSiteGame(site);
                  else await client.newGame(seed, settings);
                  setMenu(false);
                }, '新世界已生成，时间暂停');
              }}
            />
            <details>
              <summary>试玩规则与性能计数</summary>
              <p>
                64×64×16；逻辑 20 TPS，1 日 10
                分钟。两格净空，一格高差可走；梯子可携货。种植、烹饪、床位、作息、电网、冷库保鲜、有限仓储和岩块切石已接通。新世界有三种生态和四档起伏，土壤肥力与季节气温影响生产。断粮、过冷或过热会逐渐损害健康，严重时倒地甚至死亡；同伴可以救援到医疗床并喂食。种棉获得布料，手工裁缝台制作衣物，实际穿戴后改变温度耐受；每件独立保存品质与耐久。新营地配基础布衫和长裤，旧存档保留原装备。天然岩石有机会留下岩块，切石台加工后才能用于石砖墙和楼板；切石与衣物科技暂默认解锁。采用简化天光和三维导热。近战与射击会造成部位伤口；部分伤口可能延迟感染，需要关注护理和免疫进展。药根成熟后产出草药，医生按患者政策实际取药护理；感染者可前往医疗床休养。天气变化会影响露天行走、射击、降水灭火与积雪通行；真实屋顶可遮挡降水。其他疾病、坍塌和流体尚未实现。
              </p>
              <p>
                地形数组 {((s?.gridBytes ?? 0) / 1024).toFixed(0)} KiB；寻路数组{' '}
                {((s?.navigationBytes ?? 0) / 1024).toFixed(0)} KiB；最近平均 tick{' '}
                {(s?.tickMs ?? 0).toFixed(2)} ms。以下为渲染计数，并非整页或 GPU 驱动内存。
              </p>
              <p>
                房间工作数组 {((s?.roomBytes ?? 0) / 1024).toFixed(0)}{' '}
                KiB；房间编号仅在地形或门位置变化时重新计算。 电网数组{' '}
                {((s?.powerBytes ?? 0) / 1024).toFixed(0)} KiB；热模型数组{' '}
                {((s?.thermalBytes ?? 0) / 1024).toFixed(0)} KiB。
              </p>
              <pre>{JSON.stringify(state.metrics, null, 2)}</pre>
            </details>
            <a className="voxel-return" href="?">
              返回二维营地（请先保存） ↗
            </a>
          </section>
        </div>
      )}
    </div>
  );
}
declare global {
  interface Window {
    voxel: {
      snapshot: VoxelClient['snapshot'];
      project: VoxelClient['project'];
      exportSave: VoxelClient['export'];
      blockAt: VoxelClient['blockAt'];
      ladderAt: VoxelClient['ladderAt'];
      exploredAt: VoxelClient['exploredAt'];
    };
  }
}
window.voxel = {
  snapshot: client.snapshot,
  project: client.project,
  exportSave: client.export,
  blockAt: client.blockAt,
  ladderAt: client.ladderAt,
  exploredAt: client.exploredAt,
};
createRoot(document.getElementById('root')!).render(<App />);
