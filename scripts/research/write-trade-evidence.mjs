// Curated claims and manual arithmetic expectations; never updates verifier pins.
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {definitionValue} from './storyteller-model.mjs';
import {fields,listValues,itemInfo,generators} from './trade-model.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url)),dir=path.join(root,'docs/research/rimworld/evidence');
const sha=x=>createHash('sha256').update(x).digest('hex'),read=n=>JSON.parse(readFileSync(path.join(dir,n),'utf8').replace(/^\uFEFF/,''));
const write=(n,x)=>writeFileSync(path.join(dir,n),JSON.stringify(x,null,2)+'\n');
const xml=read('trade-xml.json');
const src=(group,type,start=1,end)=>{const r=read(group+'-manifest.json').types.find(t=>t.type===type);if(!r)throw Error(type);const b=readFileSync(path.join(root,r.local_file));if(sha(b)!==r.sha256)throw Error('Changed derived source '+type);const lines=b.toString('utf8').split('\n');end??=lines.length;return{group,type,line_start:start,line_end:end,range_sha256:sha(lines.slice(start-1,end).join('\n'))};};
const t=(name,start,end)=>src('trade',name,start,end);
const x=(...ids)=>ids.map(id=>{const r=xml.records.find(r=>r.id===id);if(!r)throw Error(id);return{group:'trade',xml_record:id,xml_line_start:r.source.line_start,xml_line_end:r.source.line_end};});
const claims=[];
const add=(title,statement,sources,kind='xml-and-static-derived')=>claims.push({id:'TR'+String(claims.length+1).padStart(2,'0'),title,kind,statement,sources});
add('贸易单价与银币','买价V*1.4*type*join*(1+loss)*(1-g-s)，卖价V*.6*type*SellPriceFactor*human*(1-loss)*(1+g+s+drug+animal)。分别max .5/.01，严格>99.5才Round，最后sell=min(sell,buy)。Silver绕过公式，双方价格恒MarketValue=1。RoyalFavor使用另一货币分支，未纳入项目。',[src('economy','RimWorld.TradeUtility'),src('economy','RimWorld.Tradeable'),t('RimWorld.PriceTypeUtlity'),...x('ThingDef_Silver','StatDef_SellPriceFactor')]);
add('谈判技能与能力','一般无其它modifier时TradePriceImprovement=.015*Social*[.1+.9*min(1,Talking/.95)]*[.1+.9*min(1,Hearing/.8)]，PlayerFactionLeader再加.02，最终clamp 0..0.395。能力缺陷是InverseLerp补偿后逐项Lerp乘积；不能把原始能力直接相乘，也不能把leader加两次。',[t('RimWorld.SkillNeed_BaseBonus'),t('RimWorld.PawnCapacityFactor'),t('RimWorld.StatPart_PlayerFactionLeader'),src('housing','RimWorld.StatWorker',370,398),src('housing','RimWorld.StatWorker',796,835),...x('StatDef_TradePriceImprovement','StatDef_NegotiationAbility')]);
add('难度与市场价层次','Peaceful/Easy/Medium/Rough贸易损耗默认0，Hard .10、Extreme .20。MarketValue先含材质/品质增益封顶、耐久曲线和最终>200五单位取整，再进入贸易公式；武器SellPriceFactor=.20，普通与护甲衣物=1。',[src('economy','RimWorld.Difficulty'),src('storyteller','RimWorld.StatWorker_MarketValue'),src('housing','RimWorld.StatWorker',796,835),...x('DifficultyDef_Hard','DifficultyDef_Extreme','ThingDef_BaseWeapon','StatDef_MarketValue')]);
add('总价与正常成交','普通CountToTransfer正为买入、负为卖出，所有非银币行数量*实际单价先求浮点净成本，再统一RoundToInt ties-even并取反为殖民地银币变化。玩家银币不足返回false；正常成交逐行ResolveTrade，再Reset、派系通知、结束贸易灵感。此路径不是跨行异常回滚事务。',[t('RimWorld.TradeDeal',130,250),t('RimWorld.Transferable'),src('economy','RimWorld.Tradeable'),src('economy','RimWorld.Tradeable'),t('RimWorld.TransferableUtility',48,91)]);
add('商人缺银需显式确认','Dialog_Trade在DoesTraderHaveEnoughSilver失败时显示ConfirmTraderShortFunds，玩家确认才执行。LimitCurrencyCountToFunds仅截断双方可支付银币，不减少已选择商品、不产生债务。项目必须让少收金额可见，禁止静默确认。',[t('RimWorld.Dialog_Trade',365,395),t('RimWorld.TradeDeal',215,250)]);
add('可售对象与位置','EverPlayerSellable先检查tradeability PlayerCanSell、抽象MarketValue>0及Item/Pawn/可搬建筑；PlayerSellableNow排腐烂、尸体穿过衣物、biocoded及Pawn例外。陆行地图物品还要求非fog、Home或storage、商人Touch可达；TradeDeal要求spawned，特殊容器例外。forbidden没有筛选，手持/背包/装备未spawned不进入普通清单。',[src('economy','RimWorld.TradeUtility'),t('RimWorld.Pawn_TraderTracker',102,155),t('RimWorld.Pawn_TraderTracker',256,269),t('RimWorld.TradeDeal',41,128),t('RimWorld.TradeabilityUtility')]);
add('商人接受与报价发生器','WillTrade只需任一StockGenerator HandlesThingDef；显示不愿交易行由UI拦截，赠礼也同样限制。买价类型来自首个匹配发生器，卖价始终Normal；Silver类型Undefined但不走乘数。Category按后代、Tag按tradeTags、BuyExpensiveSimple排衣物武器药物且BaseMarketValue/VolumePerUnit>=15。',[t('RimWorld.TraderKindDef'),t('RimWorld.TradeUI',25,80),t('RimWorld.StockGenerator_BuyExpensiveSimple'),t('RimWorld.StockGenerator_BuyTradeTag'),t('RimWorld.StockGenerator_BuySingleDef'),t('RimWorld.StockGenerator_Category'),t('RimWorld.StockGenerator_Tag'),t('RimWorld.StockGenerator_MultiDef'),src('energy','Verse.ThingDef',145,150),src('energy','Verse.ThingDef',460,470),...x('TraderKindDef_Caravan_Outlander_BulkGoods','TraderKindDef_Caravan_Outlander_CombatSupplier')]);
add('现有资源与装备矩阵','选定目录：杂货收steel/components/cloth/raw crops/survivalPack/普通衣物及Clothing+Armor双标签的simpleHelmet/plate；战斗收components/survivalPack/武器/Armor；两者银币自动结算。wood与herb两者不收；granite blocks和simple meal是Buyable，玩家不可卖；chunk=None。这不是所有原版商人的全局拒收结论。',[t('RimWorld.StockGenerator_BuyExpensiveSimple'),t('RimWorld.TradeabilityUtility'),...x(...xml.seeds.ThingDef.map(n=>'ThingDef_'+n))]);
add('库存计数与分组抽样','SingleDef使用RandomCountOf；仅count则IntRange inclusive抽样，仅totalPrice则RoundToInt(priceRoll/Def.BaseMarketValue)。两者皆有最多101次取样，仍不满足也返回末次。非正数量不生成。Category随机无放回选Def；Misc/MarketValue按次数有放回选Def；MarketValue权重曲线0:1,500:.5,1500:.2,5000:.1。',[t('RimWorld.StockGenerator'),t('RimWorld.StockGenerator_SingleDef'),t('RimWorld.StockGenerator_Category'),t('RimWorld.StockGenerator_Tag'),t('RimWorld.StockGenerator_MiscItems'),t('RimWorld.StockGenerator_MarketValue'),t('RimWorld.StockGeneratorUtility')]);
add('库存生成材质品质与耐久','ThingSetMaker_TraderStock按发生器顺序生成并调用PostGeneratedForTrader；MadeFromStuff按stuff commonality选择合法材料。CompQuality调用floor(clamp(Gaussian(2.5,1),Normal2,Masterwork5))，无Awful/Poor/Legendary。默认startingHpRange=1，原生PostMake全HP。品质不是PawnKind装备品质。条目数与stackLimit不同，商人可保存超大stack。',[t('RimWorld.ThingSetMaker_TraderStock'),t('RimWorld.ThingSetMaker',23,45),t('RimWorld.StockGeneratorUtility'),t('Verse.Thing',777,784),t('Verse.Thing',1106,1113),t('Verse.ThingWithComps',743,753),src('armor','RimWorld.CompQuality',30,36),src('weapons','RimWorld.QualityUtility',111,114),src('weapons','RimWorld.QualityUtility',268,281),src('energy','Verse.ThingDef',105,111),...x('ThingSetMakerDef_TraderStock')]);
add('两类陆行库存范围','Outlander_BulkGoods银币750..1200、components30..40、steel和cloth250..400，FoodRaw3种每种预算150..600，BasicClothing7次+Clothing3次；Combat银币750..1200、工业药10..20、WeaponRanged5次、WeaponsMelee6种各1、Armor5次。原版还有未实现内容，缩小目录后重归一化不等于原版完整分布。',[...x('TraderKindDef_Caravan_Outlander_BulkGoods','TraderKindDef_Caravan_Outlander_CombatSupplier'),t('RimWorld.StockGenerator_MarketValue')]);
add('交互与暂停','浮动菜单先检查商人CanTradeNow、选中殖民者可达、Social未完全禁用、未Dismiss、头衔许可；JobDriver预留商人并Touch接近，到达仍可交易才建立Dialog。窗口forcePause，改数量仅改单据，取消不Resolve，模式切换Reset。',[t('RimWorld.FloatMenuOptionProvider_Trade'),t('RimWorld.JobDriver_TradeWithPawn'),t('RimWorld.TradeSession'),t('RimWorld.Dialog_Trade',235,258),t('RimWorld.Dialog_Trade',398,441),t('RimWorld.Pawn_TraderTracker',65,84),src('housing','RimWorld.PawnUtility',198,236)]);
add('实物交割与持有者','卖出SplitOff后合并商队库存或随机载畜容器，买入SplitOff并在原持有者位置附近放地面；不能原地放下会Destroy并日志，不是自动入殖民者钱包。货物在商队carrier内不属殖民地持有财富。项目预验证并一次提交、购买品落地供搬运，是可靠性适配。',[t('RimWorld.Pawn_TraderTracker',15,58),t('RimWorld.Pawn_TraderTracker',157,213),t('RimWorld.Pawn_TraderTracker',235,255),src('economy','RimWorld.WealthWatcher',115,183)],'design-adaptation');
add('贸易行合并','TransferAsOne检查Def/material、tradeNeverStack、品质、尸衣标志等；耐久影响价格时HP差>=10分行，Item还要CanStackWith。AnyThing优先FirstThingColony；并非所有同种物资必须一个价。项目逐件装备保留真实品质/HP是更严格的身份分组。',[t('RimWorld.TransferableUtility',93,219),src('economy','RimWorld.Tradeable')],'design-adaptation');
add('赠礼与外交','赠礼只移交PlayerSells行，不从商人收钱；基础value/40，对方阵营囚犯*2；relations曲线(0,1),(75,.25)按.25基础好感步进重新求值，最后trunc(min(delta,200))。银币可手填。普通交易好感trunc(PlayerSells实际价值总和/600)，包含支付银币行；没有额外NegotiationAbility乘数。',[t('RimWorld.Planet.FactionGiftUtility',29,46),t('RimWorld.Planet.FactionGiftUtility',159,204),t('RimWorld.DiplomacyTuning',84,99),t('RimWorld.Faction',1086,1090),src('economy','RimWorld.Tradeable'),t('RimWorld.TradeDeal',151,214)]);
add('自然商队周期','Cassandra/Phoebe在第5天偏移之后60天on、0off，每窗口5个候选，最小间隔6天；acceptFraction依据非敌对派系比例曲线(.25,.6),(1,1)。每1000tick按绝对settle interval查询，重放cycle0至当前cycle，前周期hit列表最后元素作为fixedHit；accept<1时shuffle后最后不保证最大。非第5天必来，非固定每6天。',[t('RimWorld.StorytellerComp_FactionInteraction'),t('RimWorld.StorytellerCompProperties_FactionInteraction'),src('economy','RimWorld.IncidentCycleUtility'),src('economy','RimWorld.StorytellerUtility',196,221),src('economy','RimWorld.StorytellerUtility',86,90),src('storyteller','RimWorld.Storyteller',213,234),...x('StorytellerDef_Cassandra','StorytellerDef_Phoebe','StorytellerDef_Randy','IncidentDef_TraderCaravanArrival')]);
add('到达资格和地图生成','可用派系必须非玩家/非败亡/非临时/非隐藏/非敌对、有对应商队maker与traderKind，并通过温度、planet layer、hostile lord、preventNeutralVisitors等约束；从地图边缘道路偏好入口生成，散布在入口5格内，选择全队可达殖民地外围chillSpot。部分失败可发生在spawn后，本章不称失败全原子。',[t('RimWorld.IncidentWorker_TraderCaravanArrival'),t('RimWorld.IncidentWorker_NeutralGroup'),t('RimWorld.IncidentWorker_PawnsArrive')]);
add('商人载畜护卫组成','先抽商人种类再生1名Town_Trader；guard total points=整数Rand.Range(550,1000)减商人combat45，再以原版ChoosePawnGenOptionsByPoints按权重选护卫。非Pawn货物条目数n决定ceil(n/8)载畜，载畜kind由biome允许集合加权取一个，全队同种。载畜不是每8件或按重量估算。',[t('RimWorld.PawnGroupKindWorker_Trader'),t('RimWorld.TraderCaravanUtility'),src('economy','RimWorld.PawnGroupMakerUtility'),...x('FactionDef_OutlanderCivil',...xml.seeds.PawnKindDef.map(n=>'PawnKindDef_'+n))]);
add('停留和离场','状态是Travel->外围DefendTraderCaravan->ExitMapAndEscort；到达停留后Trigger_TicksPassed严格>Rand.Range(27000,45000)，再离场（并非立即消失）。受伤途中守备1200无伤ticks后恢复Travel；危险温度/天气/condition、Dismiss、重要成员失去、关系变敌会离开；损失>=20%触发fighting exit，escort exit60000后一般ExitMap。普通leaving不是CanTradeNow显式禁用条件。',[t('RimWorld.LordJob_TradeWithColony'),t('Verse.AI.Group.Trigger_TicksPassed'),t('RimWorld.LordToil_DefendTraderCaravan'),t('RimWorld.LordToil_ExitMapAndEscortCarriers'),t('Verse.AI.Group.Trigger_FractionPawnsLost'),t('Verse.AI.Group.Trigger_ImportantTraderCaravanPeopleLost')]);
add('项目边界和旧档迁移','建议实体silver、Home或storage过滤、接近商人后报价/取消/双向成交/明确少收/赠礼、种类库存、持有者财富和保存恢复。仅两类商人与支持目录，不含完整载畜/所有护卫装备、轨道/世界旅行/奴隶/皇家恩典/完整外交。旧档不赠币，不补发历史机会；按绝对周期重演，今后继续。同批预验证与一次提交是项目保证，未把原版逐行函数声称为可回滚事务。',[t('RimWorld.TradeDeal'),t('RimWorld.PawnGroupKindWorker_Trader'),src('economy','RimWorld.IncidentCycleUtility')],'design-adaptation');
claims[11].statement+=' 本次审计的普通JobDriver/Dialog/TradeDeal/Pawn_TraderTracker链没有显式SkillRecord.Learn；不能据此增加按次Social XP，也不主张全游戏无任何相关经验来源。';
claims[12].statement+=' GiveSoldThingToPlayer先记录原持有者PositionHeld，再SplitOff并Near放置；没有SetForbidden(false)。CompForbiddable.PostSplitOff继承forbidden，且无PrePreTraded覆盖。Lord.extraForbiddenThings限制商队拾取，不是玩家禁用标记。项目库存不保存forbidden而购买后允许使用属适配。';
claims[12].sources.push(t('RimWorld.CompForbiddable'),t('Verse.ThingWithComps',731,741),t('Verse.Thing',1102,1104));
add('通用外交层与袭击商队','交易/赠礼/伤害的原始delta进入TryAffectGoodwillWith后，若方向朝NaturalGoodwill，额外加同号RoundToInt(.25*min(abs(current-natural),abs(delta)))，再夹base至[-100,100]并按有效好感转换。非敌对人类商队受玩家外力攻击一般rawDelta=trunc(-1.3*min(100,DamageInfo.Amount))，在护甲吸收前通知；双方共同敌人IntendedTarget的交叉火力免罚，精神/奴隶/越狱等有例外。factionHostileOnHarmByPlayer默认false；普通关系<=-75变敌，敌对>=0恢复中立，>=75结盟、盟友<=0恢复中立。受伤守备、变敌护送退出和暴力损失>=20%战斗退出是不同触发。',[t('RimWorld.Faction',58,58),t('RimWorld.Faction',509,527),t('RimWorld.Faction',550,613),t('RimWorld.Faction',747,771),t('RimWorld.Faction',818,856),t('RimWorld.Faction',1284,1302),t('RimWorld.FactionRelation',25,50),t('RimWorld.DiplomacyTuning',17,42),t('RimWorld.LordJob_TradeWithColony',78,126),t('Verse.AI.Group.Trigger_PawnHarmed'),src('combat','Verse.Pawn_HealthTracker',321,357)]);
add('自用装备生成与商品分开','PawnKind默认itemQuality Normal、gearHealthRange1、weaponMoney0、minQuality Awful/maxQuality Excellent；质量按rand<.1中心-1、<.2中心+1、否则中心并夹范围，forceNormal/forceWeapon/指定衣物/爵位可覆盖。HP抽样<1才max(1,RoundToInt(r*MaxHP))，>=1保持满值。武器先按抽样预算、标签、材料、能力、允许概率筛选；权重pair.Commonality*pair.Price*理念*异种，Def生成权重在材料对间归一。不同于商品Normal..Masterwork Gaussian和市场值曲线。',[t('Verse.PawnKindDef',188,202),t('Verse.PawnKindDef',259,261),src('weapons','RimWorld.QualityUtility',125,157),src('storyteller','Verse.PawnGenerator',2025,2051),src('storyteller','RimWorld.PawnWeaponGenerator',22,44),src('storyteller','RimWorld.PawnWeaponGenerator',55,141),...x('PawnKindDef_Town_Trader','PawnKindDef_Town_Guard','PawnKindDef_Villager')]);
write('trade-claims.json',claims);
const data={version:'1.7.4980 rev60',scope:'Selected Core static declarations; double-precision analytic specification, no native execution or RNG stream.',buyGlobal:1.4,sellGlobal:.6,minimumBuy:.5,minimumSell:.01,roundAbove:99.5,allowedDefects:[.05,.2],priceTypes:{VeryCheap:.4,Cheap:.7,Normal:1,Expensive:2,Exorbitant:5},giftDivisor:40,giftCurve:[[0,1],[75,.25]],tradeGoodwillDivisor:600,stockWeight:[[0,1],[500,.5],[1500,.2],[5000,.1]],allyCurve:[[.25,.6],[1,1]],difficulties:{Peaceful:0,Easy:0,Medium:0,Rough:0,Hard:.1,Extreme:.2},schedule:{offsetDays:5,onDays:60,offDays:0,count:5,spacingDays:6},stayRange:[27000,45000],guardPointRange:[550,1000],items:Object.fromEntries(xml.seeds.ThingDef.map(n=>[n,itemInfo(xml.records,n)])),traders:Object.fromEntries(xml.seeds.TraderKindDef.map(n=>[n,generators(xml.records,'TraderKindDef_'+n)])),pawns:Object.fromEntries(xml.seeds.PawnKindDef.map(n=>{const a=fields(xml.records,'PawnKindDef_'+n);return[n,{combatPower:+a.combatPower,quality:a.itemQuality??'Normal',health:a.gearHealthRange??'1~1',weaponMoney:a.weaponMoney??'0~0',weaponTags:listValues(xml.records,'PawnKindDef_'+n,'weaponTags')}];}))};
data.abstractValues=Object.fromEntries(xml.seeds.ThingDef.filter(n=>/^(Apparel_|MeleeWeapon_|Gun_|Bow_)/.test(n)).map(n=>[n,definitionValue(xml.records,'ThingDef_'+n)]));
write('trade-data.json',data);
const cases=[];const c=(model,inputs,expected,claim)=>cases.push({id:'TV'+String(cases.length+1).padStart(2,'0'),model,inputs,expected,claims:[claim],limitation:'Independent analytic expectation; not original execution, loaded Def validation or project simulation evidence.'});
c('negotiator',{social:0},{gain:0,factors:[1,1]},'TR02');
c('negotiator',{social:8},{gain:.12,factors:[1,1]},'TR02');
c('negotiator',{social:8,talking:.95,hearing:.8},{gain:.12,factors:[1,1]},'TR02');
c('negotiator',{social:8,talking:.475,hearing:.4},{gain:.0363,factors:[.55,.55]},'TR02');
c('negotiator',{social:20,talking:0,hearing:0},{gain:.003,factors:[.1,.1]},'TR02');
c('negotiator',{social:20,offset:.2},{gain:.395,factors:[1,1]},'TR02');
c('negotiator',{social:8,offset:.02},{gain:.14,factors:[1,1]},'TR02');
c('negotiator',{social:8,talking:1.3,hearing:1.5},{gain:.12,factors:[1,1]},'TR02');
c('price',{value:1.2,gain:.12},{buy:1.4784,sell:.8064},'TR01');
c('price',{value:220,gain:.12,sellFactor:.2},{buy:271,sell:29.568},'TR01');
c('price',{value:220,gain:.12,sellFactor:.2,loss:.1},{buy:298,sell:26.6112},'TR03');
c('price',{value:220,gain:.12,sellFactor:.2,loss:.2},{buy:325,sell:23.6544},'TR03');
c('price',{value:135.4,gain:.12,sellFactor:.2},{buy:167,sell:18.19776},'TR03');
c('price',{value:0},{buy:.5,sell:.01},'TR01');
c('price',{value:100,buyType:.4,gain:.395},{buy:33.88,sell:33.88},'TR01');
c('price',{value:1,currency:true,gain:.3,loss:.2},{buy:1,sell:1},'TR01');
c('price',{value:100,buyType:2,settlement:.05},{buy:266,sell:63},'TR01');
c('price',{value:100,joinAs:.6,humanFactor:.6,drug:.1,animal:.1},{buy:84,sell:43.2},'TR01');
c('price',{value:100,buyType:.7107142857142857},{buy:99.5,sell:60},'TR01');
c('price',{value:100,buyType:.7178571428571429},{buy:100,sell:60},'TR01');
c('price',{value:100,buyType:.725},{buy:102,sell:60},'TR01');
c('price',{value:100,favor:3},{buy:140,sell:3},'TR01');
const row=(quantity,buy,sell)=>({quantity,buy,sell});
c('settlement',{rows:[row(1,.6,.3),row(1,.6,.3)],playerSilver:1,traderSilver:0},{net:1.2,due:1,status:'committed',playerSilver:0,traderSilver:1,shortfall:0},'TR04');
c('settlement',{rows:[row(5,.5,.1)],playerSilver:2,traderSilver:10},{net:2.5,due:2,status:'committed',playerSilver:0,traderSilver:12,shortfall:0},'TR04');
c('settlement',{rows:[row(7,.5,.1)],playerSilver:4,traderSilver:10},{net:3.5,due:4,status:'committed',playerSilver:0,traderSilver:14,shortfall:0},'TR04');
c('settlement',{rows:[row(-5,1,.5)],playerSilver:0,traderSilver:10},{net:-2.5,due:-2,status:'committed',playerSilver:2,traderSilver:8,shortfall:0},'TR04');
c('settlement',{rows:[row(2,10,4),row(-3,8,6)],playerSilver:2,traderSilver:10},{net:2,due:2,status:'committed',playerSilver:0,traderSilver:12,shortfall:0},'TR04');
c('settlement',{rows:[row(2,10,4)],playerSilver:19,traderSilver:10},{net:20,due:20,status:'player-insufficient',playerSilver:19,traderSilver:10,shortfall:0},'TR04');
c('settlement',{rows:[row(-5,10,4)],playerSilver:1,traderSilver:19},{net:-20,due:-20,status:'needs-shortfall-confirmation',playerSilver:1,traderSilver:19,shortfall:1},'TR05');
c('settlement',{rows:[row(-5,10,4)],playerSilver:1,traderSilver:19,confirmShortfall:true},{net:-20,due:-20,status:'committed',playerSilver:20,traderSilver:0,shortfall:1},'TR05');
c('settlement',{rows:[],playerSilver:1,traderSilver:10},{net:0,due:0,status:'committed',playerSilver:1,traderSilver:10,shortfall:0},'TR04');
for(const [i,e] of [[{home:true,forbidden:true},true],[{stored:true},true],[{home:false,stored:false},false],[{home:true,spawned:false},false],[{home:true,fogged:true},false],[{home:true,reachable:false},false],[{home:true,tainted:true},false],[{home:true,fresh:false},false],[{home:true,biocoded:true},false],[{home:true,tradeability:'Buyable'},false],[{home:true,abstractValue:0},false],[{home:true,willTrade:false},false],[{home:true,nearbyBlocker:true},false]])c('eligibility',i,{sellable:e},'TR06');
c('gift',{goodwill:-100,lines:[{count:40,price:1}]},{base:1,delta:1,after:-99},'TR15');
c('gift',{goodwill:75,lines:[{count:160,price:1}]},{base:4,delta:1,after:76},'TR15');
c('gift',{goodwill:0,lines:[{count:40,price:1}]},{base:1,delta:0,after:0},'TR15');
c('gift',{goodwill:100,lines:[{count:160,price:1}]},{base:4,delta:1,after:100},'TR15');
c('gift',{goodwill:-100,lines:[{count:1,price:20,sameFactionPrisoner:true}]},{base:1,delta:1,after:-99},'TR15');
c('tradeGoodwill',{soldValue:599},{delta:0},'TR15');c('tradeGoodwill',{soldValue:600},{delta:1},'TR15');
c('stockCount',{countRange:[750,1200],countRoll:1200},{count:1200,generated:1200,attempts:1},'TR09');
c('stockCount',{countRange:[-10,2],countRoll:-3},{count:-3,generated:0,attempts:1},'TR09');
c('stockCount',{priceRange:[150,600],priceRoll:150,baseValue:1.1},{count:136,generated:136,attempts:1},'TR09');
c('stockCount',{priceRange:[0,100],priceRoll:5,baseValue:2},{count:2,generated:2,attempts:1},'TR09');
c('stockCount',{priceRange:[0,100],priceRoll:7,baseValue:2},{count:4,generated:4,attempts:1},'TR09');
c('stockCount',{countRange:[1,4],priceRange:[20,40],countRolls:[1,3],baseValue:10},{count:3,generated:3,attempts:2},'TR09');
c('stockCount',{countRange:[1,4],priceRange:[200,400],countRolls:[1],baseValue:10},{count:1,generated:1,attempts:101},'TR09');
c('stockCount',{}, {count:0,generated:0,attempts:0},'TR09');
for(const [g,q]of [[-1,2],[2.99,2],[3,3],[4.9,4],[7,5]])c('quality',{gaussian:g},{quality:q},'TR10');
c('stockWeight',{baseValue:250},{weight:.75},'TR09');c('stockWeight',{baseValue:1000},{weight:.35},'TR09');
for(const [n,k]of [[0,0],[1,1],[8,1],[9,2],[17,3]])c('carriers',{nonPawnEntries:n,totalPoints:550},{carriers:k,guardBudget:505},'TR18');
c('schedule',{ticks:299999},{interval:299,relative:-1,cycle:-1,offset:-1},'TR16');
c('schedule',{ticks:300000},{interval:300,relative:0,cycle:0,offset:0},'TR16');
c('schedule',{ticks:3899999},{interval:3899,relative:3599,cycle:0,offset:3599},'TR16');
c('schedule',{ticks:3900000},{interval:3900,relative:3600,cycle:1,offset:0},'TR16');
c('allyFraction',{nonHostile:0,canBeNonHostile:4},{fraction:-1},'TR16');
c('allyFraction',{nonHostile:1,canBeNonHostile:4},{fraction:.6},'TR16');
c('allyFraction',{nonHostile:4,canBeNonHostile:4},{fraction:1},'TR16');
c('stay',{duration:27000,elapsed:27000},{leave:false},'TR19');c('stay',{duration:27000,elapsed:27001},{leave:true},'TR19');
c('loss',{violent:1,ever:5},{fightingExit:true,importantExit:false},'TR19');c('loss',{violent:0,ever:5,important:true},{fightingExit:false,importantExit:true},'TR19');
const expected={WoodLog:[true,false,false],Steel:[true,true,false],BlocksGranite:[false,false,false],ChunkGranite:[false,false,false],Cloth:[true,true,false],ComponentIndustrial:[true,true,true],MealSurvivalPack:[true,true,true],RawRice:[true,true,false],RawPotatoes:[true,true,false],RawCorn:[true,true,false],MealSimple:[false,true,true],MedicineHerbal:[true,false,false],MedicineIndustrial:[true,false,true],Silver:[true,true,true]};
for(const [name,[playerSellable,bulk,combat]]of Object.entries(expected))for(const[k,w]of [['BulkGoods',bulk],['CombatSupplier',combat]])c('accept',{traderId:'TraderKindDef_Caravan_Outlander_'+k,name},{playerSellable,willTrade:w,sellFactor:1},'TR08');
for(const name of xml.seeds.ThingDef.filter(n=>/^(MeleeWeapon_|Bow_|Gun_)/.test(n)))for(const[k,w]of [['BulkGoods',false],['CombatSupplier',true]])c('accept',{traderId:'TraderKindDef_Caravan_Outlander_'+k,name},{playerSellable:true,willTrade:w,sellFactor:.2},'TR08');
for(const name of xml.seeds.ThingDef.filter(n=>/^Apparel_/.test(n)))for(const[k,w]of [['BulkGoods',true],['CombatSupplier',/SimpleHelmet|PlateArmor/.test(name)]])c('accept',{traderId:'TraderKindDef_Caravan_Outlander_'+k,name},{playerSellable:true,willTrade:w,sellFactor:1},'TR08');
for(const [inputs,expected] of [
 [{current:-10,natural:0,delta:4},{adjusted:5,after:-5,effective:-5,relation:'Neutral'}],
 [{current:-10,natural:0,delta:3},{adjusted:4,after:-6,effective:-6,relation:'Neutral'}],
 [{current:-2,natural:0,delta:10},{adjusted:10,after:8,effective:8,relation:'Neutral'}],
 [{current:10,natural:0,delta:-6},{adjusted:-8,after:2,effective:2,relation:'Neutral'}],
 [{current:0,natural:0,delta:-76},{adjusted:-76,after:-76,effective:-76,relation:'Hostile'}],
 [{current:0,natural:0,delta:-74},{adjusted:-74,after:-74,effective:-74,relation:'Neutral'}],
 [{current:0,natural:0,delta:-75},{adjusted:-75,after:-75,effective:-75,relation:'Hostile'}],
 [{current:-10,natural:0,delta:8,relation:'Hostile'},{adjusted:10,after:0,effective:0,relation:'Neutral'}],
 [{current:-10,natural:0,delta:1,relation:'Hostile'},{adjusted:1,after:-9,effective:-9,relation:'Hostile'}],
 [{current:50,natural:0,delta:-1,relation:'Ally'},{adjusted:-1,after:49,effective:49,relation:'Ally'}],
 [{current:1,natural:0,delta:-1,relation:'Ally'},{adjusted:-1,after:0,effective:0,relation:'Neutral'}],
 [{current:74,natural:0,delta:1},{adjusted:1,after:75,effective:75,relation:'Ally'}],
 [{current:99,natural:0,delta:10},{adjusted:10,after:100,effective:100,relation:'Ally'}],
 [{current:-99,natural:0,delta:-10,relation:'Hostile'},{adjusted:-10,after:-100,effective:-100,relation:'Hostile'}],
 [{current:70,base:80,natural:0,delta:5,maxGoodwill:70},{adjusted:5,after:85,effective:70,relation:'Neutral'}],
 [{current:-10,natural:0,delta:0},{adjusted:0,after:-10,effective:-10,relation:'Neutral'}],
]) c('goodwill',inputs,expected,'TR21');
for(const [inputs,rawDelta]of [[{amount:.5},0],[{amount:1},-1],[{amount:10},-13],[{amount:100},-130],[{amount:200},-130],[{amount:10,mutuallyHostileCrossfire:true},0],[{amount:10,exempt:true},0]])c('harm',inputs,{rawDelta},'TR21');
for(const [inputs,quality]of [[{roll:.099},1],[{roll:.1},3],[{roll:.199},3],[{roll:.2},2],[{roll:.5},2],[{center:0,roll:0},0],[{center:4,roll:.15},4],[{center:1,roll:.15},2],[{center:1,roll:.15,forceNormal:true},2],[{roll:.5,forceQuality:5},5]])c('pawnQuality',inputs,{quality},'TR22');
for(const [inputs,hp]of [[{roll:.25,maxHp:10},2],[{roll:.35,maxHp:10},4],[{roll:.001,maxHp:10},1],[{roll:1,maxHp:100},100],[{roll:1.5,maxHp:100},100]])c('gearHp',inputs,{hp},'TR22');
for(const item of cases.filter(v=>v.model==='gift'))item.limitation+=' Gift delta is before the generic natural-goodwill layer; after assumes that layer adds zero, which is tested separately.';
write('trade-cases.json',cases);
console.log(JSON.stringify({claims:claims.length,cases:cases.length,items:Object.keys(data.items).length,xmlRecords:xml.records.length}));
