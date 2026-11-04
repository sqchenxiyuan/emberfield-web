# 畜产品采集：单峰驼、蓄奶、现场挤奶与实体食品

更新：2026-11-05。目标为 RimWorld **1.7.4980 rev60**。本页只使用本地安装包的静态派生 C# 与打包 XML，没有运行原版、浏览器、预览、GUI 或截图。重点是把饲养、资源增长、劳动、物品和消费接成可持续机制；原版数值作为参考记录，Web 平衡参数可以继续调整。

## 身份和覆盖边界

- 程序集 `F:/SteamLibrary/steamapps/common/RimWorld/Assembly-CSharp.dll`，SHA-256 `eff7d97949f919fb2b151ebfb906e9be749b63410b7dbda78eeebb7972b245c3`。
- 复用 [REA 托管身份记录](evidence/production-bills-rea-managed.json)，证据 `ev_41acdc3a1d6904fb12e36eeaac20397afac130d300dafc70973a154cd3fbfd84`，父证据 `ev_ebbdfc84b2bb4bc3fff131fd667e539f7c75c3d78c0491481455a7751b3a5337`。仅核对同一程序集身份。
- [提取清单](evidence/animal-milk-manifest.json) 保留 **35 个类型**的派生文本哈希；[机制投影](evidence/animal-milk-mechanisms.json) 保留 **72 个锚点、8 项有界检查、25 项 XML 投影**。
- 完整派生类型只留在忽略目录 `.local-research/animal-milk/`，不入库。下述行号只对该清单哈希有效。ILSpy 容忍未解析依赖；派生结果不是原始工程源码。
- 审查普通 `CompMilkable → CompHasGatherableBodyResource → WorkGiver_Milk → JobDriver_Milk`，以及单峰驼、奶的定义和具体食谱 / 商人兼容路径。不是完整模组补丁数据库、全部动物训练 / 运载系统、所有特殊任务或运行观测。

## 选用原本就能产奶且可野生获取的物种

Core `Races_Animal_CowGroup.xml` 中的 `Dromedary` 是单峰驼，直接带有 `CompProperties_Milkable`：`milkDef=Milk`、`milkIntervalDays=2`、`milkAmount=18`。没有覆盖 `milkFemaleOnly`，沿用类型默认 true。现有兔与鹿没有因此自动获得产奶能力；增加奶资源应同时增加正确的生产物种。

| 单峰驼原版定义 | 记录值与意义 |
|---|---|
| Wildness | 0.25 |
| 体型 / 健康缩放 | 2.1 / 1.6；不是直接总 HP 或固定肉数量 |
| baseHungerRate | 0.535；不是每天吃 0.535 营养 |
| 食性 | `VegetarianRoughAnimal`，包含草本植物 |
| trainability / roamMtbDays | None / 3，属于需围栏与牵引管理的游荡动物 |
| 幼年 / 成年年龄 | 0.25 / 0.3333 原版年，生命阶段为 AnimalJuvenile / AnimalAdult |
| 妊娠 / 寿命 | 6.66 天 / 45 年 |
| MoveSpeed / 舒适温度 | 4.3 / −22～60°C |
| 野生群体 | 2～5 只，生态权重 1 |
| 交易分类 | AnimalCommon、AnimalFarm |

`Need_Food.BaseHungerRate` 是生命阶段倍率 × `baseHungerRate` × `2.6666667E-05` 每 tick。在成年、Fed、无其它修正的简化条件下，0.535 对应约 **0.856 营养 / 原版天**。饥饿、健康等实际修正另算。不能把“基率”和“日消耗”混用。

`StatWorker_MinimumHandlingSkill` 的 Wildness 曲线在 `(0.15,1)` 与 `(0.98,10)` 之间插值；0.25 得到约 2.084，`MinimumHandlingSkill.roundValue=true`，普通参考要求为 Animals 2。它是驯服 / 训练等工作的条件，**不是挤奶工作另设的最低技能**。`trainability=None` 也不意味着不能驯服或挤奶。

`RaceProperties.Roamer` 依据 `roamMtbDays` 存在，`FenceBlocked` 等于 Roamer；`AnimalPenUtility.IsRopeManagedAnimalDef` 再检查 Animals 分类。单峰驼符合这一链。Web 若只把新物种塞进显示列表，却继续用 `species==='deer'` 判定所有圈养路径，就会漏掉围栏、牵引与区域限制，需统一按物种规则判断。

## 野生生成是加权选择，不是固定出现概率

`Biomes_WarmArid.xml` 记录：

| 生物群落 | Dromedary commonality | animalDensity |
|---|---:|---:|
| AridShrubland | 0.7 | 1.8 |
| Desert | 0.7 | 0.4 |
| ExtremeDesert | 0.2 | 0.1 |

`WildAnimalSpawner` 第 111 行先按季节可接受性过滤，再使用 `CommonalityOfAnimalNow` 加权抽取；第 163—182 行还处理污染、海岸和世界地块修正，并除以 `wildGroupSize.Average`。第 139—159 行再抽取群体数量生成 Pawn。因此 0.7 不代表“每次有 70% 概率生成单峰驼”。

Web 用荒漠地图的确定性物种轮换、较小动物容量或其它简化生成方式可以满足可玩路径，但应记录为项目适配。自然出现、可驯服、可圈养、成年雌性实际产奶这几步都需要接通，不能用后台直接赠送奶代替。

## 蓄奶只要求合适的归属、性别和生命阶段

`CompMilkable.Active` 第 17—39 行先通过父类活动条件，然后检查：允许的性别、当前生命阶段 `milkable=true`、以及不是 Anomaly Shambler。父类第 20—33 行要求 **Faction 非 null**、未 Suspended，并没有把资格限制为玩家阵营。

单峰驼使用的 AnimalBaby 和 AnimalJuvenile 没有 milkable 字段，默认 false；AnimalAdult 显式 `milkable=true`。这一 flag 对单峰驼与可繁殖成年阶段重合，但不能推广为任意物种“可繁殖就必定产奶”。

这条活动链 **不要求怀孕、曾经生育或有 Lactating hediff**。没有直接温度、睡眠或身体损伤阈值。睡眠、倒地等可阻止工人当时挤奶，但不等价于活动组件停止增长。不能将真实畜牧的泌乳逻辑擅自补成原版规则。

`CompHasGatherableBodyResource.CompTick` 第 54—69 行每个活动 tick 执行：

```text
fullness += HungerMultiplier / (milkIntervalDays × 60000)
fullness = min(fullness, 1)
```

`PawnUtility.BodyResourceGrowthSpeed` 第 341—344 行只取饥饿类别倍率，没有食物 need 时用 1：Fed=1、Hungry=0.5、UrgentlyHungry=0.25、Starving=0。饲养不足会延缓下一批奶；不会再单独扣一笔“产奶饲料费”。满度已经为 1 时，不会继续积累第二批、第三批库存。

`fullness` 存在动物组件上，存档键为 `milkFullness`，缺省 0。不活动只暂停增长，所读组件没有清空旧满度的分支，也没有驯服、阵营变化或重生成时免费补满的钩子。原版野生无阵营不蓄奶；已有奶量的个体失去归属时暂停，而非凭空重建资源。

## 满奶后安排普通现场工作

`WorkGiver_GatherAnimalBodyResources` 扫描工人同阵营的已生成 Pawn，要求动物存在对应组件且 `ActiveAndFull`、未倒地、未被工人牵引、可进行日常互动、可以预约。`CanCasuallyInteractNow` 还会拒绝睡眠、攻击 / 游荡精神状态、跟随主人、组建远行队等状态。这里没有要求 Animals 达到驯服门槛。

Core 的 Milk work giver 属于 **Handling**，要求 Manipulation，`priorityInType=90`。普通屠宰与放生是其它优先级工作；所读挤奶资格函数没有直接检查 Slaughter / ReleaseAnimalToWild 标记。Web 可以给显式管理命令优先级，但不能把该适配写成组件自己的原版条件。

`JobDriver_GatherAnimalBodyResources` 第 23—66 行的工作链是：

1. 预约目标，走到可触碰位置。
2. 工人停下，让动物进入最多 15000 tick 的维持姿势等待。
3. 每次实际工作间隔 `delta`，先学习 Animals `0.13 × delta`，再以 `AnimalGatherSpeed × delta` 增加 `gatherProgress`。
4. 达到 `JobDriver_Milk.WorkTotal=400` 才调用 `Gathered`，结束任务。

400 是工作量，不是任何人都固定等 400 tick。忽略其它 stat 修正的近似式为：

```text
speed ≈ max(0.1,
  WorkSpeedGlobal × (0.04 + 0.12 × AnimalsLevel)
  × Manipulation × (0.5 + 0.5 × min(Sight, 1)))
```

XML 的 Manipulation 权重 1，没有显式 max；Sight 权重 0.5、max=1。实际 StatWorker 还存在其它组件、装备、状态等修正，不能把上述简化式当成所有模组下的完整公式。

## 收集成功率决定整批是否浪费，不按百分比缩小每次产量

`CompHasGatherableBodyResource.Gathered` 第 72—94 行只抽 **一次** `Rand.Chance(AnimalGatherYield)`：失败产生“产品浪费”提示，不生成奶；成功才取 `RoundRandom(ResourceAmount × fullness)`。

`AnimalGatherYield` 的 Animals 等级 0—20 因子为：

```text
0.6, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95, 0.975, 1,
1.01, 1.02, 1.03, 1.04, 1.05, 1.06, 1.07, 1.08, 1.09,
1.10, 1.12, 1.13
```

忽略其它修正时，再乘 `(0.7 + 0.3 × Manipulation) × (0.8 + 0.2 × min(Sight,1))`。不要先把等级因子截为 1，因为大于 1 的部分可抵消身体能力下降。`Rand.Chance` 对最终值 ≤0 直接失败、≥1 直接成功，中间才抽样。**高于 100% 不会因此增产**。

这组曲线与 `PlantHarvestYield` 的技能数列及两项能力权重相同，但技能对象不同；植物 stat 另有 maxValue=1.5，消费这项 stat 的算法也不同。可以共享基础数据，不能直接复用植物高产量处理来多生成奶。

普通工作要求满度 ≥1，而组件增长封顶 1，因此健康满周期单峰驼成功时是 **18 奶**，失败时是 **0 奶**；不是每次稳定拿到 `18 × 60%=10.8`。若特殊调用在部分满度调用 Gathered，静态函数按当时 fullness 取整，但它不是普通 work giver 可提前挤奶的证据。

## 中断、载入与物理落地必须分开处理

`gatherProgress` 保存在当前 JobDriver；动物满度保存在组件。合法存档恢复同一任务可继续工作，取消后重新分配的新任务从自己的默认进度开始。不能把前一工人取消的 progress 自动变成动物永久共享工作量。

目标消失、禁止、倒地、不可日常打断、失去接触，或工作 toil 发现不再 `ActiveAndFull`，都会结束工作。结束回调只在动物仍处于 `Wait_MaintainPosture` 时释放这个等待；**没有在普通中断回调中挤奶、清空 fullness 或生成物品**。满奶但饥饿的动物仍可能满足 ActiveAndFull；饥饿主要影响之前的蓄奶速度。

完成后的成功产物按 stackLimit 分成真实 Thing 堆，使用 `GenPlace.TryPlaceThing(..., doer.Position, ..., Near)` 放在**工人附近**，随后 `fullness=0`。它不直接加入抽象仓库，不要求立刻搬到储存点。普通搬运、禁止标记、保鲜、堆叠与消费继续作用于这些物品。

失败浪费也会把 fullness 清零。更需要注意的是：原版这里忽略 `TryPlaceThing` 的 bool 结果；Near 找不到位置可以返回 false，但该方法没有保留待落地容器或重试状态，仍清空 fullness。本轮没有运行拥挤地图验证，不能宣称原版保证任何情况下产物无损落地。

Web 若在落地受阻时预检、保留待交付产品或保存一次成功 / 失败结果，必须明确为三维物资系统适配，并防止重试、读档、换工人重复抽样或多生成一批奶。只有物理产物真正成为世界状态时，才应按项目账本规则计入产出。

## 奶是可生吃、做饭、腐败、搬运与交易的普通物资

Milk 的继承链为 `Milk → OrganicProductBase → ResourceBase`；以下是逐级投影结果，而非仅看 Milk 子节点猜默认值：

| 属性 | 原版记录 |
|---|---|
| Nutrition / Mass / MarketValue | 0.05 / 0.045 / 1.9 |
| MaxHitPoints / Flammability | 60 / 0.2 |
| DeteriorationRate | 父定义 6 |
| stackLimit / 搬运 | 祖先定义 75，alwaysHaulable，带 Forbiddable |
| healthAffectsPrice | 父定义 false，伤损比例不直接折价 |
| 腐败 | 14 天开始，`rotDestroys=true`，父定义 Rare ticking |
| ingestible | RawTasty，AnimalProduct + Fluid，babiesCanIngest=true |
| 普通食物中毒属性 | `FoodPoisonChanceFixedHuman=0.02`，不是保证生喝绝无中毒 |
| 物品分类 | AnimalProductRaw，其父分类为 FoodRaw |

`CompRottable` 按温度调整累计 rot progress；`GenTemperature.RotRateAtTemperature` 在 0°C 以下为 0，0～10°C 线性增长，10°C 及以上为 1。达到 Rotting 且 rotDestroys=true 就销毁。拆堆保留 rot progress，合堆按数量加权；新奶与旧奶混合不是所有奶都刷新成全新。

三层定义均没有 `ingestible.tasteThought`，其类型默认 null；`FoodUtility` 只有字段非 null 时才添加普通味觉思想。因此 Milk 不继承 `PlantFoodRawBase` 的 `AteRawFood` 负面思想。其它理念、特性、就餐环境或特殊食物思想仍可能生效，不能承诺喝奶没有任何心情效果。

人类 `OmnivoreHuman` 包含 Fluid 和 AnimalProduct；`VegetarianRoughAnimal` 不包含这两项，所以原奶**不是单峰驼等普通草食动物的直接饲料**。不能因为 UI 把它放进“食物”，就让所有草食动物通过原奶自我循环饲养。加工成 Meal 后适用 Meal 的食性规则。

具体后续路径：

- `CookMealSimple` 接收 FoodRaw，按 **0.5 营养**计价，故 .05 营养的奶在无其它修正时可用 10 单位制作一份简餐。该计算是定义推导，实际 bill 过滤仍可禁用奶。
- `CookMealFine` 的蛋白一半接受 MeatRaw 或 AnimalProductRaw，另需植物营养；Milk 能替代该动物蛋白部分。Vegetarian Fine 也允许 AnimalProductRaw，奶并不等于肉。
- `Caravan_Outlander_BulkGoods` 的 FoodRaw 类别生成器涵盖 Milk，类型默认 `Tradeability.All`；但具体来访只抽若干品类，不能据此保证每次卖奶。商人购买能力仍受银钱、拒收与交易状态等系统限制。

## 给 Web 的落地边界

需要接通的最小经营循环是：荒漠野生单峰驼 → 驯服与围栏饲养 → 成年雌性、充足食物积累奶量 → 饲养员现场挤奶 → 地面实体奶 → 搬运与保鲜 → 生吃 / 烹饪 / 交易。物种表、圈养过滤、自动宰杀、尸体来源和存档校验均要认识新物种，不能仅添加渲染名称。

数值可以暂用集中参考参数；Web 的一年 / 一天长度、成长周期、野生物种比例、健康与肉产量、确定性 RNG、资源容量和落地失败策略都应在玩法文档单独声明。与原版一致的机制和为 Web 做的取舍应能被分别验证。本页不宣称本轮 Web 实现、视觉验收或迁移测试已完成。

## 静态复核命令

```powershell
pwsh -NoProfile -File scripts/research/extract-animal-milk.ps1 -Check
pwsh -NoProfile -File scripts/research/collect-animal-milk-evidence.ps1 -Check
```

前者用固定哈希的 ILSpy 分析库重新读取固定哈希的程序集，核对 35 个派生类型及清单；后者核对 72 个锚点、8 个有界检查、25 个打包 XML 投影、产奶配置及曲线对照。它们不加载执行目标程序集、不启动游戏，也不构成原版运行测试。
