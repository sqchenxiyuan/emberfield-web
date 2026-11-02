# 19 · 食物腐坏、冷藏、堆叠与转移

本篇针对本机 **RimWorld 1.7.4980 rev60** 的已安装程序集与 Core XML，回答食物如何计龄、温度如何影响腐坏、搬运与合堆是否重置进度，以及冷库如何通过库存规则吸引搬运。它是静态机制研究；不把解析算例当作原版实机运行结果，也不把项目中的三维实现当成原版规则的自动等价物。

当前源码与 XML 支持的核心合同是：**每堆一个累计腐坏进度；冻结只暂停增长；拆分继承进度；合并按实际转移数量平均；普通搬运继续按搬运者位置的温度计龄。** 本地简餐是 **4 天**，不能沿用其他版本或网页上的 3 天。

## 1. 身份、证据和复核边界

| 项目 | 本轮核对值 |
|---|---|
| Version.txt | `1.7.4980 rev60` |
| Assembly-CSharp.dll SHA256 | `eff7d97949f919fb2b151ebfb906e9be749b63410b7dbda78eeebb7972b245c3` |
| 已有 REA 模块 MVID | `8e962ecc-7ac7-42d2-8f3b-1b16cd24d2cd`，本轮以相同程序集哈希复核身份 |
| 静态重建工具 | `ICSharpCode.Decompiler 11.2.0.10050` |
| 工具 SHA256 | `587a18e18e13acfc7fd8783a44c24c7da0781dadf6b9fb9dd5e2e38a9cdfae78` |
| 原版 UI | 由单独研究任务采集；本篇提取、验证脚本不操作游戏窗口 |

| 文件 | 内容 |
|---|---|
| [preservation-manifest.json](evidence/preservation-manifest.json) | 20 个新选定类型的派生文件位置、行数、SHA256；完整重建仅保留在忽略目录 `.local-research/preservation/` |
| [preservation-claims.json](evidence/preservation-claims.json) | PR01–PR20；56 个代码行范围引用、19 个 XML 引用 |
| [preservation-xml.json](evidence/preservation-xml.json) | 4 个原 XML 文件、14 个节点；70 个叶值、11 个带属性节点、58 项被选根节点的明确缺失 |
| [preservation-cases.json](evidence/preservation-cases.json) | 12 个独立解析算例，120 条断言 |
| [preservation-validation.json](evidence/preservation-validation.json) | 原 DLL/版本/XML、25 个派生文件、所选继承链与算例核验结果 |

另外复用已记录的 `environment:Verse.GenTemperature`、`energy:Verse.Thing/TickList`、`food:Verse.GenRecipe/Verse.AI.Toils_Recipe`。引用行号只对相应 manifest 的派生哈希有效。工具容许未解析依赖；重建 C# 不是作者原始源码。XML 收集的是指定直接声明和必要父节点，不执行启用 DLC、Mod、Harmony 或 XML patch 的有效 Def 数据库。

## 2. 时间、进度与温度函数

来源 PR01–PR03、PR12；`CompRottable`、`CompProperties_Rottable`、`GenTemperature.RotRateAtTemperature`。

令 `p` 为这一堆物品的累计腐坏进度，单位是“正常腐坏速率下的原版游戏 tick”。一次实际更新为：

```text
r(T) = 0          T < 0°C
       T / 10     0°C ≤ T < 10°C
       1          T ≥ 10°C

p_new = p_old + r(当前环境温度) × delta
开始腐坏阈值 = RoundToInt(daysToRotStart × 60000)
```

0°C 的结果同样为 0；10°C、25°C、100°C 在这个函数中的腐坏速率都是 1。这个函数没有“每升高十度再翻倍”的高温段，也不读取“冷库区域”标签。

`CompRottable` 默认 `daysToRotStart=2`、`daysToDessicated=999`、`rotDestroys=false`、腐烂伤害参数 40。这些是类默认值，必须结合具体食物 Def；不能把默认 2 天套给简餐或农作物。

进度保存为浮点字段 `rotProg`，并保存 `disabled`。同一堆只有一个进度，没有每单位食材的年龄数组，也不是墙钟日期。冻结不会减小进度：已经在正常温度放置 2 天的食物，冻一个月再拿出来，仍从 2 天年龄继续。

`Active` 除 `disabled` 外还处理 `disableIfHatcher`：对尚未温度损伤的孵化器组件可以停用腐坏。这是特定物品规则，不是所有食物的默认逻辑。

### 2.1 实际调度

这些农产品继承 `OrganicProductBase` 的 `tickerType=Rare`；简餐和包装口粮继承 `MealBaseIngredientless` 的 Rare。地图 Rare 调度间隔为 **250 原版 tick**，`CompTickRare()` 向腐坏逻辑传入 250；Normal 组件入口则传实际 `delta`。

在 Rare 更新时，源码用**当前温度乘整个 250 tick 区间**，不会逐帧回溯途中经过的各个温度。稳定温度下连续算例与离散增量一致；搬运途中频繁跨冷热房间时，精确结果会受更新时间相位影响。项目若每 tick 按当前位置累加，是有意采用更细的采样，不能宣称复现了原版逐 tick 位级结果。

### 2.2 阈值和整堆销毁

`Stage` 判断顺序为：

1. `p < TicksToRotStart`：Fresh。
2. 否则 `p < TicksToDessicated`：Rotting。
3. 否则：Dessicated。

一次腐坏更新后，**`Stage == Rotting && rotDestroys`** 执行 `parent.Destroy()`。选定的稻米、土豆、玉米和简餐都启用此字段；正常更新越过首个阈值后整堆消失，不是每次删一个单位。底层 Destroy 会通知持有容器、清除非 pawn 的 `stackCount`；容器调度也清理已销毁内容。

原版的精确分支不是无条件 `p>=阈值`。对手工构造的超过 999 天进度，Stage 已成为 Dessicated，走另一条伤害逻辑；普通食物会在首个阈值附近销毁，通常到不了这个状态。本项目只实现正常食物保鲜时，可用首阈值判整堆损失，同时把这个简化写清楚。

库存腐坏提示还要求 `IsInAnyStorage()` 与自身或父对象已在地图上。提示条件不影响食物是否腐坏。尸体、腐臭气体、每日腐烂伤害不属于当前食物实现范围。

## 3. 五种食物的本地数值与父链

来源 PR13–PR15。表中“天数”是**新鲜、稳定 10°C 或以上**的基准寿命；实际已经累计的年龄需要扣除。

| 食物 | Def | 基准寿命 | 稳定 5°C 从新鲜开始 | 堆叠上限 | 到阈值 |
|---|---|---:|---:|---:|---|
| 稻米 | RawRice | 40 天 | 80 天 | 75 | 整堆销毁 |
| 土豆 | RawPotatoes | 30 天 | 60 天 | 75 | 整堆销毁 |
| 玉米 | RawCorn | 60 天 | 120 天 | 75 | 整堆销毁 |
| 简餐 | MealSimple | **4 天** | 8 天 | 10 | 整堆销毁 |
| 包装生存口粮 | MealSurvivalPack | 无 Rottable 组件 | 不适用 | 10 | 不因该机制腐坏 |

农作物链为 `具体作物 → PlantFoodRawBase → OrganicProductBase → ResourceBase`。三种作物分别直接声明 Rottable 的 40/30/60 天与 `rotDestroys=true`；ResourceBase 声明上限 75。

简餐链为 `MealSimple → MealCooked → MealCookedIngredientless → MealBaseIngredientless`。**4 天**和 `rotDestroys=true` 来自 MealCookedIngredientless；上限 10、Rare 来自 MealBaseIngredientless。

包装口粮走 `MealSurvivalPack → MealBase → MealBaseIngredientless`，不经过 MealCookedIngredientless。这里已检查整条所选父链的 `comps`，没有 Rottable；不能仅凭子 Def 没写该组件就下“不腐坏”的结论。

包装口粮直接声明 `DeteriorationRate=0.25`。这是室外耐久损耗的参数，与食物的温度腐坏进度不同；本篇不把它换算成未经核对的“每天实际损失多少耐久”。原版“不腐坏”也不能翻译成“任何环境永不损坏”。

## 4. 合并、拆分与转移

来源 PR05–PR07。

设接收堆已有 `nA` 个、进度 `pA`；被转移的 `k` 个来自进度为 `pB` 的 donor：

```text
k = min(donorCount, stackLimit − receiverCount)  // respectStackLimit=true
p_receiver = (nA × pA + k × pB) / (nA + k)
```

`ThingWithComps.TryAbsorbStack` 先计算实际转移量，再调用组件的 `PreAbsorbStack`，随后底层才改数量。因此分母中的 `parent.stackCount` 是**合并前接收数量**。不能在增加数量后再次套这个公式。

剩下没搬走的 donor 保持原进度；只按实际转移的 `k` 加权。比如 70 份 1 天龄稻米，吸收 20 份 3 天龄稻米中的 5 份补到上限：新堆年龄 `(70×1+5×3)/75=1.133333 天`，剩余 15 份仍为 3 天龄。加权总“数量×年龄”守恒，虽然各堆的到期时点改变。

部分拆分先创建新 Thing，再由 `PostSplitOff` 把源进度原样赋给新堆。整堆移走返回原对象。背包、携带、容器之间的转移最终经 SplitOff/TryAdd 和合并路径，不会因为换容器重新变新鲜。

### 4.1 哪些东西能合堆

底层要求两个对象存活、属于物品、不是 relic，并且 **Def 与 Stuff 相同**；组件还可进一步禁止合并。CompRottable 自己没有重写 `AllowStackWith`，所以年龄不同本身不是它的禁合条件。

RawRice、RawPotatoes、RawCorn 是不同 Def。项目即便将三者放在统一 `grain` 资源总量中，实体堆与搬运记录仍需要保存作物身份；不同作物不能因为同叫“生食材”就共享一次年龄平均。餐食的原料成分组件也可能限制合堆；本篇只确认基础身份与腐坏组件规则，没有宣称任意同名餐都能合并。

## 5. 搬运、背包、容器的温度与 tick

来源 PR08–PR11。

`Thing.AmbientTemperature` 的优先顺序：

1. 物品已 Spawned：自己的地图格温度。
2. 否则沿 ParentHolder 查询固定温度；有匹配就返回。
3. 自身或某层父对象在地图上：`PositionHeld / MapHeld` 的温度。
4. 有有效世界地图 tile：该 tile 的温度。
5. 都没有：21°C 兜底。

因此普通搬运中的农产品和背包里的简餐，跟随 pawn 所处的房间或室外温度。给库存区命名“冷库”、提高优先级、允许食材，都不会自动改变这里读到的温度。

### 5.1 确认存在的固定 14°C 例外

`ThingOwnerUtility.TryGetFixedTemperature` 对下列持有者有明确分支：

- Pawn_InventoryTracker 中**带 CompHatcher** 的物品。
- CompLaunchable、ActiveTransporterInfo、TravellingTransporters、CompTransporter。
- Settlement_TraderTracker、TradeShip。

第一条不是“所有放进背包的食物都 14°C”。以上也不是所有可能 Mod 容器的穷举。

### 5.2 容器物品确实会更新

这个安装版本由 `Thing.DoTick` 枚举子持有者；Pawn 的 `GetChildHolders` 包含 inventory 与 carryTracker；各 `ThingOwner.DoTick` 再调用其物品的 `DoTick`。未 Spawned 的 Rare 食物依旧经过 `IsHashIntervalTick(250)` 门控，不能把“容器每 tick 被访问”误写成“每 tick 增加 250 腐坏进度”。

单看 `CarryHandsTickInterval` 或 `InventoryTrackerTick` 看不到腐坏调用，不能据此断言携带食品不会腐坏。实际入口在通用 Thing 持有者递归链。

`dontTickContents`、`IThingHolderTickable.ShouldTickContents`、冷冻睡眠舱或 `ISuspendableThingHolder` 可以阻止内容更新；Rottable 的 Active 又有自己的开关。这些属于暂停或特殊容器机制，与 0°C 冻结应分别建模。

## 6. 烹饪与配送中的年龄

来源 PR06、PR16，以及既有 [12 食物生产](12-farming-cooking-food.md)。

搬到工作点仍是物理原料 Thing；SplitOff、携带与放下不是刷新年龄事件。`Toils_Recipe.CalculateIngredients` 从 `job.placedThings` 取得整个或拆分后的原料对象。完成普通配方时，先调用 GenRecipe 生成产品，再 ConsumeIngredients。

普通 `recipe.products` 路径经 ThingMaker 创建新对象；其 CompIngredients 登记原料 Def，没有把原料的 RotProgress 复制到成品。CompRottable 新实例的浮点进度为 0，且本类没有 recipe-produced 的进度继承重写。因此**本次所查简餐新产品从新鲜开始**。这不等于任意特殊配方、DLC 生物或 Mod 产品都如此。

若项目把灶台待用料抽象为 `job.delivered` 数量而不保留物理堆，应补上作物身份与腐坏进度，并按工作点温度更新。这是对本项目数据模型的建议，不是原版同名字段的转录。原料到期要撤销对应配送、预留与配方可完成性，不能只从地面物资栏删数量。

## 7. 冷库库存区的优先级与允许规则

来源 PR17–PR19。

库存优先级枚举从低到高是 `Unstored=0, Low=1, Normal=2, Preferred=3, Important=4, Critical=5`。普通“寻找更好储存格”要求目标**严格高于当前优先级**。所以一堆已在 Normal 普通仓库里的食物，不会仅因为另一个 Normal 仓库更冷就被此规则自动搬走。

候选还需通过区域/父库存的允许过滤、可用空间、可达性、预留、火灾与阻挡等检查。这个选址链没有温度权重。距离比较结合区域候选顺序与提前结束，不应宣称严格遍历所有格得到全局最短路。

`StorageSettings.AllowedToAccept` 同时服从自身 ThingFilter 和父库存设置。ThingFilter 可检查允许的 Def、配置的耐久百分比/品质以及被禁止的特殊分类。**库存允许接收食材**与**烹饪账单允许使用食材**是不同设置；现有配方研究见 12。

Fresh 与 Rotten 特殊过滤器也有边界：Fresh 可以匹配无 Rottable 的非药物可食用物；Rotten 只匹配有 Rottable、不是 `rotDestroys`、且已离开 Fresh 的物品。普通会直接消失的食物不进入长期“腐烂原料仓库”。这些过滤器没有“剩余寿命少于 X 小时”或自动先进先出的数值规则。

## 8. 界面读数与真实增长可不同

来源 PR20。

腐坏增量直接读未经取整的 AmbientTemperature；检查面板与 `TicksUntilRotAtCurrentTemp` 先把温度 RoundToInt，再估算倒计时。比如实际 0.4°C：真实速率为 0.04，面板可能按 0°C 显示“冷冻”。9.6°C 则可能显示为正常未冷藏，真实速率仍为 0.96。

Inactive 或速率为 0 的倒计时接口返回 `72000000` tick 哨兵，不是说冷冻食品实际在 1200 天后自动坏掉。解释截图时应区分界面近似与原始进度公式。

## 9. 对三维项目的最小实现合同

以下是建议，不属于对原版三维规则的声称；原版并没有本项目的 z 层体素房间。

- 使用当前房间系统计算食物实体位置的温度；地上、搬运与配送材料均有明确位置来源。
- 持久化每堆作物身份与累计进度。合并、拆分、携带、读档都保留该信息。
- 若项目一天为 12000 tick，可将进度也定义为项目 tick：每 tick 增长 `r(T)`，阈值分别为 **480000 / 360000 / 720000 / 48000**，依次对应稻米/土豆/玉米/简餐。这样保留游戏日寿命，不能直接拷贝原版 240000 简餐阈值。
- 高温腐坏速率封顶为 1；冷藏减速，冻结停表。不要用“在库存区”直接判永久保鲜。
- 构造测试分别覆盖温度变化、到期整堆损失、数量守恒、部分转移、任务原料失效、存读档及搬运过冷热房间。解析算例只检查研究模型，项目还需独立集成测试。
- 任何首次上线时缩短寿命以加速展示、给已有存档补默认新鲜进度、把所有容器统一实际室温、采用每 tick 连续采样或最老食材优先，都要显式登记为适配或迁移策略。

## 10. 复现命令与结果

从项目目录执行，工具与游戏位置使用本机实际路径；提取器会拒绝不同的程序集或反编译库哈希。

```powershell
./scripts/research/extract-preservation.ps1 `
  -GameRoot 'F:/SteamLibrary/steamapps/common/RimWorld' `
  -DecompilerPath '../../tools/ilspy/lib/netstandard2.0/ICSharpCode.Decompiler.dll'

./scripts/research/collect-preservation-xml.ps1 `
  -GameRoot 'F:/SteamLibrary/steamapps/common/RimWorld'

./scripts/research/verify-preservation-evidence.ps1 `
  -GameRoot 'F:/SteamLibrary/steamapps/common/RimWorld'

node scripts/research/verify-preservation-evidence.mjs
node scripts/research/verify-preservation-evidence.mjs --local
node scripts/research/test-preservation-verifier.mjs
```

Node 便携验证器检查元数据、来源范围、所选父链、数值绑定与 12 个解析模型；`--local` 再核对 25 个派生文件 SHA256。PowerShell 验证器读取原版 DLL/Version/XML，核对节点、叶值、组件 Class 属性及明确缺失项，然后调用 local 验证。两者都不执行原版类，也不读写游戏存档或推进原版游戏时间。

提取脚本对复用的 5 个派生类型优先核对已有哈希；缺失时只重建所需文件并要求匹配既有 manifest，不改写其他研究组的公开 manifest。验证器另通过 **19 种破坏拒绝检查**，包括错误游戏/工具哈希、越界行号、XML 继承循环、错误食物寿命、删减算例分支及篡改派生文件；测试在 `test-results/preservation-verifier-negative/` 的独立副本上执行。

UI 观察可另附证据，但定义面板、冻结标签或一张食物截图不能证明完整腐坏动态、搬运积分或所有 Mod 的行为。完整反编译文件和原游戏素材不公开复制进文档。
