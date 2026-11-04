# 自动重建：毁坏原因、家园条件与设置保留

更新：2026-11-04。目标为 RimWorld **1.7.4980 rev60**。本页仅依据匹配程序集的静态派生代码与安装包 XML；遵循“后续暂时不要运行程序来交互了”，**本轮没有启动或操作原版、浏览器、预览或 GUI，也没有原版玩法或浏览器交互验证**。这里记录机制约束，不把 Web 测试当作原版行为实测。

## 证据身份与读取方式

- 程序集：`F:/SteamLibrary/steamapps/common/RimWorld/Assembly-CSharp.dll`；SHA-256 `eff7d97949f919fb2b151ebfb906e9be749b63410b7dbda78eeebb7972b245c3`。
- 复用同一程序集的 [REA 托管元数据](evidence/production-bills-rea-managed.json)：证据 `ev_41acdc3a1d6904fb12e36eeaac20397afac130d300dafc70973a154cd3fbfd84`，父证据 `ev_ebbdfc84b2bb4bc3fff131fd667e539f7c75c3d78c0491481455a7751b3a5337`。仅用于身份核对，没有重新配置或安装分析服务。
- 使用已有 ILSpy 静态解析 PE，不加载或执行目标程序集。派生 C# 位于忽略目录 `.local-research/auto-rebuild/`；[提取清单](evidence/auto-rebuild-manifest.json) 记录 **33 个类型**的哈希与行数，[机制证据](evidence/auto-rebuild-mechanisms.json) 记录精确锚点、有界否定检查与打包 Def 投影。
- 下文类型行号只适用于清单记录的派生文本，不是原始源码行号；未解析依赖由 ILSpy 容忍，因此不能把派生结果当作原作者源码或运行结果。

## 开关默认关闭，保存在游戏存档

`RimWorld.PlaySettings` 第 32 行为 `public bool autoRebuild;`，字段初始值是 `false`；第 85 行以键 `autoRebuild` 保存，缺字段时也为 `false`。第 170 行的地图底部控件直接切换此布尔值。`Verse.Game` 第 31、413 行说明它属于游戏的 `playSettings` 并随游戏保存，不是每栋建筑分别设置。

打包英文提示为 “Toggle automatic rebuild of destroyed structures in the home area.”，来自 `Data/Core/Languages/English/Keyed/Misc_Gameplay.xml`。它指向毁坏事件时的判断；所审查的切换控件没有扫描历史废墟、补造以前丢失建筑的逻辑。已经放出的蓝图是独立的普通建设对象，后续关闭开关没有在此控件中撤销它们。

## 建筑毁坏后，立即尝试放置普通蓝图

`Verse.ThingUtility.CheckAutoRebuildOnDestroyed` 第 157—164 行要求以下条件同时满足：

1. `Find.PlaySettings.autoRebuild` 开启。
2. 毁坏模式严格等于 `DestroyMode.KillFinalize`。
3. 原对象 `Faction == Faction.OfPlayer`。
4. 目标建筑 Def 的 `blueprintDef` 非空。
5. `buildingDef.IsResearchFinished` 为真，即所有列出的研究前置完成。
6. **原对象的锚点 `thing.Position` 位于 Home**；不是“整个占地都在 Home”，也不是“占地任意一格碰到 Home”。
7. `GenConstruct.CanPlaceBlueprintAt` 接受当前位置、朝向与材质，且 `godMode:false`。

`Verse.Building.Destroy` 第 302—328 行先保留旧 `Spawned` 和 `Map`，执行 `base.Destroy(mode)`，随后对原先已生成到地图的对象调用上述 helper。底层先移除旧建筑并清理其预约和指定，再检查原位能否放蓝图；不能在旧建筑仍占位时直接复用普通放置验证。

通过时调用 `GenConstruct.PlaceBlueprintForBuild`，创建**全新的普通建造蓝图**。它携带原 Def、位置、朝向、材质，以及 `StyleSourcePrecept` / `StyleDef` 参数。不是免费修复，也不是把原对象或其血量恢复回来。普通蓝图使用 `CostListAdjusted(stuffToUse)`，进入正常取料、施工、完工链。放蓝图不要求当时仓库已有足量资源；材料是否可用、可达、被禁止、已预约，应由后续建造作业处理。

所审查 helper 在不满足条件时返回 `null`，没有排队等待未来地面恢复、研究完成或 Home 扩大后再重试的机制。该结论限于这条自动重建链，不排除其它游戏系统或模组另行放蓝图。

## 玩家拆除、卸装、损毁不是同一种事件

| 情况 | 静态链路 | 普通自动重建结果 |
|---|---|---|
| 攻击、火灾等最终调用普通 `Thing.Kill` | `Kill` → `Destroy(KillFinalize)` | 满足其它条件时放新蓝图 |
| 玩家拆除 | `JobDriver_Deconstruct.FinishedRemoving` → `Destroy(Deconstruct)` | 不触发 |
| 玩家卸装、搬走家具 | `JobDriver_Uninstall` → `Uninstall` → `MakeMinified` → `DeSpawnOrDeselect(Vanish)` | 不触发；包装内保留原对象 |
| 取消、退款、替换、直接消失 | `Cancel` / `Refund` / `WillReplace` / `Vanish` 等 | 均不满足 `KillFinalize` 判断 |
| 建造框架受到致命损毁 | `Frame.Destroy` 用 `def.entityDefToBuild` 调用同一 helper | 可以触发，产生新蓝图，旧施工进度不传递 |
| 普通空蓝图移除 | `Blueprint` / `Blueprint_Build` 继承 `ThingWithComps`，无建筑或框架的重建 hook | 所审查普通类没有自动重建路径 |
| 施工技能失败 | `Frame.FailConstruction` → `Destroy(FailConstruction)`，随后自身重新创建蓝图 | **独立机制**，不依赖自动重建开关或 Home |

框架销毁入口位于 `RimWorld.Frame` 第 193—204 行。施工失败位于第 408—437 行，另行恢复原材质、派系、风格与储存设置。复刻时不能将两种“又出现蓝图”的现象混成一个自动重建开关。

## 哪些 Def 支持，以及放置仍受什么限制

普通 Thing 蓝图由 `ThingDefGenerator_Buildings.ImpliedBlueprintAndFrameDefs` 对 `BuildableByPlayer` 的 Def 生成；`BuildableDef.BuildableByPlayer` 实际为 `designationCategory != null`。可卸装 `Minifiable` 会生成安装蓝图，但**有安装蓝图不保证有普通建造蓝图**。自动重建实际检查的是普通 `blueprintDef`，不是“任何能选中的建筑”或“任何搬得动的家具”。

例如打包 `Wall` 直接声明 `Structure` 建造类别；`Shelf` 经 `StorageShelfBase → ShelfBase → FurnitureBase` 获得建造类别、`Building_Storage` 与 `Blueprint_Storage`，并受 `ComplexFurniture` 研究前置约束。这里核对的是列出的 XML 继承声明和代码生成规则，没有声称已经加载所有 DLC、模组补丁后的最终 Def 数据库。

`GenConstruct.CanPlaceBlueprintAt_NewTemp` 第 364—510 行保留常规放置检查，包括占地边界、地图禁止建造边缘、锚点迷雾、重复建筑或蓝图、交互格、地面承重、其它对象占位、纪念碑限制及 Def 的 `PlaceWorkers`。`IsResearchFinished` 检查列出的研究前置，不应额外声称这一个布尔属性覆盖所有建筑解锁规则。

因此桥面被毁、地面承重改变、交互格被堵等情况，即使旧建筑确实在 Home、且是玩家所有，也可能放不出蓝图。此时应保留失败原因或清晰状态，不能无条件绕过普通建设规则。

## 哪些状态会保留

| 数据 | 原版静态链说明 |
|---|---|
| 类型、锚点、旋转、材质 | 明确作为普通蓝图工厂的参数传入 |
| 风格来源与风格 Def | 明确传给蓝图并进入框架；最终外观还受普通完工风格/意识形态逻辑约束 |
| 储存过滤、优先级 | `Building.Destroy` 显式复制 `StorageSettings`；`CopyFrom` 复制 Priority 与 filter allowances |
| 储存组 | 同一组引用经储存蓝图 → Frame → 新储存建筑转交；组设置继续有效 |
| 工作台账单 | 所审查普通工作台没有转交；新实例构造新的 `BillStack` |
| 床主人 | 旧床 `DeSpawn(KillFinalize)` 调用 `RemoveAllOwners`，居民 `UnclaimBed`；不会随重建蓝图复制 |
| 医疗床、主人类别 | 旧床卸场时复位；新床走自己的默认/生成规则，不继承旧床设置 |
| 品质 | 完工时根据**这次建造者**重新生成，不复制旧品质 |
| 施工进度、旧血量 | 没有传入新蓝图；新框架正常施工，完工血量按新框架当时的血量比例计算 |
| 储存建筑单独改名、灯光覆盖等其它状态 | 所审查通用重建链没有复制；不能由储存例外推导为完整对象克隆 |

储存传递可追到 `Blueprint_Storage.MakeSolidThing` 第 92—100 行和 `Frame.CompleteConstruction` 第 326—331 行。转交中调用 `SetStorageGroup(null, removeIfEmpty:false)`，避免交接瞬间把唯一成员的组删掉。组自身的名称随组身份存在，不等于旧建筑的独立 `label` 被复制。

普通工作台和床结论分别由 `Building_WorkTable` 第 42—45 行、`Building_Bed` 第 286—306、738—751 行支持。专用子类或 Comp 的毁坏 hook 可能另外处理状态；本页不把通用链的有界检查泛化为所有特殊建筑和模组的完整证明。

## 火灾中的框架与空蓝图

普通建筑框架的 Def 由 `NewFrameDef_Thing` 生成：占地尺寸取原建筑 `size`，基础最大血量取成品基础值的四分之一，基础可燃性取成品 `BaseFlammability`，材质类别继承。实际属性仍经过 `StatWorker` 的材质乘数与加数，因此木制和石制框架不应共用一个固定可燃度；这些数值是静态来源，Web 可先确保材料差异和损毁流程，再逐项校准。

火源通过当前位置的 `ThingGrid` 枚举对象并查看 Flammability，ThingGrid 在对象旋转后的占地格登记它；不是只命中大型框架的中心格。空建造蓝图使用 `BaseBlueprintDef` 的 `useHitPoints:false`，没有复制成品可燃性，Flammability StatDef 的默认值为 0；在所审查普通 Def 生成链中不作为可燃建筑实体。

**地形框架需单独对待。** `NewFrameDef_Terrain` 明确设置 `useHitPoints:false`、`category:Ethereal`，没有复制地形的 Flammability。不能因为最终木地板/桥可燃，就把其施工阶段也等同于普通木制建筑框架。若其它系统显式对某个地形 Frame 调用 `Kill`，Frame 的通用重建 helper 本身不检查 `TerrainDef.autoRebuildable`；这不证明地形框架能被普通火灾烧毁。

## 地板和桥：独立的地形重建路径

`ThingUtility.CheckAutoRebuildTerrainOnDestroyed` 第 166—172 行检查开关、**`terrainDef.autoRebuildable`**、蓝图存在、研究完成、该格 Home，以及常规放置合法性。地形没有建筑 `Faction` 字段，因此不照搬建筑阵营判断；放出的蓝图属于玩家。

`TerrainDef.autoRebuildable` 默认 `false`。打包 `Terrain_Foundation.xml` 的 `BridgeBase` 显式设 `true`，`Bridge` 继承它；`Terrain_Floors.xml` 的 `FloorBase` 和 `WoodPlankFloor` 都未开启。因此该安装版本中：

- 完成的普通木桥毁坏，可以在条件成立时自动重建。
- 完成的普通木地板烧毁，不因这个开关自动放木地板蓝图；它另有 `BurnedWoodPlankFloor` 烧焦地形。
- 直接拆除 top layer / foundation 与毁坏通知不同；不能所有地形移除都调用自动重建。

`TerrainGrid.Notify_TerrainBurned` 优先毁坏可燃 foundation，否则处理 top terrain 并应用 `burnedDef`。`Notify_TerrainDestroyed` / `Notify_FoundationDestroyed` 在移除地形后调用重建 helper；设有 `destroyBuildingsOnDestroyed` 时还会先 `Kill` 上方建筑。因此地基与上方建筑有各自的毁坏和放置判定，不能保证一座桥被烧掉后，其上全部设施都会恢复蓝图。

## 对 Web 多层体素实现的约束

原版地图没有 Minecraft 式 z 层。Web 的两块高墙、z 层 Home、支撑和桥面几何应明确标为三维适配，同时保持上述事件语义：

1. 将多块组成的建筑映射到唯一建筑身份和锚点；火烧上半墙也应先清理该建筑整体，再尝试一次重建，避免留下半墙阻挡自己或重复蓝图。
2. 按毁坏原因区分致命损毁、拆除、卸装、取消和施工失败，保留普通完整建造链、资源消耗与预约释放。
3. 家园判断使用定义明确的建筑锚点和 z 层；检查研究、材质、旋转、支撑及现存蓝图，不能因自动生成而绕过放置限制。
4. 储存设置与链接组走明确的传递数据；不顺便复制旧账单、床主人、品质或已损失物资。
5. 已完成地形、普通建筑框架、地形框架和空蓝图分别建模。Web 的材料、体素几何或火灾简化需在实现文档单列，不能称作原版实测一致。

## 只读复核

```powershell
pwsh -NoProfile -File scripts/research/extract-auto-rebuild.ps1 -Check
pwsh -NoProfile -File scripts/research/collect-auto-rebuild-evidence.ps1 -Check
```

第一项静态重建派生文本并逐字/逐哈希比较，第二项复读来源、核对规则锚点和所列 XML。两者都不启动游戏、浏览器或预览，也不输入、截图或修改保存。本页没有原版运行报告；特殊子类、完整模组覆盖、所有历史保存迁移及原版交互因果场景仍未验证。
