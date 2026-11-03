# 85 环境损耗、仓储、淋湿与户外娱乐

本轮把天气进一步连接到日常经营：物资为何掉耐久、棚子与封闭仓库为何不同、搬运和合堆如何保留损伤、哪些娱乐会因天气中止。目标为 **RimWorld 1.7.4980 rev60**；19 个选定类型及离线工具身份见 [manifest](evidence/environment-storage-manifest.json)，11 组调用链和 20 组精选 XML 见 [environment-storage-evidence](evidence/environment-storage-evidence.json)。以下 ES 编号均对应该文件。

派生 C# 不是原始源码。XML 保留来源 SHA256、XPath、元素属性及有关玩法字段，没有执行完整的继承合并、活动模组补丁或运行时 Def 数据库解析。原生实机仅观察一组布料储存对照，见 [86](86-native-environment-storage-runtime.md)；天气全链见 [82](82-weather-mechanisms.md)，前轮淋湿实机见 [83](83-native-weather-runtime.md)。

## 损耗扣的是物件耐久

ES01：`SteadyEnvironmentEffects` 每 tick 访问 `ceil(mapArea × 0.0006)` 个格，沿随机顺序表循环。得到房间、屋顶和地形后遍历该格物件；污渍走专门路径，其余尝试 `TryDoDeteriorate`。一天为 60000 ticks，设计尺度约为每格每天 36 次访问；向上取整会使实际次数随地图面积有轻微差异。

普通物件首先必须通过 `ThingDef.CanEverDeteriorate`：启用 HP 的 Item 可以，禁用 HP 的物品不可以；非 Item 只有配置允许损耗的植物等相应分支，不能把建筑默认纳入这条地面物资逻辑。`useHitPoints` 字段默认 true，`deteriorateFromEnvironmentalEffects` 默认 true。

计算读取的是**已经经过 stat parts 的最终 `DeteriorationRate`**。当 rate≥0.001 时，按 `Rand.Chance(rate / 36)` 抽取一次 1 HP 的 Deterioration 伤害。StatDef 的单位说明是平均 HP/天；它不是每 tick 固定扣 rate，也不是按 rate 减少库存件数。对过高 rate，单次最多一次伤害、概率饱和等因素也意味着不能无条件使用线性外推。

一个 `Cloth ×75` 栈是一个持有 HP 的物件。原生观察中它从 80/80 降至 78/80，数量始终为 75。食物腐败年龄和物件 HP 是两个状态；不腐败的应急口粮仍可能因露天存放损耗。冻结解决腐败温度条件，不能被当成所有地面物资的防损耗开关。

## 屋顶、房间、地形和货架分别贡献什么

ES02、XML01 的 `StatPart_EnvironmentalEffects` 从 **0** 开始叠加环境系数；只对已生成在地图上、且启用环境损耗的物件生效。忽略其他 stat parts 时，可写成：

```text
additive = 0.5 × 无屋顶 + 0.5 × 房间使用室外温度 + 地形额外因子
rainFactor = 无屋顶 ? Lerp(1, 5, RainRate) : 1
protectionFactor = 同格建筑提供防损耗保护 ? 0 : 1
effectiveRate = baseRate × qualityFactor × additive × rainFactor × protectionFactor
```

Unity `Lerp` 对插值比例做钳制。`RainRate` 是天气过渡后的插值值。最终 stat 已含该系数，外层处理器给出的屋顶、房间、地形原因不能再乘一次。污染、毒雾、毒尘等还有各自 stat parts，公式只展开本轮覆盖的项。

| 存放条件 | 普通地形、干燥时系数 | RainRate=1 时系数 | 经营含义 |
|---|---:|---:|---|
| 露天且使用室外温度 | 1 | 5 | 下雨明显加速，搬入仓库有实际价值 |
| 有顶但仍使用室外温度的棚子 | 0.5 | 0.5 | 屋顶挡住雨的额外倍率，但不能完全保全物品 |
| 有顶、封闭且使用室内温度的房间 | 0 | 0 | 普通地形下这条环境损耗为零 |
| 无顶、室外、水地形额外因子为 3 | 4 | 20 | 水面额外因子先相加，再被雨放大 |
| 同格受保护货架 | 0 | 0 | 由建筑独立保护，不必借用“室内”标签 |

`Room.UsesOutdoorTemperature` 在房间接触地图边缘时为 true，否则比较 `OpenRoofCount >= ceil(CellCount × 0.25)`。这不等价于 UI 某个“室外”字样，也不是测得室温和室外温度相同就自动成立；它与 `PsychologicallyOutdoors` 是不同判定。

`ProtectedByEdifice` 查物件同格建筑的 `building.preventDeteriorationOnTop`；Core 的 `ShelfBase` 明确启用。上表水地形来自 `WaterBase.extraDeteriorationFactor=3`，不代表任意可见蓝色格都能放物品。实机对照的木地板与沙地及选定父节点均无额外因子覆盖，`TerrainDef` 字段默认 0（XML19/20 与 ES02 源指针）。

这给 Web 设计的关键要求是分别保存 roof、房间封闭性、地形和具体防护建筑，而非一个笼统的 `indoors` 布尔值。当前没有对有顶户外棚、货架或水面做原生实机对照，表中数值仍是静态结论。

## 现有 15 类 Web 资源应如何映射

ES03/04/06 与 XML01..09、12..14、18。表中为选定 Core 定义的基础参数，品质、材质和其他 stat parts 尚未应用；这是实现映射，不是声称 Web 资源已完整等同原版。

| Web 资源 | 参考原版定义 | 启用 HP | 基础 HP | 基础损耗 HP/天 |
|---|---|---|---:|---:|
| wood | WoodLog | 是 | 150 | 0.5 |
| stone | BlocksGranite | 否 | 声明 200，但禁用 | 0 默认 |
| steel | Steel | 否 | 默认 100 不参与 HP | 0 默认 |
| components | ComponentIndustrial | 是 | 70 | 2 |
| food | MealSurvivalPack | 是 | 50 | 0.25 |
| grain | RawRice / RawPotatoes / RawCorn | 是 | 60 | 6 |
| meal | MealSimple | 是 | 50 | 10 |
| meat | 生成的 Meat_* | 是 | 60 | 6 |
| carcass | 选定 Hare / Deer 的尸体 | 是 | 100 | 1 |
| chunk | ChunkGranite | 是 | 300 | 0 默认 |
| cloth | Cloth | 是 | 80 | 4 |
| herb | MedicineHerbal | 是 | 60 | 6 |
| apparel | 具体服装定义 | 是 | 基类 100，具体装备可覆盖 | 基类 2，再乘品质等 |
| weapon | 具体武器定义 | 是 | 基类 100，具体武器可覆盖 | 基类 2，再乘品质等 |
| silver | Silver | 否 | 默认 100 不参与 HP | 0 默认 |

`DeteriorationRate` 的 **StatDef XML 默认值为 0**，不能根据“有 HP”推出“会自行风化”。石块有 HP 但基础损耗为 0；钢铁、白银、石砖则明确禁用 HP。WoodLog 经 `ResourceVerbBase → ResourceBase` 继承，不能漏掉中间父节点；MedicineHerbal 的 60 HP 来自 MedicineBase。

肉类生成器先写过 100 HP，之后最终覆盖为 **60**，同时写损耗 6；不能只读首次赋值。尸体生成器设置基础损耗 1，HP 来自生物的 BaseMaxHitPoints；选定 Hare/Deer 父链没有 HP 覆盖，故采用 MaxHitPoints StatDef 的 100。生物本体的 `useHitPoints=false` 不会自动传给新建尸体 ThingDef。

品质对损耗的乘数为：极差 2、差 1.5、普通 1、良好 0.8、优秀 0.6、大师 0.3、传奇 0.1。这里不能假定所有其他属性也使用同样的品质倍率。表格没有扩展所有服装、武器或 DLC 对象的最终值。

## 搬运、分堆、合堆不能修复耐久

ES05：`CanStackWith` 先检查物件类别、Def、stuff 和遗物等条件，`ThingWithComps` 还逐个询问 `AllowStackWith`；不能只按资源名称合并。合并使用实际能转入的数量 `nTransferred`，而非整个来源栈数量：

```text
newHP = ceil((targetHP × targetCount + sourceHP × nTransferred)
             / (targetCount + nTransferred))
```

例如 20 件 80 HP 布与转入的 10 件 40 HP 布合并，结果为 `ceil(2000/30)=67 HP`。未转入部分留在原栈；拆分复制原物件 HP，组件还会收到拆分回调。原版向上取整意味着存在离散舍入，不能宣称严格连续的耐久总量守恒。

Web 中损伤应随物资搬运、掉落、分堆、存档保持；栈数量、耐久与腐败年龄分别存储和合并。具体兼容限制按已实现的资源属性决定，不应把所有新鲜度或品质不同的物件无条件塞成一个标量。

## 掉落装备与穿着磨损是两条路径

ES06：掉在地上的服装、武器属于地图物件，走环境损耗 stat。人物持有但未 Spawned 的物件在相应检查中还受 `canDeteriorateUnspawned`（默认 false）限制；不能拿居民脚下的屋顶状态直接对每件装备逐格淋雨扣血。

穿着服装的 `Pawn_ApparelTracker` 在 rare tick 检查距离上次磨损是否达到 60000 ticks，并对非 world pawn 的穿着物调用独立磨损路径。其伤害为 `GenMath.RoundRandom(apparel.wearPerDay)`，与地面雨损不同。该实现不会把每件衣服都固定取整为 1 HP/天。

尸体另有特殊处理：地面环境调用会递归尝试尸体穿着的服装。故“有人携带的装备不在普通格列表里”不能外推为“所有死人身上的衣服永远受保护”。本轮没有实机验证穿着磨损、尸体衣物或叠堆。

## 雨水清理的是获准冲刷的污渍层

ES07：环境格访问中，仅在**无屋顶**且 `filth.rainWashes` 为 true 时，按 `Rand.Chance(RainRate)` 调 `ThinFilth`。这会减少一层 thickness，归零时销毁污渍，否则更新显示。不能每帧删除所有室外污渍，也不能将损耗概率 rate/36 套到污渍清理上。

`rainWashes` 字段默认 false。选定 Core 定义中 Dirt、Blood、Vomit 显式 true；Trash、Ash 没有启用。原版屠宰调用尸体生物的 `BloodDef` 生成血迹，**没有一个通用的“butcher 污渍 Def”**。Hare/Deer 继承 AnimalThingBase 的 Filth_Blood，因此当前 Web dirt/blood/butcher/vomit 映射均可雨洗；以后新增灰烬、垃圾或不同生物血液应按各自定义判断。

若 Web 以固定周期分批处理，应把原版格访问频率和雨强映射到自己的模拟时标，使用可复现随机源并保留厚度。该频率是初始参数参考，本轮没有做雨洗实机或统计分布标定。

## 淋湿是有时效的天气记忆

ES08：有肉体、有 mood 的人物在 120 tick 的散列检查中读 `CurWeatherLerped.weatherThought`。选定单阶段天气思想要求当前格无顶才获取；思想还受人物和有效前置条件影响。Core Rain、RainyThunderstorm、FoggyRain 指向 SoakingWet：**−3 心情、0.1 天持续、stackLimit=1**，并有适用的 Ideology precept 消除条件。近期游泳后的 7500 ticks 另有豁免。

屋顶阻止继续获得天气思想，不会在进屋瞬间强制删除已有记忆。应允许记忆自然过期，不能持续叠加成 −6、−9。最近在外面的淋湿记录消退和屋顶遮雨是两个状态转换。

**雪天气是关键反例**：SnowGentle/SnowHard 的 rainRate 都为 1，却没有 weatherThought。它们可影响读取 RainRate 的损耗、清污等消费者，不能因此生成 SoakingWet。前轮 [83](83-native-weather-runtime.md) 已验证 Rain 后出现淋湿 −3；本轮没有补做雪或进屋干燥的原生实机实验。

## 户外散步、观天和投蹄铁不能共用一个天气开关

ES09：`JoyUtility.EnjoyableOutsideNow` 在插值 RainRate≥0.25 时拒绝，还检查 GameCondition、人物可舒适承受的户外温度和真空等条件。这个 helper 本身没有“站在屋檐下就忽略下雨”的旁路。

| 娱乐 | 发起时的相关天气条件 | 已在进行时的相关失败条件 |
|---|---|---|
| GoForWalk 户外散步 | EnjoyableOutsideNow；还要基本需求、可行路径、可接受的无顶户外目标 | 整个 job 的 FailOn 再检查 EnjoyableOutsideNow |
| Skygaze 观天 | 同 helper，额外拒绝 current WeatherDef.rainRate>0.1、preventSkygaze 等 | 实际观天 toil 拒绝有顶、preventSkygaze、helper 不通过 |
| PlayHorseshoes 投蹄铁 | 选定 WatchBuilding/InteractBuilding 链未发现相同雨门槛 | 选定 JobDriver 和共用 JoyTickCheckEnd 未发现散步式雨取消 |

原版散步起点没有观天的 `currentDef.rainRate>0.1` 额外门槛。Web 当前 UI 对应“户外散步”，应采用 GoForWalk 路径，避免因内部曾把“散步/观景”合称而混合两套规则。

投蹄铁结论仅覆盖本轮追踪的调用链，是有边界的否定发现；不等于所有建筑娱乐都永远忽略天气或其他危险。娱乐增益、时间表、饱和与任务结束还有共用逻辑。本轮没有通过原生实际操作验证下雨中断任何娱乐。

## 复核与复用

```powershell
pwsh -File scripts/research/collect-environment-storage-evidence.ps1
node scripts/research/verify-environment-storage-evidence.mjs
node scripts/research/verify-environment-storage-evidence.mjs --local
```

采集器读取现有派生文件和本机游戏 XML；验证器检查提交记录、裁图、源指针及可选本地材料的完整性，不启动原版、不复现实验。Web 应优先保全“露天受损 → 搬运 → 有顶棚减损 → 封闭仓储保护”的可玩链，再集中调整初始参数；本文静态数值不代表已完成 Web 等速或长期平衡标定。
