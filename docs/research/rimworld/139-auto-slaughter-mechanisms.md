# 自动屠宰：分类配额、保护对象、派生名单与任务撤销

更新：2026-11-05。目标为 RimWorld **1.7.4980 rev60**。本页来自原版安装包的静态派生 C# 与 Core XML；没有启动或操作原版、浏览器、预览、GUI 或截图。目标是保留经营机制及其边界，Web 的工作时长、成长周期和产出数值可后续调整。

## 证据与范围

- 程序集：`F:/SteamLibrary/steamapps/common/RimWorld/Assembly-CSharp.dll`，SHA-256 `eff7d97949f919fb2b151ebfb906e9be749b63410b7dbda78eeebb7972b245c3`。
- 复用同一程序集的 [REA 托管身份记录](evidence/production-bills-rea-managed.json)，证据 `ev_41acdc3a1d6904fb12e36eeaac20397afac130d300dafc70973a154cd3fbfd84`，父证据 `ev_ebbdfc84b2bb4bc3fff131fd667e539f7c75c3d78c0491481455a7751b3a5337`。这里只复用身份，不把旧记录当成本轮机制结果。
- [提取清单](evidence/auto-slaughter-manifest.json) 保存 **18 个类型**的派生哈希；[机制证据](evidence/auto-slaughter-mechanisms.json) 保存 **69 个锚点、10 个有界检查、4 个 XML 投影**，并校验五组配额循环的实际先后顺序。
- 派生文件只保存在忽略目录 `.local-research/auto-slaughter/`。下文类型行号只对清单所记哈希成立。ILSpy 容忍未解析依赖，派生 C# 不是原始源码。
- 范围为 `Verse.AutoSlaughterManager/AutoSlaughterConfig → PawnUtility.ShouldBeSlaughtered → WorkGiver_Slaughter → JobDriver_Slaughter`，连同手动标记、原版配置面板及有限的生命周期刷新链。没有穷尽所有调用者、DLC、模组、特殊精神状态或最终加载后的 Def 数据库。

## 每种动物有五个上限，默认不限

`AutoSlaughterConfig` 第 5—29、46—54 行保存动物 Def、五个上限和两个保护许可：

| 原版字段 | 含义 | 默认 |
|---|---|---|
| `maxTotal` | 所有参与自动配额的个体 | `-1`，不限 |
| `maxFemales` / `maxMales` | 达到繁殖生命阶段的雌 / 雄 | `-1`，不限 |
| `maxFemalesYoung` / `maxMalesYoung` | 尚未达到繁殖生命阶段的雌 / 雄 | `-1`，不限 |
| `allowSlaughterPregnant` | 允许孕兽参与自动配额和屠宰 | false |
| `allowSlaughterBonded` | 允许有 Bond 关系的动物参与 | false |

这里“成年”依据 `CurLifeStage.reproductive`，并非统一年龄或体型阈值。没有性别的个体只进入总池。上限 **0** 合法，代表不保留该类可自动屠宰个体；分类上限不是“至少保留”的繁殖保障，总数限制仍可进一步减少某一性别。

`AnyLimit` 的实际实现还考虑两个保护许可，并非单纯检查五个数值是否有上限。即便因此进入计算，只要五个上限全为 `-1`，仍不会选中任何动物。Web 不必复刻这个不直观的字段名语义。

配置行来自 `TryPopulateMissingAnimals` 第 254—267 行：种族是 Animal、基础 Wildness 小于 1、不是 Dryad、不是尸体 Def。载入后删除丢失或尸体 Def 的配置并补齐新增动物。不能把这理解成任何临时动物实体都能直接配置。

## 保护对象不占配额，暂时不可用的动物也不进入执行池

`AutoSlaughterManager.AnimalsToSlaughter` 第 51—92 行枚举本地图 `SpawnedColonyAnimals`；`MapPawns` 第 478—493 行先取当前玩家阵营的已生成 Pawn，再保留动物。候选还需满足：

1. Def 与本行配置相同。
2. `HomeFaction` 为玩家，且不是 Dryad。HomeFaction 与当前 Faction 是不同检查，因此不能只看玩家正在照料它。
3. 没有任何 `Lord`，且没有处于 `inventory.UnloadEverything` 的卸货状态。
4. 若未允许 bonded，有任意直接 Bond 关系就排除。这里没有“关联的人仍活着”的过滤。
5. 达到繁殖阶段的雌兽如果有普通 `Pregnant` hediff，默认排除；即使怀孕尚不可见，执行池仍然排除。

被这些条件排除的动物 **既不会被自动选中，也不进入对应上限的计数**。例如总上限 4，当前有 4 只普通候选和 2 只受保护孕兽，这一轮选中数量是 0，实际畜群可以是 6。上限不能被解释成地图上全部实体的硬上限。

这一步还没有检查工人路径、预约、暴力能力和理念限制；所以进入待屠宰名单也不保证马上执行。孕兽保护不自动套用到手动屠宰指令。

## 先按分类选，再按总数补选，避免重复计算

第 94—170 行的顺序是机制的一部分：

1. 普通总池及四个性别 / 生命阶段池，各自按 `AgeBiologicalTicks` **从大到小**排序，即老的先处理。
2. 若允许孕兽，把孕兽单独按妊娠 `Severity` **从大到小**排序，再追加到成年雌池和总池的尾部。两个池都优先处理非孕个体，孕兽在最后。
3. 依次执行 **成年雌 → 幼雌 → 成年雄 → 幼雄** 的上限。每超出一只，从该池头部取出，并同时从总池移除，再加入结果名单。
4. 最后对剩余总池执行总数上限。继续从总池头部取出，并从它所属的分类池移除。

总数阶段看到的是尚未选中的动物，不能再拿最初的总数减上限，否则会重复屠宰。例如可参与配额的总数为 10，分类限制已选 4 只，总上限为 4，则总数阶段只再选 2 只，合计选 6 只。

`GenCollection.SortByDescending` 第 869—875 行只比较一个排序键，没有额外 ID 键；`PopFront` 第 1025—1030 行取第一个再删除。对同年龄或同孕进度的动物，不能承诺跨平台、跨版本的精确顺序。Web 添加稳定 ID 次排序属于可复现性适配。

分类阶段优先级也意味着“所有非孕动物必定比所有孕兽先宰”不是无条件全局结论：成年雌配额可能先选择孕兽，之后才处理其它性别配额。准确表述是 **成年雌池内部及总池内部，普通个体位于孕兽之前**。

## 孕兽排序的文字提示与代码存在冲突

Core 英文 `Dialogs_Various.xml/AutoSlaugtherTip` 写着孕兽按 “most recent to least recent pregnancy” 处理。可是 manager 第 101 行明确按 `Severity` 降序；`Hediff_Pregnant.GestationProgress` 第 23—32 行就是读写 `Severity`，第 120—122 行随时间增加并在达到 1 时进入生产路径。因此这份安装包的静态算法是 **妊娠进度更高者排前**。

本轮同时保留 XML 和代码证据，按执行算法解释机制；没有运行原版验证具体一群动物的实际出队顺序，也不把提示文字改写成另一项已观测事实。

## 自动名单与手动标记是两条独立来源

manager 保存的是配置和可重建的候选缓存；它不会给动物写入 `Slaughter` designation，也不会因为动物已经被手动标记就先从配额池排除。

`PawnUtility.ShouldBeSlaughtered` 第 1513—1525 行先要求目标仍是已生成动物，然后要求 **手动 Slaughter 标记 OR 自动名单包含该动物**，并最终要求 **没有 ReleaseAnimalToWild 放生标记**。由此得出：

- 取消手动标记不会覆盖仍然生效的自动配置。
- 放宽或清空自动配额不会删除显式手动标记。
- 同一只动物可以同时满足两种来源；执行层仍使用普通预约防止多个工人同时完成它。
- 自动名单不应伪装成一批永久手动命令，否则配置撤回时容易误删用户命令或保留过时命令。
- 放生标记对两种屠宰来源均有否决权。manager 自己并不排除或扣除待放生动物，所以它仍可能占配额并出现在自动候选里；执行层停止该目标，不会仅因待放生就从名单外补选另一只动物。完成放生改变阵营后再按生命周期通知刷新。

`WorkGiver_Slaughter` 第 12—23 行先枚举手动标记，再枚举自动候选，但这是候选枚举顺序，不能由此断言工作调度始终严格先执行手动。完整调度还受工作优先级、距离、路径和预约影响。

`Designator_Slaughter` 第 52—71 行的手动资格没有孕兽或 Bond 自动保护条件；成功标记会移除既有放生指令。Bond 手动警告由 `SlaughterDesignatorUtility` 第 7—19 行查找**仍活着**的关系对象并发出提醒，它没有直接否决操作；这与自动保护按关系数量判断又有区别。

## 配额只安排普通工作，不直接消灭动物或凭空产肉

Core `WorkGivers.xml` 把 `Slaughter` 归在 `Handling`，要求 Manipulation；`priorityInType=100` 是原版记录值。`WorkGiver_Slaughter` 还要求动物当前阵营与工人相同、没有攻击性精神状态、可预约、工人能够暴力，并通过相关理念与历史事件检查。

`JobDriver_Slaughter` 第 12—33 行复用统一工作流程：预约 → 走到可接触位置 → 等待 **180 原版逻辑 tick** → `ExecutionUtility.DoExecutionByCut` → 增加屠宰记录。`WaitWith` 会让目标等候，若目标消失或不可接触则失败。没有单独的自动屠宰产物捷径；尸体、搬运、屠宰台分解和食物生产仍应通过各自既有系统连接。

180 是原版固定等待参数，不表示 Web 必须用相同 TPS 或同样工作时长。本轮保留机制连接，数值可以后续集中调整。该 JobDriver 本身也没有技能学习调用，不能凭“Handling 工作”就断言这 180 tick 增加 Animals 经验。

## 正在工作的任务也会检查资格，但原版使用的是缓存

driver 的全局失败条件包括目标进入攻击性精神状态，以及：

```text
未启用 ignoreDesignations，并且 ShouldBeSlaughtered 已为 false
```

`JobDriver` 在活动更新和进入下一 toil 之前检查全局条件，成立时以 `Incompletable` 结束。普通配置变化使目标不再自动入选、且没有手动标记时，当前工作可停止；新增放生标记也会让该函数返回 false。任务不应因为“已经开工”就无条件杀死原目标。`ignoreDesignations` 是显式例外，不应推广到普通自动工作。

但 `ShouldBeSlaughtered` 会读取 manager 的**当前缓存**，没有强制重算。manager 第 34—38、173—185 行只在 `cacheDirty` 时重建。第 221—238 行提供四个置脏入口：

| 已核实入口 | 直接调用证据 |
|---|---|
| Spawn | `Pawn.SpawnSetup` 第 1407—1408 行，包含载入时 spawn |
| Despawn | `Pawn.DeSpawn` 第 2423—2427 行 |
| Faction change | `Pawn.SetFaction` 第 2712—2716 行，在已生成时通知 |
| Config change | `Dialog_AutoSlaughter.DoMaxColumn` 第 231—233 行，数值上限变化 |

因此出生和死亡可通过 spawn/despawn 使名单更新。`ExposeData` 只保存配置，没有序列化候选缓存或 dirty 标志，也没有在该方法里显式置脏；载入后普通 pawn spawn 是已经看到的通知路径。

有界检查发现 manager 本身没有周期 tick 刷新；所读 `Pawn_AgeTracker`、`Hediff_Pregnant`、`Pawn_RelationsTracker` 没有直接 auto-slaughter 引用。没有穷尽其它间接调用者，不能据此宣称“原版永远不会因成长或关系变化刷新”。能得出的结论是：**目前证据不足以保证成长、受孕、Bond、Lord 或卸货状态变化在同一 tick 自动重算**。

另有可定位的 UI 边界：`DoAnimalRow` 第 362—376 行修改孕兽 / Bond 许可时只调用 `RecalculateAnimals` 更新窗口统计；该方法没有通知 manager。不能把勾选后的界面变化当作执行缓存已立即变化的证据。Web 可以每次状态变化后重新派生，并在致命动作前重验资格；这应说明为稳健性适配，避免照搬未经运行验证的缓存边界。

## 原版界面“当前数量”与实际执行池也不完全一致

`Dialog_AutoSlaughter.CountPlayerAnimals` 第 139—194 行使用 `CanEverAutoSlaughter`，而执行算法使用 `CanAutoSlaughterNow`。这意味着原版窗口仍可计入暂受 Lord 管理或正在卸货的动物。窗口的孕兽识别还要求 `Hediff.Visible`，而执行池只查 `HasHediff(Pregnant)`。

窗口在打开时暂停并统计；点击 ∞ 会把上限设为当时显示的数量，数字输入限制为非负，关闭数字限制恢复 `-1`。Web 更适合清楚区分“实际畜群总数”“参与配额的数量”“受保护数量”和“当前自动待处理数”，让用户知道为什么总数高于上限却没有自动屠宰。不能用同一个“总数”标签混淆这些集合。

## 对 Web 实现的边界建议

- 保留五类配额、孕兽保护、按分类后总数去重、非孕优先及年龄顺序，让繁殖—超额—自动安排—尸体处理形成经营循环。
- 手动指令和自动派生来源分开表达，改变任一路线都不能悄悄删除另一路线；待放生状态优先阻止执行屠宰。
- 本轮 Web 选择在计算前就排除 `releaseMarked`，把待放生个体视为即将离开保留畜群，再安排剩余超额个体。这与原版“仍计入 / 可选中，再由执行资格否决”有明确差异：Web 减少放生交接期间继续按旧畜群规模安排屠宰的情况。它是经营与调度适配，不能宣称候选名单或执行时序与原版完全相同；取消放生后重新计算。
- 配置变化、出生、成长、受孕、死亡、阵营变化及载入后重新计算；候选名单本身不成为持久化的独立真相。
- 目标不可达或其它工人已预约时等待已有工作系统解决，不能改成直接扣动物数量。
- Web `null=不限`、稳定 ID 并列规则、三维路径、任务来源标签和严格存档验证均属于项目适配。生产数值不作为本轮机制完成的条件。
- 目前 Web 没有动物 Bond 模型，不能增加一个实际上不起作用的“保护羁绊”开关；应记录为尚未实现。Lord、照料外来动物和完整动物疾病模型同理应依据真实项目能力明确边界。

本页不宣称 Web 实现和测试已完成；实际功能与验证记录由本轮 gameplay 文档承接。

## 本地复核

```powershell
pwsh -NoProfile -File scripts/research/extract-auto-slaughter.ps1 -Check
pwsh -NoProfile -File scripts/research/collect-auto-slaughter-evidence.ps1 -Check
```

第一条重新读取固定 SHA 的程序集、用固定 SHA 的 ILSpy 分析库重建 18 个类型，并逐字核对忽略目录与保留清单。第二条核对静态身份、源哈希、69 个锚点、10 个有界范围、顺序断言和 4 个打包 XML 投影。不启动游戏或执行目标代码，也不是原版运行测试。
