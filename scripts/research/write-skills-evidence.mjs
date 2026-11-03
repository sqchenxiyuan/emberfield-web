import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=fileURLToPath(new URL('../../',import.meta.url)),dir=path.join(root,'docs/research/rimworld/evidence');
const read=n=>JSON.parse(readFileSync(path.join(dir,n),'utf8').replace(/^\uFEFF/,''));
const hash=x=>createHash('sha256').update(x).digest('hex');
const manifests=new Map();
function C(group,type,a,b){
 if(!manifests.has(group))manifests.set(group,read(`${group}-manifest.json`));
 const m=manifests.get(group),r=m.types.find(t=>t.type===type);assert(r);
 assert.equal(m.source_sha256,'eff7d97949f919fb2b151ebfb906e9be749b63410b7dbda78eeebb7972b245c3');
 assert.equal(m.engine_sha256,'587a18e18e13acfc7fd8783a44c24c7da0781dadf6b9fb9dd5e2e38a9cdfae78');
 const bytes=readFileSync(path.join(root,r.local_file));assert.equal(hash(bytes),r.sha256);
 const lines=bytes.toString('utf8').split('\n');assert(a>0&&a<=b&&b<=lines.length);
 return{group,type,line_start:a,line_end:b,range_sha256:hash(lines.slice(a-1,b).join('\n'))};
}
const S=(t,a,b)=>C('skills',t,a,b),F=(t,a,b)=>C('food',t,a,b),I=(t,a,b)=>C('injuries',t,a,b);
const xml=read('skills-xml.json');
const X=(...ids)=>ids.map(xml_record=>{assert(xml.records.some(r=>r.id===xml_record),xml_record);return{group:'skills',xml_record};});
const claims=[];
const add=(title,statement,sources,kind='xml-and-static-derived')=>claims.push({id:`SK${String(claims.length+1).padStart(2,'0')}`,title,kind,statement,sources});
add('技能、禁用与存档','七种已选技能保存levelInt、xpSinceLastLevel、passion、xpSinceMidnight。等级0到20，实际Level可加aptitude后夹紧；禁用技能返回0且不学习。无热情与禁用不同。工作标签或全部相关工作类型禁用可禁用技能。',[S('RimWorld.SkillRecord',9,51),S('RimWorld.SkillRecord',197,205),S('RimWorld.SkillRecord',334,369),S('RimWorld.SkillDef',43,77),S('RimWorld.Passion',1,8),S('RimWorld.Pawn_SkillTracker',68,96),...X(...xml.records.filter(r=>r.group==='skill').map(r=>r.id))]);
add('升级与等级上限','需求曲线(0,1000),(9,10000),(19,30000)端点外夹紧，20级需求仍30000。先加经验再循环扣升级门槛；20级进度最高29999，但daily经验不因此回退。',[S('RimWorld.SkillRecord',27,51),S('RimWorld.SkillRecord',251,298),C('economy','Verse.SimpleCurve',138,174)]);
add('学习倍率与饱和边界','正经验按None .35、Minor1、Major1.5；普通学习再乘GlobalLearningFactor，事件前dailyXP严格大于4000才乘.2，不拆跨阈值事件。direct仍乘热情，跳过global和饱和且不改daily；ignoreLearnRate跳过正经验倍率。普通daily累计有效经验含负值，无零下限。',[S('RimWorld.SkillRecord',139,139),S('RimWorld.SkillRecord',256,274),S('RimWorld.SkillRecord',371,398),...X('StatDef_GlobalLearningFactor')]);
add('衰退、降级与午夜','每200原版tick，10到20级分别扣.1/.2/.4/.6/1/1.8/2.8/4/6/8/12。GreatMemory减半，PerfectMemory在Anomaly启用时跳过。负XP绕过学习倍率，0级负XP直接返回。xp<=-1000才降级，降后加新等级需求，降到0时进度0；午夜当地小时0且上次重置至少30000tick后daily清零。',[S('RimWorld.SkillRecord',208,248),S('RimWorld.SkillRecord',256,261),S('RimWorld.SkillRecord',299,310),S('RimWorld.Pawn_SkillTracker',98,124)]);
add('Stat组合顺序','BaseBonus=base+bonus*Level；Direct取对应等级或末项。容量factor先处理max等，再由StatWorker用Lerp(value,value*factor,weight)混合，即一般1-w+w*min(cap,max)。容量offset=(min(cap,max)-1)*scale。postProcessCurve之后postProcessStatFactors，最后min/max。完整Stat还有装备、特性、场景等修正。',[S('RimWorld.SkillNeed',1,23),S('RimWorld.SkillNeed_BaseBonus',7,25),S('RimWorld.SkillNeed_Direct',7,27),S('RimWorld.SkillNeed_Curve',5,17),S('RimWorld.PawnCapacityFactor',7,37),S('RimWorld.PawnCapacityOffset',5,18),C('housing','RimWorld.StatWorker',106,134),C('housing','RimWorld.StatWorker',367,398),C('housing','RimWorld.StatWorker',800,834)]);
add('工作速度','Mining .04+.12L，Plants .08+.115L，Construction .3+.0875L，Tend .4+.06L，分别结合global和容量后最低.1。GeneralLabor无Crafting技能倍率。Cook不是简单乘操作：L+4*(minSight1.5-1)+16*(minManip1.5-1)，经(-20,.01),(0,.4),(20,1.6)曲线再global、最低.1。',[...X('StatDef_MiningSpeed','StatDef_PlantWorkSpeed','StatDef_ConstructionSpeed','StatDef_MedicalTendSpeed','StatDef_GeneralLaborSpeed','StatDef_CookSpeed','StatDef_WorkSpeedGlobal')]);
add('产量与建设成功率','MiningYield/PlantHarvestYield/ConstructSuccessChance按各自Direct表和容量相乘，分别夹到0..1.25、0..1.5、0..1。对humanlike可失败非枯萎植物，yield<1是整次收获失败概率；成功先YieldNow，仅yield>1才放大并随机舍入。',[...X('StatDef_MiningYield','StatDef_PlantHarvestYield','StatDef_ConstructSuccessChance'),C('generation','RimWorld.JobDriver_PlantWork',64,86)]);
add('建造与拆除XP','建造仅frame资源非空时学.25/source tick，进度ConstructionSpeed*1.7*Stuff.ConstructionSpeedFactor。拆除有实际材料成本时学.25/tick；父driver进度ConstructionSpeed*1.7，不乘材料速度。建造每间隔按1-successChance^(workDelta/workToBuild)判失败。',[S('RimWorld.JobDriver_ConstructFinishFrame',43,81),S('RimWorld.JobDriver_RemoveBuilding',44,64),C('stonecutting','RimWorld.JobDriver_Deconstruct',18,42)]);
add('采矿与植物XP','采矿.07/source工作tick，目标不同Faction或自己无Faction才学。播种.085/tick，收获.085/tick，砍除仅存在产物且CanYieldNow时.085否则0。行走、等待、搬运不是工作tick。植物收割速度另乘Lerp(3.3,1,Growth)。',[C('generation','RimWorld.JobDriver_Mine',45,59),F('RimWorld.JobDriver_PlantSow',39,61),F('RimWorld.JobDriver_PlantHarvest',7,14),C('plants','RimWorld.JobDriver_PlantCut',9,21),C('generation','RimWorld.JobDriver_PlantWork',24,27),C('generation','RimWorld.JobDriver_PlantWork',53,64)]);
add('配方XP时间点','配方workSkill非空才学习。UsesUnfinishedThing时每实际工作tick学.1*workSkillLearnFactor；无unfinished时完工一次发ticksSpent*.1*factor。因此拆分事件在4000阈值处可改变有效经验。所选衣物与武器继承unfinished及倍率默认1；简单餐无unfinished完工学；切石虽Crafting但factor0，零XP。',[F('Verse.AI.Toils_Recipe',91,117),F('Verse.AI.Toils_Recipe',179,199),F('Verse.RecipeDef',61,67),F('Verse.RecipeDef',360,360),C('apparel','Verse.RecipeMakerProperties',23,35),C('apparel','RimWorld.RecipeDefGenerator',65,72),...X('ThingDef_ApparelMakeableBase','ThingDef_BaseMeleeWeapon','RecipeDef_MakeStoneBlocksBase','RecipeDef_CookMealBase','RecipeDef_CookMealSimple')]);
add('护理XP','每次FinalizeTend先学再DoTend；humanlike500、animal175，乘药物经验因子clamp(potency*.7,.5,1)，无药.5。无药/草药人类250、工业350、闪耀500原始XP；不是每伤口每tick重复发。',[I('RimWorld.Toils_Tend',59,77),C('energy','Verse.ThingDef',712,712)]);
add('近战XP与命中','满足攻击前置后、命中掷骰前学200*AdjustedFullCycleTime秒；仅站立非倒地pawn且非殖民地机体。打建筑、倒地或非站立pawn不学。Hit与Dodge分别使用技能加容量offset后曲线；不动目标或突袭强制nonmiss1/dodge0，忙于远程攻击的防守者不闪避。',[I('RimWorld.Verb_MeleeAttack',13,58),I('RimWorld.Verb_MeleeAttack',126,209),...X('StatDef_MeleeHitChance','StatDef_MeleeDodgeChance')]);
add('医疗品质','MedicalTendQuality先(.2+.1L)*minManip1.4*(.3+.7*minSight1.4)，再(0,0),(1,1),(2,1.5),(4,2)曲线；这是人物Stat，实际治疗还受药物、床、随机、自疗等。',[...X('StatDef_MedicalTendQuality')],'xml-declared');
add('制造品质采样','品质中心按L0..20为.7,1.1,1.5,1.8,2,2.2,2.4,2.6,2.8,2.95,3.1,3.25,3.4,3.5,3.6,3.7,3.8,3.9,4,4.1,4.2。z=sqrt(-2lnu1)*sin(2piu2)，z<=0用sigma.6否则.8。结果int截断再clamp0..5；如5且额外随机数<.5，改用upperSigma.95重抽一次替换。灵感后加2封顶6，普通无额外效果不出Legendary。',[S('Verse.Rand',151,172),C('weapons','RimWorld.QualityUtility',159,246),C('weapons','RimWorld.QualityUtility',283,286)]);
add('品质归属','仅有CompQuality的产品在完工按实际完成者当时技能生成；不是排单者或配方开工等级。wrapper处理灵感消耗与DLC角色offset。Club没有CompQuality，见42章。',[F('Verse.GenRecipe',79,105),C('weapons','RimWorld.QualityUtility',248,275)]);
add('技能门槛','制造SkillRequirement检查当前Level>=min；GenConstruct默认checkSkills且检查construction/artistic；建造toil还持续FailOn CanConstruct。播种grower检查当前Plants>=sowMinSkill。门槛与研究独立，已解锁科技不免除技能。',[S('Verse.SkillRequirement',23,35),S('RimWorld.GenConstruct',251,320),S('RimWorld.JobDriver_ConstructFinishFrame',83,86),C('plants','RimWorld.WorkGiver_GrowerSow',152,167),C('stonecutting','Verse.BuildableDef',56,66),C('generation','RimWorld.PlantProperties',30,38)]);
add('选中建设与植物门槛','石砖地板继承Construction3，木地板/墙/门/床/手裁缝/切石/电线/电池/篝火0；燃料锻造台和木发电机4，电锻造5、太阳能6、heater/cooler5。棉花与三粮食0；橡/松/桦树继承Plants6及TreeSowing。默认零与父链已同时记录。',[...X(...xml.records.filter(r=>['build','terrain','plant'].includes(r.group)).map(r=>r.id))],'xml-declared');
add('选中制造门槛与材料','Club/Knife与所选普通衣物无Crafting门槛，LongSword需5。Wood/Steel ConstructionSpeedFactor默认1，Granite继承.8。材料WorkToBuild由StatWorker先factor再offset：Granite base*6+140；不能混同任务速度。',[...X(...xml.records.filter(r=>['recipe','stuff'].includes(r.group)&&r.id.startsWith('ThingDef')).map(r=>r.id)),...X('StatDef_ConstructionSpeedFactor'),C('housing','RimWorld.StatWorker',300,313)]);
add('烹饪食物中毒','FoodPoisonChance的Cooking表L0..9为.05,.04,.03,.02,.015,.01,.005,.0025,.0015,.001，之后保持.001。它是人物Stat，不等于最终含房间卫生、食物状态等因素的用餐风险；本章不扩展完整中毒模型。',[...X('StatDef_FoodPoisonChance')],'xml-declared');
add('项目时间适配','项目20TPS/12000tick日：实际工作tick XP乘3保留现实秒和每配方经验；衰退每200源tick改40项目tick保留每天300次；daily在项目日界重置是设计适配。两种时间映射不能都等同原版60000tick日，day与现实秒需分开声明。',[S('RimWorld.SkillRecord',27,33),S('RimWorld.Pawn_SkillTracker',98,121),F('Verse.AI.Toils_Recipe',102,107)],'design-adaptation');
claims[0].sources.push(S('RimWorld.Pawn_SkillTracker',50,55));
claims[6].statement+=' 可浪费矿物逐次累计min(采矿伤害,当前HP)/MaxHP*该矿工MiningYield；终产量max(1,RoundRandom(baseYield*累计比例))，还受dropChance。TreeBase明确harvestFailable=false，作物默认true。';
claims[6].sources.push(C('generation','RimWorld.Mineable',18,28),C('generation','RimWorld.Mineable',66,98),C('generation','RimWorld.PlantProperties',46,61),...X('ThingDef_TreeBase'));
const limitation='Independent static-rule arithmetic and seeded sampling; not original execution or project integration proof.';
const learn=(state,xp,expected,extra={})=>({model:'learn',claims:['SK02','SK03','SK04'],inputs:{state,xp,...extra},expected});
const cases=[
 {model:'requirements',claims:['SK02'],inputs:{levels:[0,1,9,10,18,19,20]},expected:[1000,2000,10000,12000,28000,30000,30000]},
 learn({level:3,xp:178,passion:0,dailyXp:0},450,{level:3,xp:335.5,passion:0,dailyXp:157.5}),
 learn({level:3,xp:0,passion:1,dailyXp:4000},100,{level:3,xp:100,passion:1,dailyXp:4100}),
 learn({level:3,xp:0,passion:1,dailyXp:4000.01},100,{level:3,xp:20,passion:1,dailyXp:4020.01}),
 learn({level:3,xp:0,passion:1,dailyXp:3999},100,{level:3,xp:100,passion:1,dailyXp:4099}),
 learn({level:10,xp:-999.95,passion:2,dailyXp:0},-.1,{level:9,xp:8999.95,passion:2,dailyXp:-.1}),
 learn({level:0,xp:12,passion:1,dailyXp:0},-100,{level:0,xp:12,passion:1,dailyXp:0}),
 learn({level:3,xp:0,passion:2,dailyXp:5000},100,{level:3,xp:150,passion:2,dailyXp:5000},{direct:true,global:2}),
 learn({level:3,xp:0,passion:0,dailyXp:5000},100,{level:3,xp:100,passion:0,dailyXp:5100},{ignoreLearnRate:true}),
 learn({level:19,xp:29950,passion:1,dailyXp:0},30100,{level:20,xp:29999,passion:1,dailyXp:30100}),
 {model:'decay',claims:['SK04','SK20'],inputs:{levels:[9,10,11,12,13,14,15,16,17,18,19,20],sourceDay:60000,sourceInterval:200,projectDay:12000,projectInterval:40},expected:{perInterval:[0,.1,.2,.4,.6,1,1.8,2.8,4,6,8,12],sourceEvents:300,projectEvents:300,fixedLevelDaily:[0,30,60,120,180,300,540,840,1200,1800,2400,3600]}},
 {model:'work',claims:['SK05','SK06'],inputs:{level:0,manipulation:1,sight:1,global:1},expected:{mining:.1,plants:.1,construction:.3,cooking:.4,medicine:.4,general:1}},
 {model:'work',claims:['SK05','SK06'],inputs:{level:10,manipulation:.5,sight:1,global:1},expected:{mining:.62,plants:.615,construction:.5875,cooking:.52,medicine:.5,general:.5}},
 {model:'combatMedical',claims:['SK12','SK13'],inputs:{level:10,manipulation:1,sight:1,moving:1},expected:{hit:.8,dodge:.1,tend:1.1}},
 {model:'combatMedical',claims:['SK12','SK13'],inputs:{level:20,manipulation:1,sight:1,moving:1},expected:{hit:.9,dodge:.3,tend:1.55}},
 {model:'timing',claims:['SK08','SK09','SK10','SK11','SK12','SK20'],inputs:{sourceWorkTicks:4500,projectWorkTicks:1500,baseRates:[.07,.085,.25,.1,0],humanTendBase:500,medicineFactors:[.5,.5,.7,1],meleeSeconds:2},expected:{rawXP:[315,382.5,1125,450,0],projectRawXP:[315,382.5,1125,450,0],tendRawXP:[250,250,350,500],meleeRawXP:400}},
 {model:'qualityBranch',claims:['SK14'],inputs:{level:3,random:[Math.exp(-.5),.25],inspired:false},expected:{quality:2,draws:2}},
 {model:'qualityBranch',claims:['SK14'],inputs:{level:3,random:[Math.exp(-.5),.75],inspired:false},expected:{quality:1,draws:2}},
 {model:'qualityBranch',claims:['SK14'],inputs:{level:20,random:[Math.exp(-2),.25,.5],inspired:false},expected:{quality:5,draws:3}},
 {model:'qualityBranch',claims:['SK14'],inputs:{level:20,random:[Math.exp(-2),.25,.49,Math.exp(-.5),.75],inspired:false},expected:{quality:3,draws:5}},
 {model:'qualityBranch',claims:['SK14'],inputs:{level:20,random:[Math.exp(-2),.25,.9],inspired:true},expected:{quality:6,draws:3}},
 {model:'qualityDistribution',claims:['SK14','SK15'],inputs:{levels:[0,3,5,10,15,20],samplesPerLevel:200000,seed:194531,maxStandardErrors:7},expected:{probabilitiesSum:1,ordinaryLegendary:0}},
 {model:'constructionMaterial',claims:['SK08','SK18'],inputs:{base:135,level:10,stuff:[{factor:1,offset:0,speed:1},{factor:6,offset:140,speed:.8}]},expected:{work:[135,950],progress:[1.9975,1.598]}},
 {model:'batchSaturation',claims:['SK03','SK10'],inputs:{startDaily:3999,rawEvents:[100],splitEvents:[2,98]},expected:{batch:100,split:21.6,afterBoundaryExample:20}},
 {model:'harvest',claims:['SK07'],inputs:{base:10,rows:[{stat:.6,failable:true,failDraw:.7,roundDraw:.2},{stat:.6,failable:true,failDraw:.2,roundDraw:.2},{stat:.6,failable:false,failDraw:.7,roundDraw:.2},{stat:1.13,failable:true,failDraw:.7,roundDraw:.2}]},expected:[0,10,10,12]},
 {model:'mineYield',claims:['SK07'],inputs:{base:40,maxHP:100,damage:[{amount:50,remainingHP:100,stat:.6},{amount:70,remainingHP:50,stat:1.13}],roundDraw:.4},expected:{yieldPct:.865,product:35}}
].map((c,i)=>({...c,id:'SC'+String(i+1).padStart(2,'0'),limitation}));
for(const [name,value]of [['skills-claims.json',claims],['skills-cases.json',cases]])writeFileSync(path.join(dir,name),JSON.stringify(value,null,2)+'\n');
console.log(`Wrote ${claims.length} skill claims and ${cases.length} independent cases.`);
