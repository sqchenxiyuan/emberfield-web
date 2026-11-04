# 蛋箱：产蛋目的地、真实容器与取出搬运

本轮把蛋箱从此前鸡蛋研究中的配角展开为独立证据链。目标是支持「建箱 → 母鸡选择箱子 → 在箱中产蛋 → 箱内保存、孵化或温损 → 搬运者取出 → 真实入库」的玩法闭环；原版数值用于解释规则，不要求 Web 第一版逐项校准平衡。

## 证据范围与复查

- 本地安装：`F:/SteamLibrary/steamapps/common/RimWorld`，版本 `1.7.4980 rev60`。
- `Assembly-CSharp.dll` SHA-256：`eff7d97949f919fb2b151ebfb906e9be749b63410b7dbda78eeebb7972b245c3`。
- REA 复用同一哈希的受管程序集身份记录 [production-bills-rea-managed.json](evidence/production-bills-rea-managed.json)。本轮核对 REA 会话静态能力，未打开原版运行进程。
- **重新从程序集提取**蛋箱及调用链类型，不以 [145 鸡蛋文档](145-animal-eggs-mechanisms.md) 的文字作为证据。类型清单、ILSpy 引擎哈希和派生文件哈希见 [egg-box-manifest.json](evidence/egg-box-manifest.json)。
- 代码锚点、限定范围的否定检查、XML 路径及哈希见 [egg-box-mechanisms.json](evidence/egg-box-mechanisms.json)。派生 C# 只在被忽略的 `.local-research/egg-box/`，不发布原版程序集、完整派生代码或美术资源。
- 全程只读原版静态文件；没有启动游戏、浏览器、预览页、GUI 输入或截图。派生 C# 不是原作者源码，也不是运行时行为录像；本轮未重建完整启用 MOD 的最终 Def 数据库。

```powershell
pwsh -NoProfile -File scripts/research/extract-egg-box.ps1 -Check
pwsh -NoProfile -File scripts/research/collect-egg-box-evidence.ps1 -Check
```

提取器重新生成类型文本并比对已有本地副本和 manifest；收集器核对程序集、REA、派生代码及 XML 哈希，重新生成投影后逐字比对。缺少派生副本的新环境，先运行不带 `-Check` 的提取器；不要把重新生成投影当成旧证据已经通过检查。

## 建造、几何与物理属性

XML 继承为 `EggBox → BuildingBase`。蛋箱使用普通 `Building`，没有墙、门或围栏的专用建筑类。

| 项目 | 本地 Core 声明及默认值 | 对实现的意义 |
|---|---|---|
| 占地 | `ThingDef.size = IntVec2.One`；父子 Def 均未覆盖 | 1×1 格 |
| 通行 | `BuildableDef.passability` 默认零值；`Traversability.Standable` 为零 | 可站立、可走过，母鸡走到箱所在格 |
| 路径成本 | `pathCost=10` | 额外通行成本，不等于不可通行 |
| `fillPercent` | 0.3 | 不是填满格子的墙体；不能直接当作房间分隔物 |
| 光、风遮挡 | `blockLight=false`、`blockWind=false` 默认值 | 蛋箱未声明这些遮挡 |
| 专用交互格 | `hasInteractionCell=false` 默认值 | 搬运者以 Touch 靠近箱子 |
| 朝向 | `rotatable=false` | 无需四向旋转模型 |
| 地面承载 | BuildingBase 的 `terrainAffordanceNeeded=Light` | 基础建造承载要求 |
| 原料 | `costStuffCount=20`；允许 `Metallic` 或 `Woody` | 20 份所选材料；不接受石质材料类别 |
| 基础工作量 | `WorkToBuild=2000` | 工作量，不是固定 2000 tick 必然建成 |
| 基础耐久 | `MaxHitPoints=50` | 还要应用材料及 stat 最终化规则 |
| 基础燃烧性 | `Flammability=1` | 还要应用材料系数 |
| 基础质量 | `Mass=3` | 物品信息的质量数值 |
| 类别 | `designationCategory=Misc` | 原版位于杂项建造分类 |
| 可搬迁 | `minifiedDef=MinifiedThing` | 支持原版打包机制，不代表箱内蛋随建筑无条件保持封装 |
| 内容可选 | `containedItemsSelectable=true` | 箱中蛋可经容器选择；不是不可见计数 |

`ThingDef.AffectsRegions` 依据不可通行、门或围栏判断。结合普通 Building、Standable 和未声明围栏属性，蛋箱不应像墙那样切开房间。这里不推导所有建造重叠规则；是否允许与其它设施共格仍属于通用建造系统。

**不要把上述 statBases 当成任意材质的最终数值。** 本轮也提取了 `StatWorker` 的材料因素和偏移应用：木材对 HP 乘 0.65、WorkToBuild 乘 0.7、Flammability 乘 1；钢材对 HP 乘 1、Flammability 乘 0.4。木制箱的基础工作经过材料得到 1400，HP 在取整前是 32.5；最终显示及实际构造时间还受 stat 最终化和建造者工作速度等影响。Web 若先只做木箱，可独立选简洁的工作量和耐久，但文档应区分原版基础字段与本地参数。

主要证据：`Buildings_Misc.xml:/Defs/ThingDef[defName="EggBox"]`、`Buildings_Base.xml:/Defs/ThingDef[@Name="BuildingBase"]`；`BuildableDef.passability`、`ThingDef.size/AffectsRegions`、`Traversability`、`StatWorker`。

## 母鸡怎样选箱

入口为 `JobGiver_LayEgg.TryGiveJob`：必须存在 `CompEggLayer` 且 `CanLayNow`。查找开始前读取 `NextEggType()`，因此「即将产下受精蛋」和「即将产下未受精蛋」是不同候选集合。

1. **玩家阵营**动物先找蛋箱。箱子必须 spawned，动物对它不受禁止、可以预约、在名义 30 格水平范围内，且 `CompEggContainer.Accepts(下一种蛋)`。
2. 没有合适箱子，才找 30 格内同种地面蛋。这个分支要求与动物同房间；如果动物当前没有房间，则不加该比较。
3. 再没有，找以动物当前位置为中心、半径 5 的随机游走目的地。

路径目标是 **OnCell**，危险容忍参数是 **Danger.Some**。因此不能把「箱子实体不可占据、鸡只站相邻格」作为原版蛋箱规则。

蛋箱分支没有同房间要求，也没有额外 `box.Faction == animal.Faction` 比较；调用者限制的是**动物属于玩家**。不能把地面蛋的同房间筛选误套到蛋箱，也不能从这个函数推导“任何动物都优先找箱”。`IsForbidden(pawn)` 还包含动物允许区域等通用限制，并非只检查箱上一个布尔禁止按钮。

评分为：非空箱的 **第一栈蛋数 ×5**；空箱 **0.5**；缺组件或满箱 **0**。候选仍须通过 Accepts，所以给满箱零分并不意味着没有其它箱时还能选满箱。相同评分时，已访问候选中的距离较近者胜出。

原版调用 `ClosestThing_Regionwise_ReachablePrioritized`：`minRegions=10`，未覆盖的 `maxRegions=30`。RegionProcessor 在至少访问最小数量且找到候选后即可停止。因此它**不是全半径内穷举后一定挑最多蛋的一箱**。底层候选距离比较用 `< maxDistance²`，名义 30 格边界还受该严格比较约束。Web 使用“30 格内可达箱，已有蛋数优先、距离次优”的全量搜索，是可解释的近似；应在实现文档中写清楚没有复刻原版区域遍历的提早结束。

主要证据：`JobGiver_LayEgg`；`GenClosest.ClosestThing_Regionwise_ReachablePrioritized`；`RegionProcessorClosestThingReachable` 第 113～115、130 行；`ForbidUtility.IsForbidden`。

## 产蛋任务与容量

`JobDriver_LayEgg` 走到目的格，等待 **500 原版 tick**，然后调用 `ProduceEgg()` 创建真实蛋。该 JobDriver 的 `TryMakePreToilReservations` 直接返回 true，没有实际 `Reserve` 调用。选址时 `CanReserve` 和取蛋任务的实际预约不是同一个阶段，不能声称母鸡一选箱就取得排他锁。

最后提交动作再检查目标仍为 Thing 且接受**实际生成的蛋类型**。可接受则加入 `innerContainer`；否则尝试在母鸡附近 `Near` 落地。受精可能在走路、等待期间变化，因此不能只在接任务时锁死下一枚蛋的类型。原版产出代码没有通过最终 TryAdd/TryPlaceThing 返回值来保留受精额度和蛋进度；Web 的容量预检、失败保留及原子提交应标为避免丢物的适配。

蛋箱以 `CompEggContainer : CompThingContainer` 管理真实 `ThingOwner<Thing>`：

- 仅接受**直接包含** `EggsFertilized` 或 `EggsUnfertilized` 分类的 Def。
- 空箱可以接受任一种合格蛋；非空箱要求与 `ContainedThing.def` **完全一致**。未受精鸡蛋与受精鸡蛋不能常规混入一箱，不同动物的蛋也不能只因同属受精蛋就混箱。
- `TotalStackCount < stackLimit` 才能继续接受；声明 `stackLimit=25`。
- 首栈已经温损毁坏时，`Accepts` 返回 false。
- `ContainedThing` 指向首栈，`Full` 用该 Def 的总数；评分和 `CanEmpty` 用首栈数。内部数据结构允许多条实体，不能将其源码描述为天然只有一个槽的结构。

容量 25 是 **CompThingContainer.Accepts 的准入规则**。普通 ThingOwner 默认 `maxStacks=999999`，TryAdd 不再按箱的 25 自动裁切任意批量。鸡一次产一枚，正常入箱规则会停在 25；若以后扩展一次多枚的物种，不能未经核对就声称原版每次批量都会截断至余量。Web 使用 `eggs: Cargo | null` 单批次、硬性限量并复用加权合堆，是当前鸡玩法的数据结构选择。

主要证据：`JobDriver_LayEgg`；`CompThingContainer` 第 20、32、44、66、73～75 行；`CompEggContainer.Accepts`；`ThingOwner.GetCountCanAccept` 与泛型 `ThingOwner.TryAdd`。

## 箱内时间、温度、禁止状态与孵化

蛋箱 `tickerType=Normal`。普通 `Building → ThingWithComps.Tick → CompThingContainer.CompTick → innerContainer.DoTick → 每个蛋.DoTick` 会继续推进蛋自己的组件；蛋箱不是把物品暂存到停止模拟的数字仓库。

普通 Building 自身不是 IThingHolder；持有者在 CompThingContainer。不要因为 `Thing.DoTick` 另有 IThingHolder 递归分支，就给同一蛋箱再额外推进一次。在 Web 中，每枚蛋应恰好属于地面、手持、配方、商队或蛋箱中的一个实际容器，每步推进一次。

| 条件 | 原版静态结果 |
|---|---|
| 蛋箱放在室外 | 所持蛋不是 spawned 地面物品；默认 `canDeteriorateUnspawned=false`，普通户外劣化速率为零 |
| 箱所在格过冷或过热 | 箱无固定温度覆盖，蛋采用 `PositionHeld / MapHeld` 格温；不能隔绝温损 |
| 受精蛋尚未完全温损毁坏 | 继续孵化；部分温损不自动暂停孵化 |
| 正常受精蛋 | `disableIfHatcher=true` 使普通腐败停止 |
| 未受精蛋 | 仍按温度累积腐败；防户外劣化不等于防腐败 |
| 蛋箱禁止使用 | 影响普通选址/取物可用性，未发现该状态关闭 `CompThingContainer.CompTick` |
| 没有电力或开关 | EggBox 未声明供电或 Flick 组件，正常 ticking 没有这些门槛 |
| 没有母鸡守在旁边 | Hatcher 不以附近母鸡或趴窝作为进度条件 |

禁止与暂停模拟必须区分。普通蛋箱的 CompTick 没有 Forbidden、Power 或 Flick 判断；ThingOwner 确实有通用 `dontTickContents` 能力，但本轮蛋箱构造及 tick 没有启用它。特殊暂停持有者、未加载地图等更大范围不在此处作无条件运行承诺。

**补充并纠正此前温度范围。** `Thing.AmbientTemperature` 先遍历固定温度覆盖，再退到 held 格温。本轮展开 `ThingOwnerUtility.TryGetFixedTemperature` 确认：`Pawn_InventoryTracker` 中带 Hatcher 的蛋固定为 **14°C**；某些运输舱、运输途中和交易持有者也返回 14°C。普通地图蛋箱与 `Pawn_CarryTracker` 手持没有这个专用覆盖。当前 Web 的 pawn.cargo 是手持，不是独立背包，因此采用所在地温度仍与该手持分支相符。

箱内孵化继续使用 Hatcher 的逐枚生成流程；`PawnUtility.TrySpawnHatchedOrBornPawn` 在地图持有者存在时以蛋的 PositionHeld/MapHeld 生成新生动物。成功或失败的原版 Hatch 最后都会销毁蛋，不能据此声称原版对任何拥挤位置保证保留重试。Web 若在空间不足或动物上限时保留 100% 进度，是已有防丢失适配，箱内应延续同一规则。

**温损转化在原箱内完成。** CompHatcher 检查到 TemperatureDamaged 且有物种 EggLayer 声明后，会从 CompEggContainer 移除旧蛋、销毁旧实例、创建同数量的新未受精蛋，再放回同一箱。只显式保留数量，不继承旧蛋的孵化身份、温损、腐败进度、耐久或禁止状态。新的未受精蛋已没有毁坏 hatcher，因此“毁坏允许提前清空”的条件不会永远贴在箱上；转化后若不足 20 枚，通常重新受数量阈值约束，除非玩家强制取出。

主要证据：`CompThingContainer.CompTick`；`Thing.DoTick`；`ThingOwnerUtility.TryGetFixedTemperature`；`CompHatcher.CompTick/Hatch`；`CompTemperatureRuinable`；`CompRottable.Active`；`SteadyEnvironmentEffects.FinalDeteriorationRate`。

## 自动清空、强制取出与真实搬运

`WorkGiver_EmptyEggBox` 是 **Hauling** 工作，`priorityInType=20`，要求 **Manipulation**。这不是 Animals 处理、采集产物或瞬间进仓。

`CanEmpty` 的规则依次为：空箱 false；当前首栈 `EggsRuined` true；否则首栈数量 **≥20**。容量是 25，但自动工作阈值是 20。原版描述写“满了才取”并不精确，机制应以属性和代码为准。

| 分配条件 | 普通自动工作 | `forced=true` |
|---|---|---|
| 箱仍 spawned | 必须 | 必须 |
| 有实际内容 | 必须 | 必须 |
| 预约可用 | 调用 CanReserve | 仍调用，并传入 forced 的预约语义 |
| 数量≥20或当前温损毁坏 | 必须 | 可以低于自动门槛 |
| 能找到更好的可用储存地点 | 必须 | **仍必须** |

普通 `JobGiver_Work` 在调用 HasJobOnThing 前检查 `!t.IsForbidden(pawn)`。WorkGiver 自身没有单独比较箱的阵营或内容物的禁止标记；不要把单个函数的缺省检查扩大成全流程任意访问。强制并不意味着取消后续路径、容器存活或实际预约规则。

储存搜索从 `StoragePriority.Unstored` 起，用搬运者阵营、物品接受条件等调用 `StoreUtility.TryFindBestBetterStorageFor`。找不到储位时返回“无空位置”失败；玩家强制取出也不等于允许把蛋无条件丢在任意地上。分配得到 A=箱、B=当时的实际蛋实例、C=储位，`job.count` 记录当时首栈数量。

取出流程是：

1. 实际预约箱子和目标储位；蛋箱没有专门交互格，因此走到 Touch。
2. 接近时检查箱没有消失、未禁止、无别人正在实体交互且不为空。
3. **等待 120 原版 tick**，带进度条。提取等待自身检查容器没有 despawn；该 helper 不重新声称每 tick 检查所有接近阶段条件。
4. 调用 `TryDropAll`，把箱内内容放到**搬运者所在格附近的地面**；这一步还没有记为入库。
5. 预约并走近实际蛋实例，`StartCarryThing` 拿起，`CarryHauledThingToCell` 搬到 C。
6. `PlaceHauledThingInCell` 用 storageMode 放下，并允许同一储存区内处理放不下全栈的情况。

不能用“120 tick 后仓库计数增加”替换以上所有权转移。中断可能发生在蛋仍在箱内、已落地、已在手中、已入库的不同阶段，保存加载也应保持同样事实。取出时机与后续搬运中若发生孵化、温损换型或腐败，原内容引用可能失效；Web 需要使工作失效或重排，不能按旧 `job.count` 再造一批蛋。

源码组件提供选择内容物和开发填箱 gizmo，没有 `emptyRequested` 持久状态。Web 若提供“请求取出”按钮并保留到搬运者执行，应把它定义为本地玩家意图；没有储位时可以等待，但按钮本身不应直接增减库存。

主要证据：`WorkGivers.xml:/Defs/WorkGiverDef[defName="EmptyEggBox"]`；`WorkGiver_EmptyEggBox` 第 16～54 行；`JobDriver_EmptyThingContainer` 第 35～58 行；`Toils_General.WaitWhileExtractingContents`；`JobGiver_Work` 的扫描 Validator。

## 毁坏、移除、存档与内容选择

spawned 建筑 `Destroy` 会经过 `DeSpawn`，`ThingWithComps.DeSpawn` 调各组件 `PostDeSpawn`。CompThingContainer 在 **mode != DestroyMode.WillReplace** 时，尝试将所有内容以 Near 放到原箱位置附近。因此通常拆除、毁坏或普通移除后，蛋应作为真实物品留下；并不是拆箱返材料时顺便把蛋当作材料、也不是按营养重建新蛋。

但原版的这条 `TryDropAll` 是尝试：ThingOwner 只在对应实体放置成功时才移除该实体，`TryDropAll` 汇总失败；CompThingContainer.PostDeSpawn 本身没有检查其返回值或提供可靠的销毁后重试队列。不要把静态代码写成“任何满地环境也保证无损退货”。Web 可以采用删除前容量预检、保留待吐出实体或其它明确的原子恢复机制；具体策略与火灾毁坏后的损失记账应由实现文档说明。

`WillReplace` 明确跳过该吐出调用，需要把替换模式与普通移除区分。`minifiedDef` 声明可打包，但仅凭这一字段不能推导蛋可安全随打包建筑跨所有持有者继续模拟；本轮不覆盖完整搬迁链。

存档使用 `Scribe_Deep.Look(ref innerContainer, "innerContainer", this)`，保存真实内容实例。箱的信息显示 Contents 和总数，有未毁坏受精蛋时追加 Hatcher 信息；`Building.SelectContainedItemGizmo` 支持选中箱内物品。Web 至少应能查看蛋种、数量、孵化进度、温损及当前可取出原因。

主要证据：`Thing.Destroy`；`ThingWithComps.DeSpawn`；`CompThingContainer.PostDeSpawn/PostExposeData/CompGetGizmosExtra`；`ThingOwner.TryDrop/TryDropAll`。

## 本轮结论与 Web 实现边界

| 原问题 | 证据状态 | 落地约束 |
|---|---|---|
| 建造、阻挡、工作与耐久 | 已有 XML、默认值及材料修正链 | 可通行单格容器；基础值和本地调参分开 |
| 箱子优先级、范围、归属、房间 | 已有选址、区域搜索及禁止调用链 | 玩家动物优先箱，下一蛋类型匹配；蛋箱不强制同房间 |
| 箱内温度、孵化、禁止 | 已有 tick、holder 温度、hatcher、劣化链 | 内容继续流动，禁止不能冻结孵化；勿重复 tick |
| 自动与强制取出 | 已有 WorkGiver、JobDriver、Toils、储位入口 | 自动20，容量25，真实等待、落地、手持和入库 |
| 毁坏及内容物 | 已有 despawn 与 TryDropAll 链 | 常规吐出，满地失败保证属于 Web 适配 |
| 中断、全满地、启用 MOD 的实际行为 | 未做原版运行时验证 | 不把静态分支推导写成运行时实测 |

建议把验证集中在机制而非再次调数值：不同蛋型不混箱；满箱换目标；等待中受精改变时重新验证；自动与手动都尊重储位；同一实体只处于一个容器；取出前后各阶段中断和读档不复制；箱内孵化/温损使旧任务正确失效；拆除或烧毁时内容守恒或明确记录损失。

首版采用单个 Cargo 保存箱内蛋、可持久的取出请求、30 格范围内的完整候选排序、容量预检和空间不足保留重试，均应列为 Web 适配。实现实际行为另记于相邻玩法文档，不把本静态研究的建议当作已经完成的功能。
