# 通用物品禁止 / 允许：机制与实现边界

更新：2026-11-04。目标为 RimWorld **1.7.4980 rev60**。本页依据匹配程序集的静态派生代码；**v45 没有完成原版玩法实测**。用户要求“后续暂时不要运行程序来交互了”后，停止所有新运行、输入和截图。准备过程及验证缺口见 [134](134-native-item-forbidden-runtime.md)。

## 证据身份

- `F:/SteamLibrary/steamapps/common/RimWorld/Assembly-CSharp.dll`，SHA-256 `eff7d97949f919fb2b151ebfb906e9be749b63410b7dbda78eeebb7972b245c3`。
- 复用 [REA 托管元数据](evidence/production-bills-rea-managed.json)：`ev_41acdc3a1d6904fb12e36eeaac20397afac130d300dafc70973a154cd3fbfd84`，父证据 `ev_ebbdfc84b2bb4bc3fff131fd667e539f7c75c3d78c0491481455a7751b3a5337`。仅用于匹配二进制身份，不把元数据检查称为反编译或运行。
- 本轮用同一 ILSpy 引擎静态重建 **36 个类型**：[提取清单](evidence/item-forbidden-manifest.json)、[机制锚点与有界检查](evidence/item-forbidden-mechanisms.json)。派生 C# 留在忽略目录 `.local-research/item-forbidden/`；不是原始源码，没有加载或执行目标程序集。

## 旗标与允许区域如何组合

`CompForbiddable` 持有每个 Thing 自己的 `forbiddenInt`。保存键为 `forbidden`，读取缺省值是 `false`；Def 的 `forbidOnMake` 可以使新物品初始禁止，因此不能声称“所有新物品一律允许”。UI 切换会更新物品红叉，以及搬运、合堆候选列表；门另有可达性缓存刷新。

`ForbidUtility.IsForbidden(thing, pawn)` 是组合判断：居民是否遵守禁用规则、物品所在允许区域、物品对玩家阵营的旗标、Lord/仪式保留等。`IsForbidden(thing, faction)` 的通用旗标只针对玩家阵营生效。征召、精神状态、叛乱及部分特殊身份可绕过 pawn-aware 判断；因此这不是对所有生物都有效的物理锁，也不是地块不可通行规则。

物品禁止与 [允许区域](129-allowed-area-mechanisms.md) 必须分别保存。物品仍存在、占用堆叠容量并可能腐坏；不应因禁止而从世界或总库存中删除。旗标 setter 本身没有遍历并取消所有居民任务，不能仅凭它声称“所有已开始任务必在切换当帧终止”；具体任务的失败条件和玩家强制任务例外应分别处理。

## 哪些自动选择会排除禁止物

| 场景 | 静态调用链 | 行为边界 |
|---|---|---|
| 普通搬运、自动合堆 | `ListerHaulables` / `ListerMergeables` → `HaulAIUtility` | 候选登记排除禁止物；普通右键优先搬运也不会自动解除禁止 |
| 自动寻找地面食物 | `FoodUtility.BestFoodSourceOnMap` | 默认 `allowForbidden=false`；显式例外参数和特殊居民状态另算，不泛化到所有进食路径 |
| 护理选药 | `HealthAIUtility.FindBestMedicine` | 药物必须通过 `!m.IsForbidden(healer)`、护理政策及预约条件；禁药不等于一概不能无药护理 |
| 建造取料 | `WorkGiver_ConstructDeliverResources` | 材料候选检查 `th.IsForbidden(pawn)`；现有数量与可用数量是不同指标 |
| 生产/手术取料 | `WorkGiver_DoBill` | 地图材料、可访问容器材料和药品收集经过 forbidden 检查；恢复绑定未完成品也检查其禁止状态 |
| 普通优先工作 | `FloatMenuOptionProvider_WorkGivers` | 禁止目标显示不可优先；并非所有右键命令都能越过禁止 |

取消或替换任务时，Web 需要释放预约并保留已经搬起、投放的物品，避免重复扣料或物品消失。该要求属于实现一致性目标，不是本轮原版运行观察。

### 野生动物、家畜与囚犯进食

普通饥饿流程可从打包 Def 追到同一个选择器：`Animal.xml` → `SatisfyBasicNeeds` → `JobGiver_GetFood`；`Humanlike.xml` 的囚犯分支也使用 `JobGiver_GetFood`。该类型显式传 `allowForbidden:false`。差异来自 `ForbidUtility` 的执行者上下文：

| 普通地面食物选择的执行者 | 对玩家物品禁止旗标的反应 |
|---|---|
| 野生动物，非玩家阵营且无玩家 HostFaction | 不因该旗标被排除；仍检查可食、可达等条件 |
| 正常玩家家畜，无精神/特殊身份绕过 | 会排除禁止物；不能把所有动物都接到无过滤库存查询 |
| 玩家家园地图上的普通囚犯 | `HostFaction != null` 且 `Map.IsPlayerHome` 使 `CaresAboutForbidden=false`，通常不因该旗标被排除；牢房社会适当性与可达条件仍存在 |
| 居民代替动物/囚犯取料 | 依据取料者判断，不能借用被喂食者的例外 |

动物还有低频 `JobGiver_EatRandom` 好奇进食分支，其选物 validator 未显式检查 forbidden；本轮不把普通饥饿规则泛化到该分支的所有后续结果。精神状态、阵营改变、非家园 HostFaction 等也需分别审查。此表是普通选择链的静态推导，不是三类主体的原版运行对照实验。

## 直接装备、穿戴与重装的区别

**Equip 和 Wear 明确解除旗标。** `FloatMenuOptionProvider_Equip` 调用 `clickedThing.SetForbidden(false)`，`FloatMenuOptionProvider_Wear` 调用 `apparel.SetForbidden(false)`，随后才发玩家指定任务。已被接受的玩家强制任务还会设置 `ignoreForbidden`。正确复刻应把“旗标由禁止变允许”作为真实状态变化，不能只让这次操作绕过并仍显示禁止。

**Install/Reinstall 没有同样的清旗标路径。** 已检查 `Designator_Install`、`GenConstruct.PlaceBlueprintForInstall/PlaceBlueprintForReinstall` 和 `Blueprint_Install`：指定目标只是放置安装蓝图。`WorkGiver_ConstructDeliverResources.InstallJob` 仍检查源 `MiniToInstallOrBuildingToReinstall.IsForbidden(pawn)` 并拒绝禁止源物。不能把重装直接当成 Equip/Wear 例外；蓝图放置成功也不等于安装作业可执行。此处结论是静态链路检查，尚未实机验证。

## 拆分与合堆

拆分明确继承：`CompForbiddable.PostSplitOff(piece)` 把源 `forbiddenInt` 写入新块。

底层合堆由 `ThingWithComps.CanStackWith` 依次检查各 Comp 的 `AllowStackWith`，吸收前调用 `PreAbsorbStack`。`CompForbiddable` 没有覆盖这两个方法；基类分别允许和不做处理。`Thing.TryAbsorbStack` 将数量转到接收对象，不合并或重算 forbidden。因此在其余堆叠条件均满足、调用者确实执行底层吸收时，**接收堆保留自身旗标**，不能自行定义为两堆旗标的 AND/OR。

这不代表自动搬运会主动把禁止堆合并：其候选列表和作业选择先排除了禁止物。需要把“自动选不选它”和“底层吸收怎样保留数据”分开。调用者可能有另外的状态处理；本轮未运行不同来源合堆矩阵。

## 禁止库存仍可能计数、出售

默认 `RecipeWorkerCounter` 的 until-X 逻辑不以禁止旗标过滤产品。其常见快速路径读取 `ResourceCounter` 加符合条件的携带物；`ResourceCounter.ShouldCount` 检查新鲜度、迷雾等，不检查 forbidden。较完整的 `CountValidThing` 检查产品类型、污染服装、耐久、品质、材料和迷雾，也不检查 forbidden。因此满足原有计数范围的禁用成品仍可达到“做到 X 个”的目标；不能因为它不能被当前工人使用就额外生产。仓储范围、计入装备等原有设置依然有效，也不能简化成世界上所有物品都计数。

商队 `Pawn_TraderTracker.ColonyThingsWillingToBuy` 检查可售、已探索、家园或仓储位置、商人可达；`TradeUtility.PlayerSellableNow` 检查交易类别、新鲜度、死者服装、生物编码等，没有 forbidden 排除。轨道交易在通电信标覆盖范围内的物品筛选也没有该排除。**禁止不是“锁定不出售”**：在其它交易资格成立时，禁用物资仍可出售。本轮只核对普通商队/轨道路径，不宣称所有特殊交易与模组都一致。

**普通商队购回不会统一清除原旗标。** `GiveSoldThingToPlayer` 对普通物品依次 `SplitOff`、`PreTraded(PlayerBuys)`、`GenPlace.TryPlaceThing`。拆分继承源旗标；`CompForbiddable` 没有交易 hook 清除；直接生成新堆时 `GenSpawn`/`PostSpawnSetup` 也不清除。若落地时合入已有堆，则遵循接收堆保留自身旗标的规则。卖给商人时也可能先合入商人已有堆，所以不能保证“购回的某件货永远携带第一次卖出前的旗标”，但同样不能默认买入一律变允许。商人 `Lord.extraForbiddenThings.Add` 是商人群体自己的排除列表，不是玩家物品 `CompForbiddable.Forbidden`。其它交易提供者、特殊物品 Comp 与模组没有逐一穷举。

## 本阶段复刻优先级

1. 为独立物品堆保存 forbidden，提供选中信息、禁止/允许按钮及可辨标记；旧保存缺字段时使用明确兼容默认。
2. 统一自动搬运、食物、药物、建造/生产取料的可用性判断，同时保留“总数”和“可用数”的差别。
3. 明确玩家命令语义：普通优先工作仍检查禁止；Equip/Wear 解除旗标；Reinstall 仍受源物限制。
4. 处理预约释放、携带中物品、拆分继承和合堆接收者旗标，使切换、存读档、取消任务不会丢失或复制资源。
5. until-X 和出售保留原有计数/筛选范围，不擅自增加“禁止即排除”。机制链完整后再调工时、堆叠上限等数值。

上述是由静态证据约束的实现建议，不表示 Web 已实现或原版实测已通过。

## 仅静态复核

```powershell
pwsh -NoProfile -File scripts/research/extract-item-forbidden.ps1 -Check
pwsh -NoProfile -File scripts/research/collect-item-forbidden-evidence.ps1 -Check
pwsh -NoProfile -File scripts/research/collect-item-forbidden-runtime-boundary.ps1 -Check
```

第一项只静态解析 PE 并重建派生文本，第二项核对来源和机制锚点，第三项只复读中止前的已有文件；均不会启动游戏、输入、拍摄新截图或改保存。专门配方计数器、模组覆盖、所有已有作业的即时取消和原版因果场景仍未验证。
