import { defaultShelfSettings, isShelfKind, validStorageSettings, type Shelf, type StorageSettings } from './shelves';
import type { Cargo, CommandResult, Job, Pawn, VoxelCommand } from './types';

/** Members are stable inner-building identities, including blueprints and
 * packed shelves. Inventory and capacity still belong to physical map cells. */
export interface StorageGroup { id: number; name: string; memberIds: number[]; settings: StorageSettings }
interface Host {
  shelves: Shelf[]; jobs: Job[]; items: Cargo[]; pawns: Pick<Pawn,'cargo'>[];
  storageGroups: StorageGroup[]; nextId: number;
}
interface Member { id: number; settings: StorageSettings; set: (settings: StorageSettings) => void }
const copy = (s: StorageSettings): StorageSettings => ({priority:s.priority,accepts:[...s.accepts]});
const validName = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0 &&
  v.trim().length <= 40 && !/[\u0000-\u001f\u007f]/.test(v);

function members(s: Pick<Host,'shelves'|'jobs'|'items'|'pawns'>): Member[] {
  const out: Member[] = s.shelves.map(m=>({id:m.id,settings:m.settings,set:value=>{m.settings=copy(value);}}));
  for(const j of s.jobs) if(isShelfKind(j.kind)&&!j.cancelled) out.push({id:j.id,
    settings:j.storageSettings!,set:value=>{j.storageSettings=copy(value);}});
  for(const b of [...s.items,...s.pawns.flatMap(p=>p.cargo?[p.cargo]:[]),...s.jobs.flatMap(j=>j.deliveredBatches)]) {
    const f=b.furniture;
    if(f && 'settings' in f) out.push({id:f.id,settings:f.settings,set:value=>{f.settings=copy(value);}});
  }
  return out;
}
export function effectiveShelfSettings(groups: StorageGroup[], id: number, local: StorageSettings): StorageSettings {
  return groups.find(g=>g.memberIds.includes(id))?.settings ?? local;
}
/** Run after committed lifecycle changes, never during placement trials.
 * Ordinary despawn/uninstall keeps its packed identity and therefore its group. */
export function reconcileStorageGroups(s: Host): void {
  if(!s.storageGroups.length)return;
  const alive=new Map(members(s).map(m=>[m.id,m]));
  s.storageGroups=s.storageGroups.filter(g=>{
    g.memberIds=g.memberIds.filter(id=>alive.has(id));
    if(g.memberIds.length>1)return true;
    for(const id of g.memberIds)alive.get(id)!.set(g.settings);
    return false;
  });
}
function detach(s:Host,member:Member) {
  const old=s.storageGroups.find(g=>g.memberIds.includes(member.id));
  if(!old)return;
  member.set(old.settings);
  old.memberIds=old.memberIds.filter(id=>id!==member.id);
  reconcileStorageGroups(s);
}
export function storageGroupCommand(s:Host,c:VoxelCommand):CommandResult|null {
  if(!['shelfStorage','shelfLink','shelfUnlink','shelfGroupRename'].includes(c.type))return null;
  if(c.type==='shelfGroupRename') {
    const group=s.storageGroups.find(g=>g.id===c.groupId);
    if(!group||!validName(c.name))return {ok:false,message:'储存组不存在，或名称需要1到40个字符'};
    group.name=c.name.trim();return {ok:true,message:'储存组已重命名'};
  }
  const all=members(s),byId=new Map(all.map(m=>[m.id,m]));
  if(c.type==='shelfStorage') {
    const member=byId.get(c.shelfId),value={priority:c.priority,accepts:c.accepts};
    if(!member||!validStorageSettings(value))return {ok:false,message:'货架或接纳设置无效'};
    const group=s.storageGroups.find(g=>g.memberIds.includes(member.id));
    if(group)group.settings=copy(value);else member.set(value);
    return {ok:true,message:group?'整组货架设置已更新；现有货物等待实际搬运':'货架设置已更新；现有货物等待实际搬运'};
  }
  if(c.type==='shelfUnlink') {
    const member=byId.get(c.shelfId);
    if(!member||!s.storageGroups.some(g=>g.memberIds.includes(member.id)))return {ok:false,message:'这座货架没有联动设置'};
    detach(s,member);return {ok:true,message:'已解除联动，保留当前收纳设置'};
  }
  if(c.type==='shelfLink') {
    if(!Array.isArray(c.memberIds)||!c.memberIds.length||c.memberIds.length>1024)return {ok:false,message:'请选择要联动的货架'};
    const ids=[c.sourceId,...c.memberIds];
    if(new Set(ids).size!==ids.length||ids.some(id=>!byId.has(id)))return {ok:false,message:'只能联动不同的现有货架或货架蓝图'};
    const source=byId.get(c.sourceId)!;
    let group=s.storageGroups.find(g=>g.memberIds.includes(source.id));
    if(new Set([...(group?.memberIds ?? [source.id]),...c.memberIds]).size>1024)
      return {ok:false,message:'每个储存组最多联动 1024 座货架'};
    if(!group) {
      if(s.storageGroups.length>=512)return {ok:false,message:'储存组数量已达上限'};
      const id=s.nextId++;
      group={id,name:`储存组 ${id}`,memberIds:[source.id],settings:copy(source.settings)};
      // Add only after detach completes: temporary singleton groups must not
      // be dissolved by cleanup of a member's previous group.
    }
    const target=group;
    for(const id of c.memberIds)if(!target.memberIds.includes(id)) {
      detach(s,byId.get(id)!);target.memberIds.push(id);
    }
    if(!s.storageGroups.includes(target))s.storageGroups.push(target);
    return {ok:true,message:`已联动 ${target.memberIds.length} 座货架，采用来源货架的设置`};
  }
  return null;
}

const list=(v:unknown):any[]=>Array.isArray(v)?v:[];
const record=(v:unknown):v is Record<string,any>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const own=(v:unknown,k:string)=>record(v)&&Object.hasOwn(v,k);
const fail=(why:string):never=>{throw new Error('储存组存档无效：'+why);};
export function rejectLegacyStorageGroups(d:Record<string,any>,version:number) {
  if(version<38&&(Object.hasOwn(d,'storageGroups')||list(d.jobs).some(j=>own(j,'storageSettings'))))
    fail('旧版本包含新版联动设置字段');
}
export function migrateStorageGroups(d:Record<string,any>,version:number) {
  if(version>=38)return;
  d.storageGroups=[];
  for(const j of list(d.jobs))if(isShelfKind(j?.kind))j.storageSettings=defaultShelfSettings();
}
export function validateStorageGroups(d:Record<string,any>) {
  if(!Array.isArray(d.storageGroups)||d.storageGroups.length>512)fail('组列表无效');
  for(const j of d.jobs) {
    if(isShelfKind(j.kind)?!validStorageSettings(j.storageSettings):Object.hasOwn(j,'storageSettings'))
      fail('施工蓝图设置与建筑类型不符');
  }
  const all=members(d as Host),memberIds=new Set(all.map(m=>m.id)),claimed=new Set<number>(),groupIds=new Set<number>();
  for(const g of d.storageGroups) {
    if(!record(g)||Object.keys(g).length!==4||!['id','name','memberIds','settings'].every(k=>own(g,k))||
       !Number.isSafeInteger(g.id)||g.id<=0||g.id>=d.nextId||groupIds.has(g.id)||memberIds.has(g.id)||
       !validName(g.name)||g.name!==g.name.trim()||!validStorageSettings(g.settings)||
       !Array.isArray(g.memberIds)||g.memberIds.length<2||g.memberIds.length>1024)fail('组身份、名称、成员数或设置无效');
    groupIds.add(g.id);
    for(const id of g.memberIds) {
      if(!memberIds.has(id)||claimed.has(id))fail('成员不存在、已取消或被重复联动');
      claimed.add(id);
    }
  }
}
