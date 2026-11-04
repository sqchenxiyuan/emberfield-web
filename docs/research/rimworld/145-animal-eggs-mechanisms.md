# 鸡、产蛋、受精和孵化的完整状态链

更新：2026-11-05。目标版本 RimWorld **1.7.4980 rev60**。本页研究「获得鸡 → 饲养与成熟 → 配种 → 产出真实鸡蛋 → 食材或孵化 → 新生雏鸡」的机制。初版应先连通这些行为，生产周期、营养、价格和工作时间可集中配置后调整。

## 证据边界

- 本地目标：`F:/SteamLibrary/steamapps/common/RimWorld/Assembly-CSharp.dll`，SHA-256 `eff7d97949f919fb2b151ebfb906e9be749b63410b7dbda78eeebb7972b245c3`。
- 复用 [REA 托管身份记录](evidence/production-bills-rea-managed.json)核对程序集身份；本轮用固定哈希的 ILSpy 库静态读取 PE 元数据，没有加载或执行目标游戏代码。
- [提取清单](evidence/animal-eggs-manifest.json)记录 **43 个派生类型**及其哈希；[机制投影](evidence/animal-eggs-mechanisms.json)记录有限代码锚点、方法范围检查、Core XML 字段及枚举范围内的野生鸡缺失检查。完整派生类型仅在忽略目录 `.local-research/animal-eggs/`。
- 这是安装包声明和派生控制流证据，不是原始源码，也不是原版运行验收。未解析完整模组补丁后的有效 Def 数据库；没有启动原版、浏览器、预览、GUI 交互或截图。
- 本页的数值均是原版静态参考，不代表 Web 已实现、已平衡或运行表现已确认。Web 实现及验证应另记在对应玩法文档中。

## 鸡是需要管理的农场动物

Chicken 继承 AnimalThingBase，`foodType=VegetarianRoughAnimal`、trainability=None、Wildness=0、roamMtbDays=7；因此需要围栏/牵引等既有动物管理，而不是套用可训练猎犬的行为。物种带 AnimalCommon 和 AnimalFarm 交易标签。

成年 baseBodySize=0.3、baseHealthScale=0.35、baseHungerRate=0.14。MaxNutrition stat 的基础值为 1，经过 BodySize 和 LifeStageMaxFood 两个 part，因此普通成年鸡营养容量为 **0.3**。`Need_Food.BaseHungerRate` 是 lifeStage.hungerRateFactor × 0.14 × 2.6666667E-05/tick；按每天 60000 tick，成年、Fed、无其它修正时约 **0.224 营养/天**。0.14 本身不是日摄入量。

| 阶段 | 起始年龄 | 尺寸系数 | foodMaxFactor | 普通容量 | hungerRateFactor |
|---|---:|---:|---:|---:|---:|
| AnimalBabyTiny，雏鸡 | 0 | 0.1 | 6 | 0.18 | 0.4，继承 AnimalBaby |
| AnimalJuvenile | 0.12 年 | 0.5 | 1.5 | 0.225 | 0.75 |
| AnimalAdult | 0.2 年 | 1，类型默认 | 1，类型默认 | 0.3 | 1，类型默认 |

按原版 60 天/年的常用时间单位，0.2 年为 12 天，0.12 年为 7.2 天；Web 若沿用自己的成熟节奏，应明确这是时间尺度适配。该表不包含疾病、基因、床位或其它 stat 修正。

已枚举的 Core BiomeDefs XML 没有直接 `wildAnimals/Chicken` 项。这个结论只覆盖证据中列出的文件和 XPath，不证明所有事件、DLC 或 Mod 都不可能生成鸡。Core 大宗商队有 AnimalFarm 活体动物生成器，而且能配置成对购入；若 Web 提供野生鸡或固定售卖受精鸡蛋作为入口，需要标明自己的分布/商品适配。

## 蛋进度与受精额度是两个独立状态

`CompEggLayer.Active` 依次检查：

1. 默认 `eggLayFemaleOnly=true`，所以公鸡不能产蛋。
2. 当前生命阶段必须 `milkable=true`。字段名虽然叫 milkable，也被蛋组件复用，不能误写成 shearable。
3. `Pawn.Sterile()` 为 false；它包含 reproductive 生命周期门槛、阻止怀孕的健康条件和相应基因。AnimalAdult 明确 reproductive/milkable=true，幼体和幼年默认 false。
4. 启用 Anomaly 时不是 Shambler。

这个 Active getter **没有 Faction、温度、睡眠或倒地判断**。蛋增长与产奶/毛的父类不同，不能直接复制「无阵营不增长」规则；外层是否真正 tick、动物能否开始动作仍需分别考虑。

组件保存 `eggProgress`、`fertilizationCount` 和 `fertilizedBy`。每逢个体 hash 对齐的 **2500 原版 tick**且 Active，增加：

`2500 / (eggLayIntervalDays × 60000) × HungerMultiplier`

Fed / Hungry / UrgentlyHungry / Starving 分别为 1 / 0.5 / 0.25 / 0。进度封顶 1；不活动时暂停，不抹掉原有进度或受精额度；没有每产一枚另扣一笔营养的路径。鸡的 intervalDays=1、eggCountRange=1。

部分其它卵生物种可设置 `eggProgressUnfertilizedMax<1`，没有受精额度就卡在部分进度；**鸡没有这个覆盖，默认上限是 1**。没有公鸡的成年母鸡仍会正常产未受精蛋。已满进度的饥饿母鸡也能产蛋，因为饥饿限制增长速度，不是 Active 或 CanLayNow 的独立门槛。

## 配种补充的是下一枚蛋资格，不是哺乳类怀孕

Animal ThinkTree 的普通配种节点位于 `ThinkNode_ConditionalHasFaction` 之下。原版普通路径要求有阵营，但不是仅玩家阵营；公鸡查找同阵营的雌鸡。`JobGiver_Mate` 要求发起者为 Male、非 Sterile、物种未 disableMating，目标未倒地、可日常互动、对发起者不禁止，并且在 30 格内能走到 Touch。

`PawnUtility.FertileMateTarget` 对带 EggLayer 的雌性检查 `!FullyFertilized`，并不是检查蛋进度为 0。鸡 mateMtbHours=8，ThinkNode_ChancePerHour 最多每 2500 tick 尝试一次，用 MTB 概率判断；不能解释成「每隔 8 小时必定交配」。

`JobDriver_Mate` 先走到雌性，再等待 500 tick，最后调用 `PawnUtility.Mated`。卵生分支直接 Fertilize；后面的 50% 怀孕抽签只属于没有 EggLayer 的哺乳类分支。鸡不应创建 Pregnant 状态，也不应每次配种再抽一次 50% 受精概率。

Fertilize 把 fertilizationCount **设为物种最大值**，并记住公鸡引用。鸡最大值为 **1**，所以一次完成的配种只为下一枚蛋提供受精额度，不是永久受精、不是可无限累加的存量，也不需要产蛋进度重新从 0 开始。

产出时看当时的额度：大于 0 就选择 EggChickenFertilized，否则选择 EggChickenUnfertilized；额度扣除本次产量后最小为 0。一般物种批产超过剩余额度时，原版这条分支会把整批都按受精蛋创建，并把额度扣至 0；鸡一次只有一枚，不涉及这项批量边界。

## 母鸡自己完成产蛋动作

`JobGiver_LayEgg` 在 Animal ThinkTree 中不位于上述配种阵营分支内。CanLayNow=Active 且 eggProgress≥1；母鸡需要执行真实任务，并非计时一满就远程给仓库加数量。

- 玩家阵营母鸡优先找 30 格内可达、未禁止、可预约且接受下一种蛋的 EggBox。非满箱中已有蛋数×5作为优先评分，空箱评分 0.5。
- 找不到蛋箱时，找 30 格内同类型蛋的可达格，要求与当前房间相同，除非当前没有房间。
- 再没有就用附近 5 格游走目标。目标使用 OnCell 和 Danger.Some 路径规则。

`JobDriver_LayEgg` 走到目标格，等待 **500 tick**，然后 ProduceEgg。它的预约函数直接返回 true；不能从候选检查 `CanReserve` 就推导它已实际占有排他预约。产蛋没有殖民者 Handling 工作、AnimalGatherSpeed、AnimalGatherYield 或经验；不是「鸡版挤奶」。

中断发生在最终产出动作前时，不会消费组件的蛋进度或受精额度；新任务重新经过移动/等待。ProduceEgg 首先把 eggProgress 清零，再生成物品、扣额度、填写 Hatcher。普通分配会检查 Active，但最终 ProduceEgg 发现不 Active 时只是记录错误，仍继续其代码；Web 若在最终提交前重新验证并等待，是明确的健壮性适配。

有可接受的目标蛋箱时 TryAdd 入箱，否则用 GenPlace.TryPlaceThing 在母鸡附近落地。非玩家母鸡所产地面蛋会在放置回调标为 forbidden。此处没有检查最后的入箱/落地返回值以保留重试所有权，消耗已经发生。Web 如采用落地容量预检、保留进度和原子提交，应明确是防丢失适配，同时避免重复蛋、重复扣额度或读档重放。

## 两种蛋都是实体食材，但默认用途不同

继承链：Chicken egg → EggUnfertBase/EggFertBase → EggBase → OrganicProductBase → ResourceBase。

| 属性 | 原版静态值/行为 |
|---|---|
| 两种鸡蛋 Nutrition | 0.25/枚，不能把它当成 0.05 营养的奶或肉单位 |
| 栈上限 | 75 |
| MaxHitPoints / DeteriorationRate | 20 / 每天 2 |
| Mass / MarketValue | 0.15 / 7 |
| Flammability | 0.7 |
| healthAffectsPrice | false，继承 OrganicProductBase |
| FoodPoisonChanceFixedHuman | 0.02，仍可能受人体条件/其它处理路径影响 |
| foodType / raw tasteThought | AnimalProduct / AteRawFood |
| 未受精 preferability | RawBad |
| 受精 preferability | DesperateOnly |
| 腐败 | EggBase 15 天、rotDestroys=true，另有 disableIfHatcher=true |

物品分类是 EggsUnfertilized / EggsFertilized → AnimalProductRaw → FoodRaw，**不是 MeatRaw**。它们保留普通物品的选择、禁止、搬运、储存、耐久和交易身份。

CookMealBase 的固定原料范围允许 FoodRaw，而默认材料过滤器排除 EggsFertilized。因此可用未受精蛋做饭；受精蛋具有食材资格，但默认保护它避免煮掉下一代，玩家可以明确放行。简单餐按营养计数，原版需求 0.5 营养时是两枚鸡蛋，不是照搬十单位 0.05 原料。精致餐的非植物原料组也接受 AnimalProductRaw。

`DesperateOnly` 是食物选择中的偏好档位，不是物品自身不可绕过的「饱食≤某值才可食用」属性。普通 human 的 JobGiver_GetFood 把 `desperate=(CurCategory==Starving)` 传入 FoodUtility；Need_Food 的 Starving 是 **CurLevelPercentage≤0**。没有 minPrefOverride 的普通地图食物搜索，此时才把最低档放宽到 DesperateOnly。非 Starving 的 UrgentlyHungry 只放宽到 RawBad，因此不能把受精蛋的普通地面自主进食门槛写成「饱食18%」。候选仍经过 WillEat、当前饮食策略解析、禁止、预约、可达等检查；通过门槛不保证一定选它，FoodOptimality 还给 DesperateOnly 减 150 分。

这里有重要的**库存回退例外**：TryFindBestFoodSourceFor 在较好地图/库存候选都没有找到时，只要允许库存且取食者能操纵工具，会再次用 DesperateOnly 下限查自身库存，再查满足条件的殖民地驮兽库存。这个回退分支没有再检查 desperate/Starving；库存方法仍检查 WillEat、可食性和偏好范围。因此不能把「所有位置、所有取食路径必须饱食0才吃受精蛋」描述成原版事实。支持吃尸体的特定 mutant 还可显式传入 DesperateOnly 覆盖；玩家强制命令也不等同于普通自主搜索。Web 若统一保护库存和地面受精蛋，或采用不同应急阈值，应记录为自己的饮食策略。

CompRottable.Active 在存在未 TemperatureDamaged 的 Hatcher 且 disableIfHatcher=true 时返回 false。**仍可孵化的受精蛋不累积普通腐败**；不是一边 3.5 天孵化、一边 15 天腐败两个竞争时钟。未受精蛋正常用温度影响的腐败速率：低于 0°C 为 0，0～10°C 线性，10°C及以上为 1；腐败到达阈值后销毁。

## 孵化和温度损伤并行，不需要母鸡趴窝

受精鸡蛋的 Hatcher 声明 `hatcherDaystoHatch=3.5`、hatcherPawn=Chicken。每个实际 tick，只要没有完全 TemperatureDamaged，gestateProgress 增加 `1/(3.5×60000)`；原版判断是 **>1** 后 Hatch，非严格等于 1。

该孵化组件没有母鸡在附近、蛋箱、供电、巢、食品投入或当前安全温度的额外条件。温度损伤是另一个组件并行推进的状态：

- 安全范围 **0～50°C，含两端**。
- 低于 0 或高于 50 时，每 tick 增加超出安全范围的摄氏度差 × **0.00003**。
- 温损达到 1 判定 Ruined，并广播 RuinedByTemperature。
- 回到安全温度不会自动修复已累计损伤。类上另有显式 Reset 方法，不代表日常温度 tick 会调用它。

因此温度稍有越界时，蛋可以同时增长孵化进度与温损；尚未完全损毁就不会被 Hatcher 暂停。不能实现成「任何越界立即停止孵化」并称为原版机制。

**本地 1.7 的完全温损结果是转成未受精蛋。** Hatcher 从 Chicken 的 EggLayer 找到 eggUnfertilizedDef；箱内删除旧蛋并创建新未受精蛋，同样数量再入箱；其它普通地图持有情况销毁旧蛋并在 held 位置生成同数量的新未受精蛋。手持情况下先尝试放下。转换只显式保留数量，不复制旧腐败、HP、forbidden、父母或阵营字段；新的鸡蛋没有品质组件，通常是新鲜、默认初始 HP 的普通未受精蛋。并不是把原来的受精蛋永久标成「冻坏、仍受精」后继续保留 Hatcher。不能据此宣称所有无地图特殊容器转换都已经运行成功，派生分支仍有具体持有环境假设。

## 搬运、库存和蛋箱中的时间继续流动

Verse.Thing.DoTick 对普通 IThingHolder 递归访问其直接内容；Pawn.GetChildHolders 包含 inventory 和 carryTracker，ThingOwner.DoTick 再调用内容物 DoTick。所以普通地图上的**地面、手持、库存**受精蛋都能推进孵化与温损。蛋箱 CompThingContainer.CompTick 也调用 innerContainer.DoTick。

Thing.AmbientTemperature 优先使用自身地图格温；未生成物品先查持有链提供的固定温度，再使用 held 格温，之后是世界 tile 温度，最后才是 21°C 兜底。把蛋搬到室内、地下或加热区的意义在于真正改变物品所在位置的温度；库存不能无条件成为恒温保险箱。

ContentsSuspended、IThingHolderTickable.ShouldTickContents、ThingOwner.dontTickContents 可以阻止普通内容 ticking。这里核对的是普通地图持有链和孵出函数的世界分支，没有完整运行验证所有世界/远行队调度器、冷冻容器或 DLC 特例。

## 原版按堆保存孵化状态，不逐枚保存谱系

一个 CompHatcher 保存一套 gestateProgress、hatcheeParent、otherParent、hatcheeFaction；一个温损组件保存一份 ruinedPercent。合堆之前，Thing/ThingWithComps 先要求相同物品 Def 和 Stuff，并咨询组件许可。

Hatcher/温损组件要求「是否完全温损」相同，没有比较父母或 hatcheeFaction。部分吸收 count 枚时：

`新平均进度 = (接收堆数量 × 原进度 + count × 来料进度) / (接收堆数量 + count)`

孵化进度和温损都按这个形式加权；**接收堆保留自己的父母和孵化阵营**。原版没有每枚独立的入库时间、谱系或可变孵化期限。拆堆时复制进度、温损、父母和孵化阵营。

这意味着把较新蛋加入快孵出的旧蛋堆，会拉低整堆进度；两者之后一起孵化。若 Web 选择按谱系拆堆、拒绝不同阵营混堆、逐枚计时等更精细行为，应标成自己的玩法设计，不把它写成从这段原版源码复现的事实。

## 每枚孵出一个独立新生儿，整堆共享来源

Hatch 构造 Chicken 的 PawnGenerationRequest，使用保存的 hatcheeFaction 和 Newborn 请求，不允许生成死亡、倒地或怀孕个体。通用 PawnGenerator 的 Newborn 分支跳过世界个体复用，并把生理年龄与时间年龄都设为 0；这里不是靠误读构造函数位置参数来推导年龄。循环 `i < parent.stackCount`，**每枚调用一次 PawnGenerator.GeneratePawn**，所以 12 枚不是只产一只鸡，但整堆使用同一保存的父母和派系。

普通无强制性别的鸡按通用 50% 分支选择公母，并不保证每堆恰好一公一母。新生个体的食物初值位于 Hungry 与 UrgentlyHungry 阈值中间，需要尽快找到食物；并非孵出时赠送满饱食。Web 若提供更宽松的新生缓冲或固定配对，应记录为可玩性适配。

普通地图上 `TrySpawnHatchedOrBornPawn` 用蛋的 PositionHeld/MapHeld 生成子代；它也包含特定远行队/世界库存分支。拿在手里的蛋在孵化前尝试放下。生成成功时：

- 保存了母亲、且其当前阵营仍等于 hatcheeFaction 时，可继承母亲的当前地图允许区域设置。
- 对 flesh 个体记录母亲 Parent 关系；otherParent 满足相应性别/存在条件时记录另一条 Parent 关系。
- 地面蛋会生成羊水污渍。

失败放置的个体走 WorldPawns 的 Discard 路径；无论结果如何，finally 销毁整堆蛋。原版这里没有把不能放下的剩余蛋保留为待孵化队列。Web 如果受单位上限、可站立格或事务容量约束而采用保留蛋重试，需要防止重复生成父母关系、孩子或数量，同时明确这种失败保护与原版不同。

## 交易改变的是孩子归属，进度不会重置

CompHatcher.PrePreTraded 在 PlayerBuys 时把 hatcheeFaction 改为玩家；PlayerSells 时改为 trader.Faction。PostPostGeneratedForTrader 使用传入 forFaction 初始化归属。上述函数没有重置孵化进度、温损或父母。不能因为蛋是普通无阵营物品就让买来的鸡孵成野生，也不能因为卖家原先驯养母鸡就永久保留孩子的玩家归属。

查到的 Core Caravan_Outlander_BulkGoods 原料生成器明确排除 EggsFertilized；本轮没有证明原版此商队固定出售受精鸡蛋。因此 Web 为快速接入养鸡而安排的「商队售受精蛋」是商品适配，不能冒称为这个原版商队的原生商品表。原版活鸡的 AnimalFarm 交易标签及配对生成声明是另一条可复刻入口。

## 蛋箱连接动物行为与搬运

EggBox 使用 CompEggContainer，接受受精/未受精蛋类别，但已有内容时只接受相同 Def，且必须没有达到箱子容量。完全温损的现存蛋会被拒绝继续追加。原版箱子容量 **25**，自动搬空条件却是 **至少 20**，或者组件检测为损坏；XML 描述里的“full”不能代替实际 minCountToEmpty。

WorkGiver_EmptyEggBox 属于 Hauling：预约箱子，要求有内容，普通任务达阈值、强制任务可越过阈值，并须能找到更好的存储位置。driver 走到箱子、等待 **120 tick**取物，再按真实搬运流程拿起蛋、运到目标格、放下。蛋箱不会远程刷新仓库；它减少零散搬运频率。箱子说明明确防露天风化但不防温损，本轮没有把它扩展成恒温孵化器。

## Web 首版应保持的机制边界

应先完成：可追溯的物种入口；雏鸡成长与饲养；母鸡蛋进度/公鸡配种额度；动物自主移动与等待产蛋；受精/未受精两个真实物资；默认保护受精蛋的食材过滤；热环境中的孵化/不可逆温损/转普通蛋；堆叠/拆分/搬运/消耗/交易全过程的状态保存；逐枚生成新个体；蛋箱到仓库的实体搬运；旧存档保持原有动物和食材选择。

同时保留明确差异：Web 数值尺度、固定售蛋商队、产出容量保护、单位上限下的孵化重试、特殊合堆限制等均可合理设计，但需要在玩法文档中与上述静态原版事实分开。静态证据不能替代原版实际交互、浏览器动画表现或完整新殖民地长期体验验证。

复核：`pwsh -NoProfile -File scripts/research/extract-animal-eggs.ps1 -Check`，随后 `pwsh -NoProfile -File scripts/research/collect-animal-eggs-evidence.ps1 -Check`。命令只读原始目标与本地派生文件，检查哈希、锚点、方法范围和限定 XML 投影。
