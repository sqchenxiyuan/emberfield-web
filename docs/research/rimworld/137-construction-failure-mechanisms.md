# 施工失败：按工作量采样、材料损失与自动续建

更新：2026-11-05。目标为 RimWorld **1.7.4980 rev60**。本页依据同一安装包程序集的静态派生 C# 和 Core XML；**没有启动或操作原版、浏览器、预览、GUI 或截图**。原版静态事实、概率推导和 Web 适配分别注明，不把模型测试当作原版运行验证。

## 证据与范围

- 程序集：`F:/SteamLibrary/steamapps/common/RimWorld/Assembly-CSharp.dll`，SHA-256 `eff7d97949f919fb2b151ebfb906e9be749b63410b7dbda78eeebb7972b245c3`。
- 复用同一程序集的 [REA 托管身份记录](evidence/production-bills-rea-managed.json)，证据 `ev_41acdc3a1d6904fb12e36eeaac20397afac130d300dafc70973a154cd3fbfd84`，父证据 `ev_ebbdfc84b2bb4bc3fff131fd667e539f7c75c3d78c0491481455a7751b3a5337`。仅作身份核对。
- [提取清单](evidence/construction-failure-manifest.json) 记录 **16 个类型**的派生文本哈希；[机制证据](evidence/construction-failure-mechanisms.json) 保存 **47 个锚点、5 个有界检查、4 个打包 XML 投影**。
- 派生 C# 留在忽略目录 `.local-research/construction-failure/`，不入库。下文行号只适用于清单中的派生文本；ILSpy 容忍未解析依赖，结果不是原始源码。
- 范围为普通 `FinishFrame → Frame.FailConstruction → GenLeaving`，以及安装、瞬时放置和工作中断的边界。没有穷尽所有建筑子类、DLC、模组补丁和最终加载后的 Def 数据库。

## 失败发生在施工期间，不只在完工瞬间

`WorkGiver_ConstructFinishFrames.JobOnThing` 第 27—44 行先要求框架 `IsCompleted()`，即材料已交齐，再检查接触位置、阻挡、技能等条件，才分配 `FinishFrame`。

`JobDriver_ConstructFinishFrame` 第 44—79 行在每次实际施工的 `tickIntervalAction(delta)` 中按以下顺序处理：

1. 框架容器非空且工人有技能追踪器时，先增加 `0.25 × delta` 的 Construction 学习量。
2. 读取当时的 `ConstructionSpeed`，计算 `ΔW = speed × 1.7 × delta`；有 Stuff 时再乘材料的 `ConstructionSpeedFactor`。
3. 读取框架总工作量 `W = WorkToBuild`。玩家阵营工人读取 `ConstructSuccessChance` 为 `S`；非教程模式时抽一次 `Rand.Value`。
4. 若随机值 `< 1 - S^(ΔW / W)`，调用 `FailConstruction` 并结束当前施工 toil，**本次 ΔW 不计入进度**。
5. 幸存时才清理地形上的雪/沙、执行 `workDone += ΔW`，达到总工作量后完工。

因此实现不能每个逻辑帧都直接用 `1-S`，否则长工期建筑和更高 TPS 会遭遇过大的失败率。也不能把“工人被打断”“没有路径”“暂时拿不到材料”当作已经发生技能失败并销毁材料。

在 **S 固定、独立理想随机、正工作量、没有最后一步超额** 的数学近似下，各次施工幸存概率的乘积为 `S^(累计工作量/W)`；完整做完一份 W 后约为 S。原版直接使用完整 ΔW，没有截断到 `WorkLeft`，最后一步可能越过 W。真实过程还会因学习、能力变化、更换工人、浮点和 RNG 端点而偏离这个简化解释。证据并不能证明“每栋楼最终失败比例精确等于 1-S”。

## 成功率同时受技能和身体能力影响

Core `Stats_Pawns_WorkGeneral.xml` 声明 `ConstructSuccessChance` 的基础值为 1，最终范围为 `[0,1]`。Construction 的 `SkillNeed_Direct` 逐级值如下；这些是**记录的原版值**，不是要求 Web 当前阶段冻结所有平衡数值。

| 技能等级 | 原始技能乘数 |
|---|---|
| 0—7 | 0.75、0.80、0.85、0.875、0.90、0.925、0.95、0.975 |
| 8—14 | 1、1.01、1.02、1.03、1.04、1.05、1.06 |
| 15—20 | 1.07、1.08、1.09、1.10、1.12、1.13 |

能力因子为 Manipulation 权重 `0.3`、Sight 权重 `0.2`。Sight 的 factor 最大为 1；Manipulation 没有在该 XML 中设最大值，`PawnCapacityFactor.max` 的类型默认是 9999，而非 1。

`StatWorker` 第 372—390 行先乘技能因子，再逐能力执行 `Lerp(value, value × factor, weight)`；第 798—833 行在后续修正和普通后处理之后才 clamp。忽略其它修正时，可解释为：

```text
S ≈ clamp01(skillFactor
            × (0.7 + 0.3 × Manipulation)
            × (0.8 + 0.2 × min(Sight, 1)))
```

这只是所列因子的简化表达，完整 stat 还可受种族、组件、健康状态、场景和其它修正影响。尤其不能先把等级 9—20 的技能乘数截到 1：大于 1 的部分可能抵消身体能力下降。技能要求另由 `GenConstruct.CanConstruct` 第 291—319 行检查；“够等级能接单”与“施工绝不会失败”是不同条件。机械体没有因为缺少普通技能列表就被此 failure 分支排除，具体有效 stat 仍取决于其定义和统计计算。

## 仅损失已经交入框架的材料，幸存材料落到地面

`Frame.FailConstruction` 第 408—437 行先 `Destroy(DestroyMode.FailConstruction)`。`Thing.Destroy` 第 1075—1079 行进入 `GenLeaving.DoLeavingsFor`。后者第 114—125 行从框架 `resourceContainer` **倒序遍历实际材料 stack**，逐 stack 计算幸存数量，再把剩余容器内容销毁。

`GenLeaving` 第 322 行的公式是：

```text
survivors = max(RoundRandom(stackCount × 0.5), 1)
lost = stackCount - survivors
```

`GenMath.RoundRandom` 第 62—65 行为整数部分加一次小数概率进位。对正整数 stack 来说：

| 已交入的单个 stack | 幸存数量 | 损失数量 |
|---|---|---|
| 1 | 1 | 0 |
| 2 | 1 | 1 |
| 3 | 1 或 2 | 2 或 1 |
| 15 | 7 或 8 | 8 或 7 |

这个最小保留 1 的规则适用于**每个实际 stack**，不是每个配方、每类物资、每次搬运历史。原版材料容器可能已经合并相容 stack；Web 按自己保留的批次处理时，需明确批次模型与原版 stack 的差异。计算只查看框架内的材料，没有按完整配方补出未交付资源，也不读取还在工人手里的在途货物。

幸存部分通过 `TryTransferToContainer` 转移真实材料，再用 `TryDrop(..., ThingPlaceMode.Near)` 放到旧占地附近；**不是直接存进新蓝图，也不是立即加进抽象仓库余额**。常规失败余料不因位于 Home 外自动被禁止：这里的该项 `SetForbidden` 条件只匹配 `KillFinalize`，不匹配 `FailConstruction`。原有物品状态和其它系统仍可能影响其可搬运性。

原版落地操作失败时会记录警告并 `break`。本次静态链没有看到保存待落地容器、下帧重新尝试的状态。因此不能把它描述成“任何拥挤地图都保证剩余材料完整落地”。Web 若用持久化 pending 容器等待合法位置，应把它记录为三维地图和物理物资实现的适配，而不是原版同名机制。

## 失败会重新放蓝图，独立于自动重建开关

销毁后，`Frame.FailConstruction` 只检查最终 Def 的 `blueprintDef` 是否存在，然后新建普通蓝图，在原位置、原朝向 `GenSpawn.Spawn(..., WipeMode.FullRefund)`。这条路径没有检查 `autoRebuild`、Home、研究或 `CanPlaceBlueprintAt`。它与 [135 自动重建](135-auto-rebuild-mechanisms.md) 的致命损毁分支应保持分离。

| 状态 | 失败重试的原版静态行为 |
|---|---|
| Def、位置、朝向、Stuff、Faction | 明确保留 |
| 风格来源 / StyleDef | 通过 `InheritStyle` 传递 |
| 储存组 | 对兼容蓝图保留组引用 |
| 储存过滤与优先级 | 有 `storageSettings` 时复制；后续蓝图转框架取有效组设置 |
| 已完成工作量、框架损伤 | 没有复制；后续重新创建全新框架 |
| 剩余材料 | 在地面重新参与取料，不填入新蓝图 |
| `glowerColorOverride` | 失败方法未复制；不能推断所有自定义建筑设置都保留 |
| 原框架预约和指定 | 旧对象销毁时移除，新蓝图使用新对象身份 |

失败会显示本地“建造失败”文字；只有玩家阵营且 `WorkToBuild > 1400` 时发额外负面事件消息。没有在该方法设置重试次数上限、逐次减小损失、免费补材料或给下次保证成功。蓝图缺材料时自然等待普通供应链；再次施工仍走同一失败机制。

## 地形、重装、瞬时放置和中断边界

| 情况 | 是否经过本次审查的施工失败 sampler |
|---|---|
| 玩家普通有工期建筑、家具、工作台、导线 | 通过普通 Frame 收齐材料后施工时会经过；具体 Def/特殊子类仍可能不同 |
| 地板、桥等 TerrainDef 框架 | 会；terrain 分支在 failure 判断之后，没有“无框架 HP 所以不会施工失败”的例外 |
| 非玩家阵营施工 | 此 driver 跳过 failure 判断 |
| 教程模式 | 跳过 failure RNG 和失败判断，普通施工进度仍继续 |
| 安装 / 重装旧家具 | `Blueprint_Install.MakeSolidThing` 第 97—119 行返回旧 `ThingToInstall`，不新造 Frame；审查的 haul/install driver 不调用该 sampler |
| `WorkToBuild == 0` 或 god mode 的 Designator 放置 | `Designator_Build` 第 474—528 行直接放成品/地形，绕过 Frame；睡眠点是打包的零工时例子 |
| 正工期但零材料成本 | sampler 自身没有成本例外；不能把“零成本”等同“零工时瞬间放置” |
| 被禁止、目标失效、失去可建资格、工作 toil 到时 | 工作中断/结束，本 driver 没有为这些情况调用 `FailConstruction` 或清零框架进度 |

工期 progress 存在 `Frame.workDone` 且参与保存；工作任务结束不等于框架销毁。玩家暂停、任务切换或保存恢复不能重复触发已经处理过的失败，也不能让原有施工进度凭空消失。

## RNG 与 Web 适配边界

原版 `Rand.Value` 由全局 seed 和自增 iterations 产生浮点值；本条工作路径没有按框架局部 `PushState`。非教程的玩家施工即使有效 S 为 1，也会读取一次 `Rand.Value`，只是 `< 0` 不会成功。逐 stack 的 `RoundRandom` 同样会读随机值，包括半数已经为整数时。其浮点化和端点意味着本文概率推导不是逐位兼容的 RNG 重放证明。

Web 可使用独立、可从存档状态恢复的施工随机流或稳定哈希，避免给施工增加抽样后改变所有世界随机事件。应保留实际工作量归一化、学习先于 stat 读取、最后一步完整 ΔW、真实材料损耗、自动重试，以及普通中断不损耗等机制；不必为追求相同随机序列而复刻整个原版全局 RNG。

三维可落点、任务容量、物资批次 metadata、失败后等待落地和唯一重试任务属于 Web 自身约束。若使用 pending 状态，至少需要保存“已经失败且已经结算过损失”，等待时不得再次抽签、反复扣料或生成多个同位蓝图。具体 Web 行为与测试以对应玩法报告为准；本页不宣称这些适配已经实现或验证。

## 复现静态提取

在项目目录使用已有 ILSpy 与用户本地安装执行：

```powershell
pwsh -NoProfile -File scripts/research/extract-construction-failure.ps1
pwsh -NoProfile -File scripts/research/collect-construction-failure-evidence.ps1
pwsh -NoProfile -File scripts/research/extract-construction-failure.ps1 -Check
pwsh -NoProfile -File scripts/research/collect-construction-failure-evidence.ps1 -Check
```

首次两个命令生成忽略的派生文本和受版本管理的摘要；`-Check` 重新解析并核对精确文本/清单/投影。需要原安装包及仓库外层已有 `tools/ilspy`，普通仅克隆 Web 子仓库的环境不具备这些私有本地输入。它们读取 PE/文本，不启动目标代码；校验通过也不代表原版互动行为已实测。
