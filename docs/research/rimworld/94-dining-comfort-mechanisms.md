# 94 · 取餐、座位、餐桌记忆与舒适需求

本轮解析 **RimWorld 1.7.4980 rev60**。重点是食物、角色、座位预约和需求结算如何共同形成生活行为；原版实机对照另见 [95 · 原版进食实机](95-native-dining-runtime.md)，Web 的实现边界见 [96 · 生活与就餐玩法](96-living-dining-gameplay.md)。

## 证据与边界

[静态证据](evidence/dining-comfort-evidence.json) 包含 17 条结论、来源文件哈希/行号、7 组 Core XML 投影。[类型清单](evidence/dining-comfort-types.json) 与 [提取 manifest](evidence/dining-comfort-manifest.json) 记录 3 个新增派生类型；食物、住房、工作调度的既有派生文件继续复用，没有重复提取大类型。

源程序集 SHA-256：`eff7d97949f919fb2b151ebfb906e9be749b63410b7dbda78eeebb7972b245c3`。ILSpy `11.2.0.10050`，工具 SHA-256：`587a18e18e13acfc7fd8783a44c24c7da0781dadf6b9fb9dd5e2e38a9cdfae78`。派生 C# 不是原作者源码，反编译允许未解析依赖；XML 是选定 Core 节点，不能当作全部 DLC/Mod 补丁应用后的 Def 数据库。

REA 已有制品身份继续复用；之前成员表示超过 67,108,864 字节预算的失败保留在证据中，没有重复请求，也没有把工具不可用写成“类不存在”。本轮使用 [reverse-engineer-anything](https://github.com/morluto/rea) 的身份、证据类型和未知项分离流程。

## 1. 一次普通人类进食的行为链

`JobDriver_Ingest` 的主链是准备、咀嚼、结算。可操作物品的角色先从 inventory 取出，或预约地面食物并走到取物点，将所需数量转入 carry；如果从堆叠中拆出新物品，任务的 `targetA` 跟随新 carry 对象。随后寻找就餐位置，预约并走过去，再咀嚼，最后执行 `FinalizeIngest`。**选择餐桌或拿起食物时，不会提前增加饱腹。** [DC01、DC02]

食物必须仍可食；咀嚼要求目标仍在地图上或由自己携带，并能触及。未征召的 ToolUser 才运行 `CarryIngestibleToChewSpot`；征召跳过寻找座位。缺乏 Manipulation 的角色、非 ToolUser 动物和营养膏机各有准备路径，不能用“任何进食都先去桌边”替代这些分支。[DC02]

## 2. 椅子要同时满足位置、许可与预约

第一轮搜索在食物 `chairSearchRadius` 内寻找最近可达、危险程度为 None 的合格人工建筑。合格条件包括：

- `building.isSittable`，有可用坐席；玩家角色使用同阵营座位。
- 未禁用、殖民者未处于迷雾格、可预约、符合社会使用许可，未燃烧且不敌对。
- **选中坐席的四邻格至少一个有 `SurfaceType.Eat` 建筑。** 单独放一把椅子，不构成这个搜索器的普通就餐座位。

座位预约与寻路目的地预约都建立后才走过去。普通单座椅预约建筑，多人可坐家具按具体格预约；检查还会排除不可通行、禁区和与其他已预约建筑交互格冲突的座位。[DC03、DC04]

没有安全合格椅子时，系统寻找站立咀嚼位置；若站立候选有危险，会再找危险不高于该候选的椅子。完全找不到有效位置时，代码发出警告并把路径终点设为当前位置，而非统一禁止进食。站立搜索逐渐扩大范围/放宽约束，不等于任意瞬移到最近桌子。[DC05]

## 3. 面朝桌面、绘制食物与真实物品归属

到达后 `FindAdjacentEatSurface` 检查四邻接桌面，将其设为 `targetB` 并朝向它。角色不移动、仍携带可食物、桌格有效且四邻接、`ingestHoldUsesTable=true` 时，绘制函数把 carry 食物画到桌格上。[DC06]

因此，“截图里食物在桌上”不能单独证明食物已经被丢到地面、存入桌子或发生库存转移。实机桌边咀嚼档同时显示桌面食物与角色 carry 中同一个食物对象，见 95。

## 4. 咀嚼、结算与中断

咀嚼时停止移动；时长为 `round(baseIngestTicks × durationMultiplier)`。通常 multiplier 为 `1 / EatingSpeed`；食物禁用 `useEatingSpeedStat` 时为 1。地面食物会建立 physical-interaction reservation，finish action 负责释放。咀嚼 tick 同时调用 `GainComfortFromCellIfPossible`。[DC07]

`FinalizeIngest` 才检查餐桌/餐厅记忆，计算营养需求并调用 `thing.Ingested`，随后给仍存活且有食物需求的角色增加返回的营养。`ingestTotalCount` 与 `overeat` 有各自覆盖规则；不能根据一次采样后的饱腹差直接拟合餐食营养。[DC01、DC08]

在结算前被中断，不会凭空执行这一结算阶段。普通 `EndCurrentJob` 清理任务预约与 driver；手持物通常落到附近，但 `carryThingAfterJob` 或任务切换覆盖值可保留它。挂起/排队任务有保留预约分支，不能把所有中断都概括为“删除食物并清空全部预约”。本轮没有运行中断对照。[DC17]

## 5. 无桌记忆与餐厅记忆的实际触发条件

共同入口要求：角色有 mood、食物能提供营养、`chairSearchRadius > 10`。

| 结果 | 额外检查 | Core 记忆参数 |
|---|---|---|
| AteWithoutTable | 正前方相邻格无 Eat surface；姿态 Standing；不是 WildMan；`tableDesired=true` | -3，持续 1 天，stackLimit 1；Ascetic / 指定 Ideology precept 可抵消 |
| AteInImpressiveDiningRoom | 有当前 room，Impressiveness 对应 thought stage 非 null | stage 0–2 无记忆，stage 3–9 为 +2 至 +8；持续 1 天，stackLimit 1 |

**无椅不必然等于无桌。** 就餐者面前已有合格桌面，可以避免该无桌检查；反过来，地图上有桌子但没有走到合适位置，不保证免罚。[DC08、DC09]

餐厅记忆这一调用点不检查 `RoomRole == DiningRoom`、不要求桌椅，也没有直接的“必须在室内”条件。它取实际 room 的 Impressiveness stage；不要把 UI 房间名称当成这里的硬前提。具体房间统计见 [85 · 环境机制](85-environment-storage-mechanisms.md)。[DC10]

后来有桌吃饭不会在这段代码中删除旧的 `AteWithoutTable`。实机必须比较记忆年龄是否刷新，不能只看 Needs 中仍有“-3”。

## 6. 舒适是持续需求，不是坐下立即获得的固定心情

`Need_Comfort` 记录最近一次 `ComfortUsed(value)`。最近使用时间在当前 tick 前 15 tick 内时，瞬时目标为 `clamp01(value)`；超过这个窗口，瞬时目标为 0。角色所在格的建筑在角色自己的 15 tick hash interval 被采样，非负 Comfort stat 传入需求。房间里远处存在一把好椅子，不会通过这个函数提升角色舒适。[DC11、DC12]

`Need_Seeker` 在 `NeedInterval` 中以 `seekerRisePerHour × 0.06` 或 `seekerFallPerHour × 0.06` 向瞬时目标靠近，并在目标处截断。Comfort 的 Core XML 参数分别为 **0.60/小时上升、0.04/小时下降**。家具 Comfort 是目标上限来源，不是每餐直接增加同样数值。[DC13]

| 当前 Comfort | 类别 | NeedComfort 情境心情 |
|---|---|---:|
| < 0.1 | Uncomfortable | -3 |
| 0.1 至 < 0.6 | Normal | 无该 thought |
| 0.6 至 < 0.7 | Comfortable | +4 |
| 0.7 至 < 0.8 | VeryComfortable | +6 |
| 0.8 至 < 0.9 | ExtremelyComfortable | +8 |
| ≥ 0.9 | LuxuriantlyComfortable | +10 |

`NeedComfort` 是根据当前需求评估的情境 thought，与有持续时间的无桌/餐厅 memory 分开。睡眠使用舒适家具的既有解析见 [14 · 睡眠与住房](14-sleep-housing-mechanisms.md)。[DC14]

## 7. 本轮锁定的原版基础参数

| Def | 基础 Comfort | costStuffCount | WorkToBuild |
|---|---:|---:|---:|
| Stool | 0.5 | 25 | 450 |
| DiningChair | 0.70 | 45 | 8000 |
| Armchair | 0.8 | 110 | 14000 |
| Table1x2c | 未在本 Def 设置 | 28 | 750 |

Table1x2c 通过 TableBase 继承 Eat surface。Comfort 品质因子依次为 Awful 0.76、Poor 0.88、Normal 1、Good 1.12、Excellent 1.24、Masterwork 1.45、Legendary 1.7；材料、品质和生效后 stat 另算。以上是原版字段，不是 Web 建造时长。[DC15]

`IngestibleProperties` 默认 `baseIngestTicks=500`、`chairSearchRadius=32`，`useEatingSpeedStat`、`ingestHoldUsesTable`、`tableDesired` 均为 true。选定 MealSimple/MealSurvivalPack 的父链保留在 DX02；二者 Nutrition 为 0.9，父类限制每次吃 1 份。其他食物可能覆盖默认值。[DC16]

## 8. Web 应保留的机制与待验证项

优先保留真实 carry、预约、走到坐席、持续咀嚼、结束后消费的状态链；分别表达食物、桌面和座位；将无桌记忆、房间记忆、舒适需求分开。取消/失败时处理持有物与预约，读档后防止重复消费。Web 的步长、房间权重、成本和舒适变化幅度必须单独标明为暂定适配，不能借本轮原版证据宣称数值一致。

实机已覆盖无桌、有桌椅、取餐后的行走/预约中态、咀嚼中态、完成和重复保存。并发抢座、单桌无椅、危险/禁用/燃烧座位、征召进食、任务中断、餐厅加成与搜索半径边缘仍未实测。

复核命令：[静态采集器](../../../scripts/research/collect-dining-comfort-evidence.ps1)、[实机证据采集器](../../../scripts/research/collect-native-dining-runtime.ps1)、[验证器](../../../scripts/research/verify-dining-comfort-evidence.mjs)。验证只检查保存的证据，不启动原版或重放输入。

```powershell
node scripts/research/verify-dining-comfort-evidence.mjs
node scripts/research/verify-dining-comfort-evidence.mjs --local
```
