# 活畜交易：真实个体、商队归属与繁殖状态延续

这一轮补齐「商队带来活畜 → 查看个体 → 买入并饲养 → 繁殖/产出 → 出售真实动物 → 跟随商队离开」的机制依据。优先确定对象身份、交易资格、派系与任务转换，以及繁殖状态跨交易的延续；价格与供给数量留作后续平衡参数。

## 证据范围与复查

- 本地原版：`F:/SteamLibrary/steamapps/common/RimWorld`，`1.7.4980 rev60`。
- `Assembly-CSharp.dll` SHA-256：`eff7d97949f919fb2b151ebfb906e9be749b63410b7dbda78eeebb7972b245c3`。
- REA 只复用该精确哈希的受管程序集身份：[production-bills-rea-managed.json](evidence/production-bills-rea-managed.json)。本轮用 ILSpy `11.2.0.10050` 重新提取 45 个类型；只加载反编译器读取目标元数据/CIL，不加载或执行游戏程序集。
- [live-animal-trade-manifest.json](evidence/live-animal-trade-manifest.json) 记录派生类型和引擎哈希；[live-animal-trade-mechanisms.json](evidence/live-animal-trade-mechanisms.json) 记录代码锚点、限定方法范围的缺失核对与 Core XML 投影。
- 派生 C# 保留在被忽略的 `.local-research/live-animal-trade/`。不发布完整派生代码、原版程序集或美术资源。
- 全程静态检查，没有启动原版、浏览器、预览、GUI 输入或截图。派生代码不是原作者源码或运行时证明；未重建所有 DLC/MOD patch 后的完整 Def 数据库。

```powershell
pwsh -NoProfile -File scripts/research/extract-live-animal-trade.ps1 -Check
pwsh -NoProfile -File scripts/research/collect-live-animal-trade-evidence.ps1 -Check
```

提取检查会重新生成类型文本并比对既有副本及 manifest；收集检查会验证身份、代码、XML 与投影。新环境缺少被忽略的副本时，先运行不带 `-Check` 的提取命令。重建新投影与验证旧投影是两件事。

## 货单中的动物就是地图上的动物

`PawnGroupKindWorker_Trader` 从 TraderStock 得到货物。动物等 Pawn 货物被赋予商队派系，加入实际到访 `outPawns`；普通物品放进承运者库存。`IncidentWorker_TraderCaravanArrival` 把到场 Pawn 列表交给 `LordJob_TradeWithColony` 管理。

`Pawn_TraderTracker.Goods` 从 Lord 的 `ownedPawns` 读取：

| 角色 | 报价来源 |
|---|---|
| `Carrier` | 承运者库存中的物品 |
| `Chattel` | 这个 Pawn 本身，排除已售奴隶名单 |
| 商人、护卫 | 不作为可购买动物本体 |

角色判断顺序也很关键：`packAnimal && inventory.Any` 先得到 Carrier，然后普通 Animal 得到 Chattel。不能仅凭“羊驼/单峰驼是驮兽”就永久排除其交易；空库存驮兽也可能落入 Chattel 分支。

`Tradeable_Pawn` 只是引用这些真实 Pawn 的交易行。外观相同的动物可以合并显示数量，但成交仍逐个选取真实对象；不能把它们转为只有物种和数量的 Cargo，再在成交时新造一只。

## Bulk / Exotic 的供给与收购

Core 文件：`Data/Core/Defs/TraderKindDefs/TraderKinds_Caravan_Outlander.xml`。

| 参数 | BulkGoods | Exotic |
|---|---|---|
| 供给标签 `tradeTagsSell` | AnimalFarm | AnimalUncommon、AnimalFighter、AnimalFarm、AnimalPet |
| 额外收购标签 `tradeTagsBuy` | AnimalExotic | AnimalExotic |
| `countRange` | 3–4 只，总量 | 1–3 只，总量 |
| `kindCountRange` | 1 | 3 |
| 创建异性对标签 | AnimalFarm | AnimalFarm |
| 最大野性 | 0.70 | 默认 1 |
| 气温检查 | 默认启用 | 默认启用 |

`GenerateThings` 先抽总量。若总量大于 1，尝试先造同种一雌一雄，**从总量扣掉 2**。然后另建一个物种候选列表，最多按 `kindCountRange` 抽取不同物种，再将剩余只数分配到列表。因此 `3 kinds × 1–3 each` 是错误解释；配对物种也没有自动放入剩余列表，Bulk 的“1”不保证全批只有一种动物。

供给候选必须是 Animal，满足野性范围、种族允许商人出售、供给标签匹配及当地季节/室外温度条件。低野性权重较大。若玩家在任意地图、世界商队或运输途中已有同 kind、处于 reproductive 阶段的一雄一雌，该物种的配对供给权重乘 0.5；此检查不要求同圈、同地图，也不直接检查绝育或是否能相遇。

### 标签方向不要误用

`StockGenerator_Animals.TradeabilityFor` 确实返回定向的 Buyable / Sellable / All 描述，但本轮检查的实际 UI/成交链是：

```text
TradeUI → Tradeable.TraderWillTrade → TraderKindDef.WillTrade
        → StockGenerator.HandlesThingDef
```

动物生成器的 `HandlesThingDef` 接受 **sell 或 buy 任一标签**；交易数量上下限取双方实际库存。检查过的 UI、候选加入与成交方法未额外调用 `TradeabilityFor`。因此不能仅凭 Bulk 的 buy 标签只有 AnimalExotic，就声称 Bulk 不收购 Chicken/Alpaca/Dromedary；这些物种已经被 AnimalFarm 的 sell 标签覆盖。这里不声称 `TradeabilityFor` 在整个游戏中没有其它调用者。

按当前 Core 声明，Web 已支持的五种动物对应如下。表中“可”仍受个体出售资格、温度和真实库存影响，并不保证每队都带来：

| 物种 | 贸易标签 | 野性 | Bulk 生成/收购 | Exotic 生成/收购 |
|---|---|---:|---|---|
| 野兔 Hare | AnimalCommon，来自 BaseHare | .75 | 否 / 否 | 否 / 否 |
| 鹿 Deer | AnimalCommon | .75 | 否 / 否 | 否 / 否 |
| 羊驼 Alpaca | AnimalCommon、AnimalFarm | .25 | 可 / 可 | 可 / 可 |
| 单峰驼 Dromedary | AnimalCommon、AnimalFarm | .25 | 可 / 可 | 可 / 可 |
| 鸡 Chicken | AnimalCommon、AnimalFarm | 0 | 可 / 可 | 可 / 可 |

两类商人的额外 `StockGenerator_BuyExpensiveSimple` 明确只接受 Item，不会因为鹿价格高就收购活鹿。表只覆盖上述两类 Outlander 商人及所核对的 Core 定义，不能推广为“所有商人都不买鹿”。

## 性别、年龄与“配对”的含义

配对请求固定 Female / Male，没有固定生物年龄，也没有在这个分支把年龄强制设为繁殖成体。年龄由 PawnGenerator 与种族/PawnKind 规则决定。`DevelopmentalStage.Adult` 也不能直接等同动物的 reproductive 成体：AnimalBaby/AnimalJuvenile 未覆写该字段，仍使用类默认 Adult。

这不意味着普通新供给一定能出现幼体。没有种族年龄曲线时，新生成普通动物从默认曲线抽寿命比例，曲线范围从 `0.05 × lifeExpectancy` 开始。Chicken 寿命 6 年，普通新造年龄约从 0.3 年开始，高于其成体阈值 0.2 年；Alpaca 的 0.75 年和 Dromedary 的 2.25 年也高于各自约 0.3333 年阈值。当前三种 Farm 的普通新造供给由这条默认路径得到成体，而非配对分支直接写入成体。

生成请求允许复用世界 Pawn，并有健康/可倒地/关系等条件；本轮不把新造年龄曲线推成所有复用对象的完整保证。Web 可以先固定成年异性对帮助建立繁殖玩法，但应标为供给设计选择，并保留真实 age/sex 字段以便后续扩展。

## 玩家动物何时可以出售

出售资格由多层共同决定：

1. Def 允许玩家出售，抽象市场价值大于零。
2. `AllSellableColonyPawns` 取地图上 spawned、玩家派系的 Animal，要求 HostFaction 为空、未精神失常、未倒地、当地季节与室外温度合适。
3. `PlayerSellableNow` 额外排除正在组建玩家远行商队的动物，以及特定原籍/托管派系与购买者关系情形。
4. 地图商人必须有 Lord，动物必须能从商人位置以 `Touch / PassDoors / Danger.Some` 到达。
5. `TradeDeal.InSellablePosition` 再检查已生成于地图、未被战争迷雾覆盖，以及半径 6.9 格同房间内对象是否禁止附近出售。
6. 商人对应的 `WillTrade` 接受该种族，且交易货币/数量有效。

动物分支**不要求位于 Home 或库存区**；那些条件属于地面 Item 分支。它也没有直接以圈地指派、允许区域、绑定、怀孕、挤奶/剪毛/产蛋进度作为拒绝理由。圈墙与门仍会影响真实到达条件，不能因此把“无 Home 要求”写成“无视地形”。温度是当地季节和室外条件，并非只检查动物当前站的室内格温。

绑定、具名、受伤或可见怀孕会影响交易行能否合并。`TransferableUtility.CanStack` 在这些情形返回 false，意味着显示独立行，**不是禁止出售**。出售绑定动物还会触发关系/心情后果，不能静默当成普通数字减一。

## 买入、卖出与控制状态切换

地图商队买入的链路：`Tradeable_Pawn → GiveSoldThingToPlayer(原 Pawn) → PreTraded(PlayerBuys) → SetFaction(player)`，并移出旧 Lord。该分支不会重新生成、传送到仓库或把动物变成搬运货物；它留在当前地图位置，之后由玩家动物行为继续接管。

卖出链路：原 Pawn 执行 `PreTraded(PlayerSells)`，临时解除派系，再由 `AddPawnToStock` 赋予商队派系、加入 Lord。通常原地转换归属。仅不在地图上的对象才走 AddPawnToStock 的备用 spawn 分支，而普通地图售卖资格本已要求 spawned。

| 保留/改变 | 机制 |
|---|---|
| 保留个体 | Pawn 引用、种族、性别、生物年龄、身体健康与疾病/妊娠仍属于同一对象 |
| 保留生产组件 | 交易/转派代码未重新生成 CompEggLayer 等生物生产组件；不应把进度清零来造新动物 |
| 清掉旧控制 | 旧路径、工作、心智控制、地图标记、目的地预约等在转派与 ClearMind 链中清理 |
| 解除关系性指派 | PreTraded 取消床等 ownership；转派清允许区域、断绳、清手术账单，并更新医疗护理设置 |
| 所有权后果 | 出售会执行 PawnSold 关系通知；符合相关关系条件时解除 Bond 并给关联角色出售记忆 |
| 买入驯化 | 加入玩家会完成 Tameness，并更新漫游冷却 |
| 携带物 | spawned 或由地图 holder 持有的交易 Pawn 先 DropAndForbidEverything，不保证把所有随身库存一并“赠送” |

因此“保留个体状态”不能理解成原样保留所有任务、医疗计划、床位、绳索或绑定。Web 应把持续生物状态与旧阵营控制状态分开处理。

## 离场、出生与蛋的归属

出售后动物加入 Lord，离场阶段的 Chattel 获得 Escort 等 duty，随商人走向地图出口。商人离场与每只动物实际到边缘是不同事件；不应在点击成交或领队离场时直接抹掉仍被困在围栏内的动物。本轮提取证明了原版离场 duty 路径，没有运行原版封闭围栏实验，不能保证所有困住场景的最终恢复策略。

已有妊娠的动物可以继续生育。`Hediff_Pregnant.DoBirthSpawn` 用母体**分娩当时的派系**生成幼体；地图母体存在 Lord 时执行 `mother.GetLord()?.AddPawn(pawn)`。所以孕体卖给商队后在地图上分娩，新生儿随母体归商队并加入该 Lord；不是默认属于玩家或野生。胎生还保留亲子关系，并尝试继承允许区域。

蛋生需要单独建模：

- `CompEggLayer.ProduceEgg` 把产蛋当时母体派系写进 `hatcheeFaction`，并保存父母引用。
- 孵化使用蛋上保存的派系。母鸡后来改变派系不会自动重写已经产下的蛋；交易那颗蛋自身才调用 Hatcher 的交易 hook，买入设玩家派系、卖出设购买方派系。
- `CompHatcher.Hatch` 生成幼体并建立亲子关系，但本轮核对的地图孵化路径**没有调用母体 GetLord/AddPawn**。它与胎生自动入队不同。

因此商队鸡产下的地面蛋可能孵出同派系幼体，却不能仅凭派系相同就认定已成为商队货单或获得离场 duty。Web 尚未支持这个归属链时，暂缓商队实际下蛋、继续保留母鸡生产进度，是明确的功能边界；不能悄悄把它们孵成 wild/colony 或声称这与原版一致。商队是否主动寻找配偶也应单列为实现范围，不能与“已有妊娠能分娩”混为一项。

## 价格依赖先建立，平衡后调整

当前数值只作为原版参照：Hare 50、Deer 250、Alpaca 350、Dromedary 300、Chicken 50。幼体/幼年/成体的 life-stage 市场系数为 .4 / .75 / 1；Chicken 的 AnimalBabyTiny 继承 .4。

个体市场价值不是 `物种基础价 × 健康百分比` 的单一公式。`StatWorker_MarketValue` 先应用 PawnQualityPriceFactor，再加 PawnQualityPriceOffset；前者包含健康总百分比、各能力、生命阶段，以及存在时的技能/特质/美貌；后者包含声明影响价格的 hediff 或移除后产物价值。普通 Pawn 的 `useHitPoints=false`，不能再把普通物品耐久因子叠加一次。

买价与卖价又使用不同全局倍率（1.4 / .6）、商人价格类型、议价、难度及适用的 SellPriceFactor 等；普通非活畜特定折扣不应照搬。`AnimalProductsSellImprovement` 的条件明确是 Leather / Meat / Wool，**不包含活畜，也不包含蛋**。缓存卖价不会高于对应买价。

第一版可用物种基价、生命阶段、已有健康模型和统一买卖报价模块近似，先确保：逐只可追溯、买卖方向正确、货币与物品交易合并结算、报价与实际对象匹配。怀孕、亲缘与生产进度需要保留，但本轮没有发现它们在 PriceUtility 中独立的直接乘数，不应随意加“孕体翻倍价”并归因于原版。

## 保存与交易渠道边界

Pawn 保存性别，深度保存 ageTracker、health、training、playerSettings 等；CompEggLayer 保存生产进度，Hatcher 保存蛋派系；Lord 保存 ownedPawns 的引用。Web 也应保存真实动物与 `caravan.animalIds` 的对应关系，加载时清理缺失/重复引用，避免一次买卖重复生成或删除同一只。

上面的原地转派专指**地图上的商队交易**。`TradeShip` 买入后通过 drop pod 送到地图；世界 Settlement 买入把 Pawn 加入玩家 world caravan，卖出动物进入结算点 stock holder。不能用这些路径为地面商队发明即时送货。

Web 实现记录应另行说明：有限三种 Farm 的供给池、固定种子/入门配对、简化健康报价、商队繁殖与产蛋范围、围栏困住后的等待机制。原版机制证据与可玩的适配版本分开记录，便于后续扩展而不需要先校准全部数值。
