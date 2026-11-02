# 天然岩石、切石生产与石材建造

本轮把此前“开采直接产石材”的抽象拆成天然花岗岩、岩块、切石账单和花岗岩砖。最小生产闭环是：每个天然岩石实体完成开采时抽一次掉落；搬运一块岩块到切石台；完成整批工作后消耗岩块、产出 20 砖；再按账单设置放置或搬入仓储。采矿、生产、入库是不同阶段，不应提前把未产出的砖计入库存。

本章复用 [06 世界生成与资源](06-world-generation-resources.md)、[12 农业与生产账单](12-farming-cooking-food.md)、[21 有限仓储](21-storage-logistics-mechanisms.md) 的原始样本与派生证据。新增证据编号 `RW17-STONECUTTING`，逐项定位见 [stonecutting-claims.json](evidence/stonecutting-claims.json)。静态结论与项目三维实现选择分开说明；本章没有操作原版 UI。

## 1. 样本和数值速查

样本仍为 `F:\SteamLibrary\steamapps\common\RimWorld` 的 `1.7.4980 rev60`。`Assembly-CSharp.dll` SHA256 为 `eff7d97949f919fb2b151ebfb906e9be749b63410b7dbda78eeebb7972b245c3`；ILSpy 分析库版本 `11.2.0.10050`，SHA256 为 `587a18e18e13acfc7fd8783a44c24c7da0781dadf6b9fb9dd5e2e38a9cdfae78`。

| 对象 | 原版已核声明/机制 | 解释 |
| --- | --- | --- |
| 天然 `Granite` | HP 900，掉 `ChunkGranite` 概率 0.25 | 每个完成销毁的 Mineable 实体抽一次 |
| `ChunkGranite` | 单堆 1；基础掉落数量 1 | 岩块，不是建材砖 |
| `BlocksGranite` | 单堆 75 | 项目 `stone` 的对应物 |
| `TableStonecutter` | 3×1；交互偏移 `(0,0,-1)` | 偏移随朝向旋转 |
| 切石台成本 | 75 可选基材 + 30 钢 | 基材允许 Metallic / Woody；木制即 75 木 + 30 钢 |
| 切石台建造 | 基础工作量 2000；木制实际 1400 | 木材 `WorkToBuild` 系数 0.7 |
| 指定花岗岩配方 | 1 `ChunkGranite` → 20 `BlocksGranite` | 默认效率 1；完整批次 |
| 切石劳动 | `workAmount=1600`，`GeneralLaborSpeed` | 再乘工作台工作速度因子 |
| 工作/技能 | Crafting 工作；Crafting 经验系数 0 | 不因配方写了 Crafting 就获得经验或按该等级加速 |
| 普通石墙 | 5 石砖，工作量 950 | `135×6+140` |
| `TileGranite` 地板 | 4 石砖，工作量 1100 | 地形固定工作量，不再乘石材系数 |
| `FlagstoneGranite` 石板路 | 4 石砖，工作量 500，拆除返还 0 | 与精制花岗岩地板分开 |

来源 SC01–SC06、SC15–SC18。这里的工作量不是无条件耗时；人物速度、建筑 stat、时间缩放需另行计算。表中切石台 HP 180 是 XML 基础值，材质也可影响最终耐久。

## 2. 开采粒度、概率和技能

`Granite → UglyRockBase → RockBase → BuildingNaturalBase`。花岗岩声明 `mineableDropChance=0.25`；`UglyRockBase` 设置 `mineableYieldWasteable=false`。未覆盖的 `BuildingProperties.mineableYield` 默认 1；难度因子参与 `EffectiveMineableYield`。

`Mineable.TrySpawnYield` 的选中分支为：

```text
若 Rand.Value > mineableDropChance，则没有掉落
否则成功数量 = max(1, RoundToInt(mineableYield × difficulty.mineYieldFactor))
仅 mineableYieldWasteable=true 时再应用累积 MiningYield
```

因此普通难度下，天然花岗岩成功掉落 1 岩块；MiningYield 不会把这项非 wasteable 岩块产量按采矿技能放大。矿石的可浪费产出链另有伤害占比累计，不应套到岩块上。

`JobDriver_Mine` 对天然岩石每次镐击基础伤害 80，非天然矿物为 40；间隔按 `100 / MiningSpeed` 计算。最后一击走 `DestroyMined`，然后抽掉落。概率不是每次镐击抽，也不是每个派工任务统一抽。来源 SC01。

原版是二维地图上的 Mineable 实体。项目一个挖掘任务若处理上下两个天然石体素，应对每个实际移除的天然石块分别决定掉落；土、钢矿、建筑石墙等不得共用天然花岗岩规则。项目用种子和坐标决定结果便于复现，这是对原版全局 `Rand` 随机流的适配，不是原版 RNG 重放。

在独立伯努利模型与默认产量下，每个天然岩石的最终石砖期望为 `0.25×1×20=5`；两个岩石恰掉 0/1/2 岩块的概率分别为 `0.5625/0.375/0.0625`。此前直接产 5 砖保留了均值，但跳过了随机性、单块岩块仓位、取料与加工劳动。有限样本不保证接近均值。

## 3. 切石台的空间、成本与工作条件

切石台占 3×1 格，`hasInteractionCell=true`。原版交互格为中心位置加旋转后的 `(0,0,-1)`；人物工作位置与台面投料位置并不是同一概念。

`DoBill` 先预留工作台，再预留可坐位置或交互格，然后预留原料队列。候选原料放置格先检查工作台占用格，按距交互格远近排序，再考虑附近径向格；`Building_WorkTable.IngredientStackCells` 返回工作台自身占用格。来源 SC04、SC11。

`TableStonecutter → BenchBase → BuildingBase` 所选组件链没有电力或燃料组件。工作台逻辑允许没有相应组件的台子工作；不能因为它是生产设备就强加电力要求。台子需要 `Stonecutting` 研究，地板配方也可能有研究/施工技能限制。项目本轮选择开局已解锁切石研究，应在实现说明中记录。

建造成本由 75 选定基材和 30 钢组合。木制台的工作量为 `2000×0.7=1400`；基础值 2000 不应直接当作木制台最终工作量。基础耐久等其他材质相关 stat 同样不能把 XML 基础数值冒充最终值。来源 SC03。

## 4. 配方劳动、速度和经验

指定账单 `Make_StoneBlocksGranite → MakeStoneBlocksBase`：输入过滤器只允许 `ChunkGranite`，每批 1，输出 `BlocksGranite=20`，工作量 1600。

`DoRecipeWork` 的主要进度关系为：

```text
每次更新扣除的工作量
  = pawn.GeneralLaborSpeed
  × table.WorkTableWorkSpeedFactor
  × 本次经过的原版 ticks
```

配方未显式指定工作台速度 stat 时，`RecipeDef.ResolveReferences` 填入 `WorkTableWorkSpeedFactor`。该 stat 基础值为 1，并包含电力、房间角色、温度、室外因素。切石台没有电力组件，因此普通切石不能凭空套用缺电惩罚。

| 条件 | 已核速度因子 |
| --- | ---: |
| 心理意义上的室外 | ×0.8 |
| 室内且房间角色不是 Workshop | ×0.8 |
| 温度 <9°C 或 >35°C | ×0.7 |
| 恰好 9°C 或 35°C | 不触发该温度惩罚 |

室外与“不在正确室内房间”有不同适用条件：室外情形不同时触发这项房间角色惩罚，不能一律叠为 0.64。温度惩罚可以与其他适用因素相乘。人物特性、操作能力、全局工作速度及设施等仍可能改变最终值；本章没有复制完整 StatWorker 系统。来源 SC05。

`DoBillsStonecut` 属于 Crafting 工作，要求 Manipulation。`workSkill=Crafting` 但 `workSkillLearnFactor=0`，无半成品配方完成经验的公式是 `实际工作ticks×0.1×learnFactor`，结果为 0。配方父链没有技能门槛声明；账单自己的工人限制/技能范围仍可收紧允许人员。来源 SC06。

指定配方的普通产物数量由 `ceil(20×efficiency)` 计算。默认人物效率取 1，工作台效率 stat 默认 1，所以是 20；不能对任意 Mod 或被修改 stat 保证永远 20。`Make_StoneBlocksAny` 是另一条路径：按 StoneChunks 类别取料，从实际岩块的 `butcherProducts` 生成 StoneBlocks 特殊产物，并使用随机取整。默认效率下花岗岩也产 20。来源 SC14、SC19。

## 5. 账单模式、暂停和目标修改

`Bill_Production` 支持固定次数、永远制作、做到目标数量三种模式。`repeatCount` 在**完成一批**后减 1；目标模式判断当前计数是否小于目标，不把一批裁成差额。已有 19 砖、目标 20 时，仍可消耗一块岩块做完整 20 砖，结束后有 39 砖。`targetCountAdjustment=20` 是目标数 UI 加减步长，不是把产出数量自动对齐目标的规则。

自动暂停可使用迟滞：达到目标 `count>=target` 后设 `paused=true`，下降到 `count<=unpauseWhenYouHave` 才解除。手动 `suspended` 是另一个字段，不应把这两种状态合并。来源 SC08。

**仅修改目标数量，不应因此清空当前切石进度。**在本次已审阅路径中：

- `ShouldDoNow` 用于 WorkGiver 选择新的账单作业。
- 目标数 UI 修改字段，没有额外取消当前作业的调用。
- 正在运行的 `DoRecipeWork.FailOn` 检查 `bill.suspended` 和适用的腐败条件；没有检查 `targetCount` 或 `ShouldDoNow`。
- `JobDriver_DoBill` 另检查账单被删除、工作台不再可用等情况。

所以提高或降低目标时，可以让在途批次继续，完成后再判断是否需要下一批。其他正常作业调度、中断或工作台销毁仍可能结束加工；本结论并非“加工过程绝不会中断”。

## 6. 半成品、暂停与存读档

指定和通用切石配方都没有 `unfinishedThingDef`；默认字段为 null，`UsesUnfinishedThing` 为 false。因此原版不生成附着剩余进度的“未完成石砖”物品。

切石新作业进入 `DoRecipeWork` 时设置完整工作量。手动暂停账单会让工作 toil 失败；重新开始的新作业没有可恢复的半成品进度。正常消费原料在完成阶段发生，暂停前原料已可能搬到台面，但不能提前变成已消耗数量。

这与保存游戏不同：当前 `JobDriver_DoBill` 会保存 `workLeft`、开始 tick、累计工作 tick。保存并加载**同一个正在运行的作业**可保留该作业状态，不能因为没有半成品就推导“任何存读档都丢进度”。游戏全局暂停也不等于把账单设为 `suspended`。来源 SC07。

## 7. 目标计数与项目总量的区别

原版指定花岗岩账单在默认设置下走普通 `RecipeWorkerCounter`。花岗岩砖继承 `ResourceBase.resourceReadoutPriority=Middle`，满足 CountAsResource 条件；默认计数使用：

```text
ResourceCounter 中的花岗岩砖
  + 玩家阵营已生成 pawn 手持的花岗岩砖
```

`ResourceCounter.UpdateResourceCounts` 遍历仓储 `SlotGroup.HeldThings`，累计对应 stackCount，排除迷雾、非新鲜等不计对象。它不是对所有无仓储散落物求和；有周期 204 tick 的刷新，也有调用方主动刷新。更改 include-group、品质/耐久等设置可走其他计数分支，本章不将默认路径概括成所有账单设置。来源 SC09。

通用“任意石砖”账单使用专用 `RecipeWorkerCounter_MakeStoneBlocks`，汇总 StoneBlocks 类别各 Def 的 ResourceCounter；该专用函数没有普通计数器额外加入手持量的步骤。不要把指定花岗岩和任意石砖的计数逻辑写成完全相同。来源 SC19。

项目采用**全世界已存在石砖 + 在途携带石砖**来决定是否再生产，可以降低满仓散落后重复开工的机会，但这是明确的项目适配。还应区分：

- 真正已经生成、尚待落地的产物，可纳入项目实物总量。
- 仅预约或计划将要生产的 20 砖，不应冒充已存在库存；若另做“预计在产量”防重复派单，应单列字段。
- 一个物品从地面到手持、再到仓储时只计一次，不能按阶段重复累计。

## 8. 原料配送、完成与产物搬运

新作业选取原料时检查账单允许开工、工人限制、配方门槛、原料过滤、搜索半径、禁用标记、预留及区域可达。普通地面原料以距工作台的平方距离**严格小于**半径平方筛选；默认半径 999。失败搜索可延迟 500–600 原版 tick 后重试，不必每 tick 全图扫描。来源 SC10。

原料从源堆搬到工作台附近后获得物理交互预留。加工未完成时，原料仍是可追踪实物。完成流程依次为：计算本批原料、生成产物对象、消费原料、通知账单本批完成、开始放置/搬运产物。普通 `RecipeWorker.ConsumeIngredient` 销毁本批输入。没有单独附加“切石失败概率”；不要把施工失败或武器品质 roll 套到石砖产出。来源 SC11–SC12。

产物存放模式包括 DropOnFloor、BestStockpile、SpecificStockpile。没有合适目的地时尝试附近落地；找到仓储时，可将产物放入手持并启动新的搬运作业，超过手持容量的余量先尝试旁置。普通基线下 20 砖小于石砖手持/堆叠上限 75。

**原版完成配方与入库不是一个事务。**原料消耗和账单次数更新发生在后续放置之前。附近落地失败有日志分支，不会自动撤销刚消费的岩块。21 章已证明部分放置可能先转移若干物品，再返回失败。因此项目若保存“待放置产物”或等输出空间可容纳整批才消费输入，应标注为防丢货适配，并测试重新尝试不会复制产物。来源 SC13。

## 9. 石墙、地板、拆除与三维时间映射

原版 `Wall` 基础工作量 135，消耗 5 基材。`StatWorker` 的材料运算是**先乘 factor，再加 offset**：

```text
木墙 = 135×0.7 = 94.5 work
花岗岩墙 = 135×6 + 140 = 950 work
木制切石台 = 2000×0.7 = 1400 work
```

`TileGranite` 是 TerrainDef，固定 1100 work、4 砖，继承施工技能门槛 3；不能因为它用石砖就再乘 6、加 140。石板路为 500 work、4 砖，木地板为 85 work、3 木。来源 SC15–SC16。

原版正常速度 60 ticks/现实秒；项目 20 TPS。若劳动速度因子均取 1，并保持现实秒数，使用 `ceil(sourceWork×20/60)`。本轮实现选择如下：

| 项目建造/生产 | 资源与原版工作量映射 | 项目 tick |
| --- | --- | ---: |
| 木制切石台 | 75 木 + 30 钢，1400 work | 467 |
| 一批花岗岩砖 | 1 岩块 → 20 砖，1600 work | 534 |
| 两格高石墙柱 | 两个物理石墙块，各 5 砖/950 work | 634 |
| 石楼板 | 4 砖，参照 TileGranite 的 1100 work | 367 |

两格高墙柱和真正承重的楼板都是三维几何适配，原版地板只是二维地形层。项目已有木墙 6 木/80 tick、木楼板 3 木/45 tick 保持旧实现，不应称为本轮按原版时间公式换算的结果。以一天 12000/60000 的比例 0.2 来缩放会给切石 320 项目 tick，这是另一种尺度；本轮未采用它。来源 SC20。

正常建筑/地板拆除默认返还比例 0.5，但原版使用 `GenMath.RoundRandom` 随机取整。成本 5 的石墙返还 2 或 3，平均 2.5；4 砖花岗岩地板返 2；石板路显式返 0。项目每物理墙块固定向下取整返 2、两格高柱返 4，属于保守确定性回收，比原版两个墙实体的平均返还 5 少 1，不能写成原版固定返 4。

建筑拆除工作量为已求值 WorkToBuild 限制在 20–3000 范围；普通地板移除基础工作量 200，使用 ConstructionSpeed。正常顶层地板移除调用 TerrainGrid 的 leavings；临时地形等其他分支需要另行区分。来源 SC17–SC18。

## 10. 最小实现接口与验收约束

以下是实现需表达的契约，不限定现有 TypeScript 的方法名：

| 接口/状态 | 必须表达的信息 |
| --- | --- |
| 资源身份 | `chunk` 单堆 1；`stone` 花岗岩砖单堆 75；天然岩体与砌筑块区分 |
| 放置切石台 | 中心/朝向、3×1 占格、交互格、完整建造成本与已交材料 |
| 账单设置 | 固定次数/目标/永久、手动暂停、目标数、原料搜索范围、产物去向 |
| 账单观测 | 当前阶段、工人、工作剩余、原料位置、等待原因、真实产品计数范围 |
| 任务预留 | 原料、台子、操作位、必要的输出容量；结束或取消时释放 |
| 完成结算 | 本批输入恰消费 1 次，20 产物恰创建 1 次，余量有可恢复载体 |
| 存读档 | 保留当前工作与实物/预约关系；加载后不再次消费或重复生产 |

必须覆盖的行为包括：源岩块缺失/被占用时不凭空开工；交互格堵塞时不远程加工；手动暂停后不继续偷偷增长进度；仅调整目标保留在途工作；目标满足后不再开新批；满仓情况下输入、产物、携带和待落地量守恒；移动原料后总量不重复；多个工人不共享一个正在被占用的台子；拆除和挖掘的材料身份不会混淆。

这些是本项目验收建议。本文独立脚本通过，并不意味着上述 UI、寻路、保存或三维实现已经通过运行测试；应另看实现与浏览器/原版对照记录。

## 11. 独立证据验证

最终验证覆盖 20 条主张、63 处派生代码引用和 49 处 XML 引用。新提取 17 个类型，复用 generation / food / housing / preservation / logistics / energy 的 17 个类型；本地共 34 个派生文件校验 SHA 与行数。

XML 共 14 个原始文件、30 个独立 Def：本轮 27 个字段选择记录，引用既有 logistics 的 8 个记录；相同 Def 的记录只补充不同字段根，来源摘要和 ParentName 必须一致。另外逐字段交叉检查既有 generation 的 RockBase、UglyRockBase、Granite 三个记录。原始文件复核包含 187 叶值、9 属性节点、144 个明确缺省根。

16 组独立案例、128 个结果断言全部通过；30 项负向证据篡改全部被拒绝。案例包含概率边界、非 wasteable 数量、材料系数顺序、时间映射、温度边界、暂停迟滞、无半成品中断、修改目标不取消在途迭代、原料搜索、目标计数范围、随机回收及待落地产物守恒。它们不导入项目实现，也不加载原版游戏类。

在项目根目录执行：

```powershell
./scripts/research/extract-stonecutting.ps1 `
  -GameRoot 'F:/SteamLibrary/steamapps/common/RimWorld' `
  -DecompilerPath '../../tools/ilspy/lib/netstandard2.0/ICSharpCode.Decompiler.dll'

# 仅在有意识更新已选原始声明时重建 XML 快照。
./scripts/research/collect-stonecutting-xml.ps1 -GameRoot 'F:/SteamLibrary/steamapps/common/RimWorld'

# 无需原版安装的公开证据/模型验证。
node scripts/research/verify-stonecutting-evidence.mjs

# 核对本地派生文件。
node scripts/research/verify-stonecutting-evidence.mjs --local

# 同时核对原始 DLL、Version.txt 和所有选中 XML。
./scripts/research/verify-stonecutting-evidence.ps1 -GameRoot 'F:/SteamLibrary/steamapps/common/RimWorld'

# 在忽略目录的隔离副本中验证错误证据会被拒绝。
node scripts/research/test-stonecutting-verifier.mjs
```

固定主张/案例由 `write-stonecutting-evidence.mjs` 写入；期望值为人工审阅的固定数据，与验证器模型分离。摘要见 [stonecutting-validation.json](evidence/stonecutting-validation.json)，输入及边界见 [stonecutting-cases.json](evidence/stonecutting-cases.json)。

完整派生类仅位于忽略的 `.local-research`；本章不分发原版资源或完整反编译文本。验证未覆盖全部 DLC/Mod 的有效 Def 数据库、完整路径与原料搜索、原版随机流重放、真实暂停/读档时机、极端无处可放的原版 UI 观测。静态派生、独立算例和运行时证据应分别报告。
