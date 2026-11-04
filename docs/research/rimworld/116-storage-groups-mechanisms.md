# 储存联动组：共享规则、成员迁移与生命周期

核对日期：2026-11-04。目标为本机 RimWorld **1.7.4980 rev60**。本章只记录发行程序集的静态派生代码和 Core XML；没有执行目标游戏，不能代替主线程的实机操作记录。玩法机制优先：这里关注“修改一个货架影响哪些对象”“拆装、重建、读档后关系是否延续”，不调整货架容量、建造耗时或经济数值。

原版联动组共享一份储存设置，成员并不合并成一个实体容器。普通解除或移除成员后，**剩一个成员的组也会解散**，最后成员保留当时的共享设置。卸下货架则保留原建筑对象与组关系；它和拆毁是不同生命周期。

证据入口：[SG01–SG15 静态规则](evidence/storage-groups-evidence.json)、[新增类型 manifest](evidence/storage-groups-manifest.json)、[沿用的 REA 身份记录](evidence/shelf-storage-rea-managed.json)。货架基本机制见 [111](111-shelf-storage-mechanisms.md)。本章不宣称 Web 已完成所有列出的原版行为。

## 1. 身份、来源和复核方式

| 项目 | 固定身份 |
|---|---|
| 原文件 | `F:\SteamLibrary\steamapps\common\RimWorld\Assembly-CSharp.dll` |
| Assembly SHA-256 | `eff7d97949f919fb2b151ebfb906e9be749b63410b7dbda78eeebb7972b245c3` |
| MVID | `8e962ecc-7ac7-42d2-8f3b-1b16cd24d2cd` |
| 工具 | ILSpy `ICSharpCode.Decompiler` / `11.2.0.10050` |
| 工具 SHA-256 | `587a18e18e13acfc7fd8783a44c24c7da0781dadf6b9fb9dd5e2e38a9cdfae78` |

新增派生类型为 `RimWorld.StorageGroupUtility`、`Verse.StorageGroupManager`、`RimWorld.IStorageGroupMember`、`RimWorld.Zone_Stockpile`。管理器在 **Verse** 命名空间。其他来源复用同 DLL、同工具哈希的 `shelf-storage / logistics / preservation / storyteller / furniture-reinstall / energy` 记录。

完整派生 C# 留在忽略的 `.local-research`；公开证据保存来源 manifest、文件哈希、行范围和范围内容哈希。每个 SG 条目都能定位实际文件与范围。反编译容忍未解析依赖，结果是派生重建，不是开发者原始源码。XML 只投影本专题相关字段，没有计算 Mod/DLC patch 后的 effective Def 数据库。

本机有原版与已记录工具时，在项目根执行：

```powershell
pwsh -NoProfile -File scripts/research/extract-storage-groups.ps1 -Check
pwsh -NoProfile -File scripts/research/collect-storage-groups-evidence.ps1 -Check
```

第一条重新静态提取四个类型并与保留文件、manifest 精确比较。第二条重核 DLL、工具、全部引用文件/范围和原始 XML，并重建 JSON 作精确比较。省略 `-Check` 才写入对应新证据；这两个工具都不会启动游戏或加载游戏代码执行。

## 2. 哪些东西可以联动（SG01）

原版操作入口是 `StorageGroupUtility.StorageGroupMemberGizmos`。它从当前 `SelectedObjects` 枚举中筛选：

1. 对象实现 `IStorageGroupMember`。
2. `StorageGroupTag` 与正在生成按钮的成员相同。
3. 地图相同。
4. 如果是 `Building_Storage`，储存页可见。

兼容候选少于两个时，“联动”按钮禁用。这里只证明同 tag 和同地图是此 UI 的约束；底层 `SetStorageGroup` 本身没有再次做 tag/map 校验，不能推导任意脚本或损坏存档也守住这个条件。

| 对象 | 已核对结果 |
|---|---|
| 大、小普通货架 | 都继承 `StorageShelfBase` 的 `storageGroupTag=Shelf`，尺寸不同不阻止联动 |
| 书架父类 | `BookcaseBase` 使用 `Bookcase`，不与普通 Shelf 候选混合 |
| 储存建筑蓝图 | `Blueprint_Storage` 实现成员接口，tag 来自待建建筑 |
| 施工框架 | `Frame` 实现接口，tag 来自 `BuildDef`；无 tag 时不显示储存相关 UI |
| 普通储存区 | `Zone_Stockpile` 实现储存和 SlotGroup 接口，但不实现成员接口；提供复制/粘贴设置，不进入此联动机制 |

不能把所有 `ISlotGroupParent` 都当成“可联动货架”。储存区的相同过滤规则可以来自复制粘贴，这与之后持续共享同一个组对象不同。

## 3. 联动时到底采用谁的设置（SG02–SG04）

点击联动的 action 取筛选列表的 **`tmpMembers[0]`**：

- 它已有组：使用该组和组内当前设置。
- 它尚无组：创建新组，并 `InitFrom` 它当前的有效储存设置。
- 遍历此次筛选到的成员，为它们调用 `SetStorageGroup(目标组)`。

这不是求过滤器交集、取最高优先级或平均设置。也不能直接写成“最后点击的货架为准”：本次只核对了 `SelectedObjects` 的枚举，没有证明多选顺序等于玩家点击顺序。按钮悬停代码会高亮第一个候选，可作为后续实机观察的定位点。

**迁移的单位是被选中的成员。** 例如旧组 A 有三架，玩家只选择其中一架并让它加入 B，代码不会把 A 另外两架全部迁过去。如果 A 因此只剩一个成员，A 会按正常规则自动解散。

`SetStorageGroup` 的顺序是：移除旧成员记录 → 清空成员 Group 引用 → 把旧组当前设置复制回该对象本地设置 → 加入新组 → 通知设置变化。同一个非空组的重复设置直接跳过，避免重复加入。此 helper 正常脱组保留当前组规则，不回滚到最初联动前的旧规则。

`Building_Storage / Blueprint_Storage / Frame` 在有组时都直接返回组的 `StorageSettings`。修改不是逐架同步副本；它们读取同一个设置对象。`CopyFrom` 复制优先级和过滤允许项，包含物品定义、特殊过滤器、耐久范围、品质范围等；不会复制独立建筑名称、占地或物品实体。

组的父级固定限制取 `members[0].ParentStoreSettings`。普通同 tag 的货架以相同父级限制工作；不能据此假定强行把不同限制的 Mod 建筑塞入一个组也会正确取交集。

## 4. 解除、单成员与空组（SG05、SG06）

`StorageGroup.RemoveMember` 成功删除成员后，默认通知地图的 `StorageGroupManager`。管理器在 **`MemberCount <= 1`** 时：

1. 对剩余成员调用 `SetStorageGroup(null)`，保存当前组规则。
2. 从地图管理器中移除该组。

因此二人组解除一个，另一个也变为独立储存；三人组解除一个，剩下两个继续共享。不要用“仅在零成员时回收组”代替原版正常操作的规则。

`removeIfEmpty:false` 是生命周期转移时跳过管理器回收的参数，名字不能代表实际默认阈值只有零。`NewGroup` 可以暂时创建空组，而读取存档后的 `PostLoadInit` 只清除 null 成员，没有显式调用自动解散。上述规则不能扩张成“任何损坏/旧存档都不会出现单成员组”。

显式 **Unlink UI** 另有分支：它保存当前组设置、移除成员、清空 Group，然后只对 `Building_Storage` 执行本地 `settings.CopyFrom`。派生结果没有对蓝图、Frame 做同样复制，也没有统一调用通用 helper。因此已完成建筑的脱组保留规则有直接依据；蓝图/框架手动解除及多选按钮分发仍需实机实验，不能以 helper 的正确性代替 UI 分支证据。

## 5. 修改规则如何影响搬运（SG07）

组内共享过滤设置变化会通知各 `ISlotGroupParent`，已有建筑会通知 `listerHaulables` 刷新对应 SlotGroup。组优先级修改还会刷新搬运目的地优先级、组内格子和搬运来源。复刻中只改 UI 文本而不让搬运查询读新规则，会出现“面板一致、居民仍按旧规则搬运”的错误。

`HeldThings / CellsList` 只聚合实际实现 `ISlotGroupParent` 的成员；蓝图和 Frame 的成员身份不代表已经提供可用容量。库存仍是各地图格中的物品，联动不瞬移物资，不新增格子、容量或额外副本。组内优先级相同也不意味着货架会为了更近而相互搬空；普通储存优先级规则仍见 111。

## 6. 卸下、重新安装和跨地图（SG08、SG09）

卸下链是 `MakeMinified → DeSpawnOrDeselect → InnerThing = 原建筑`。`Building_Storage.DeSpawn` 没有脱组操作，因而打包后原建筑仍是同一个组成员；它只是暂时不在地图上提供货架占格。`AllSlotCells` 对未 Spawned 建筑直接结束，不能因组成员数量仍在就继续给旧位置计算可用容量。

重装蓝图取回同一个 `ThingToInstall`，先清空包装的 `InnerThing` 再销毁空包装，返回原建筑供生成。因此同地图重装延续其设置与组关系。组内其他架在它打包期间修改共享规则时，它仍读取该组当前规则；这是这些代码路径组合后的静态结论，打包期间改规则的实机交互另需观察。

跨地图安装时，`Building_Storage.SpawnSetup` 检查实际新地图与 `storageGroup.Map`：不同则移除原组关系，并把组当前规则复制到本体。此处是**建筑重新生成时**的条件；不能写成“包装一跨地图立即脱组”，本次没有追踪旅行、交易、出售等所有运输入口。

包装存档深存其内部容器，原建筑自身仍存本地 settings、storageGroup 引用、独立 label。货架中的松散物资仍不随包装走，详见 111。

## 7. 拆毁、自动重建和施工转换（SG10、SG11、SG15）

| 事件 | 已核对的静态路径 |
|---|---|
| 普通建筑销毁/拆除 | `Building_Storage.Destroy` 在 base 调用后移除组成员，清空 Group；可能触发剩一人组解散 |
| 蓝图取消/销毁 | `Blueprint_Storage.Destroy` 在 base 调用前移除成员并清空 Group |
| 包装销毁 | 包装销毁其 `InnerThing`，因此原建筑销毁清理适用；普通重装已先将 InnerThing 清空，不会误销毁建筑 |
| 蓝图变 Frame | 先将 Frame 加入旧组、复制有效规则，再对旧蓝图 `SetStorageGroup(null, false)` |
| Frame 完工 | 先让新建筑接组并复制本地设置，再对旧 Frame `SetStorageGroup(null, false)` |
| 被毁后的自动重建 | base `Building.Destroy` 可先创建并联动新蓝图，之后派生类才移除旧建筑 |

自动重建要求开启 autoRebuild、`KillFinalize`、玩家阵营、存在 blueprintDef、已完成研究、位于家区且允许放置蓝图。成功替代时组人数未必净减少，所以“任何损毁都直接删组关系且不再继承”不完整。正常拆除不会因为这个分支获得自动重建。

失败施工和 Frame 的异常销毁尚不能宣称完整闭环：当前派生 `Frame.Destroy` 未出现与普通建筑一致的显式移除旧 Frame 调用；`FailConstruction` 先直接赋新蓝图 Group，再调用同组 `SetStorageGroup`。这是需要追踪的具体异常边界，不据局部代码直接宣称实机必然有 bug，也不应复制为 Web 的悬空引用行为。

## 8. 名称、存档、选择与显示（SG12–SG14）

组身份是 `loadID`，引用键为 `StorageGroup_<id>`；组显示名 `label` 与建筑自身 `label` 独立。改名不应更换成员关联 ID，也不应批量改所有架子的独立名字。

默认名生成器尝试“基础名 1”到“基础名 1000”，避免与当前地图的区域名、储存建筑名、现有组名冲突；耗尽时记录错误并返回基础名加 `X`。这只证明自动命名策略，没有证明手动改名一定禁止重名。

存档层级：地图深存 `storageGroups` → 管理器深存 `groups` → 每组保存 `loadID / label / map引用 / members引用 / settings`。建筑、蓝图、Frame 另存各自组引用与本地设置。组成员字段还保留旧名 `buildings` 的 LoadAlias。载入后清除 null 成员，只能证明这一种清理，不能证明任意重复成员、跨图引用、单成员残组都有自动修复。

“选择所有联动”遍历组成员，跳过已选对象或已毁 Thing。显示连接括号则看 `DrawConnectionOverlay`：完成建筑要求 Spawned，蓝图为 true，Frame 要有 tag。面板人数来自全体成员计数，不能把该人数直接当作当前地图可用货架/容量数。

此外，派生的 `AlreadyLinked` 判断循环读取的是生成 gizmo 的 `member.Group`，不是每个枚举出的 `storageGroupMember.Group`。因此混合已联动/未联动对象的按钮禁用行为还需独立实机观察，不能只按理想化判断写成“所有对象已属于同组才禁用”。

## 9. Web 实现应保持的机制与当前未知项

以下是从静态规则导出的实现要求，不是完成声明：

- 明确联动来源，并对兼容成员执行迁移；默认不带走未选择的旧组成员。
- 所有过滤、优先级与搬运查询读取同一有效设置；脱组保存当前规则，组剩一人时解散。
- 已安装建筑、包装中的同一建筑、重装计划应有可追踪的同一生命周期；拆除才移除，不因普通卸下消失。
- 蓝图、施工、成品的替换保持组 ID；取消、失败、销毁后不遗留无效成员。
- 存档同时覆盖组身份/名称/设置和成员关系；老存档无组时仍按原有独立储存规则工作。
- 成员列表、选择全部、组名称与独立建筑信息可见；人数、容量、库存分别计算。

目前静态已回答：来源选择、兼容筛选、共享对象、正常迁移与脱组、单成员回收、同地图卸装、跨图生成、正常毁坏/自动重建、成功施工转换、名称与序列化结构。尚未由本章实机证明：多选顺序与按钮合并分发、蓝图/Frame 手动解除、混合组禁用逻辑、失败/取消 Frame 的完整清理、跨地图运输时机、损坏存档修复和 Mod 特殊成员。

主线程的原版实机结果应独立保留动作、截图、原始存档哈希与结构化投影；如与这里的静态推导不同，应据实际路径收窄或修正结论。不要把此前单个货架的搬运、卸装实测挪用成多成员联动验证。
