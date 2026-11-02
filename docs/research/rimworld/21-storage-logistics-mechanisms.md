# 普通地面仓位、堆叠与搬运机制

本章将有限仓储的原版规则拆成物品上限、单格堆数、手持数量、作业预留和落地处理五层。普通地面通常每格一堆；货架容量来自建筑定义，不能把货架的三堆套给地面。原版静态证据与本项目的三维适配分别说明。

本章衔接 [01 工作与物流](01-work-and-logistics.md) 和 [19 保鲜机制](19-preservation-mechanisms.md)。证据编号为 `RW17-LOGISTICS`，逐项定位见 [logistics-claims.json](evidence/logistics-claims.json)。本章不使用原版窗口实验作为自身验证结论；UI 观测应由独立运行记录交叉对照。

## 1. 样本和证据边界

| 项目 | 本次样本 |
| --- | --- |
| 本地目录 | `F:\SteamLibrary\steamapps\common\RimWorld` |
| Version.txt | `1.7.4980 rev60` |
| Assembly-CSharp.dll SHA256 | `eff7d97949f919fb2b151ebfb906e9be749b63410b7dbda78eeebb7972b245c3` |
| 已有 REA MVID | `8e962ecc-7ac7-42d2-8f3b-1b16cd24d2cd`，复用既有身份记录 |
| 派生引擎 | `ICSharpCode.Decompiler 11.2.0.10050` |
| 引擎 SHA256 | `587a18e18e13acfc7fd8783a44c24c7da0781dadf6b9fb9dd5e2e38a9cdfae78` |
| 派生文本 | `.local-research/logistics/`，UTF-8 无 BOM / LF；忽略目录，不分发完整反编译文本 |
| 本次范围 | Core 相关 XML、8 个新提取类型、14 个既有类型 |

反编译结果是当前二进制的派生重建，不是原始源码。验证器读取原始 DLL 身份与 XML，并检查派生文件摘要；不加载或执行游戏类，不评价所有 DLC/Mod 补丁，也不证明原版所有异常分支都能在正常游玩中出现。

## 2. 七种项目资源的对应和上限

这里的“75 件”是 `stackCount`，不是 75 kg。下表“基线手持”以**已求值的 `CarryingCapacity=75`、空手、兼容物品、足够源数量**为前提。

| 项目资源 | 原版对应 | 单堆上限 | 基线手持上限 | 关键来源 |
| --- | --- | ---: | ---: | --- |
| `wood` 木材 | `WoodLog` | 75 | 75 | `WoodLog → ResourceVerbBase → ResourceBase` |
| `stone` 抽象石材块 | `BlocksGranite` | 75 | 75 | `BlocksGranite → StoneBlocksBase → ResourceBase` |
| `steel` 钢材 | `Steel` | 75 | 75 | `Steel → ResourceBase` |
| `components` 零件 | `ComponentIndustrial` | 50 | 50 | 该 Def 显式 `stackLimit=50` |
| `food` 包装生存口粮 | `MealSurvivalPack` | 10 | 10 | `MealSurvivalPack → MealBase → MealBaseIngredientless` |
| `grain` 生食材 | `RawRice` / `RawPotatoes` / `RawCorn` | 各 75 | 各 75 | 各自继承至 `ResourceBase` |
| `meal` 简餐 | `MealSimple` | 10 | 10 | `MealSimple → MealCooked → MealCookedIngredientless → MealBaseIngredientless` |

来源 LG01–LG05。XML 快照保留完整选中父链、`stackLimit` 与 `smallVolume` 的明确缺省，不通过中文名称猜测资源类型。

**`stone` 的范围决定：**本轮将其定义为对应 `BlocksGranite` 的抽象可用建材块。当前项目挖花岗岩体素直接产 5 石材，尚未实现“采出的岩块 → 切石台 → 石砖”。原版 `ChunkGranite` 继承 `ChunkBase.stackLimit=1`，并声明 `butcherProducts/BlocksGranite=20`；`BlocksGranite` 才继承 75。因此：

- 不把岩块的上限 1 用到当前抽象建材。
- 不把原版“每块岩块加工产 20 石砖”写成当前“每个矿格产 20”。本章没有证明每次开采都必掉一块岩块。
- 后续若补原版资源加工链，应新增独立岩块物品、加工配方及仓储筛选，再迁移旧石材语义。

`grain` 只是项目的汇总资源名。稻米、土豆、玉米必须保留 `crop` 身份；不同原版 Def 不能合堆。同一类型不同腐败进度可按实际转移件数加权，拆分保留进度，详见 19 章。

## 3. 手持搬运如何计算

`Pawn_CarryTracker` 使用 `oneStackOnly: true` 的容器。核心数量关系为：

```text
VolumePerUnit = smallVolume ? 0.1 : 1
MaxStackSpaceEver = min(stackLimit, RoundToInt(CarryingCapacity / VolumePerUnit))
AvailableStackSpace = MaxStackSpaceEver - 已手持件数
实际取走数量 = min(Job 剩余需求, AvailableStackSpace, 源堆件数)
```

来源 LG04–LG06。所选七种资源的完整父链均没有设置 `smallVolume`，所以单位体积使用默认 1。物品 `Mass` 没有参与这个手持上限公式；例如木材质量声明 0.4、花岗岩砖 1.25、工业零件 0.6，不会据此把 75 石砖手持上限改成 60 或套用商队负重。

`CarryingCapacity` StatDef 基础值是 75、下限 1；有 `StatPart_BodySize`，另有 `Manipulation` 容量因子、权重 1。体型 stat part 会乘以实际体型；受伤、年龄或其他 stat 变化后的最终值不能一概写成 75。本章没有实现整个 StatWorker 计算器，案例输入的是已求值容量，也刻意避开 Unity 四舍五入中恰好 `.5` 的边界。

取走一部分源堆后，`StartCarryThing` 会把作业目标转成手持物；若不把余量排回队列，且仍持有源堆预留，可释放源余量的预留。手持数量、源堆数量和作业剩余需求是三个独立字段，不应一次性把整堆从账本删除。

## 4. 普通地面的“一个仓位”

`GridsUtility.GetMaxItemsAllowedInCell` 返回建筑的 `MaxItemsInCell`，没有建筑时返回 1。`GetItemCount` 每遇到一个 `ThingCategory.Item` 对象就加 1，统计的是堆数；地上的 75 木材仍只占一堆。

`Building.MaxItemsInCell` 读取 `def.building.maxItemsInCell`；Core 的 `ShelfBase` 直接声明 3。该值属于货架基类的声明，本次没有解析完整家具继承或所有特殊容器。地面仓储区本身不会让没有建筑的格子获得 3 堆容量。来源 LG07。

正常仓储判定 `NoStorageBlockersIn`：

1. 若格内存在可储存、`CanStackWith` 且未满的同类堆，记录可合堆。
2. 不可站立的建造目标、没有可用表面的阻挡物等会拒绝；货架多物品格的处理有专门条件。
3. 若没有可合堆对象，且当前堆数已经达到格容量，拒绝。

这意味着已有 70 木材的普通地格还可收 5 木材，但不能再收钢材；满 75 木材时也不能再插入第二堆木材。此处“同类”不能只看 `resource` 字符串：原版基础规则要求相同 Def/Stuff、未销毁、Item、不是遗物，`ThingComp.AllowStackWith` 还可额外拒绝。来源 LG08。

`GetItemStackSpaceLeftFor` 的数量估算为：

```text
同 Def 的所有未满件数
  + max(格子堆数容量 - 当前 Item 堆数, 0) × 该 Def 的 stackLimit
```

例如两堆已占用的三堆货架格，其中 70 木材与一堆钢材，再放木材的估算容量为 `5 + 75 = 80`。普通地格里只有 70 木材时容量是 5。该辅助方法按 Def 估算，不能替代完整 `CanStackWith` 检查。来源 LG09。

## 5. 满仓、预留与搬运数量

自动 `HaulToStorageJob` 先找更高优先级的可接受目的地，找不到就不创建这项搬运作业。`IsGoodStoreCell` 检查仓位阻挡、可预留、禁区、静态火、妨碍施工，以及从物品/搬运者位置到目的地的可达性。

标准 `JobDriver_HaulToCell.TryMakePreToilReservations` 先预留 B 目的地格，再预留 A 源物品，两次均使用 `maxPawns=1, stackCount=-1`。`ReservationManager` 对格子视作总量 1，`-1` 表示整个目标可用量；对普通源堆也是整堆预留。其他受尊重的同层预留会阻止第二人竞争。

这套预留属于**格子/目标独占**。通用 ReservationManager 虽支持显式数量与多名额，不能据此声称普通 HaulToCell 已为未来到货建立“剩余容量按件分配”的账本。来源 LG10。

原版搬运数量也不总等于单个目标格的空余：`HaulToCellStorageJob(...fitInStoreCell:false)` 可汇总同一槽组或储存组多个有效格子的容量，随后由取物阶段按手持上限和源数量截断。因而可一次带来 75 木材，先给目标格补 5，再继续放另外 70；若整个可用组仅剩 5 空间，数量估算可限制本次取 5。来源 LG11。

本项目若按“可达剩余容量”预留每个目的地并在派单时扣除承诺容量，这是明确的适配。至少需要保障：

- 预约只影响调度可用量，不能提前增加实际仓库库存。
- 取货/落地前重验源数量、品种、目的地接受规则与实际空位。
- 取消、失败、改道时释放相应预约，手持余量仍计入实物总量。
- 不可达格、已满格、拒收品种不能作为虚拟容量；货物不得跨堵路直接入账。

这些是项目实现验收条件，本章的静态验证结果不代表对应 TypeScript 行为已经通过测试。

## 6. 放置成功、部分成功与邻近溢出

### Direct

`GenPlace.TryPlaceThing(...Direct)` 委托 `TryPlaceDirect`。它先按现有堆件数从大到小尝试兼容合堆，再计算还剩多少个 Item 槽位；每个新堆不超过该 Def 的 `stackLimit`。

**返回 false 不等于没有修改任何数据。**已有 70 木材，尝试放 20：先合入 5 成为 75，余量 15 尚未落地，因此返回 false。空普通地格尝试放 160 木材：可先分出 75 落地，留下 85，再返回 false。调用者不能因为 false 又补回原来的完整 20 或 160，否则会复制资源。来源 LG12。

`ThingOwner.TryDrop` 只有在 `GenDrop` 返回 true 后才移除原容器物；失败时余量仍在容器，已合入或分出的部分不回滚。因此要核对守恒式：

```text
转移前源数量 + 目标数量 = 转移后源余量 + 目标数量
```

来源 LG14。此式针对正常转移分支，不掩盖下文原版明确存在的销毁兜底。

底层 Direct 对 `stackLimit<=1` 有“无槽仍尝试一个槽”的特殊分支；它不是普通仓储许可。调用者仍需仓位检查，且底层 `GenSpawn` 可能搬开现有物。不能用这个特殊分支证明岩块等能无限重叠存储。

### Near

Near 分层检查中心附近前 9 个径向格、半径 3、半径 12.9 范围，根据生成条件、额外验证器、合堆机会、房间、通路和物体阻挡评价地点。找到格后调用 Direct；若只转移了一部分且源件数改变，再次寻找地方处理余量。

这不是无限搜索全图，也不保证按简单八方向 BFS 放置。合堆与位置质量会影响候选选择；`extraValidator` 属于该候选筛选流程，不能把 Direct 当成同样执行全部筛选的仓储入口。来源 LG13。

### 正常搬运落地后的续搬

`PlaceHauledThingInCell` 在 Direct 不完全成功后，通常用余量再找储存格，更新目标并跳回搬运步骤；没有仓储可用时尝试 `HaulAside`。如果连旁置地点都找不到，当前二进制有日志警告并 `Destroy` 手持物的极端兜底。来源 LG15。

原版 `GenSpawn.Spawn` 也不是无损仓储 API：运行地图中把 Item 强行生成到满格时，可能取出格内一个 Item，尝试 Near 移开，失败则销毁它。`ThingGrid` 本身只登记格内对象列表，仓储容量并非由列表容器自动保证。来源 LG18。

本项目建议在无处可放时保留源堆/手持余量并显示阻塞原因，后续扩大仓位或解除阻挡后再重试。若采用此策略，应说明这是有意保留资源的适配，不能宣称与原版异常处理逐分支一致。

## 7. 优先级变更与运行中的作业

原版枚举为 `Unstored=0, Low=1, Normal=2, Preferred=3, Important=4, Critical=5`。自动寻找“更好仓储”使用严格大于当前优先级，不会仅因为同级仓库更近或更冷就重新搬运；组内使用距离筛选与提前退出，不能宣称每次全局最短路径最优。来源 LG16。

`StorageSettings.Priority` 修改后会通知目的地管理器重新排序，并重新计算相关可搬运列表。运输途中，去源物品以及携带去目的地的指定检查会调用 `IsValidStorageFor`：验证仓储组、接受过滤和仓位阻挡，没有比较“新优先级是否仍是最优”。

所以仅凭这条调用链，不能承诺一改优先级所有在途搬运者立刻改道。改为拒收该物品、仓位被占满或仓储区消失，则会使这类目的地有效性检查失败。其他作业中断机制还可能产生不同结果。来源 LG17。

本项目现有四档优先级需要按语义映射，不要直接与原版六值枚举按整数互换。若主动取消旧预约并重选更高档仓位，可作为明确的交互适配；应验证不会重复落地、丢失货物或留下过期预约。

## 8. 独立验证与复现

验证包括元数据、已选 XML 父链、对应派生文件摘要和独立算术/分支模型。没有调用原版游戏类，也没有导入项目物流实现当成期望值。

| 项目 | 结果 |
| --- | --- |
| 主张 | 18 条，39 处派生代码引用，24 处 XML 引用 |
| 派生覆盖 | 新提取 8 类型 + 复用 14 类型；本地 22 文件摘要/行数通过 |
| XML | 9 文件、23 节点、60 叶值、1 属性节点、64 明确缺省根 |
| 独立案例 | 11 组、103 个结果断言通过 |
| 负向验证 | 23 项错误样本全部被拒绝 |

案例包含七资源及岩块上限、体积/质量区别、剩余手持空间、地面/货架格容量、部分合并、溢出守恒、阻挡、独占预留、严格优先级、在途目的地失效和石材映射。

负向验证使用忽略目录中的独立副本，覆盖版本/引擎身份、来源行号、路径越界、继承断裂/循环、零件/岩块上限误写、把货架容量套给地面、修改搬运基础值、丢失体型属性、篡改派生文本等。它不改变游戏、正式证据或实现文件。

在本项目目录执行：

```powershell
# 重新提取本轮类型；既有引用按已记录 SHA 复用或重建，不覆盖旧组 manifest。
./scripts/research/extract-logistics.ps1 `
  -GameRoot 'F:/SteamLibrary/steamapps/common/RimWorld' `
  -DecompilerPath '../../tools/ilspy/lib/netstandard2.0/ICSharpCode.Decompiler.dll'

# 如需有意识更新所选原始声明，先确认版本一致，再重建快照。
./scripts/research/collect-logistics-xml.ps1 -GameRoot 'F:/SteamLibrary/steamapps/common/RimWorld'

# 不需要原版安装的公开证据/独立模型验证。
node scripts/research/verify-logistics-evidence.mjs

# 核对本地完整派生文件；无需启动原版。
node scripts/research/verify-logistics-evidence.mjs --local

# 同时复核原始 DLL、Version.txt、原始 XML 和所有本地派生文件。
./scripts/research/verify-logistics-evidence.ps1 -GameRoot 'F:/SteamLibrary/steamapps/common/RimWorld'

# 验证错误证据会被拒绝。
node scripts/research/test-logistics-verifier.mjs
```

固定的主张/案例数据由 `scripts/research/write-logistics-evidence.mjs` 生成；期望值为人工审阅的固定值，与验证器模型独立。重写数据后仍需运行验证器，不应把生成过程当作验收。

验证摘要见 [logistics-validation.json](evidence/logistics-validation.json)；具体输入与边界见 [logistics-cases.json](evidence/logistics-cases.json)。Near 的三维候选顺序、完整寻路、所有组件合堆限制、手持容量全 StatWorker，以及极端无处可放的原版实际观测仍不在本章验证范围内。
