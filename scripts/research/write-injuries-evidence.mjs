import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=fileURLToPath(new URL('../../',import.meta.url));
const dir=path.join(root,'docs/research/rimworld/evidence');
const read=name=>JSON.parse(readFileSync(path.join(dir,name),'utf8').replace(/^\uFEFF/,''));
const hash=v=>createHash('sha256').update(v).digest('hex');
const manifests=new Map();
function code(group,type,start,end){
 if(!manifests.has(group))manifests.set(group,read(`${group}-manifest.json`));
 const manifest=manifests.get(group),t=manifest.types.find(t=>t.type===type);assert(t);
 assert.equal(manifest.source_sha256,'eff7d97949f919fb2b151ebfb906e9be749b63410b7dbda78eeebb7972b245c3');
 assert.equal(manifest.engine_sha256,'587a18e18e13acfc7fd8783a44c24c7da0781dadf6b9fb9dd5e2e38a9cdfae78');
 const bytes=readFileSync(path.join(root,t.local_file));assert.equal(hash(bytes),t.sha256);
 const lines=bytes.toString('utf8').split('\n');assert(start>0&&end>=start&&end<=lines.length,`${group}/${type}:${start}-${end} of ${lines.length}`);
 return {group,type,line_start:start,line_end:end,range_sha256:hash(lines.slice(start-1,end).join('\n'))};
}
const xml=read('injuries-xml.json');
const X=(...ids)=>ids.map(xml_record=>{assert(xml.records.some(r=>r.id===xml_record));return{group:'injuries',xml_record};});
const C=(type,a,b)=>code('combat',type,a,b),N=(type,a,b)=>code('injuries',type,a,b),S=(type,a,b)=>code('survival',type,a,b);
const claims=[];
const add=(title,statement,sources,kind='xml-and-static-derived')=>claims.push({id:`IM${String(claims.length+1).padStart(2,'0')}`,title,kind,statement,sources});
add('时间单位','标准健康检查60原版tick，伤口恢复600tick；60000tick/日、2500tick/游戏小时。动作秒与模拟日的项目映射应分开。',[N('Verse.HealthTuning',12,45),C('Verse.HediffCompProperties_TendDuration',29,62),C('Verse.Pawn_HealthTracker',1258,1294)],'static-derived');
add('空手工具','Human双拳8.2伤害/2秒，牙齿8.2/2秒且chanceFactor=.07，头撞5/2秒且factor=.2；缺省tool权重1、AP=-1。Blunt/Bite能力由Maneuver映射到相应伤害。',[...X('ThingDef_Human','ManeuverDef_Smash','ManeuverDef_Bite'),N('Verse.Tool',26,65)]);
add('近战工具分组','初始权重=调整伤害*(1+AP)*accuracyTouch/完整周期*附加选择因子。最高的95%及以上为Best，低于25%为Worst且最终0；其余Mid。Best/Mid组分别分配.75/.25，同组均分后按可用目标再次归一。健康裸拳限定算例只选双拳，不把.07直接解释为7%。',[N('Verse.VerbUtility',208,269),N('RimWorld.Pawn_MeleeVerbs',201,242),N('RimWorld.VerbEntry',26,39)],'static-derived');
add('近战伤害与穿透','最终近战伤害受部位效率、生命阶段和MeleeDamageFactor；缺省AP=调整伤害*.015；生成DamageInfo前伤害随机*.8..1.2但AP先算。伤害起始部位深度Outside，后续传播另算。冷却再乘人物MeleeCooldownFactor。',[N('Verse.VerbProperties',326,386),N('Verse.VerbProperties',506,545),N('Verse.VerbProperties',579,618),N('RimWorld.Verb_MeleeAttackDamage',14,55)],'static-derived');
add('近战命中与躲闪','近战先掷命中再掷躲闪。突袭或不能移动的目标有命中1/躲闪0分支；未倒地但非站立也视为不能移动。普通目标用已结算人物Stat，不能由工具power推断必命中。',[N('RimWorld.Verb_MeleeAttack',43,88),N('RimWorld.Verb_MeleeAttack',126,208)],'static-derived');
add('普通钢匕首','knife柄9/2秒、刃12/1.5秒、尖13/2秒，分别Blunt/Cut/Stab；Steel锋利/钝伤材料倍率均1，未声明近战冷却倍率而Stat默认1。普通品质伤害倍率1，其他品质.8/.9/1.1/1.2/1.45/1.65。人物倍率均1时AP=.135/.18/.195。',[...X('ThingDef_MeleeWeapon_Knife','ThingDef_BaseWeapon','ThingDef_BaseMeleeWeapon','ThingDef_BaseMeleeWeapon_Sharp','ThingDef_BaseMeleeWeapon_Sharp_Quality','ThingDef_Steel','StatDef_MeleeWeapon_DamageMultiplier','StatDef_MeleeWeapon_CooldownMultiplier','StatDef_SharpDamageMultiplier','StatDef_BluntDamageMultiplier'),N('Verse.Tool',65,104),N('Verse.VerbProperties',374,386),code('housing','RimWorld.StatPart_Quality',39,75)]);
add('伤情映射与区别','伤害Def默认hediff先取值、皮肤覆盖可覆盖为hediffSkin、硬部位再优先覆盖hediffSolid；Blunt为Crush/Bruise/Crack。Bruise疼痛.0125且出血默认0；Cut/Stab/Bite疼痛.0125、出血.06，相同伤口恢复主干；Cut/Stab感染启动.15、Bite.30。Cut/Stab的传播差异不能伪装成不同伤情出血系数。',[...X('HediffDef_InjuryBase','HediffDef_Bruise','HediffDef_Bite','HediffDef_Cut','HediffDef_Stab','HediffDef_Crush','DamageDef_Blunt','DamageDef_Bite','DamageDef_Cut','DamageDef_Stab'),N('Verse.InjuryProps',3,20),N('Verse.DamageDef',1,80),S('Verse.HealthUtility',519,531)]);
add('部位生命值','部位maxHP=ceil(声明HP*HealthScale)，当前HP扣同部位伤口、缺失为0、特殊不可摧毁与不破坏部位伤口有至少1HP分支，然后RoundToInt。不存在通用总HP100。',[...X('BodyPartDef_Torso','BodyPartDef_Head','BodyPartDef_Neck','BodyPartDef_Shoulder','BodyPartDef_Arm','BodyPartDef_Hand','BodyPartDef_Finger','BodyPartDef_Leg','BodyPartDef_Foot','BodyPartDef_Toe'),N('Verse.BodyPartDef',14,18),N('Verse.BodyPartDef',137,158),N('Verse.RaceProperties',80,84),C('Verse.HediffSet',581,606)]);
add('身体覆盖','Human结构是父子部位树；coverage是相对父级权重。withChildren=父withChildren*coverage，self=withChildren*max(0,1-各子coverage和)，不是直接把每行coverage当总体概率。按深度/高度与缺失过滤，再乘DamageDef命中因子抽样；此快照并非完整能力/器官模拟器。',[...X('BodyDef_Human','BodyPartDef_Eye','BodyPartDef_Ear','BodyPartDef_Nose','BodyPartDef_Jaw'),N('Verse.BodyPartRecord',20,44),N('Verse.BodyDef',149,203),C('Verse.HediffSet',969,1005),N('Verse.BodyPartDef',142,158)]);
add('疼痛与休克','普通伤口疼痛=Severity*injury.painPerSeverity/HealthScale；死亡、某些人工部位或causesNoPain排除。全身加offset再乘健康/基因/特质factor并钳到0..1。PainShockThreshold缺省.8，休克是倒地条件之一。',[C('Verse.Hediff_Injury',128,140),C('Verse.HediffSet',1328,1368),C('Verse.Pawn_HealthTracker',95,106),N('Verse.HealthTuning',34,36)],'static-derived');
add('伤口出血','未护理、非永久、可出血且非硬/人工等排除状态：伤口Severity*injury.bleedRate*race.bleedRateFactor*part.bleedRate。总和乘阶段totalBleedFactor并除HealthScale。部位默认倍率1、Head2、Neck4。当前Severity1..30线性决定90000..180000tick伤龄止血阈值。',[C('Verse.Hediff_Injury',142,188),C('Verse.HediffSet',1299,1326),N('Verse.RaceProperties',80,84),N('Verse.BodyPartDef',14,18),...X('BodyPartDef_Head','BodyPartDef_Neck')]);
add('失血推进','常规60tick giver调用中总出血B>=.1时BloodLoss加B*.001，否则减.00033333333。对固定伤势且普通调度约增加B/日或恢复1/3/日；B=.099仍走恢复分支。',[C('Verse.HediffGiver_Bleeding',3,16),C('Verse.Pawn_HealthTracker',1258,1294),...X('HediffGiverSetDef_OrganicStandard','ThingDef_Human')]);
add('失血阶段','BloodLoss .15/.30/.45/.60阶段意识offset分别-.1/-.2/-.4/-.4，.60另意识上限.1，1致死。失血严重度是损失指标，不是剩余血量；回血与伤口愈合分开。',[...X('HediffDef_BloodLoss'),S('Verse.Hediff',239,271)]);
add('倒地死亡与断肢','疼痛休克、无法清醒或移动不够等会倒地；死亡还看致死Hediff、必要能力、核心部位效率及累计伤口150*HealthScale。非核心部位HP归0会生成MissingBodyPart；普通护理不会再生缺失肢体，不能只把伤口删掉就恢复部位。',[C('Verse.Pawn_HealthTracker',73,74),C('Verse.Pawn_HealthTracker',642,720),C('Verse.HediffSet',342,363),N('Verse.Hediff_MissingPart',27,27),N('Verse.Hediff_MissingPart',150,205)],'static-derived');
add('新鲜断肢','新鲜外部非硬断肢在父部位未缺失等条件下，以部位maxHP*.12*partBleed*raceBleed出血；年龄90000tick或护理置IsFresh=false停止新鲜状态。缺失标记仍保留。',[...X('HediffDef_MissingBodyPart'),N('Verse.Hediff_MissingPart',89,116),N('Verse.Hediff_MissingPart',150,191)]);
add('伤口恢复预算','非饥饿每600tick：从可自然恢复伤口随机选一处，8/日+非站立4/日+该姿态下CurrentBed.healPerDay，再乘阶段自然恢复因子、HealthScale、InjuryHealingFactor。独立随机选一处已护理伤口加8*(.5+clamp01(Q))/日份额。每次预算*.01；不是每处伤口全额发放。普通床继承4、医院床10。',[C('Verse.Pawn_HealthTracker',1151,1188),N('Verse.HediffUtility',58,71),C('Verse.Hediff_Injury',201,212),...X('ThingDef_SansComfortBedBase','ThingDef_BasicBedBase','ThingDef_Bed','ThingDef_HospitalBed')]);
add('护理资格与任务','正常WorkGiver要求人类病人卧床（自疗例外），动物非站立；征召/强制护理Driver存在地面邻接路径。医生预约病人和药品，走到病人；(int)(600/MedicalTendSpeed)原版tick后完成，离开即时可达范围失败。自疗开关与medCare限制会使任务失败。',[S('RimWorld.WorkGiver_Tend',23,59),S('Verse.Hediff',322,337),N('RimWorld.JobDriver_TendPatient',49,151),...X('JobDef_TendPatient')]);
add('护理批次与药物实物','优先级=max(危及生命1,出血*1.5,护理使严重度降低时.025)，再按严重度排序。单次先选首项；tendAllAtOnce追加同类，否则有药且首项为伤口时追加累计<=20的其他伤口。无药不合并该分支。DoTend仅实际处理时消耗1份药；Medicine.GetMedicineCountToFullyHeal是所需护理批次数估计，不是恢复全部伤口到0的药数。',[S('Verse.Hediff',215,233),C('RimWorld.TendUtility',26,71),C('RimWorld.TendUtility',113,180),N('RimWorld.Medicine',12,49),N('RimWorld.Toils_Tend',11,52)],'static-derived');
add('护理质量','base=clamp((医生最终质量*药效+当前床偏移)*(自疗?.7:1),0,药品上限)；无医生.75，无药药效.3/上限.7。每伤情实际Q=clamp(base+随机[-.25,.25],0,上限)。质量0也会标记护理、普通伤口止血；较高质量促进额外恢复，但伤口恢复Q在1封顶。',[C('RimWorld.TendUtility',10,16),C('RimWorld.TendUtility',90,110),C('Verse.HediffComp_TendDuration',182,200),C('Verse.Hediff_Injury',158,161),C('Verse.Pawn_HealthTracker',1181,1187)],'static-derived');
add('伤口护理永久与疾病护理过期','TendDuration的baseHours缺省-1，即永久护理：成功后tendTicksLeft=1且不递减。所选普通伤口未覆盖该字段。tendQuality存档默认0，字段省略本身不是护理成功证据。有限疾病使用(baseHours+3)*2500，并在剩余严格小于3*2500时可重复护理；不是所有伤口每12小时重包扎。',[...X('HediffDef_Bruise','HediffDef_Bite','HediffDef_Cut','HediffDef_Stab'),C('Verse.HediffCompProperties_TendDuration',7,62),C('Verse.HediffComp_TendDuration',43,65),C('Verse.HediffComp_TendDuration',160,165),C('Verse.HediffComp_TendDuration',173,193),N('Verse.HediffUtility',32,46)]);
add('药物等级与策略','无药/草药/工业/高级药效=.3/.6/1/1.6，上限=.7/.7/1/1.3。MedicineBase堆叠25，草药150日腐坏起点。允许药物按potency阈值过滤而不只按名称；找药还受禁止、预约和路径影响，并比较随身与地图药效。',[...X('ThingDef_MedicineBase','ThingDef_MedicineHerbal','ThingDef_MedicineIndustrial','ThingDef_MedicineUltratech','ThingDef_ResourceBase','StatDef_MedicalPotency','StatDef_MedicalQualityMax'),N('RimWorld.MedicalCareUtility',73,84),S('RimWorld.HealthAIUtility',147,205)]);
add('医疗能力声明','MedicalTendSpeed声明技能因子.4+.06*Medicine级别，质量技能因子.2+.1*级别；两者另有视力/操作，速度还有WorkSpeedGlobal，质量另有后处理曲线。这里不把技能公式单独当最终Stat。',[...X('StatDef_MedicalTendSpeed','StatDef_MedicalTendQuality')],'xml-declared');
add('药草生产链','可种植healroot生长参数7日、播种800工作、最低种植8级；继承HealrootBase收获400工作、基础产量1份MedicineHerbal和60HP。野生healroot未覆盖基类10日，也不声明播种标签。生长日参数不是固定日历成熟时间，收获失败/产率仍需植物链。',[...X('ThingDef_Plant_Healroot','ThingDef_HealrootBase','ThingDef_Plant_HealrootWild','ThingDef_PlantBase','ThingDef_PlantBaseNonEdible')],'xml-declared');
add('感染延迟边界','伤口先按injury infectionChance启动延迟15000..45000tick（6..18游戏小时），到期再用当前严重度、难度、有效护理质量和护理时房间因子抽检。Bite的.30并非最终30%感染率。感染/免疫完整赛跑复用第02章，不把本章算例当原版运行。',[N('Verse.HealthTuning',64,70),C('Verse.HediffComp_Infecter',20,67),C('Verse.HediffComp_Infecter',77,134),...X('HediffDef_Bite','HediffDef_Cut','HediffDef_Stab')]);

const limitation='Independent arithmetic and branch reconstruction under stated fixed inputs; not original execution, effective-mod database or project integration proof.';
const cases=[
 {id:'IC01',model:'time',claims:['IM01','IM17'],inputs:{sourceDay:60000,projectDay:12000,sourceTPS:60,projectTPS:20,healthInterval:60,healInterval:600,tendTicks:600},expected:{health:12,heal:120,tendBySeconds:200,tendByDay:120,ageStopDays:[1.5,3],infectionHours:[6,18]}},
 {id:'IC02',model:'melee',claims:['IM02','IM03','IM04'],inputs:{power:[8.2,8.2,8.2,5],cooldown:[2,2,2,2],chance:[1,1,.07,.2]},expected:{ap:[.123,.123,.123,.075],minDamage:[6.56,6.56,6.56,4],maxDamage:[9.84,9.84,9.84,6],category:['Best','Best','Worst','Worst'],probability:[.5,.5,0,0]}},
 {id:'IC03',model:'melee',claims:['IM03','IM04','IM06'],inputs:{power:[8.2,8.2,8.2,5,9,12,13],cooldown:[2,2,2,2,2,1.5,2],chance:[1,1,.07,.2,1,1,1]},expected:{ap:[.123,.123,.123,.075,.135,.18,.195],minDamage:[6.56,6.56,6.56,4,7.2,9.6,10.4],maxDamage:[9.84,9.84,9.84,6,10.8,14.4,15.6],category:['Mid','Mid','Worst','Worst','Mid','Best','Mid'],probability:[.0625,.0625,0,0,.0625,.75,.0625]}},
 {id:'IC04',model:'meleeBoundary',claims:['IM03'],inputs:{weights:[.2499,.25,.9499,.95,1],highest:1},expected:['Worst','Mid','Mid','Best','Best']},
 {id:'IC05',model:'bleed',claims:['IM07','IM10','IM11'],inputs:{severity:10,injuryBleed:[0,.06,.06,.06],partBleed:[1,1,2,4],scale:1,race:1},expected:{bleed:[0,.6,1.2,2.4],pain:[.125,.125,.125,.125],tendedBleed:[0,0,0,0]}},
 {id:'IC06',model:'blood',claims:['IM12'],inputs:{bleed:[0,.099,.1,.6],callsPerDay:1000},expected:{perCall:[-.00033333333,-.00033333333,.0001,.0006],perDay:[-.33333333,-.33333333,.1,.6]}},
 {id:'IC07',model:'bloodStages',claims:['IM13'],inputs:{severity:[0,.149,.15,.299,.3,.449,.45,.599,.6,1]},expected:{offset:[0,0,-.1,-.1,-.2,-.2,-.4,-.4,-.4,-.4],maximum:[1,1,1,1,1,1,1,1,.1,.1],lethal:[false,false,false,false,false,false,false,false,false,true]}},
 {id:'IC08',model:'healing',claims:['IM16'],inputs:{rows:[{lying:false,bed:0,q:null,starving:false},{lying:true,bed:0,q:null,starving:false},{lying:true,bed:4,q:0,starving:false},{lying:true,bed:4,q:.7,starving:false},{lying:true,bed:10,q:1.3,starving:false},{lying:true,bed:10,q:1,starving:true}]},expected:{natural:[8,12,16,16,22,0],tended:[0,0,4,9.6,12,0],total:[8,12,20,25.6,34,0]}},
 {id:'IC09',model:'quality',claims:['IM19','IM21'],inputs:{doctor:.8,bed:.1,potency:[.3,.6,1,1.6],max:[.7,.7,1,1.3],self:false},expected:{base:[.34,.58,.9,1.3],low:[.09,.33,.65,1.05],high:[.59,.7,1,1.3]}},
 {id:'IC10',model:'quality',claims:['IM19'],inputs:{doctor:.8,bed:.1,potency:[.6],max:[.7],self:true},expected:{base:[.406],low:[.156],high:[.656]}},
 {id:'IC11',model:'batch',claims:['IM18'],inputs:{severity:[9,8,6],usingMedicine:true},expected:{batches:[[9,8],[6]],medicine:2}},
 {id:'IC12',model:'batch',claims:['IM18'],inputs:{severity:[9,8,6],usingMedicine:false},expected:{batches:[[9],[8],[6]],medicine:0}},
 {id:'IC13',model:'batch',claims:['IM18'],inputs:{severity:[25,11,9,1],usingMedicine:true},expected:{batches:[[25],[11,9],[1]],medicine:3}},
 {id:'IC14',model:'tendTime',claims:['IM17'],inputs:{speed:[.1,.4,1,1.3,2]},expected:{sourceTicks:[6000,1500,600,461,300],seconds:[100,25,10,7.683333333333333,5]}},
 {id:'IC15',model:'tendTimer',claims:['IM20'],inputs:{baseHours:[-1,12],overlap:3,elapsed:1},expected:{permanent:[true,false],initialTicks:[1,37500],afterTick:[1,37499],retendAtLeft:[null,7499]}},
 {id:'IC16',model:'missing',claims:['IM14','IM15'],inputs:{hp:30,bleedFactor:1,race:1,scale:1,age:90000},expected:{freshBleed:3.6,pain:.375,tendedBleed:0,agedBleed:0,ordinaryRegrowth:false}},
 {id:'IC17',model:'infection',claims:['IM24'],inputs:{initial:[.15,.3],severity:12,quality:.6,room:.5,difficulty:1},expected:{second:.26,total:[.039,.078]}},
 {id:'IC18',model:'injuryAge',claims:['IM11'],inputs:{severity:[0,1,15.5,30,50]},expected:{ticks:[90000,90000,135000,180000,180000]}}
].map(c=>({...c,limitation}));
for(const [name,value]of [['injuries-claims.json',claims],['injuries-cases.json',cases]])writeFileSync(path.join(dir,name),JSON.stringify(value,null,2)+'\n');
console.log(JSON.stringify({claims:claims.length,cases:cases.length,codeReferences:claims.flatMap(c=>c.sources).filter(s=>s.type).length,xmlReferences:claims.flatMap(c=>c.sources).filter(s=>s.xml_record).length}));
