# 实体货架：继承、容量、储存规则与卸装

核对日期：2026-11-04。目标为本机 RimWorld **1.7.4980 rev60**。本章依据随游戏发行的 Core XML 和同版本程序集的静态派生代码；未启动游戏，没有把静态分支当成实机结果。实机搬移床的旧记录不能代替货架装满、卸下或温度试验。

关键结论：货架每占一格容纳 **3 个物品堆**；大架两格共 6 堆，小架一格共 3 堆。满格允许兼容的未满堆继续合并。架上物品免受该路径的环境劣化，但仍按环境温度腐坏。**原版卸下满货架不要求先清空**：移除建筑会尝试将超额堆放到附近，物资不随打包货架一起搬走。

证据入口：[SH01–SH14 规则与源位置](evidence/shelf-storage-evidence.json)、[新增类型 manifest](evidence/shelf-storage-manifest.json)、[类型清单](evidence/shelf-storage-types.json)、[REA managed 身份记录](evidence/shelf-storage-rea-managed.json)。完整派生 C# 留在忽略目录，公开记录保存类型哈希、行范围、范围内容哈希、必要 XML 投影及其哈希。

## 1. 目标身份和证据范围

| 项目 | 本次固定值 |
|---|---|
| 原文件 | `F:\SteamLibrary\steamapps\common\RimWorld\Assembly-CSharp.dll` |
| Assembly SHA-256 | `eff7d97949f919fb2b151ebfb906e9be749b63410b7dbda78eeebb7972b245c3` |
| MVID | `8e962ecc-7ac7-42d2-8f3b-1b16cd24d2cd` |
| 派生工具 | `ICSharpCode.Decompiler` / ILSpy `11.2.0.10050` |
| 工具 SHA-256 | `587a18e18e13acfc7fd8783a44c24c7da0781dadf6b9fb9dd5e2e38a9cdfae78` |
| REA summary | `ev_107c63f87f74870b8dc7c9c2205fec8ed587133e8dc9701a85c5682d8aa43cea` |
| REA parent | `ev_002f7c6a8e7e5c16296ff1beb7f5dc6ac1cc486e52a65155a913c3753871a42b` |

REA 的 managed metadata coverage 为 complete，记录的实现为 CIL、managed architecture 为 AnyCPU。这里没有加载程序集到游戏运行环境，也没有据 PE 的 x86 字段推断实际游戏进程架构。REA 身份检查与 ILSpy 反编译是两条不同证据；反编译结果是派生重建，容忍未解析的依赖，并非开发者原始源码。

本次新增 8 个类型：`SlotGroup`、`SpecialThingFilterWorker_CorpsesLarge`、`Blueprint_Storage`、`StorageGroup`、`StoragePriority`、`GenGrid`、`PathGrid`、`Pawn_PathFollower`。最后两个中的 `Pawn_PathFollower` 仅为本地路径研究预留，当前 14 条规则没有引用其行范围；不能把提取数量当成已逐行确认的类型数。其余来源复用 `energy`、`logistics`、`preservation`、`work`、`weather`、`weapons`、`skills` 和家具重装专题中相同 DLL/工具哈希的派生文件。

XML 保留 `MayRequire`，未运行 DLC/Mod patch 合并。下文是选定 Core 父链的规则，不是当前启用 Mod 后的完整 effective Def 数据库。

## 2. 完整父链与数值（SH01）

```text
Shelf      ─┐
            ├─ StorageShelfBase → ShelfBase → FurnitureBase → BuildingBase
ShelfSmall ─┘
```

| 层级 | 本专题相关字段 |
|---|---|
| `BuildingBase` | `category=Building`、默认 `thingClass=Building`、可选中、`terrainAffordanceNeeded=Light` |
| `FurnitureBase` | 家具建造分类、`minifiedDef=MinifiedThing`、`thingCategories=BuildingsFurniture` |
| `ShelfBase` | `PassThroughOnly`、`pathCost=50`、`fillPercent=0.4`、`surfaceType=Item`、不与 Zone 重叠、`maxItemsInCell=3`、防环境劣化、忽略储物美观度、`Blueprint_Storage`、研究 `ComplexFurniture` |
| `StorageShelfBase` | `thingClass=Building_Storage`、`storageGroupTag=Shelf`、固定接纳限制、默认过滤和 `Preferred` 优先级 |
| `Shelf` / `ShelfSmall` | 占地、材料数量、耐久、重量和建造工作量的基础数值 |

| 基础 Def 数值 | Shelf | ShelfSmall |
|---|---:|---:|
| 未旋转尺寸 | 2×1 | 1×1 |
| 每格物品堆上限 | 3 | 3 |
| 总物品堆上限 | 6 | 3 |
| `costStuffCount` | 20 | 10 |
| `WorkToBuild` | 500 | 250 |
| `MaxHitPoints` | 100 | 50 |
| `Mass` | 8 | 4 |

`ShelfBase` 允许 `Metallic / Woody / Stony` 材料，默认放置朝南。所选父链没有覆盖 `ThingDef.rotatable` 默认 true，因此大架旋转后实际占格方向改变。这里的工作量、HP、Mass 是基础 Def 数值；没有评估具体材料、StatPart、角色建造速度或场景倍率，不能直接写成所有材质相同的最终 HP 或固定建造秒数。

**这条父链没有 `CompProperties_Quality`。** 普通床/椅的品质继承结论不能迁移到货架。`CompProperties_Styleable` 与品质组件不是一回事；DLC 风格字段也不证明货架具有 Awful–Legendary 品质。

## 3. 可通过、可站立和可放物品是三个条件（SH02）

`PassThroughOnly` 允许寻路通过。`PathGrid.CalculatedCostAt` 遇到 `Impassable` 才拒绝普通地面通行，随后把相关物体的 pathCost 与地形等成本比较。因此货架会参与通行成本计算，但 **50 不是完整的跨格耗时公式**，不能未经角色/地形/路径评估就换算为秒。

`GenGrid.Standable / StandableBy` 要求格内物体的 passability 都是 `Standable`。货架不满足此一般站立检查；这不等于物理上绝不能经过或在任何任务里短暂出现于架格，也不能把它做成不可通过的墙。

普通搬运的取货 `JobDriver_HaulToCell` 和交货 `Toils_Haul.CarryHauledThingToCell` 都使用 `ClosestTouch`。角色可以靠近架格取放，无需固定站在架内。`surfaceType=Item` 则用于放置/储存阻挡检查，不能由“人能走过”推导“任意建筑表面都能存物”。`fillPercent=0.4` 在这里只记录 Def，不将其直接等同于已验证的掩体命中率。

## 4. 物资仍是地图上的实体（SH03、SH07、SH08）

`SlotGroup.HeldThings` 遍历占格的 `map.thingGrid`，返回其中可储存的已生成 Thing。普通货架没有把这些物资塞进一个随架移动的私有 `ThingOwner`。因此物资仍有自己的坐标、数量、禁用/受损/腐坏状态，移动建筑不会天然移动它们。

`GetMaxItemsAllowedInCell` 查询同格 edifice 的 `MaxItemsInCell`，不存在这类建筑时返回 1；`Building.MaxItemsInCell` 转发 Def 字段。`GetItemCount` 数的是 `ThingCategory.Item` 对象数，不是 `stackCount` 单位数。六堆容量既不是六个单位，也不是六种物品：同一种物资可以占多个堆，仍各占一位。

容量估算 `GetItemStackSpaceLeftFor` 为：

```text
该 Def 已有堆的剩余单位数之和
+ max(该格堆上限 − 现有 Item 堆数, 0) × 该 Def 的 stackLimit
```

该 helper 只按 Def 汇总。实际合堆还需通过 `CanStackWith` 等条件，不能把估算值当成通用许可。`NoStorageBlockersIn` 即便发现堆数已满，仍允许向兼容且未满的已有堆补货；建筑/蓝图等阻挡检查仍执行。

例如，**假设**某物资 `stackLimit=75`：架格放有它的 70 单位，加另外两个不兼容物品堆，此格仍可再接收 5 个兼容单位，却不能生成第 4 堆。若另一个架格有空位，整次搬运可能继续去那里放剩余物资。

`HaulAIUtility.HaulToCellStorageJob` 会检查 slot/storage group 内多个格的容量；取货时 `StartCarryThing` 再以 `AvailableStackSpace`、任务数量、源堆数量的最小值决定携带量。交货 `PlaceHauledThingInCell` 可部分放下并重新寻找剩余物品的落点。货架扩容不会同时提高角色搬运能力。

## 5. 固定过滤与玩家设置共同生效（SH04、SH05）

`StorageSettings.AllowedToAccept` 先查自己的 mutable filter，再查 owner 的 parent/fixed filter，两者必须都通过。玩家“全选”不会越过家具本身的硬限制。

| 类型 | Core 货架规则 |
|---|---|
| 普通 Foods、Manufactured、ResourcesRaw、Items、Weapons、Apparel、BodyParts | 默认类别已允许，仍需其他属性过滤通过 |
| `Chunks`、`Plants`、`Buildings` 类别 | fixed filter 排除 |
| 不满足 `EverStorable` 的 Def | fixed filter 排除 |
| Biotech `Wastepack` | XML 有带 `MayRequire` 的排除，必须按 DLC 条件解读 |
| 大型尸体 | `AllowLargeCorpses` special filter 硬排除 |
| 小型尸体 | 不在默认类别中；可在 fixed 范围内另行启用，不能说所有尸体都禁止 |
| 打包床、桌、椅、货架 | fixed filter 仍排除，不能因外层是 Item 就允许上架 |

尸体实际实例判断是 `corpse.InnerPawn.BodySize >= 0.75`。`CanEverMatch / AlwaysMatches` 用 life-stage `bodySizeFactor` 提前筛 Def，那不是替代实例体型的最终判断式，也不能简单写成“成年人都不行、幼年都行”。

打包家具容易被误判：`ThingFilter.Allows(Thing)` 先执行 `GetInnerIfMinified()`，然后用内家具 Def/属性检查。内家具由 `FurnitureBase` 继承 `BuildingsFurniture → Buildings`，正中 fixed 排除。`EverStorable(willMinifyIfPossible:true)` 只说明某物体有机会储存，不会覆盖某货架自己的类别限制。此规则同时适用于尚未实现武器、衣物或尸体的 Web 扩展，不能只列一个当前资源白名单后宣称完整复刻原版。

## 6. 优先级与联动储存（SH06、SH14）

原版枚举从低到高是 `Unstored → Low → Normal → Preferred → Important → Critical`；`Unstored` 是未储存状态，后五档才是一般储存级别。货架默认 **Preferred**。

自动寻找更好的储存位置要求新位置的优先级**严格高于**当前优先级，并按优先级层次缩小候选。已有物资不会仅因另一个同级货架更近就自动不断搬来搬去。当前 Web 若采用四档优先级，需要写明映射和取舍，不能只按同名标签宣称数值一致。

`Building_Storage.GetStoreSettings` 在已联动时返回 `storageGroup.GetStoreSettings()`，否则返回本体 settings。货架蓝图在建成前就可配置 settings；`Blueprint_Storage.PostMake` 从将来的建筑默认设置复制，转成 Frame 时复制当前设置并传递 storage group。这是**新建蓝图 → Frame** 的路径，与把已有货架打包后重装不同。

## 7. 环境劣化保护不等于冷藏（SH09、SH10）

货架的 `building.preventDeteriorationOnTop=true` 会被同格 `SteadyEnvironmentEffects.ProtectedByEdifice` 识别；`DeteriorationRate` 的 `StatPart_EnvironmentalEffects` 配置 `protectedByEdificeFactor=0`，使该环境劣化路径归零。屋顶、露天、雨量等通常参与环境倍率，但货架保护本身不要求室内或屋顶。

食物腐坏由另一条 `CompRottable.TickInterval` 路径推进：读取 `parent.AmbientTemperature`，经 `RotRateAtTemperature` 增加 `RotProgress`。这里没有货架的防劣化开关，因此温暖货架上的食物仍会变质，冷库仍有用途。

本章未核准温度曲线全部断点，也没有做长期计时试验。不会把货架写成“免腐坏”“免火灾”“免攻击伤害”或“抵抗所有伤害”；`ignoreStoredThingsBeauty=true` 是额外 Def 标记，并非上述任何保护的替代名称。

## 8. 满货架卸下与重装（SH11–SH13）

正常 Uninstall designation 和 RemoveBuilding 工作检查没有“货架必须为空”的条件。任务完成后依次进入 `Uninstall → MakeMinified → DeSpawn`。**“先清空才能卸下”若作为 Web 规则，是额外设计限制，不是本版原生行为。**

`Building.DeSpawn` 在移除建筑后，针对旧占格执行容量恢复：如果原建筑 `MaxItemsInCell >= 2` 且某旧格的 Item 堆数超出移除后的容量，就重复取该格 `GetFirstItem`，先 DeSpawn 该堆，再 `GenPlace.TryPlaceThing(... Near)`；当该格容量已合法时提前退出。算法移动的是若干物资堆，未必清空整个原格，更没有按玩家概念预设“先把货架内袋子倒出来”。

`MakeMinified` 仅令包装 `InnerThing=原建筑`。卸下的架子仍是同一内实体；原格物资保持为地图物品或被尝试移动到附近，不变成包装内容。重装时 `Blueprint_Install` 取出同一 InnerThing、先清空包装再销毁包装，基类最后在新位置/旋转 Spawn 原建筑。因此货架设置与散落物资是两条不同生命周期。

`Building_Storage.PostMake` 仅在新建时创建 settings；普通 `DeSpawn` 只清占格缓存，不重置 settings 或 storageGroup。`ExposeData` 保存 settings、storageGroup 引用与 label。跨地图再次 Spawn 时，若原 group 属于另一张图，会脱离原 group 并把当时 group settings 复制到自身。由此可静态确认本体设置保留、同图分组不会仅因普通 DeSpawn 被主动清空；完整跨图存档/联动操作仍未实机验证。

### 极端满图的失败边界

`GenPlace.TryPlaceThing(... Near)` 采用逐步扩大搜索的方式，可能返回 false。`Building.DeSpawn` 对超额堆和 `MinifyUtility.Uninstall` 对包装的调用均**未检查返回值，也没有先完整规划后原子提交的回滚流程**。

超额堆在调用前已经 DeSpawn；若搜索失败，这一调用点没有把它还原到原格。静态上不能保证物体仍由地图或可保存的 owner 持有，也不能说原版会自动等空间、保证物资绝不丢失。反过来，本章未运行彻底拥堵地图，亦不把这条潜在失败分支宣布为已复现的消失 bug。准确落点、合堆顺序、失败后存档回收需要专项运行证据。

Web 可主动卸装时先计算全部落点，空间不足则保留原建筑与全部物资并提示；火毁等不可撤销移除可以保留超额地面堆或使用明确的待安置 owner。两种方案都必须保持物资有可序列化的归属，同时明确标注为 Web 守恒适配，不能声称原版就是这种事务式保证。

## 9. 实现与实机核对重点

| 情形 | 静态证据给出的边界 | 运行验证应记录 |
|---|---|---|
| 双格架/单格架 | 每格三堆；实际占格取决于尺寸与旋转 | 每堆 ID、坐标、单位数、格数 |
| 满格部分合堆 | 兼容未满堆仍可接收；无第四堆 | 搬运前后堆数与单位守恒 |
| 优先级 | 自动改善要求严格更高 | 当前/目标优先级、任务原因 |
| 打包家具/大小尸体 | fixed filter 检查内家具；尸体 BodySize 阈值 | 设置可选项与实际任务接纳分别观察 |
| 室外架与温暖架 | 防环境劣化，仍受温度腐坏 | HP 与 RotProgress 分开记录 |
| 满架卸下 | 不要求预清空；超额堆 Near 重放 | 原架 ID、包装 InnerThing、每个物资 ID 与位置 |
| 重装/读档 | 同一建筑/设置；物资不随搬 | 原实体身份、过滤和优先级、散货总量 |
| 无处安置 | 静态调用未保证回滚 | 单列极端样本，不用普通样本推出无损 |

上述是后续验证清单，**不是本专题已执行的实机结果**。实现时应复用物品堆实体、过滤、预约和搬运流程，而非把一个“库存总数”挂到家具上后绕过这些系统。

## 10. 重现与校验

已有相同哈希的派生文件时直接复用。只有缺少新增类型时才运行以下静态提取；它读取 PE/CIL，不启动 RimWorld：

```powershell
& scripts/research/extract-rimworld.ps1 `
  -GameRoot 'F:/SteamLibrary/steamapps/common/RimWorld' `
  -DecompilerPath 'C:/Users/chenxiyuan/Documents/ChatGPT/game-re-build/tools/ilspy/lib/netstandard2.0/ICSharpCode.Decompiler.dll' `
  -Group shelf-storage -Types @(
    'RimWorld.SlotGroup', 'RimWorld.SpecialThingFilterWorker_CorpsesLarge',
    'RimWorld.Blueprint_Storage', 'RimWorld.StorageGroup', 'RimWorld.StoragePriority',
    'Verse.GenGrid', 'Verse.AI.PathGrid', 'Verse.AI.Pawn_PathFollower'
  )
& scripts/research/collect-shelf-storage-evidence.ps1
node scripts/research/verify-shelf-storage-evidence.mjs
node scripts/research/verify-shelf-storage-evidence.mjs --local
```

可用 `RIMWORLD_GAME_ROOT` 环境变量覆盖校验器的游戏目录；采集器对应使用 `-GameRoot`。游戏和工具的记录哈希必须匹配。

[采集器](../../../scripts/research/collect-shelf-storage-evidence.ps1) 的 `-Check` 模式重新读取游戏 XML 与本地派生，复算投影和每条引文内容，逐字节对比已保存 JSON，不重写记录。[校验器](../../../scripts/research/verify-shelf-storage-evidence.mjs) 的 portable 模式核对 REA 身份、manifest、规则 ID、行范围、XML 投影哈希和关键继承/数值；不要求访问原游戏或忽略目录。它不能仅凭范围哈希复算未公开的 C# 语义，所以不叫运行验证。

`--local` 额外检查原 DLL、工具、XML、所引派生文件、行数和每条引文 SHA-256，并调用采集器 `-Check` 复算；两种模式均不加载游戏代码，不执行键鼠操作，也不校准原版路径耗时或腐坏时长。

本次两种模式均通过：14 条规则、8 个新增提取类型、26 个实际引用类型、45 处源码范围、6 组 XML 选择共 14 个节点、10 份 manifest。local 模式核验了 37 个文件，并成功逐字节复算静态记录。
