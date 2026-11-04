import { at, inside, position, WIDTH, DEPTH, HEIGHT, type Pos, type Pawn, type WildAnimal,
  type VoxelCommand, type CommandResult, type VoxelSave } from './types';
import { PEN_RULES, buildPenTopology, penAcceptsAnimal, planRopePath,
  planAreaReturnPath, type PenTopology, type PenSummary, type PenMarker, type AnimalArea } from './pens';
import { ANIMAL_HUSBANDRY, HUSBANDRY_RULES } from './husbandry';
import { healthSummary } from './survival';
import { plantRandom } from './plants';

export interface PensHost extends Pick<VoxelSave, 'fences' | 'fenceGates' | 'penMarkers' | 'animalAreas' |
  'animals' | 'pawns' | 'grass' | 'husbandryLog' | 'items'> {
  tick: number; seed: number; nextId: number; revision: number; notice: string;
  penNeighbors(p: Pos, mode: 'enclosure' | 'rope'): number[];
  penStandable(p: Pos): boolean;
  animalNeighbors(a: WildAnimal, p: Pos): number[];
  animalMoveTicks(a: WildAnimal, from: Pos): number;
  animalGrassSite(p: Pos): boolean;
  prisonRelease(p: Pawn): void;
  penApproach(p: Pawn, target: Pos): number[] | null;
  penMoveHandler(p: Pawn, next: number): boolean;
  pawnAllowed?(pawn: Pawn, target: Pos): boolean;
}
const adjacent = (a: Pos, b: Pos) => a.z === b.z && Math.abs(a.x-b.x)+Math.abs(a.y-b.y) === 1;
const edge = (p: Pos) => p.x === 0 || p.y === 0 || p.x === WIDTH-1 || p.y === DEPTH-1;
const pawnAllowed = (s: PensHost, p: Pawn, target: Pos) => s.pawnAllowed?.(p, target) ?? true;
const cache = new WeakMap<PensHost, { revision: number; topology: PenTopology[]; cells: Map<number, Set<number>> }>();
function topology(s: PensHost) {
  let entry = cache.get(s);
  if (!entry || entry.revision !== s.revision) {
    const regions = buildPenTopology(s.penMarkers, p => s.penNeighbors(p, 'enclosure'), p => s.penStandable(p));
    const shared = new Map<number[], Set<number>>();
    entry = { revision: s.revision, topology: regions, cells: new Map(regions.map(region => {
      let cells = shared.get(region.cells); if (!cells) { cells = new Set(region.cells); shared.set(region.cells, cells); }
      return [region.markerId, cells];
    })) };
    cache.set(s, entry);
  }
  return entry;
}
export function penCells(s: PensHost, markerId: number): Set<number> | null {
  const entry = topology(s);
  return entry.topology.find(r => r.markerId === markerId)?.closed ? entry.cells.get(markerId)! : null;
}
function eligiblePens(s: PensHost, a: WildAnimal): PenMarker[] {
  return s.penMarkers.filter(marker => penAcceptsAnimal(marker, a) && penCells(s, marker.id) &&
    (a.requestedPenId === null || marker.id === a.requestedPenId));
}
function isHoused(s: PensHost, a: WildAnimal): boolean {
  return eligiblePens(s, a).some(marker => penCells(s, marker.id)!.has(at(a)));
}
export function penSummaries(s: PensHost): PenSummary[] {
  return topology(s).topology.map(region => {
    const cells = topology(s).cells.get(region.markerId)!;
    const animals = s.animals.filter(a => !a.dead && a.faction === 'colony' && ANIMAL_HUSBANDRY[a.species].penAnimal && cells.has(at(a)));
    return { ...region, animalIds: animals.map(a => a.id),
      pendingAnimalIds: s.pawns.filter(p => p.ropeTask?.penId === region.markerId).map(p => p.ropeTask!.animalId),
      grassNutrition: s.grass.filter(g => cells.has(at(g)) && s.animalGrassSite(g))
        .reduce((sum,g) => sum + g.growth * HUSBANDRY_RULES.grassNutrition, 0),
      nutritionPerDay: animals.reduce((sum,a) => sum + ANIMAL_HUSBANDRY[a.species].nutritionPerDay *
        (a.growth < HUSBANDRY_RULES.juvenileGrowth ? .4 : a.growth < 1 ? .75 : 1), 0) };
  });
}
function resetAnimal(a: WildAnimal) {
  a.path = []; a.goal = null; a.mateId = null; a.mateProgress = 0; a.eatProgress = 0;
  a.layProgress = 0;
  if (!a.dead) a.phase = 'roam';
}
export function cancelAnimalRopes(s: PensHost, animalId?: number, markerId?: number) {
  for (const p of s.pawns) if (p.ropeTask && (animalId === undefined || p.ropeTask.animalId === animalId) &&
      (markerId === undefined || p.ropeTask.penId === markerId)) s.prisonRelease(p);
}
export function removePenMarker(s: PensHost, markerId: number) {
  cancelAnimalRopes(s, undefined, markerId);
  for (const a of s.animals) if (a.requestedPenId === markerId) a.requestedPenId = null;
  s.penMarkers = s.penMarkers.filter(marker => marker.id !== markerId); s.revision++;
}
const areaCache = new WeakMap<AnimalArea,{source:number[];cells:Set<number>}>();
function areaContains(area:AnimalArea,cell:number) {
  let cached=areaCache.get(area);
  if(!cached||cached.source!==area.cells){cached={source:area.cells,cells:new Set(area.cells)};areaCache.set(area,cached);}
  return cached.cells.has(cell);
}
export function animalAllowed(s: PensHost, a: WildAnimal, p: Pos): boolean {
  const area=s.animalAreas.find(area=>area.id===a.allowedAreaId);
  return a.allowedAreaId === null || !!area&&(!area.cells.length||areaContains(area,at(p)));
}
const validName = (name: unknown): name is string => typeof name === 'string' && !!name.trim() && name.trim().length <= 40;
export function pensCommand(s: PensHost, c: VoxelCommand): CommandResult | null {
  if (c.type === 'fenceGate') {
    const gate = s.fenceGates.find(g => g.id === c.gateId);
    if (!gate || !['auto','open','locked'].includes(c.mode)) return { ok:false,message:'栏门或模式无效' };
    if (c.mode === 'locked' && [...s.pawns,...s.animals,...s.items].some(a => at(a) === at(gate)))
      return { ok:false,message:'栏门正被占用，暂不能锁闭' };
    gate.mode = c.mode; gate.openUntil = 0; s.revision++;
    cancelAnimalRopes(s); return { ok:true,message:c.mode === 'open'?'栏门保持敞开，请检查圈地边界':'栏门模式已更新' };
  }
  if (c.type === 'penFilter' || c.type === 'penName') {
    const marker = s.penMarkers.find(m => m.id === c.markerId);
    if (!marker) return { ok:false,message:'圈地标记不存在' };
    if (c.type === 'penName') {
      if (!validName(c.name)) return { ok:false,message:'圈地名称需要1到40个字符' };
      marker.name = c.name.trim();
    } else {
      if (!c.filter || Object.keys(c.filter).length !== 6 || !['deer','dromedary','alpaca','chicken','male','female'].every(k =>
        typeof c.filter[k as keyof typeof c.filter] === 'boolean')) return { ok:false,message:'圈地筛选无效' };
      marker.filter = {...c.filter}; cancelAnimalRopes(s, undefined, marker.id);
      for (const a of s.animals) if (ANIMAL_HUSBANDRY[a.species].penAnimal) a.retryTick = 0;
    }
    s.revision++; return { ok:true,message:'圈地设置已更新，饲养员将重新评估牵引' };
  }
  if (c.type === 'ropeAnimal') {
    const a = s.animals.find(a => a.id === c.animalId && !a.dead && a.faction === 'colony' && ANIMAL_HUSBANDRY[a.species].penAnimal);
    if (!a || typeof c.paused !== 'boolean' || (c.penId !== null && !s.penMarkers.some(m => m.id === c.penId)))
      return { ok:false,message:'只能为殖民地圈养动物指定现有圈地或自动安排' };
    cancelAnimalRopes(s, a.id); a.requestedPenId = c.penId; a.ropePaused = c.paused; a.retryTick = 0;
    return { ok:true,message:c.paused?'已暂停此动物的牵引；动物仍在当前位置':'已安排牵引，等待饲养员与有效通路' };
  }
  if (c.type === 'animalAreaCreate') {
    if (!validName(c.name) || s.animalAreas.length >= PEN_RULES.maxAreas) return { ok:false,message:'名称无效或活动范围数量已达上限' };
    const id = s.nextId++, colors = [0x68b2a0,0xdcb668,0x86aada,0xd490b4,0xb0be6a];
    s.animalAreas.push({id,name:c.name.trim(),color:colors[id % colors.length],cells:[]}); s.revision++;
    return { ok:true,message:'活动范围已创建，请在地图上绘制',areaId:id };
  }
  if (c.type === 'animalAreaAssign') {
    const a = s.animals.find(a => a.id === c.animalId && !a.dead && a.faction === 'colony' && a.species === 'hare');
    if (!a || (c.areaId !== null && !s.animalAreas.some(area => area.id === c.areaId))) return { ok:false,message:'活动范围用于殖民地兔，鹿使用圈地管理' };
    a.allowedAreaId = c.areaId; resetAnimal(a); a.decisionTick = s.tick;
    return { ok:true,message:'活动范围已分配，动物将自行寻找可达通路' };
  }
  if (c.type === 'animalAreaRename' || c.type === 'animalAreaDelete' || c.type === 'animalAreaPaint') {
    const area = s.animalAreas.find(a => a.id === c.areaId);
    if (!area) return { ok:false,message:'活动范围不存在' };
    if (c.type === 'animalAreaRename') {
      if (!validName(c.name)) return { ok:false,message:'活动范围名称需要1到40个字符' };
      area.name = c.name.trim();
    } else if (c.type === 'animalAreaDelete') {
      s.animalAreas = s.animalAreas.filter(a => a !== area);
      for (const a of s.animals) if (a.allowedAreaId === area.id) { a.allowedAreaId = null; resetAnimal(a); }
    } else {
      const to = c.to ?? c.from;
      if (!inside(c.from) || !inside(to) || c.from.z !== to.z || typeof c.erase !== 'boolean')
        return { ok:false,message:'请在同一楼层绘制或擦除活动范围' };
      const cells = new Set(area.cells);
      for (let y=Math.min(c.from.y,to.y); y<=Math.max(c.from.y,to.y); y++)
        for (let x=Math.min(c.from.x,to.x); x<=Math.max(c.from.x,to.x); x++) {
          const cell = at({x,y,z:c.from.z}); if (c.erase) cells.delete(cell); else cells.add(cell);
        }
      if (cells.size > PEN_RULES.maxAreaCells) return { ok:false,message:'活动范围过大，请缩小选择' };
      area.cells = [...cells].sort((a,b)=>a-b);
      for (const a of s.animals) if (a.allowedAreaId === area.id) { resetAnimal(a); a.decisionTick = s.tick; }
    }
    s.revision++; return { ok:true,message:'活动范围已更新；绘制范围不会改变地形或瞬移动物' };
  }
  return null;
}
function canRope(p: Pawn) {
  const h=healthSummary(p);
  return p.faction==='colony'&&!p.dead&&!p.downed&&!p.drafted&&p.carriedBy===null&&p.carryingPawnId===null&&
    p.priorities.handle>0&&!p.cargo&&p.food>=30&&p.rest>=20&&h.manipulation>0&&h.moving>.15;
}
/** Restrict the animal's storage destination, not the handler's adjacent stand
 * or the physical edges either of them crosses. */
function ropePath(s: PensHost, p: Pawn, animal: Pos, handler: Pos, cells: Set<number>) {
  return planRopePath(animal,handler,cells,q=>s.penNeighbors(q,'rope'),
    a=>pawnAllowed(s,p,a));
}
function ropeEndAllowed(s: PensHost, p: Pawn, animal: Pos, handler: Pos, path: number[]) {
  const lastAnimal = path.length > 1 ? position(path.at(-2)!) : path.length ? handler : animal;
  return pawnAllowed(s,p,lastAnimal);
}
export function tryRope(s: PensHost,p: Pawn): boolean {
  if (!canRope(p)) return false;
  for (const a of s.animals) {
    if (a.dead || a.faction!=='colony' || !ANIMAL_HUSBANDRY[a.species].penAnimal || a.ropePaused || a.slaughter || a.releaseMarked ||
        a.fleeUntil>s.tick || a.retryTick>s.tick || s.pawns.some(q=>q.ropeTask?.animalId===a.id||q.handleTask?.animalId===a.id) || isHoused(s,a)) continue;
    if (!pawnAllowed(s,p,a)) continue;
    const availablePens=eligiblePens(s,a);
    if (!availablePens.length) { a.reason='等待接受此动物的封闭圈地'; a.retryTick=s.tick+PEN_RULES.ropeRetryTicks; continue; }
    const pens=availablePens.filter(m=>[...penCells(s,m.id)!].some(cell=>pawnAllowed(s,p,position(cell))))
      .sort((x,y)=>Math.abs(x.x-a.x)+Math.abs(x.y-a.y)-Math.abs(y.x-a.x)-Math.abs(y.y-a.y));
    if (!pens.length) continue;
    const candidates = s.penNeighbors(a,'rope').map(position).filter(q=>adjacent(q,a))
      .flatMap(stand => { const route=s.penApproach(p,stand);return route===null?[]:[{stand,route}]; });
    let chosen: {marker:PenMarker;route:number[];length:number}|null=null;
    for(const {stand,route} of candidates)for(const marker of pens) {
      const lead=ropePath(s,p,a,stand,penCells(s,marker.id)!);
      if(lead!==null&&(!chosen||route.length+lead.length<chosen.length))chosen={marker,route,length:route.length+lead.length};
    }
    if (!chosen) { p.reason='允许区域内没有可用的圈地收纳点或牵引通路'; continue; }
    const {marker,route}=chosen;
    s.prisonRelease(p); resetAnimal(a);
    p.ropeTask={animalId:a.id,penId:marker.id,stage:'approach',progress:0,path:[]};
    p.path=route; p.destination=route.at(-1)??null; p.phase='rope'; p.reason='靠近'+a.name+'，准备牵入'+marker.name;
    return true;
  }
  return false;
}
export function ropeTick(s:PensHost,p:Pawn) {
  const task=p.ropeTask;if(!task)return;
  const a=s.animals.find(a=>a.id===task.animalId), marker=s.penMarkers.find(m=>m.id===task.penId);
  const cells=marker?penCells(s,marker.id):null;
  const cancel=(reason:string,retry=true)=>{if(a){if(retry)a.retryTick=s.tick+PEN_RULES.ropeRetryTicks;a.reason=reason;}s.prisonRelease(p);p.reason=reason;};
  if(!a||!marker||!cells||!penAcceptsAnimal(marker,a)||a.dead||a.ropePaused||a.slaughter||a.releaseMarked||
      a.fleeUntil>s.tick||!canRope(p)||(a.requestedPenId!==null&&a.requestedPenId!==marker.id)) {cancel('牵引条件改变，已解绳并保留当前位置');return;}
  if(((task.stage==='approach'||task.stage==='attach')&&!pawnAllowed(s,p,a))||
      ((task.stage==='lead'||task.stage==='detach')&&!ropeEndAllowed(s,p,a,p,task.path))) {
    cancel('牵引目标或收纳点已在允许区域之外，原地解绳',false);return;
  }
  if(task.stage==='approach') {
    if(!adjacent(p,a)||!s.penNeighbors(a,'rope').includes(at(p))) {
      if(!p.path.length||(s.tick+p.id)%40===0) {
        const paths=s.penNeighbors(a,'rope').map(position).filter(q=>adjacent(q,a))
          .filter(q=>ropePath(s,p,a,q,cells)!==null)
          .map(q=>s.penApproach(p,q)).filter((r):r is number[]=>r!==null).sort((a,b)=>a.length-b.length);
        const path=paths[0]??null;
        if(path===null){cancel('允许区域内没有可用的收纳点或牵引通路',false);return;}p.path=path;p.destination=path.at(-1)??null;
      }
      return;
    }
    p.path=[];p.destination=null;task.stage='attach';task.progress=0;resetAnimal(a);a.phase='rope';
  }
  if(task.stage==='attach') {
    if(!adjacent(p,a)){cancel('挂绳位置已改变');return;}
    p.reason='正在给'+a.name+'挂绳';a.reason=p.name+'正在挂绳';
    if(++task.progress<PEN_RULES.attachWork)return;
    const route=ropePath(s,p,a,p,cells);
    if(route===null){cancel('允许区域内没有可用的圈地终点或牵引通路',false);return;}
    task.path=route;task.stage='lead';task.progress=0;
  }
  if(task.stage==='lead') {
    p.reason='牵引'+a.name+'进入'+marker.name;a.phase='rope';a.reason='跟随'+p.name;
    if(cells.has(at(a))&&ropeEndAllowed(s,p,a,p,[])){task.stage='detach';task.path=[];task.progress=0;}
    else {
      if(!task.path.length || !s.penNeighbors(p,'rope').includes(task.path[0]) || !s.penNeighbors(a,'rope').includes(at(p))) {
        const path=ropePath(s,p,a,p,cells);
        if(path===null){cancel('允许区域内没有可用的牵引终点或通路',false);return;}task.path=path;
      }
      if(s.tick<p.moveTick||s.tick<a.moveTick)return;
      const next=task.path[0];if(next===undefined||next===at(a)){cancel('牵引路径无效，等待重新规划');return;}
      const old={x:p.x,y:p.y,z:p.z}, animalOld={x:a.x,y:a.y,z:a.z};
      if(s.penMoveHandler(p,next)) {
        Object.assign(a,old);a.moveTick=s.tick+s.animalMoveTicks(a,animalOld);task.path.shift();
      }
      return;
    }
  }
  if(task.stage==='detach') {
    if(!cells.has(at(a))){cancel('动物已离开目标圈地');return;}
    p.reason='解绳，让'+a.name+'在圈内活动';a.reason='等待解绳';
    if(++task.progress<PEN_RULES.detachWork)return;
    a.nextRoamTick=s.tick+PEN_RULES.roamReturnCooldownTicks;a.reason='已牵入'+marker.name;
    s.prisonRelease(p);s.notice=a.name+'已经牵入'+marker.name;
  }
}
function animalStep(s:PensHost,a:WildAnimal) {
  if(!a.path.length||s.tick<a.moveTick)return;
  const next=a.path[0];
  if(!s.animalNeighbors(a,a).includes(next)){resetAnimal(a);a.decisionTick=s.tick+40;return;}
  const from={x:a.x,y:a.y,z:a.z};Object.assign(a,position(a.path.shift()!));a.moveTick=s.tick+s.animalMoveTicks(a,from);
}
/** Owns only management movement. Needs, grazing, pregnancy and threat flight remain in husbandry. */
export function animalManagementTick(s:PensHost,a:WildAnimal):boolean {
  const rope=s.pawns.find(p=>p.ropeTask?.animalId===a.id&&p.ropeTask.stage!=='approach');
  if(rope){resetAnimal(a);a.phase='rope';a.reason=rope.reason;return true;}
  if(a.allowedAreaId!==null) {
    const area=s.animalAreas.find(area=>area.id===a.allowedAreaId);
    if(!area){a.allowedAreaId=null;resetAnimal(a);}
    else if(area.cells.length&&!areaContains(area,at(a))) {
      if(a.goal?.kind!=='area'||a.goal.id!==area.id||!a.path.length){
        if(s.tick<a.decisionTick)return true;
        const path=planAreaReturnPath(a,area,p=>s.animalNeighbors(a,p));resetAnimal(a);
        a.decisionTick=s.tick+PEN_RULES.ropeRetryTicks;
        if(path===null){a.reason=area.cells.length?'活动范围不可达，请检查门和通路':'活动范围为空，请绘制范围或取消限制';return true;}
        a.path=path;a.goal={kind:'area',id:area.id};
      }
      a.phase='roam';a.reason='返回活动范围：'+area.name;animalStep(s,a);return true;
    }else if(a.goal?.kind==='area')resetAnimal(a);
  }
  if(a.faction!=='colony'||!ANIMAL_HUSBANDRY[a.species].penAnimal)return false;
  if(a.goal?.kind==='exit') {
    if(isHoused(s,a)){resetAnimal(a);return false;}
    if(edge(a)) {
      cancelAnimalRopes(s,a.id);
      for(const p of s.pawns)if(p.handleTask?.animalId===a.id)s.prisonRelease(p);
      for(const b of s.animals)if(b.mateId===a.id)resetAnimal(b);
      s.animals=s.animals.filter(b=>b!==a);
      s.husbandryLog.push({tick:s.tick,kind:'escaped',animalId:a.id,otherId:null,message:a.name+'从未封闭的营地漫游离开了地图'});
      s.husbandryLog=s.husbandryLog.slice(-HUSBANDRY_RULES.maxLog);s.notice=a.name+'已离开地图，请修复圈地或安排牵引';
      return true;
    }
    if(!a.path.length){resetAnimal(a);return false;}
    a.phase='roam';a.reason='未受圈地约束，正在向地图边缘漫游';animalStep(s,a);return true;
  }
  if(s.tick<PEN_RULES.roamGraceTicks||s.tick<a.nextRoamTick)return false;
  a.nextRoamTick=s.tick+PEN_RULES.roamCheckTicks;
  if(isHoused(s,a)||s.pawns.some(p=>p.ropeTask?.animalId===a.id||p.handleTask?.animalId===a.id)||
      plantRandom(s.seed,a.id,s.tick,1301)>=PEN_RULES.roamChance)return false;
  const targets:number[]=[];
  for(let z=1;z<HEIGHT-1;z++) for(let v=0;v<WIDTH;v++)for(const p of [{x:0,y:v,z},{x:WIDTH-1,y:v,z},{x:v,y:0,z},{x:v,y:DEPTH-1,z}])
    if(s.penStandable(p))targets.push(at(p));
  const path=planAreaReturnPath(a,{id:0,name:'地图边缘',color:0,cells:targets},p=>s.animalNeighbors(a,p));
  if(path===null)return false;
  resetAnimal(a);a.path=path;a.goal={kind:'exit',id:path.at(-1)??at(a)};a.reason='未圈养的鹿准备漫游离图';return true;
}
export function inheritAnimalArea(parent:WildAnimal,child:WildAnimal) { child.allowedAreaId=parent.allowedAreaId; }
