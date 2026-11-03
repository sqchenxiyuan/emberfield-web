# 66. 陆行商队、双向贸易与赠礼：原版静态机制

本章依据本机 **RimWorld 1.7.4980 rev60** 的 Core XML 与 `Assembly-CSharp.dll`，补充第 [04 章](04-wealth-storyteller-trade.md)、第 [63 章](63-storyteller-wealth-mechanisms.md) 的贸易闭环。目标是让商人真实入场、殖民者接近交谈、物品和银币发生转移、商队最终离场，并使价格、拒收原因与存档行为可解释。

本章没有运行原版、没有操作原版 UI，也没有把独立模型测试当成原版运行证据。完整反编译仅保存在被忽略的 `.local-research/trade/`；公开 evidence 是身份、类型/行区间哈希、选定 Def 字段、结论与算例，不发布完整派生代码、原生资源或存档。

## 1. 来源、覆盖与结论等级

| 项目 | 核对结果 |
|---|---|
| 原版安装 | `F:/SteamLibrary/steamapps/common/RimWorld` |
| 版本 | `1.7.4980 rev60` |
| Assembly SHA-256 | `eff7d97949f919fb2b151ebfb906e9be749b63410b7dbda78eeebb7972b245c3` |
| PE/CLI 元数据 | 复用 [REA 身份证据](evidence/artifact-identity.json)：现代 .NET，目标 `.NETCoreApp v10.0`，不能称 Unity Mono |
| 派生工具 | ILSpy `11.2.0.10050`；工具 SHA `587a18e18e13acfc7fd8783a44c24c7da0781dadf6b9fb9dd5e2e38a9cdfae78` |
| 静态覆盖 | 50 个新派生类型、17 个复用类型；113 个代码区间引用、60 个 XML 记录引用 |
| Def 覆盖 | 30 个原始 XML 文件、124 条声明，所有选定 XML ParentName 链和物品类别祖先闭合 |
| 目录范围 | 28 个物品 Def、2 类 Outlander 商人、11 个商队 PawnKind，另取技能、难度、叙事和事件声明 |
| 独立检查 | 176 个算例、456 个算术断言、646 个结构/估值断言、22 个篡改检查、53 个公式变异 |

代码与数据来源记录在 [trade-manifest](evidence/trade-manifest.json)、[trade-xml](evidence/trade-xml.json)、[trade-data](evidence/trade-data.json)。22 条结论 `TR01–TR22` 的来源区间见 [trade-claims](evidence/trade-claims.json)，手工预期见 [trade-cases](evidence/trade-cases.json)，本机复核结果见 [trade-validation](evidence/trade-validation.json)。REA 保留身份为 `ev_107c63f87f74870b8dc7c9c2205fec8ed587133e8dc9701a85c5682d8aa43cea`，其完整父记录为 `ev_002f7c6a8e7e5c16296ff1beb7f5dc6ac1cc486e52a65155a913c3753871a42b`。

XML 采集器保留 `MayRequire`、`Inherit`、未声明字段与原始行位置；**不加载 DLC/Mod patch，也不是通用 Def 加载器**。`Mercenary_Slasher` 存在含同名 defName 的抽象父声明，采集器把抽象节点按 `Name=MercenarySlasherBase` 标识，具体 Def 按 defName 标识，避免重复名字误取父节点。类别祖先是 `ThingCategoryDef/parent`，与 XML `ParentName` 分别闭合。

## 2. 成交价：市场价之外的第二层计算

来源：`TR01–TR03`，`TradeUtility.GetPricePlayerBuy/GetPricePlayerSell`、`Tradeable.InitPriceDataIfNeeded`。

令：

- `V`：当前实物的 `MarketValue`，已经包含材质、品质、耐久和市场价最终取整。
- `g`：谈判者 `TradePriceImprovement`。
- `s`：商人的 `TradePriceImprovementOffsetForPlayer`；地图 Pawn 商人是 0。
- `L`：难度贸易损耗。
- `Tb/Ts`：商人买入/卖出报价类型倍率。
- `J/H`：加入身份与人类交易因子；普通物资均 1。
- `F`：物品 `SellPriceFactor`；武器为 0.20，选定衣物和一般资源为 1。
- `D/A`：非医疗药物、动物产品专属卖价奖励；当前项目均无此系统。

```text
rawBuy  = V × 1.4 × Tb × J × (1 + L) × (1 − g − s)
rawSell = V × 0.6 × Ts × F × H × (1 − L) × (1 + g + s + D + A)

buy  = max(rawBuy,  0.5)
sell = max(rawSell, 0.01)
若某一侧价格严格大于 99.5：该侧使用 Mathf.Round 取整
最后：sell = min(sell, buy)
```

不能先封顶卖价再取整。不能把每个小额单价都取为整数。`Mathf.Round/RoundToInt` 是中点取偶：100.5→100，101.5→102，2.5→2，3.5→4；本章独立算例用双精度算术与同一取整规则，不声称复现原生 float32 在所有临界输入的最后一位。

Silver 单独分支直接用 `BaseMarketValue`：买卖价格都是 1，不套 1.4/0.6、难度或谈判。Silver `stackLimit=500`、`useHitPoints=false`、`healthAffectsPrice=false`、单枚质量 0.008。商人内部库存允许超过物品堆叠上限；地面放置/合堆应遵守实际堆叠规则。

`TraderKindDef.PriceTypeFor` 只在玩家买入时遍历发生器并取**首个**匹配项，卖出返回 Normal。类型表为 VeryCheap 0.4、Cheap 0.7、Normal 1、Expensive 2、Exorbitant 5；这两类商人选定物资正常为 1。Royalty 恩典货币走 `RoyalFavorValue`，不属于银币闭环。

| 原版难度 | Peaceful | Easy | Medium | Rough | Hard | Extreme |
|---|---:|---:|---:|---:|---:|---:|
| `tradePriceFactorLoss` | 0 | 0 | 0 | 0 | 0.10 | 0.20 |

市场价计算沿用第 63 章：品质倍率有增益封顶；耐久曲线是 `(0,0),(.5,.1),(.6,.5),(.9,1)`，不是线性 HP 百分比；最终市场价超过 200 才按 5 取整。先得到 `V` 后再算贸易价。尸体穿过衣物即使仍有财富价值，也被可售资格拒绝。

## 3. Social、说话和听力如何影响报价

来源：`TR02`，`Stats_Pawns_Social.xml`、`PawnCapacityFactor`、`StatWorker`。

没有装备、特性、基因、灵感等额外 modifier 时：

```text
t = min(1, Talking / 0.95)
h = min(1, Hearing / 0.80)
g = clamp(0.015 × Social × (0.1 + 0.9t) × (0.1 + 0.9h)
          + leaderOffset, 0, 0.395)
```

能力实际非负；通用源码对 `C<1` 使用 `InverseLerp(0,1−allowedDefect,C)`，然后 `max=1`；两个 factor 各通过 `Lerp(value,value×factor,.9)` 顺序作用。因此 95% Talking 和 80% Hearing 已不降价，100% 以上也不会继续加成。

Social 8、健康时 `g=.12`；Talking=.475、Hearing=.4 时两个乘数都是 .55，`g=.0363`。两项能力都为 0 时，公式因 .1 保底仍可能非零；这是报价数学，不代表这样的角色必然有可执行交谈入口。`Social.TotallyDisabled` 会被普通交易菜单拒绝。

玩家派系领袖在 StatPart 再加 .02，已包含在 `g` 内，不能额外再加一次。原版还有泛用 Stat modifier；项目若只实现 Social 与身体能力，应明确这是当前范围。

`NegotiationAbility` 是另一项 Stat：基底 `(0.4+.075×Social)`，同样经过能力因子且最低 .4。**本章追到的交易/赠礼提交链没有再乘它**；不能仅因该 Stat 描述提到赠礼就额外改好感公式。

| 实物、健康 Social 8 | 市场价 V | 买价 | 卖价 |
|---|---:|---:|---:|
| 木材，仅示范价格；这两种商人不收 | 1.2 | 1.4784 | 0.8064 |
| 普通满耐久左轮 | 135.4 | 167 | 18.19776 |
| 普通满耐久冲锋手枪，普通难度 | 220 | 271 | 29.568 |
| 同一冲锋手枪，Hard | 220 | 298 | 26.6112 |
| 银币 | 1 | 1 | 1 |

## 4. 什么可以卖：资格、位置、类别是三道检查

来源：`TR06–TR08`。

1. **物品本身**：`tradeability` 允许玩家卖，抽象市场价>0；Item/Pawn/可搬运建筑才可能进入。当前腐烂、不新鲜、尸衣、biocoded 等拒绝；Pawn 另有阵营、囚犯、动物状态例外。
2. **普通地图陆行位置**：物品已 Spawned、非 fog，位于 Home 区或任一 storage，且商人以 Touch / PassDoors / Danger.Some 可达。附近 6.9 格、同 Room 内若有阻止出售物品的对象，还会被 TradeDeal 拒绝。
3. **商人经营范围**：至少一个 `stockGenerator.HandlesThingDef` 接受该 Def。交易界面即使列出不收物品，也禁用其数量控件；赠礼模式同样检查。

`forbidden` 不在这条过滤链中，所以家园区内“禁止搬运”的银币也能卖/支付。Home 外但处于 storage 的物资也能卖。搬运中 cargo、殖民者背包、穿戴衣物和已装备武器未 Spawned，不能在普通地图陆行交易里直接卖；先放到可交易位置。书柜、基因库和装备展示架有专门容器例外，不能由此推断所有容器都有效。世界地图 Caravan 交易另有路径，本章不把它与地图陆行混用。

下表是**所选两种 Outlander 商人**对项目相关物品的接受矩阵。✓ 表示满足物品/位置前提时可卖；与是否生成在本次库存中无关。

| Def / 项目类别 | 杂货 BulkGoods | 战斗 CombatSupplier | 关键原因 |
|---|---:|---:|---|
| Silver | 自动差额 / 可赠 | 自动差额 / 可赠 | 两者都有 Silver 发生器 |
| Steel | ✓ | — | Bulk SingleDef |
| ComponentIndustrial | ✓ | ✓ | Bulk SingleDef；两者 BuyExpensiveSimple |
| Cloth | ✓ | — | SingleDef / Textiles |
| RawRice / RawPotatoes / RawCorn | ✓ | — | FoodRaw 后代 |
| MealSurvivalPack | ✓ | ✓ | 值24，满足昂贵普通物资条件 |
| WoodLog | — | — | 两者没有匹配经营范围 |
| BlocksGranite | — | — | `Buyable`：商人可卖、玩家不可卖 |
| MealSimple | — | — | 同样 `Buyable`，不能被≥15条件重新开放 |
| ChunkGranite | — | — | `None` 且市场价0 |
| MedicineHerbal | — | — | 两者没有对应发生器；昂贵物资发生器排 Medicine |
| 普通帽/衬衫/裤/派克大衣/防尘外套 | ✓ | — | Clothing + BasicClothing |
| SimpleHelmet / PlateArmor | ✓ | ✓ | **Clothing + Armor**，不能假设 Bulk 不收护甲 |
| 木棒/匕首/长剑/短弓/左轮/冲锋手枪 | — | ✓ | WeaponsMelee / WeaponRanged |
| MedicineIndustrial，仅原版扩展参考 | — | ✓ | Combat SingleDef；当前项目未建工业药资源 |

`BuyExpensiveSimple` 的门槛是 `Def.BaseMarketValue / Def.VolumePerUnit >= 15`，排除武器、衣物、药品、药物以及 `genericMarketSellable=false`。小体积物品的 VolumePerUnit=.1，否则1。它只负责收购、不生成商品。不得把“不出售简餐/石砖”改写成“该物品完全无价值”。

## 5. 库存不是一个无限商店

来源：`TR09–TR11`。本次到访只生成一次有限物资，卖出的东西进入商队持有库存，之后重新交谈能看到状态变化；商人银币也有限。

| 发生器 | 原版数量/选择方式 |
|---|---|
| SingleDef，只配置 countRange | IntRange 两端包含；例如750..1200 |
| 只配置 totalPriceRange | `RoundToInt(randomTotalPrice / Def.BaseMarketValue)` |
| countRange + totalPriceRange | 最多101次试抽count，仍不满足预算则使用最后一次 |
| 两个 range 都未配置或最大值≤0 | 0，不生成 |
| Category | 先抽需要几种 Def，再在符合类别/科技等条件的 Def 中均匀无放回选择 |
| MiscItems / MarketValue | 重复次数由countRange决定；每次可再次选同一 Def |
| MarketValue 权重 | 线性曲线 `(0,1),(500,.5),(1500,.2),(5000,.1)`，输入抽象 `Def.BaseMarketValue` |
| 非正 count | `TryMakeForStockSingle` 返回 null |

Category / Tag 的“愿不愿意买”和“会不会随机生成”不是同一方法：范围未配置的发生器仍可能扩大收购范围。Tag 的排除/科技处理细节也不能自动推成全局过滤器；独立模型仅为本章选定普通物品建立闭合判断，不是通用 StockGenerator 解释器。

两类商人的当前相关库存：

| 类型 | 原版产生规则 |
|---|---|
| Bulk | Silver750..1200，Components30..40，Steel250..400，Cloth250..400 |
| Bulk 食物 | FoodRaw 选3种，每种总价格预算150..600；原版候选含其它生食，本项目只保留稻米/土豆/玉米属于缩减 |
| Bulk 衣物 | BasicClothing发生器7次 + Clothing发生器3次；五种普通衣物都属于BasicClothing，包括parka/duster；两种护甲还属于Clothing |
| Combat | Silver750..1200，MedicineIndustrial10..20；未实现工业药时不能偷偷换成herb |
| Combat 装备 | WeaponRanged5次；WeaponsMelee选6种，每种1；Armor5次 |

原版另有药物、书、家具、动物、技术蓝图、DLC物品等发生器。本项目选池不足6种近战时，原版 Category 型流程会在候选耗尽后停止；可出现3种各1件，不能重复补足成6件而仍称原版规则。

`Def.BaseMarketValue` 是没有指定材质的抽象价。源码对 costStuffCount 默认每单位估2银币，而成交时要按实际木/钢/布计价。发生器权重的输入应区分：

| Def | 抽象价 | 固定项目材质实际价格与此相同？ |
|---|---:|---|
| Tuque / BasicShirt / Pants | 44.32 / 85.76 / 85.76 | 否，实际布制更低 |
| Parka / Duster | 188.8 / 196 | 否 |
| SimpleHelmet / PlateArmor | 91.52 / 475 | 否，实际钢制更低 |
| ShortBow / Revolver / MachinePistol | 44.64 / 135.4 / 220 | 当前固定配方相同 |
| Club / Knife / LongSword | 84.32 / 66.48 / 265 | 不同；近战Category选择本就不使用市场权重 |

材料允许集由 `GenStuff.AllowedStuffsFor` 与 commonality 控制。限定本项目固定材料以及删去其它商品后重归一化，都是**显式目录适配**，不是原版全目录概率或随机种子复现。

## 6. 商人物品的品质和耐久

`ThingSetMaker_TraderStock` 按发生器顺序调用 `PostGeneratedForTrader`；`ThingWithComps` 继续通知各 Comp，`CompQuality` 使用：

```text
quality = truncate(clamp(Gaussian(mean=2.5, stddev=1), 2, 5))
2=Normal，3=Good，4=Excellent，5=Masterwork
```

因此商人随机生成的普通品质物品下限 Normal、上限 Masterwork，不会按本公式生成 Awful/Poor/Legendary。无 CompQuality 的木棒不应获得虚构品质加价。货物默认 `startingHpRange=1`，生成时满 HP；这是商品规则，**商人/护卫身上的自用装备**按 PawnKind 的 gearHealthRange、itemQuality 另算。

单次原版 Gaussian 随机算法、调用顺序与项目 PRNG不同；即使分布公式相同，也不能声称同seed同一批货。品质、材质和 HP 必须随每个实物身份保存，不能购买时再抽一次，也不能通过重复开关窗口刷新。

## 7. 单据、银币和原子性边界

来源：`TR04–TR05`、`TR12–TR14`。

普通单据中正数量买入、负数量卖出：

```text
net = Σ(buyCount×buyUnitPrice) − Σ(sellCount×sellUnitPrice)
silverToColony = −RoundToInt(net)
```

不是先把各行取整，也不是两边各自取整。买5件单价.5、净额2.5时扣2银币；买7件是3.5扣4银币。以物换物只需支付净差额，所以不能先要求玩家支付全部买入总额。

- 玩家可交易银币不足：原版闪烁银币行、拒绝，未执行ResolveTrade。
- 商人银币不足：原版显示 `ConfirmTraderShortFunds`；明确确认后，只支付其现有银币，**商品仍全部转移**，差额不是欠款。
- 赠礼：不自动生成银币差额，银币可作为普通礼物行指定数量。
- 重置/模式切换：重建单据，不能保留旧选择偷偷执行。
- 取消：不执行交易；打开窗口 `forcePause=true`，关闭没有专门恢复/更改速度的代码，不应把临时窗口暂停等同于玩家真实暂停设置。

原版 `TradeDeal.TryExecute` 是“先做部分检查，再逐行ResolveTrade”，**不是数据库式跨行回滚事务**。`Pawn_TraderTracker` 的放置/合并错误路径会日志甚至Destroy物品；不能因为方法名是TryExecute就承诺任意异常全部回滚。

项目应在一次命令中重新核对session、商人状态、位置、物品ID/数量、报价、双边资金和放置条件，形成计划后一次提交。任一预检查失败保持物品、银币、好感、收据不变。这是本项目可靠性保证，原版静态证据不能代替对应实现测试。

买入实物在原持有货物者附近落地，供殖民者搬运；卖出实物进入商队载畜/商人库存。不能把银币变成无形钱包，也不能把买来的装备用类型名重建而丢失实际品质/HP。商队持有物不计殖民地财富；一旦真实掉落地图，则按原版地图财富范围重新判断。

`GiveSoldThingToPlayer` 在拆分前保存货物 `PositionHeld/MapHeld`，再按 `Near` 放置，所以通常落在驮兽或商人附近，不是在谈判者脚下。它没有 `SetForbidden(false)`；`CompForbiddable.PostSplitOff` 继承原标记，该 Comp 没有交易前清标记的覆盖。成功落地后加入 `Lord.extraForbiddenThings` 是限制商队拾取，与玩家“禁止”状态不同。项目库存没有保存禁止标记、买入后统一允许使用，应标为适配。

本次审计的普通 `JobDriver_TradeWithPawn → Dialog_Trade → TradeDeal/Pawn_TraderTracker` 链没有显式 `SkillRecord.Learn`，因此不能增加按成交次数发放的 Social XP。本结论限定该审计链，不声称全游戏不存在任何相关经验来源。

原版合并Tradeable还会比较Def、材料、品质、尸衣标志、tradeNeverStack等；影响价格时HP差≥10分行。项目逐件装备报价是更严格的身份处理，应避免把同类型不同品质统一成一个单价。

## 8. 赠礼、普通贸易好感和外交

来源：`TR15`。

赠礼基础值 `B=Σ(count×实际卖价)/40`，银币单价1；同派系囚犯基础价值翻倍。使用当前派系好感 `G` 和曲线 `f(G)`：0以下为1，0..75线性下降，75以上为.25。

```text
delta=0
while B>=.25:
  delta += .25 × f(min(G+delta,100))
  B -= .25
  若delta>=200则停止
若delta<200：delta += 剩余B × f(min(G+delta,100))
结果 = truncate(min(delta,200))
```

最后不足 .25 的余额不能丢弃。不得只在初始好感上查一次曲线。例：G=-100时赠40银币基础1、得到+1；G=75时赠160银币基础4、得到+1；G=0赠40银币经过递减后不足1，截断得到0。派系最终好感另有[-100,100]范围；在100仍能送出礼物，不会凭空退回物品。

普通贸易 `Notify_PlayerTraded` 的增量是 `truncate(Σ PlayerSells行的实际价×数量 / 600)`。包含支付给商人的银币行，变量名称虽为marketValueSent，调用方传入的是实际交易价值；不应替换成物品原始市场价。

以上都是交给外交系统的**原始增量**。`TR21` 的 `Faction.TryAffectGoodwillWith` 还执行通用自然好感修正，交易、赠礼、伤害都经过它：

```text
若 natural < current 且 delta < 0，或 natural > current 且 delta > 0：
  toward = min(abs(current-natural), abs(delta))
  delta += sign(delta) × RoundToInt(.25 × toward)
baseAfter = clamp(baseGoodwill + delta, -100, 100)
effectiveAfter = min(baseAfter, 当前好感上限)
```

`RoundToInt` 仍为 ties-even。自然值0时，当前-10、原始+4最终+5；当前10、原始-6最终-8；当前-2、原始+10的额外量是Round(.5)=0，仍+10。原版自然值来自 `GoodwillSituationManager`，固定为0是项目世界简化。赠礼窗口的原始好感预估与真正关系提交应区分；算例中的gift.after假设此层不加额外量，通用层另有独立算例。

关系有状态记忆：非敌对且有效好感≤-75变敌；非盟友且≥75结盟；原敌对达到0才转中立；原盟友降到0才失盟。不能每次只按-75/75把中间范围一律改中立。永久敌对、好感上限、阵营事件与自然漂移等仍超出本轮简化外交。

普通非敌对商队成员遭玩家外力攻击时，原始惩罚为 `truncate(-1.3×min(100,DamageInfo.Amount))`。通知发生在 `Pawn_HealthTracker.PreApplyDamage`，先于护甲吸收，不能按最终掉血替代。原版有精神状态、奴隶、越狱、任务帮手等例外；仅当 `IntendedTarget` 同时敌对攻击者与商队派系（或其派系同时敌对双方）时，交叉火力免此扣分。一般误伤并不全部免费。实例 `factionHostileOnHarmByPlayer` 默认false，不能据此声称所有商队一击就变敌。成员死亡还有坍塌、人为/中立死亡及PawnKind特殊标志的分支，本轮不把伤害公式说成完整外交死亡规则。

## 9. 自然到访不是第5天必来

来源：`TR16`。Cassandra/Phoebe 的 `FactionInteraction` 商队参数：minDaysPassed5、baseIncidentsPerYear5、minSpacingDays6。

```text
Q = floor(TicksSinceSettle / 1000)
R = Q − 300
R<0：无候选
cycle = floor(R / 3600)
每cycle：60天on、0天off、5个候选，最小间隔360 intervals
```

cycle0 从第5天起，覆盖第5..65天；不是在第0..60天预排后只做第5天gate。首次机会可能很晚，最小间隔不是固定到访频率。原版每次查询从cycle0重演到当前cycle，种子由world persistent random、target ConstantRandSeed、compIndex、cycle组合。前周期hit列表最后元素成为本周期fixedHit。

接受比例：非隐藏/非玩家/非临时派系中，统计非敌对数 `N` 与可转非敌对派系数 `M`。N=0时停用；否则对 `N/max(M,1)` 取曲线 `(.25,.6),(1,1)`。`acceptFraction<1` 时先shuffle hit列表再删减；因此传给下一周期的last不一定是最大的时间值。

时间放松算法允许hit等于窗口end，但0off切到下一cycle时只查新cycle列表，旧cycle endpoint不应补发。精确算法复用第63章的IncidentCycleUtility说明，包括`values[i]+j`和最多101次重排；不能自行改成更“合理”的公式还称原版等价。

候选触发还须通过`CanFireNow`。旧档迁移应保留绝对时间和世界seed，只查询未来机会；不能迁移当天补发历史候选或重新滚动首个到访。项目只有一个可见中立派系时使用acceptFraction=1，是显式世界结构简化；Randy没有这里同一商队FactionInteraction配置，不能套用Cassandra参数而不说明。

## 10. 商队组成、入场与离场

来源：`TR17–TR19`。

到达源派系需通过非敌对、未败亡、非隐藏、非临时、PawnGroupMaker与TraderKind、温度、planet layer、危险条件和hostile lord等筛选。入口从地图边缘按中立道路偏好挑选，成员生成在入口5格附近，然后找全队可达的殖民地外围chillSpot。

Outlander的原版组成：

- 1名 `Town_Trader`，combatPower45。
- 总护卫点 `Rand.Range(550,1000)`，整数上界排除，即550..999；先扣掉商人45，再交给 `ChoosePawnGenOptionsByPoints`，护卫数不是固定2人。
- 非Pawn货物条目数n产生`ceil(n/8)`载畜，不是每8个stackCount单位，也不按重量计算。
- biome允许集合中按Muffalo6、Dromedary5、Alpaca2、Elephant1选一个载畜种类；本批载畜同种，先各放一个货物条目，其余随机分配。

| PawnKind | combatPower | 护卫权重 | 品质中心 | gearHealthRange | 武器预算/标签 |
|---|---:|---:|---|---|---|
| Town_Trader | 45 | 单独1名 | Normal | 1..1 | 200..200 / Gun |
| Villager | 45 | 3 | Poor | .2..2 | 65..250 / Gun+MedievalMeleeBasic |
| Town_Guard | 60 | 10 | 默认Normal | .6..2 | 250..400 / Gun |
| Grenadier_Destructive | 70 | 1.5 | Normal | .7..2.3 | 500 / GrenadeDestructive |
| Mercenary_Slasher | 140 | 7 | Normal | .7..3.2 | 200..500 / MedievalMeleeDecent+Advanced |
| Mercenary_Gunner | 85 | 10 | Normal | .7..3.2 | 330..650 / Gun |
| Mercenary_Elite | 130 | 10 | Normal | 1..1 | 500..1400 / IndustrialGunAdvanced |

自用装备另按 `TR22`：抽样 `<.1` 取品质中心−1，`.1≤r<.2` 取中心+1，其余80%取中心，再夹到PawnKind上下限（默认Awful..Excellent）。Town_Guard未声明品质，`PawnKindDef`默认Normal，所以通常Poor10%/Good10%/Normal80%；forceNormal、forceWeapon、指定衣物和爵位可覆盖。HP抽样小于1时为 `max(1,RoundToInt(r×MaxHP))`，≥1保持满值，不会生成超过最大HP的装备。商品Normal..Masterwork Gaussian不适用。

自用武器先抽weaponMoney预算，以材料对的Normal/满耐久价格≤预算及weaponTags、材料许可、暴力/射击/操作能力、生成概率筛选；再按 `pair.Commonality×pair.Price×理念修正×异种修正` 抽样。材料对的Commonality先按该Def.generateCommonality归一。它不是商品市场价权重曲线，也不是固定总挑最贵武器。项目只保留有限武器和固定材料时会改变归一分布；固定衣物配置同样是适配。

状态链为`Travel → 外围守备/停留 → Escort exit → 地图外`。抵达停留点后，计时阈值是整数随机27000..44999 native ticks；`Trigger_TicksPassed`严格在elapsed>duration触发，所以阈值27000在第27001个tick开始离开。时间约0.45..0.75原版游戏日，不包括入场和离场行走。若项目一天长度不同，应按游戏日换算并说明tick量化。

途中受伤可进入守备，1200个无伤tick后恢复Travel；危险温度、异常天气、causesTraderCaravanExit条件、Dismiss、变为敌人或重要人员倒地/被捕/死亡会启动离场。暴力损失至少全队曾获得人数的20%可触发战斗离场；商人或载畜失去有单独重要成员条件。Escort离场60000tick后转一般ExitMap，不能永远堵在出口。

原版“受伤进入守备”不等于“一击就把玩家派系变敌”；关系变敌由另一个触发器转到护送退出。项目若只实现扣好感、达到-75敌对和退出，而未复刻低于敌对阈值的受伤守备/1200tick恢复状态，应明确这一缺口。护卫对raider的战斗响应仍需通过共享战斗/健康规则验证。

普通离场状态没有直接令 `CanTradeNow=false`：该属性主要检查存活、Spawned、wantsToTrade、可随意交谈、未倒地/囚禁、非玩家/敌对及有可交易货物。Dismiss另由菜单检查。项目若规定离场后立即不可交易，应写为交互简化。商队若能受伤，就应有护卫对敌对袭击的响应与死亡后持有货物的处理；只移动图标不构成完整商队机制。

## 11. 本轮3D适配范围与验收契约

这是实现建议与边界声明，不是本章静态验证已经证明项目功能通过。

本轮范围：实体Silver；Home与stockpile过滤；Social与Talking/Hearing影响报价；从地图边缘进入的商人和可伤害护卫；靠近商人交谈、暂停单据、逐件装备报价、买卖、取消、赠礼、明确接受少收；有限库存、实物落地/搬运、离场、存读档、财富统计。

原版两类库存发生器在当前物品目录重归一化；未实现的工业药/动物/家具/其它装备不替换为不同Def。当前没有完整载畜模拟，货物可显式挂到trader持有容器；护卫保留Villager/TownGuard/Slasher/Gunner代表池，以3/10/7/10重新归一化，省略手雷兵和高阶精英。固定材料、简化派系世界、项目PRNG、严格逐件交易与一次提交均应标成适配。**这不是完整原版商队复刻**。

验收至少应分别证明：正常买入、卖出、混合买卖净额；玩家不足拒绝；商人不足默认拒绝/明确少收；取消不改变状态；重复物品ID、库存改变、会话关闭、商人死亡/倒地、不可达时不发生部分交割；装备品质/HP/ID连续；货物从商人到地面后能搬运；赠礼真实减物资且好感算法正确；生成/报价/保存恢复不刷新库存；旧档不补银币或历史商队；未来自然到访和离场；袭击商队、护卫战斗及落货的物权/财富。

独立算例只验证本章抽出的算术和资格规格；项目需要自己的单元、集成、浏览器交互和长程流程证据。不得用本章176例替代这些验收。

## 12. 复核与失效检测

在项目根目录运行：

```powershell
./scripts/research/verify-trade-evidence.ps1 -GameRoot 'F:/SteamLibrary/steamapps/common/RimWorld'
```

它校验本地版本/Assembly/ILSpy身份、30份XML文件SHA，重新采集所选声明，逐个核对本地67份派生代码哈希及引用区间，再运行portable断言和篡改/公式变异检查。不启动游戏。

没有原版安装时可进行portable复核：

```powershell
node scripts/research/verify-trade-evidence.mjs
node scripts/research/test-trade-verifier.mjs
```

需要重新生成本地派生类型时用 [extract-trade.ps1](../../../scripts/research/extract-trade.ps1)，其复用通用只读PE/CIL提取器；输出仍在`.local-research/trade`。采集 [collect-trade-xml.ps1](../../../scripts/research/collect-trade-xml.ps1)，独立模型 [trade-model.mjs](../../../scripts/research/trade-model.mjs)，结论/人工期望写入器 [write-trade-evidence.mjs](../../../scripts/research/write-trade-evidence.mjs)，校验器 [verify-trade-evidence.mjs](../../../scripts/research/verify-trade-evidence.mjs) 的职责分离。写入器不会更新校验器中的人工审核语义哈希，变更事实后必须显式复核。

本轮完整命令结果：`PASS trade: installed assembly + 30 XML files, 67 derived files, 456 analytic + 646 structure assertions, 22 corruption checks and 53 formula mutations.` 所有数字仅覆盖本章边界，不证明加载中的Mod结果、原版随机流、原版运行时成交或项目全流程等价。
