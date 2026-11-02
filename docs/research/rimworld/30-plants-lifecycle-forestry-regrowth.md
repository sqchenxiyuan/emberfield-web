# 30 植被生命周期、林地与自然补种

本章把“地形上出现一棵树”补成“树会生长、可提前砍伐、可人工重种、会衰老、空地可能自然恢复”的规则链。它承接第 06 章植物/生成调查与 [第 27 章生态与地形](27-biomes-terrain-generation.md)，以本机 **RimWorld 1.7.4980 rev60** 的 DLL 和 Core XML 为证据；不把本项目的 3D 简化规则称为原版机制。

原件为 `F:\SteamLibrary\steamapps\common\RimWorld\Assembly-CSharp.dll`，SHA256 为 `eff7d97949f919fb2b151ebfb906e9be749b63410b7dbda78eeebb7972b245c3`。ILSpy `11.2.0.10050` 只解析文件，没有加载执行游戏代码。本章的代码行号只适用于证据清单中的派生文件指纹；完整派生 C# 保留在忽略目录 `.local-research`，仓库只交付规则、定位、少量 XML 数值和独立算例。

## 30.1 实现合同

下表是原版确认规则。项目对它们的取舍见 30.10；表格本身不是项目运行验收。

| 主题 | 原版确认规则 | 实现时容易误解的点 |
|---|---|---|
| 状态 | growth、age、unlitTicks、madeLeaflessTick、sown；HP 由 Thing 保存 | 生长与年龄独立，不能用 growth 反推 age |
| 初始野生树 | growth=`clamp01(U(.15,1.5))`；age 在 `[0, max(lifespanTicks-50,0))` 随机 | 初始树不是全成年；年龄与生长分别取样 |
| 后续自然苗 | growth=.15，age=0，sown=false | 空地自然补种不直接长出成年树 |
| 人工苗 | 播种中 growth=0、sown=true；完成 growth=.0001 | 完工仍设为 0 会停在 Sowing 阶段 |
| 生长 | `2000/(60000*growDays) × 肥力 × 温度 × 光照 × 条件系数` | 夜间休眠、成熟状态、枯萎、真空另有门禁 |
| 提前收获 | 普通树严格 `growth>.4`，Saguaro 严格 `>.2` | 等于阈值仍不能收获；自动林地收获还要 Mature |
| 木材 | `base × growthFactor × (.5+.5*health) × difficulty` 后随机舍入 | 健康 50% 对应 75% 健康收益系数 |
| 砍伐/清除 | Cut、Chop 均经过共有收益流程 | 清除一棵已可收获的树也可能产木 |
| 林地间距 | 检查 8 邻格；详见 30.5 的 `sown` 谓词 | 自然聚类半径 8 不是人工种树间距 |
| 衰亡 | 过寿命或连续缺光超过 450000 ticks 后，以 .005 HP/tick 衰减 | 多个原因取 max；不是同一百分比生命伤害 |
| 自然补种 | 扫描、密度概率、MTB、占用、饱和、物种资格、权重依次限制 | 没有“砍完原格固定 N 天重生”的保证 |

规则索引是 [plants-claims.json](evidence/plants-claims.json) 的 PL01–PL20；每条含原始 XML 定位或带指纹的派生代码行号。

## 30.2 生长、年龄与初始分布

`Plant.LifeStage` 判断为：growth `<.0001` 属于 Sowing，growth `>.999` 属于 Mature，其余为 Growing。setter 把 growth 限制在 0..1。普通自然新苗的类默认值为 .15；完成播种则明确写成 .0001。阶段判断不是 0/1 两态。[PL01、PL08]

初始地图生成调用 `SpawnPlant(..., setRandomGrowth:true)`，把 .15..1.5 的均匀生长抽样截到 1；有寿命的植物另取一个随机年龄。`Rand.Range(int,int)` 的第二个端点排除。因此初始树可以“尚未成熟但年龄很高”，年龄并不是由树的外观或 growth 推出来的。

在理想连续均匀模型里，恰好 growth=1 的比例为 `(1.5-1)/(1.5-.15)=10/27≈37.04%`。若按原版 Mature 的 `>.999` 判断，则约为 37.11%；两者不能混用。后续自然补种默认不启用随机生长/年龄，仍从 .15 和 0 开始。

初始年龄接近均匀分布，并不意味着大量树立刻同日死亡。仅估算“未来一天跨过寿命门槛”的连续模型比例，Poplar 约 .738%、Pine .556%、Saguaro .5%、Oak .370%；这还没有计入跨门槛后继续扣 HP 的时间。该比例是静态公式推论，不是原版地图采样结果。

## 30.3 生长的时间与环境因子

普通 `Plant` 以每次 2000 原版 ticks 的 long tick 更新。在实际温度许可时增加 `GrowthPerTick*2000`，超过 1 则截到 1。`GrowthPerTick` 只有在 Growing 且没有休眠/真空限制时非零；若某次停在 .99901，下一次已属 Mature，可以不再增长至精确 1。[PL02]

局部日内比例 `<.25` 或 `>.8` 时休眠，.25 与 .8 两个端点仍清醒。原版一天 60000 ticks，普通速度 60 ticks/秒。这是昼夜阶段规则，普通植物即使有人工光照也不会因此取消夜间休眠。

在不受本章未展开的 DLC 条件影响时：

```text
fertilityFactor = fertility*sensitivity + (1-sensitivity)
temperatureFactor = 0..6°C 线性 0→1；6..42°C 为 1；42..max°C 线性 1→0
lightFactor = clamp01((glow-.51)/(1-.51))
growthDelta = 2000/(60000*growDays) * fertilityFactor * temperatureFactor * lightFactor
```

实际生长季还要求格子/房间温度严格满足 `min<T<max`，默认 0..58°C；Saguaro 的上限覆盖成 75°C，最佳区间仍是 6..42°C。低温或高温只停长，不等价于立即死亡。肥力最低要求用于能否种植，与肥力速率系数是两次不同检查。[PL03]

例如 Pine 在肥力 1、适温、光照 1、清醒且未成熟时，一次 long tick 增长 1/600≈.1667 个百分点。肥力 .7、温度因子 .5、光照因子 .5 时，增长降至约 .03542 个百分点。`growDays=20` 表示累积满速生长所需的等效天数，并非从播种到成熟的固定日历 20 天。

`HasEnoughLightToGrow` 使用的是 `lightFactor>.001`，用于连续缺光计时；不是直接检查 glow>.001。光照最小值 .51 也是默认值，`growMinGlow==growOptimalGlow` 有特殊端点处理。本章输入的 glow 已视为已知归一值，尚未重建原版天空、灯具、遮挡和 3D 光线传播。

## 30.4 树种参数与继承

| 参数 | Poplar | Pine | Saguaro Cactus | Oak |
|---|---:|---:|---:|---:|
| growDays | 15.05 | 20 | 5 | 30 |
| base wood yield | 27 | 27 | 15 | 46 |
| harvestWork | 800 | 710 | 210 | 1400 |
| MaxHitPoints | 200 | 200 | 130 | 200 |
| fertilityMin | .7 | .7 | .05 | .7 |
| fertilitySensitivity | .5 | .5 | 0 | .5 |
| harvestMinGrowth | .4 | .4 | .2 | .4 |
| lifespanDaysPerGrowDays | 9 | 9 | 40 | 9 |
| 派生寿命天数 | 135.45 | 180 | 200 | 270 |
| 普通速度、工作速度 1 的成年砍伐秒数 | 13.33 | 11.83 | 3.5 | 23.33 |

四者继承 TreeBase 的 WoodLog、harvestTag=Wood、harvestFailable=false、sowWork=4000、sowMinSkill=6、TreeSowing 研究、Ground sowTag、mustBeWildToSow、blockAdjacentSow、interferesWithRoof。Poplar/Oak 经过 DeciduousTreeBase，Pine/Saguaro 直接经过 TreeBase。参数必须沿父链求值；PincushionCactus 的父类是 PlantBase，不能因为同为仙人掌就套用产木树机制。[PL04、PL05；第 27 章]

表中“base wood”只代表未损伤、完全成长、难度系数 1 等条件下的基础值。寿命按 `growDays*lifespanDaysPerGrowDays` 计算，ticks 转换使用 C# 浮点乘积后转 int。算例采用独立双精度模型，没有宣称所有边界都与 Unity 浮点逐位一致。

## 30.5 人工林地：选择、资格、邻格与工作

生长区的作物选择先由 `PlantUtility.CanSowOnGrower` 检查 Ground 等种植标签，再由 `Command_SetPlantToGrow.IsPlantAvailable` 检查研究和物种。TreeSowing 原始定义为 baseCost=1000、techLevel=Neolithic、tags=[TribalStart]；这个标签不足以独立证明每个剧本开局都已解锁。[PL05]

对这里的树种，研究完成后还要求目标在 `map.wildPlantSpawner.AllWildPlants` 内。此集合表示该地图可用的野生物种，检查的不是“地图上目前至少存在一棵同种活树”。菜单方法还存在一个容易遗漏的短路：若研究前置列表为 null，直接返回 true，后面的 mustBeWildToSow/永久黑暗分支不会执行。本章树种的前置列表非 null，故确实执行研究和野生物种检查。

普通种植工作还要检查区域允许播种、目标物种、实际格子生长季、屋顶、技能、种植地、通行/预约以及当前格和邻格阻挡。有些阻挡会生成 CutPlant 或搬开物品工作，不能把“本次没有直接生成 Sow”都解释成不可种植。技能和研究不是同一层：已读的工作生成器没有重复菜单的研究检查，不能据此声称它能修复任何强行写入的非法存档选择。[PL06]

8 邻格阻挡谓词为：

```text
existingNeighbor.blockAdjacentSow
OR (desiredPlant.blockAdjacentSow AND existingNeighbor.sown)
```

因此现有树会阻挡邻近播种；目标为树时，邻近人工种下的普通作物也会阻挡。未人工种植且自身不阻挡的普通野草，不会仅由这条谓词阻挡树苗。自然聚类半径 `wildClusterRadius=8` 是另一套生态权重参数。所审阅的人工播种路径没有“整片林地树密度上限”；自然饱和度规则不能移用为玩家资格限制。[PL07]

Sow 开始时生成实体苗，growth=0、sown=true。工作按 `PlantWorkSpeed*delta` 累计至 sowWork，完成设 growth=.0001。活动 job 保存 sowWorkDone；播种未完成而结束时清除临时植物。把已完成苗留在 0、把中断苗无条件保留、或把活动 job 进度自动当成永久格子进度，都属于不同设计。[PL08、PL19]

## 30.6 伐木、清除、收益与树桩

`HarvestableNow` 只要求定义可收获且 growth 严格高于收获下限；`CanYieldNow` 再检查 yield>0、未枯萎。手动“收获木材”可以选择尚未 Mature 但超过下限的树；自动种植区收获还要求 Mature、CanYieldNow 及其他工作条件。[PL09、PL10]

令 `g` 为生长、`m` 为门槛、`h=HP/MaxHP`：

```text
growthFactor = .5 + .5*clamp01((g-m)/(1-m))
healthFactor = .5 + .5*h
rawYield = baseYield*growthFactor*healthFactor*cropYieldFactor
yield = floor(rawYield) + Bernoulli(frac(rawYield))
```

例如 Poplar 在 growth=.7、满血、难度 1 时 rawYield=20.25，得到 20/21 的概率分别为 75%/25%；满成长但半血时也是 20.25。正好 growth=.4 时不能收获，产出为 0。随机比较使用严格 `<`；受控 draw=.25 时 20.25 向下舍入。若操作者收获属性>1，原版再把第一次得到的整数乘该属性后随机舍入一次。树定义 harvestFailable=false，不走普通可失败收获的失败分支。[PL09、PL11]

砍伐/收获工作每 tick 增加 `PlantWorkSpeed*Lerp(3.3,1,growth)`，使用定义的 harvestWork。较小的植物清除更快，但“清除”并不必然零资源：JobDriver_PlantCut 与 JobDriver_PlantHarvest 都继承同一个产物流程，分别传入 Cut 和 Chop。作业会把产物尝试放在操作者附近；源码中 Near placement 的调用不足以证明任何环境下都绝不丢失。[PL11]

指定式作业还要求对应 designation 在工作时存在。工作保存的是活动 driver 的 workDone，并复查目标、接触、禁止/预约等条件。“清除植物”设计器中的树过滤还依赖 isOrder；本章没有将这个局部分支扩写成所有 UI 入口的全局规则。[PL10、PL12]

1.7 的树桩必须单独考虑：已生成、非 Sowing、HarvestableNow 的树在 Cut/Chop 后可生成 ChoppedStump，并把原树 growth 复制给 DeadPlant。玩家 Cut 会为树桩追加 CutPlant 并放入作业队列，Chop 不做这项自动清理。低于门槛的幼苗不会通过这个路径生成桩。[PL13]

StumpBase 声明 HP=100、startingHpRange=.5..1、基础产木 4、门槛 0；ChoppedStump 的 harvestWork=90、DeteriorationRate=20。桩仍受继承 growth 和实际 HP 对收益的修正，因此不是额外必掉 4 木材。`startingHpRange` 的区间已读取，但本章未追踪 Thing 初始化器的具体随机赋值；也未重建树桩的独立 deterioration 调度。DeadPlant 自身 GrowthRate=0、CurrentDyingDamagePerTick=0、LifeStage=Mature。[PL13、PL14]

## 30.7 缺光、衰老与寒冷

每次 long tick：先按光照因子是否 `>.001` 重置或增加 unlitTicks，再增加 age 2000，随后检查衰亡。因此正好 age=寿命或 unlitTicks=450000 尚未满足严格 `>` 条件，但下一次增加后可能进入伤害。年龄在成熟、夜晚、低温时仍增加。[PL15]

普通树过寿命或连续缺光超过 450000 ticks 时，基础衰亡速率为 .005 HP/tick，每次按 `ceil(rate*2000)` 扣除，等于 10 HP/long tick。并存原因以 max 合并，不是衰老 10 加缺光 10。450000 ticks 等于 7.5 原版天，这是开始衰亡的宽限门槛，不能写成第 7.5 天保证死亡。

这个速率是绝对 HP。相同 10 HP 对 200 HP 的树是 5%，对 130 HP 的 Saguaro 是约 7.69%。若项目以健康比例保存，必须按物种 MaxHP 转换。若把原版日历压缩到每游戏日 `D` 个项目 ticks，则对应平滑速率为 `(.005*60000/D)/MaxHP` 健康比例/项目 tick；是否保持原版 2000-tick 阶梯伤害是独立取舍，不能仅以“项目 20 TPS”推断倍率。

寒冷落叶阈值是 `minGrowthTemperature + seeded[-18,-10]`，且要求植物所在房间使用室外温度。状态保持到最后一次 madeLeaflessTick 后不足 60000 ticks，持续受冷会刷新时间。选定四种树及父链都未覆盖 dieIfLeafless，类默认 false；因此 0°C 生长停止不会直接杀死它们，低温落叶通常也不触发此开关的立即死亡。毒害、污染、真空和其他 DLC 分支各有规则，不在本章普通树模型的范围内。[PL16]

## 30.8 自然恢复：扫描和概率，而非树位计时器

自然补种每个内部 tick 从持久化随机顺序格子循环中检查 `ceil(mapArea*.0001)` 格，例如 2400 格检查 1 格、250×250 检查 7 格、300×300 检查 9 格。默认检查间隔参数固定为 10000，循环实际扫描密度可能受 ceil 影响，不能把面积缩小后直接宣称维持原版每格到达率。[PL17]

流程先过密度概率，再调用 `Rand.MTBEventOccurs(days,60000,10000)`。温带、寒带、沙漠的 days 分别 20/25/35，洞穴为 130。普通范围的单次 MTB 通过概率分别约 .8333%、.6667%、.4762%、.1282%。实现是 `duration/(MTB*unit)` 的概率比较，**不是** `1-exp(-duration/(MTB*unit))`。极小概率另用 8 倍多阶段抽样，MTB=0/负值与非法单位/时长还有边界分支。[PL17]

这只是 MTB 门。还要满足：密度系数正、没有 plant/cover/edifice、肥力条件许可、雪深<.2、沙深<.2。人工屋顶阻止自然补种，自然屋顶进入洞穴物种选择，并不意味着普通树能在自然屋顶下生成。`CanEverPlantAt` 的气候适应检查也不能替代实际生长季检查；符合物种条件的新苗可以暂时休眠。[PL18]

普通正肥力、非洞穴且无特殊忽略肥力物种的格子，期望容量为 `min(plantDensity*densityFactor*fertility²,1)`。总容量/非零肥力格数参与前置密度机会；低目标数量或特定 biome 分支使用全图 NonStumpPlant 数量判断饱和，其他分支按区域邻近容量判断。还存在肥力覆盖概率曲线、物种占比反馈、聚类和演替顺序等规则，细节沿用第 27 章。

树桩虽不计入 NonStumpPlant 饱和计数，但本格仍有 Plant，会阻挡该格产生下一株植物。没有任何已读规则说明“每个树桩若干天后变回同树”；自然候选与物种权重是全流程重新选择。

## 30.9 可复现的证据与校验

新增 14 个派生类型，复用 generation 的 7 个、food 的 3 个，共检查 24 个实际引用类型。新 XML 仅增加 TreeSowing、StumpBase、ChoppedStump 三个记录，复用第 27 章的 11 个父链/物种/生态记录。没有重复分发整份原版 Def 或派生源码。

- [plants-manifest.json](evidence/plants-manifest.json) / [plants-types.json](evidence/plants-types.json)：文件身份、派生类型和行数。
- [plants-xml.json](evidence/plants-xml.json)：3 个新记录、11 个复用记录索引、72 项明确缺省检查。
- [plants-claims.json](evidence/plants-claims.json)：20 条规则，70 个代码引用和 28 个 XML 引用。
- [plants-cases.json](evidence/plants-cases.json)：16 个独立算例，250 项算术/布尔断言。
- [plants-validation.json](evidence/plants-validation.json)：对原件、版本、8 个 XML 文件、192 个字段、14 个属性节点、30 个缺省根和 72 个缺省叶的实际检查结果。

仓库根目录为 `experiments/rimworld-like` 时：

```powershell
# 不需要原游戏：校验选定元数据、继承与独立数学模型
node scripts/research/verify-plants-evidence.mjs

# 有本地合法原件时：重建缺失的引用派生文本，不改旧组清单
./scripts/research/extract-plants.ps1 `
  -GameRoot 'F:/SteamLibrary/steamapps/common/RimWorld' `
  -DecompilerPath '../../tools/ilspy/lib/netstandard2.0/ICSharpCode.Decompiler.dll'

# 检查实际派生指纹、原版 DLL/XML、父链和缺省字段
./scripts/research/verify-plants-evidence.ps1 `
  -GameRoot 'F:/SteamLibrary/steamapps/common/RimWorld'

# 对忽略目录中的元数据副本做33项拒绝测试
node scripts/research/test-plants-verifier.mjs
```

首次创建/有意更新本章元数据才使用 `collect-plants-xml.ps1` 和 `write-plants-evidence.mjs`。collector 遇到版本变化或意外默认值覆盖会中止，不能用重采集来绕过版本审阅。负向测试只改 `test-results/plants-verifier-negative` 下副本，并覆盖错误健康系数、严格阈值、夜间端点、指数 MTB、错误树/桩参数、父链、路径穿越、遗失缺省检查和派生文本污染。

本次 portable、local-derived、original-XML 三层检查均 PASS，33 个篡改样本全部被拒绝。它们证明选定文件/参数及独立规则算例一致，**不证明原版 UI 已运行、游戏完整生态已复现、或项目中的实现已通过端到端验收**。原版和项目运行验证必须引用各自的独立材料。

## 30.10 本项目适配与尚未确认的边界

本轮给实现端的合同保留 growth、age、health、unlitTicks；health 归一化时同时使用物种 MaxHP。人工苗 .0001、自然苗 .15，保留严格收获下限和健康收益修正。以下属于本项目适配，仍由实现端的测试和存档迁移材料确认：

| 项目决策 | 与原版的关系 |
|---|---|
| 仅对树实行 8 邻格间距，普通草不参与完整 sown 互斥 | 简化人工林地资格；不是原版完整邻格谓词 |
| 固定种子+坐标决定小数收益舍入 | 保留确定性和统计意图；没有复现原版全局 RNG 消耗顺序 |
| 树苗占地或 3D 头顶预留两格 | 3D 空间设计，原版 2D 林地没有对应的可行走高度规则 |
| 自然补种只对选定树种，采用项目 3D 密度/概率 | 与原版草、树、灌木、洞穴、演替的完整竞争过程不同 |
| 简化/延后 TreeSowing、技能、研究、树桩或 DLC 分支 | 应在玩法与状态面板中说明，不应标为已原样实现 |
| 缩放日历、平滑生命衰减、简化天空/屋顶光照 | 需分别记录日历映射、绝对 HP 换算和光照输入来源 |

尚未在本章闭合的范围包括：完整 active-mod/DLC Def patch 数据库、原版太阳/灯具光照、完整树桩 deterioration 调度、随机起始 HP 的赋值器、Near 产物放置失败行为、所有 designator 的 isOrder 来源以及原版整局随机数回放。`minSpacingBetweenSamePlant` 虽存在于类字段，所读的普通播种/补种路径没有发现它的使用；这只限定于已读路径，不能宣布整个游戏都不使用该字段。
