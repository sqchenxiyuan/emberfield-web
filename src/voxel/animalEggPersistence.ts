import { at, CELLS, type VoxelSave } from './types';
import { EGG_RULES, eggLayerActive } from './animalEggs';
import { defaultProductionQueue, productionJobRecipe, type ProductionHost } from './productionBills';

export function rejectLegacyEggs(old: Record<string, any>, version: number): void {
  if (version >= 51) return;
  const visit = (node: any): void => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      if (node.some(v => ['chicken','eggUnfertilized','eggFertilized'].includes(v))) throw new Error('旧版本混入鸡或鸡蛋筛选');
    } else for (const [key,value] of Object.entries(node)) {
      if (['chicken','eggUnfertilized','eggFertilized','hatcher','eggProgress','fertilizationCount','eggFatherId','layProgress'].includes(key) ||
        (key === 'species' && value === 'chicken') || (key === 'resource' && ['eggUnfertilized','eggFertilized'].includes(value as string)) ||
        (['kind','phase'].includes(key) && ['layEgg','laidEgg','fertilized','hatched'].includes(value as string)))
        throw new Error('旧版本混入产蛋或孵化字段');
    }
    Object.values(node).forEach(visit);
  };
  visit(old);
}
export function migrateEggs(old: Record<string, any>, version: number): void {
  if (version >= 51) return;
  for (const a of old.animals ?? []) Object.assign(a, {eggProgress:0,fertilizationCount:0,eggFatherId:null,layProgress:0});
  for (const m of old.penMarkers ?? []) m.filter.chicken=false;
  for (const l of [old.stats?.produced,old.stats?.consumed,old.stats?.destroyed,old.stats?.spoiled,old.trade?.imported,old.trade?.exported]) {
    if (!l || typeof l !== 'object') throw new Error('旧版资源账本缺失');
    l.eggUnfertilized=0;l.eggFertilized=0;
  }
  // Freeze all legacy implicit bill choices before adding new ingredients and
  // butcher species. Explicit empty queues must stay empty.
  for (const bench of [...old.stoves,...old.butcherSpots,...old.stonecutters,...old.tailors,...old.weaponBenches]) {
    if (old.productionQueues.some((q:any)=>q.benchId===bench.id))continue;
    const q=defaultProductionQueue(old as ProductionHost,bench.id);
    if(!q)throw new Error('旧版隐式生产账单缺失');
    old.productionQueues.push(q);
    for(const j of old.jobs)if(!j.cancelled&&j.billId===undefined&&j.x===bench.x&&j.y===bench.y&&j.z===bench.z){
      const recipe=productionJobRecipe(j);if(recipe)j.billId=`legacy:${bench.id}:${recipe}`;
    }
  }
  const visit=(node:any):void=>{
    if(!node||typeof node!=='object')return;
    if(Array.isArray(node.allowedFood))node.allowedFood=node.allowedFood.filter((r:string)=>!['eggUnfertilized','eggFertilized'].includes(r));
    if(Array.isArray(node.allowedCarcasses))node.allowedCarcasses=node.allowedCarcasses.filter((s:string)=>s!=='chicken');
    Object.values(node).forEach(visit);
  };
  visit(old);
}
export function validateEggs(d: VoxelSave): void {
  const id=(n:unknown)=>Number.isSafeInteger(n)&&Number(n)>0&&Number(n)<d.nextId;
  const nonAnimalIds=new Set(Object.entries(d).filter(([key,value])=>key!=='animals'&&Array.isArray(value))
    .flatMap(([,value])=>(value as any[]).map(v=>v?.id).filter(id)));
  const parents=(mother:number|null,father:number|null)=>{
    for(const [value,sex] of [[mother,'female'],[father,'male']] as const) {
      if(value===null)continue;
      if(!id(value)||nonAnimalIds.has(value))throw new Error('孵化父母身份无效');
      const animal=d.animals.find(a=>a.id===value);
      if(animal&&(animal.species!=='chicken'||animal.sex!==sex))throw new Error('孵化父母物种或性别无效');
    }
  };
  for(const a of d.animals){
    if(!Number.isFinite(a.eggProgress)||a.eggProgress<0||a.eggProgress>1||
      !Number.isInteger(a.fertilizationCount)||a.fertilizationCount<0||a.fertilizationCount>EGG_RULES.fertilizationMax||
      !Number.isInteger(a.layProgress)||a.layProgress<0||a.layProgress>EGG_RULES.layWork||
      (a.eggFatherId!==null&&!id(a.eggFatherId))||
      (a.fertilizationCount===0)!==(a.eggFatherId===null))throw new Error('产蛋进度或受精额度无效');
    if((a.species!=='chicken'||a.sex!=='female')&&(a.eggProgress||a.fertilizationCount||a.eggFatherId!==null||a.layProgress))
      throw new Error('非母鸡含产蛋状态');
    if(a.species==='chicken'&&a.pregnancy)throw new Error('卵生动物不应怀孕');
    if(a.eggFatherId!==null)parents(a.id,a.eggFatherId);
    if(a.goal?.kind==='layEgg') {
      if(!eggLayerActive(a)||a.eggProgress!==1||a.mateId!==null||a.eatProgress!==0||a.phase!=='layEgg'||
        !Number.isInteger(a.goal.id)||a.goal.id<0||a.goal.id>=CELLS||
        (a.layProgress>0&&(a.path.length!==0||at(a)!==a.goal.id)))throw new Error('产蛋任务状态无效');
    } else if(a.layProgress!==0||a.phase==='layEgg')throw new Error('产蛋工作缺少目标');
  }
  const visit=(node:any):void=>{
    if(!node||typeof node!=='object')return;
    if(node.hatcher)parents(node.hatcher.motherId,node.hatcher.fatherId);
    Object.values(node).forEach(visit);
  };
  visit(d);
}
