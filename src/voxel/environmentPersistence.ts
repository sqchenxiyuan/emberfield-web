import { freshBatch, isPerishable, validBatch } from './preservation';
import { emptyCounts, type Resource } from './types';

const record = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
const list = (v: unknown): any[] => Array.isArray(v) ? v : [];
function fail(message: string): never { throw new Error('环境存档无效：' + message); }

/** Runs before historic schema migrations. No new HP or wet memory may be
 * smuggled through an old version number and silently replaced. */
export function rejectLegacyEnvironmentFields(old: Record<string, any>): void {
  const jobs=list(old.jobs), pawns=list(old.pawns);
  if(old.version >= 28) {
    if(jobs.some(j=>record(j)&&Object.hasOwn(j,'deliveredFood')))fail('新版仍含旧配送容器字段');
    return;
  }
  const batches=[...list(old.items), ...pawns.map(p=>p?.cargo),
    ...jobs.flatMap(j=>list(j?.deliveredFood)),
    ...list(old.trade?.caravans).flatMap(c=>list(c?.stock)),
    ...list(old.trade?.receipts).flatMap(r=>list(r?.transferred).map(t=>t?.batch))];
  if(jobs.some(j=>record(j)&&Object.hasOwn(j,'deliveredBatches')) ||
    list(old.animals).some(a=>record(a)&&Object.hasOwn(a,'carcassHitPoints')) ||
    batches.some(b=>record(b)&&Object.hasOwn(b,'hitPoints')) ||
    pawns.some(p=>list(p?.psyche?.memories).some(m=>m?.kind==='wet')))
    fail('旧版本包含新版物资耐久、配送容器或淋湿记忆');
}

/** Old ordinary material counters had no condition data. Preserve every real
 * food batch and initialize only the formerly unrepresented full-HP materials. */
export function migrateEnvironment(old: Record<string, any>, sourceVersion: number): void {
  if(sourceVersion >= 28)return;
  if(!Array.isArray(old.jobs))fail('任务列表缺失');
  const resources = Object.keys(emptyCounts()) as Resource[];
  const migrated = old.jobs.map(j => {
    if(!record(j)||!record(j.delivered)||!Array.isArray(j.deliveredFood)||
       j.deliveredFood.length > 6 ||
       j.deliveredFood.some((b: any)=>!validBatch(b)||!isPerishable(b.resource)||Object.hasOwn(b,'hitPoints')) ||
       new Set(j.deliveredFood.map((b: any)=>`${b.resource}/${b.crop ?? ''}`)).size !== j.deliveredFood.length)
      fail('旧配送容器无效');
    const batches=[...j.deliveredFood];
    for(const [resource,amount] of Object.entries(j.delivered)){
      if(!resources.includes(resource as Resource)||!Number.isSafeInteger(amount)||Number(amount)<0||Number(amount)>10000000)
        fail('旧配送数量无效');
      if(Number(amount)>0&&!isPerishable(resource as Resource)) {
        if(resource==='apparel'||resource==='weapon')fail('旧配送材料不能缺少装备身份');
        batches.push(freshBatch(resource as Resource,Number(amount)));
      }
    }
    for (const resource of resources.filter(isPerishable))
      if(j.deliveredFood.filter((b: any)=>b.resource===resource).reduce((sum: number,b: any)=>sum+b.amount,0)!==(j.delivered[resource]??0))
        fail('旧配送食材与数量不一致');
    return batches;
  });
  for (const [index,j] of old.jobs.entries()) {
    j.deliveredBatches=migrated[index];
    delete j.deliveredFood;
  }
}
