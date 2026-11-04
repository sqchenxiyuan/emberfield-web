# 允许区域：目标过滤、路径偏好与玩家命令

更新：2026-11-04。对象为本地 RimWorld **1.7.4980 rev60**。本轮优先确定机制，不把原版寻路代价或更新周期直接当作 Web 平衡数值。实机对照见 [131](131-native-allowed-area-runtime.md)。

## 身份与证据

- `Assembly-CSharp.dll` SHA-256：`eff7d97949f919fb2b151ebfb906e9be749b63410b7dbda78eeebb7972b245c3`。
- 复用匹配该文件的 [REA managed metadata](evidence/production-bills-rea-managed.json)，Evidence ID `ev_41acdc3a1d6904fb12e36eeaac20397afac130d300dafc70973a154cd3fbfd84`，父证据 `ev_ebbdfc84b2bb4bc3fff131fd667e539f7c75c3d78c0491481455a7751b3a5337`。它只证明静态元数据，不证明游戏执行。
- [31 个定向派生类型清单](evidence/allowed-area-manifest.json)绑定 DLL、ILSpy 引擎与每份 LF C# 的 SHA-256。派生代码保留在忽略目录 `.local-research/allowed-area/`，不提交原版完整代码。
- [静态结论与精确锚点](evidence/allowed-area-mechanisms.json)保存类型、行号、摘录、原始文件哈希及普通殖民者 think-tree 分支顺序。ILSpy 容忍未解析依赖，因此这些是派生重建结果，不能冒充原始源码。

## 可编辑数据与分配

`Area_Allowed` 是地图上的 BoolGrid，可命名、改色、扩大、缩小、反选、清空和删除。默认命名避开已有名称；原版同时最多创建 10 个可编辑允许区。居民存储的是 `Dictionary<Map, Area>`，不同地图可各自分配。`null` 表示 Unrestricted。

**空区域也是无限制。** `ForbidUtility.InAllowedArea` 只有在有效区 `TrueCount > 0` 时才拒绝区外坐标；`PathUtility.GetAllowedArea` 也把空区转成 `null`。不要把空区实现成“居民原地饿死”的硬封锁。

分配一个非空有效区时，如果居民已生成、未征召、当前作业存在任何区外目标，就用 `InterruptForced` 中断作业。`Job.AnyTargetOutsideArea` 检查 A/B/C 和两个 target queue。绘制现有区域的格子走另一条链：标记显示、PathFinder map data 和 Region 的区域缓存为脏，不能把它与“重新分配时立即中断”的 setter 混为一谈。删除区域会通知所有有 playerSettings 的存活或死亡 pawn，移除对应地图引用；删除地图也清理引用。

## 区域不是墙

自动作业首先过滤目标，而不是要求每一步都在区内：

| 位置/行为 | 原版规则证据 |
|---|---|
| 自动工作目标 | `JobGiver_Work` 过滤 thing/cell 的 `IsForbidden` |
| 生产原料和半成品 | `WorkGiver_DoBill` 选材/续做检查 `IsForbidden` |
| 建造材料 | `WorkGiver_ConstructDeliverResources` 检查资源物体 |
| 仓储目的地 | `StoreUtility` 检查 carrier 的目标格 |
| 普通地图食物 | `FoodUtility` 在 `allowForbidden=false` 时过滤物体；特殊调用可例外 |
| 床 | `RestUtility` 检查床；倒地、当前作业 `ignoreForbidden` 等有例外 |
| 路线 | `PathGridJob` 对区外格增加 **600 寻路代价**，不把该格设为不可走 |

600 是原版寻路评分，不是减速 600 tick，也不是单位移动时间。居民可以穿过区外格去区内目标。实机还证实：只把实体墙自身一格加入允许区，居民可站在区外相邻格拆它。因此 Web 不能对所有相邻交互站位额外施加硬区域限制。

`JobGiver_SeekAllowedArea` 仅在当前位置被禁止、且当前作业没有已经生成的区内 A/B/C 目标时尝试返回。它按可通行 Region 做广度优先搜索，跳过门口 Region，找到有可用允许格的 Region 后随机选格发出 Goto。找不到返回格时可返回 null，不会传送人物。

Core `Humanlike.xml` 普通殖民者分支先放 SeekAllowedArea，然后是安全温度、紧急工作、饥饿应急及后续 MainColonistBehaviorCore。但树前部存在倒地、征召、精神状态和其他特殊分支；不能将此顺序概括为“允许区高于任何生理需求”。正在执行合法区内目标时，SeekAllowedArea 自己会让路。

## 自动工作和手动命令必须分开

普通“优先执行工作”仍受区域限制。`FloatMenuOptionProvider_WorkGivers` 会在生成候选作业后检查目标 `IsForbidden`，并显示 `CannotPrioritizeForbiddenOutsideAllowedArea`。实机区外木墙确实显示 `Cannot deconstruct wooden wall: Outside allowed area (ResearchYard)`。

但这不等于所有右键命令都受同样限制。`FloatMenuOptionProvider_Equip` 不做区域拒绝，先解除物品禁用，然后发出 ordered Equip。`Pawn_JobTracker` 对已获准的 `playerForced` 作业设置 `ignoreForbidden=true`。实机未征召居民实际离开允许区装备区外木头，再返回允许区。不能只看 JobTracker 的 ignoreForbidden 就推断“所有强制工作都能绕过区”，因为工作菜单前面仍有拒绝逻辑。

征召、精神状态、奴隶叛乱、部分跟随主人/机械体等在 `CaresAboutForbidden` 存在跳过条件。有效区域还要求支持区域控制、玩家阵营、无 HostFaction、无当前 Lord 等条件；圈养 roamer 与禁用区域控制的种族不支持同样的区域系统。这些分支本轮只核实静态代码，不声称做过 DLC/角色全矩阵实机试验。

## 复刻约束与未覆盖范围

Web 应明确区分允许区、Home area、仓储区、动物围栏、房间和禁用物品。区域支持不连通片段、空区无限制、可跨区寻路、区内目标的相邻区外作业及显式装备例外。3D 格子与原版 2D BoolGrid 的映射、返区和选择工作的具体调度属于 Web 适配，需由实现文档说明。

本轮没有运行空区、删除区、精神崩溃、征召、床、食物、救援、动物及所有工作种类的逐项对照；结论不能超出上面的静态范围与 131 的实测场景。没有数值拟合、TPS 测量或新地图生成推断。

复核命令（均在项目根运行，后两步不启动原版）：

```powershell
pwsh -NoProfile -File scripts/research/extract-allowed-area.ps1 -Check
pwsh -NoProfile -File scripts/research/collect-allowed-area-evidence.ps1 -Check
pwsh -NoProfile -File scripts/research/collect-native-allowed-area-runtime.ps1 -Check
```
