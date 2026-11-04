# 家具卸下、搬移与重装：实体和任务机制

核对日期：2026-11-04。目标为本机 RimWorld **1.7.4980 rev60**，`Assembly-CSharp.dll` SHA-256 `eff7d97949f919fb2b151ebfb906e9be749b63410b7dbda78eeebb7972b245c3`。本章是带文件哈希的反编译派生证据与随游戏发行的 Core XML；不是原始源码，也不是所有分支的运行证明。普通玩家操作的单样本见 [104 实机记录](104-native-furniture-reinstall-runtime.md)，Web 范围见 [105 实现记录](105-furniture-relocation-gameplay.md)。

证据入口：[规则与源位置](evidence/furniture-reinstall-evidence.json)、[核心类型 manifest](evidence/furniture-reinstall-manifest.json)、[任务与组件 manifest](evidence/furniture-reinstall-extra-manifest.json)、[Stat 转发 manifest](evidence/furniture-reinstall-stats-manifest.json)。16 个新类型均使用记录的 ILSpy 11.2.0.10050；其余类型复用相同 DLL/工具哈希的既有派生。完整 C# 与原存档保留本地，仓库保存机制摘要、来源指针、必要 XML 投影与运行片段。

## 1. 搬的是原家具，包装只是容器

`ThingDef.Minifiable` 由 `minifiedDef != null` 决定。`FurnitureBase` 提供 `MinifiedThing`，床、餐椅、桌子的父链与品质组件另外继承，不能仅看具体 Def 有没有直接写这两个字段。

`MinifyUtility.MakeMinified` 先将原家具 DeSpawn，再创建包装并赋 `InnerThing = 原Thing`。普通家具没有重新制造、重抽品质或退款再扣料。包装以 `ThingOwner<Thing>(oneStackOnly:true)` 保存内家具，`ExposeData` 深保存容器。包装与内家具有各自的 ID 和 HP；名称、描述、inspect 文本可来自内家具，不能据界面同名就把两个对象合为一个。

安装蓝图的 `MakeSolidThing` 取出同一 `ThingToInstall`，先清包装的 `InnerThing`，再销毁空包装，最后返回原家具供基类在新地点 Spawn。位置、spawn 时间等生命周期字段会变；实体 ID、材质、品质和未被其他逻辑改变的家具 HP 可保留。并非所有用途开关都原样保留，床是明确反例。

本轮原版样本包装为 **100 HP**，内床为 **91 HP**。这只是两层实体与正常重装的证据；没有验证受击、燃烧时的伤害转发。Web 当前直接扣内家具 HP 属于简化，不能用这份样本证明等同原版包装伤害机制。

## 2. 卸下和安装走不同工作路径

| 环节 | 原版行为 | 数值与边界 |
|---|---|---|
| 显式 Uninstall | `JobDriver_Uninstall : JobDriver_RemoveBuilding` | `building.uninstallWork` 默认 **200** |
| 卸下工作推进 | `workLeft -= ConstructionSpeed × 1.7 × delta` | 工作量属于 job；新任务初始化会重新设置总量 |
| 卸下完成 | `Building.Uninstall()` | 显式任务递增 `ThingsUninstalled`；所选 driver 无 Construction Learn 调用 |
| 指定已安装家具换位置 | 安装蓝图引用原建筑 | 到源头时 `Toils_Construct.UninstallIfMinifiable` 再打包；这条内联卸下路径不在那里递增 `ThingsUninstalled` |
| 搬运打包家具安装 | `HaulToContainer` | A 为源包装，B 为安装蓝图，`count=1`；预约源和目标 |
| 安装完成 | 蓝图替换为原家具 | `ThingsInstalled++`；没有 Frame 建造、材料消耗或品质抽样 |

源必须可达、可预约且满足禁用检查，不能是另一个 pawn 正携带的物体。任务顺序为走向源 → 必要时卸下 → 拿起 → 走向蓝图 → 让开建筑占格 → 等待目标要求的 duration → 替换安装蓝图 → deposit。普通安装不存在通用 `JobDriver_Install`；本版该功能实际复用了搬运任务。

**不要把 `Blueprint_Install.WorkTotal = 150` 写成“安装需要 150 tick”。** 这个字段用于 inspect 的 WorkLeft 显示；`JobDriver_HaulToContainer.Duration` 对非 `Building` 目标返回 0，安装蓝图属于此分支。本轮界面显示 `Work left: 3`，并不改变实际 driver 的等待条件。跨帧任务调度仍可能消耗 tick，不能把 Duration=0 改说成整个搬移零时间。

Construction 的 `activeSkill` 只是当前活动技能标记，不等于增加经验。实机样本的 Construction XP 在卸下和重装前后均为 `169.049194`，与所选代码无 XP 奖励路径一致；没有据单样本校准工作速度。

## 3. 床主恢复是有条件的

普通殖民者床卸下时，`CompAssignableToPawn.PostDeSpawn` 让 pawn 放弃当前床，将原成员放入 `uninstalledAssignedPawns`。这时床 `assignedPawns` 为空、pawn `ownedBed=null`，但待恢复成员仍随内床保存。

重装时 `PostSpawnSetup` 尝试重新分配，并清空临时列表。床的检查至少包括：pawn 仍存在、没有另外拥有床、`CanAssignTo` 通过，以及殖民者/囚犯等归属资格成立。不能覆盖玩家在搬运期间给该 pawn 新分配的床，也不能保留永久悬挂的 owner 引用。

`Building_Bed.DeSpawn` 在非 `WillReplace` 路径中把 `ForOwnerType` 改回 Colonist，把 `Medical` 设为 false，把 `alreadySetDefaultMed` 清除。相关 setter 可能先移除原床主；因此医疗/囚犯用途不能简单当作随实体保存的布尔值。再次 Spawn 还可能按床 Def 默认医疗用途、所在牢房重新设置。这里仅做静态确认，本轮没有分别运行医疗和囚犯床。

## 4. 桌子聚会开关与床用途不同

`CompGatherSpot.active` 自己序列化。DeSpawn 只注销 gather-spot lister，不清 active；玩家阵营 Spawn 保留 active 并注册。非玩家分支可关闭它。因而模型应让组件自己处理生命周期，不能制定“搬移保留全部开关”或“搬移清空全部开关”的通用规则。该结论来自相同版本 `CompGatherSpot`，没有运行桌子搬移样本。

## 5. 重选目标、取消与阻挡

开始新的安装 designator 时就会 `CancelBlueprintsFor(source)`；该查询以内实体匹配跨地图已有安装蓝图。正常位置检查传入原源与内物体，允许特定原源例外；原位置、同旋转、同建筑的无变化安装会被拒绝。

取消安装蓝图不等于销毁源家具。`HaulToContainer` 会检测 B 丢失或未 Spawn 并使任务失败。具体中断后何时、在哪格放下物品，还涉及通用 job cleanup，本章所选来源没有完整覆盖，不据此断言固定落地位置。

蓝图替换前先查 `FirstBlockingThing`；失败时结束工作为 Incompletable，尚未先拆包装。工作提供器也可能安排砍植物、搬物品或处理可移除建筑，所以“任何阻挡都会无限等待”不准确。

包装被真正销毁且内家具仍存在时，会取消相应安装计划并销毁容器内容；leavings 取决于 destroy mode。正常安装先拿走内物体，再销毁空包装，所以不会连带删除家具。交易也取消计划，已安装建筑的 Destroy 同样清理关联安装蓝图。

## 6. 打包家具不能照搬装备户外劣化率

当前 Core 的 `MinifiedThing` 没有 Parent，也没有 `statBases`。`DeteriorationRate` 默认基值为 **0**，没有设置 `minifiedThingInherits`；该 StatDef 布尔默认 false。`StatWorker` 仅在该标记为 true 时改查内物体；`StatExtension` 本身只是转发。

`QualityUtility` 确实能从包装读到内品质，但零基值乘品质倍率仍为零。`SteadyEnvironmentEffects.FinalDeteriorationRate` 遇到非正 stat 提前返回 0。因此这版普通包装不能套用装备的 2 HP/day。它仍可能符合 `CanEverDeteriorate` 的类别/HP 条件，那个布尔不等于最终劣化率大于零。此项是静态规则核对，未做长期露天试验；Mod 或补丁后的 effective Def 必须另核。

## 7. 重现与复核

```powershell
& scripts/research/collect-furniture-reinstall-evidence.ps1
& scripts/research/collect-native-furniture-reinstall-runtime.ps1
node scripts/research/verify-furniture-reinstall-evidence.mjs
node scripts/research/verify-furniture-reinstall-evidence.mjs --local
```

[静态采集器](../../../scripts/research/collect-furniture-reinstall-evidence.ps1)、[实机采集器](../../../scripts/research/collect-native-furniture-reinstall-runtime.ps1)、[证据校验器](../../../scripts/research/verify-furniture-reinstall-evidence.mjs) 均不启动或重放游戏。portable 检查公共记录、实体链、字段、哈希与文档链接；local 另外复核 DLL/工具/派生/原 Def、原档精确 XPath 投影和输入日志。REA member 表 67,108,864-byte 限制失败继续保留为已知边界，未重复盲试。
