# 100 家具施工品质：组件、完工者、属性与财富

本章研究 RimWorld **1.7.4980 rev60** 的 Bed、DiningChair、Table1x2c 和 HorseshoesPin。最关键的规则是：**品质由最后完成施工的人在完工时生成；床、餐椅、餐桌有品质，马蹄铁柱没有；这几种家具的最大生命值不随品质变化。**

证据分为安装包 Core XML、ILSpy 派生 C#、[原版普通施工观察](101-native-furniture-quality-runtime.md)三层。完整派生代码和原始存档仅留本地；仓库保留[源版本与新提取类型](evidence/furniture-quality-manifest.json)、[13 项机制断言及定位](evidence/furniture-quality-evidence.json)、[原版观察投影](evidence/furniture-quality-runtime-evidence.json)。不能把派生 C# 称为原始源码，也不能把一次 Poor 结果当作概率标定。

## 1. 品质从完整父链继承

箭头方向为具体家具 → 父定义；以下均追到无 ParentName 的 BuildingBase。XML 位置与原文件 SHA 见 FQX01–03。

| 家具 | 完整父链 | 品质 / 艺术 |
| --- | --- | --- |
| Bed | BasicBedBase → SansComfortBedBase → ArtableBedBase → BedWithQualityBase → BedBase → FurnitureBase → BuildingBase | BedWithQualityBase 加 CompQuality；ArtableBedBase 加 CompArt，最低艺术品质 Excellent |
| DiningChair | ArtableFurnitureBase → FurnitureWithQualityBase → FurnitureBase → BuildingBase | 有 CompQuality；CompArt 最低 Excellent |
| Table1x2c | TableGatherSpotBase → TableBase → FurnitureWithQualityBase → FurnitureBase → BuildingBase | 有 CompQuality；没有上述艺术组件；另有聚会点组件 |
| HorseshoesPin | BuildingBase | 没有 CompQuality，也没有本章所述 CompArt |

`TryGetQuality` 对没有品质组件的物体返回 false，同时把 out 参数设为 Normal；`StatRequest.For(thing)` 接收这个计算缺省值。这只保证一般 Stat 计算使用中性倍率，不表示马蹄铁柱实际拥有“普通”品质。

## 2. 普通施工与品质生成的时机

`WorkGiver_ConstructFinishFrames` 检查阵营、材料是否齐备、可达与建造技能资格，分派 FinishFrame。`JobDriver_ConstructFinishFrame` 预约并走到施工位置，在工作 tick 中：

```text
基础工作增量 = ConstructionSpeed × 1.7 × delta
有材料属性时再乘 Stuff.ConstructionSpeedFactor
材料容器非空且有 skills 时：Construction.Learn(0.25 × delta)
玩家施工失败检验概率 = 1 − ConstructSuccessChance^(工作增量 / 总工作量)
workDone ≥ WorkToBuild → frame.CompleteConstruction(actor)
```

这里的 Learn 输入还会经过技能学习系统；不能直接当成存档中最后增加的经验。实际耗时还含搬运、移动、中断和速度变化，不能拿 XML WorkToBuild 直接当现实秒数。施工失败与低品质是两个不同结果。

完成路径清空并销毁框架材料、销毁 Frame、创建成品；若成品存在 CompQuality，才用 **当前 actor 的当前 Construction 等级**调用品质生成并 SetQuality 一次。随后处理艺术、继承框架损伤、生成实体，增加 `ThingsConstructed` 记录。达到 `WorkToBuild ≥ 9500` 才触发长工程 Tale；本章木床不满足。

因此多人接力时应采用最后完成者，而不是蓝图下单者、搬运者、最早施工者或参与者平均等级。本轮原版实测只有一次普通施工，没有运行多人接力分支；该规则来自 FQ02–03 的代码路径。

## 3. 品质抽样机制

枚举 Awful、Poor、Normal、Good、Excellent、Masterwork、Legendary 对应 0–6。等级中心值：

| Construction | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 中心 | .7 | 1.1 | 1.5 | 1.8 | 2 | 2.2 | 2.4 | 2.6 | 2.8 | 2.95 | 3.1 |

| Construction | 11 | 12 | 13 | 14 | 15 | 16 | 17 | 18 | 19 | 20 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 中心 | 3.25 | 3.4 | 3.5 | 3.6 | 3.7 | 3.8 | 3.9 | 4 | 4.1 | 4.2 |

1. 取 `Rand.GaussianAsymmetric(center, .6, .8)`，转换为 int，clamp 到 0–5。
2. 若结果为 Masterwork，50% 机会再用 `(center, .6, .95)` 抽取并 clamp 到 0–5。
3. 创作灵感 `Inspired_Creativity` 增加 2 级，上限 Legendary；Pawn 重载在实际使用时消耗该灵感。默认普通生成本身没有 Legendary。
4. 机械体固定技能、Ideology 生产角色品质加成是另外的分支，不等于所有玩家都自动享受这些修正。

这复用[技能与品质研究](45-skills-learning-quality-mechanisms.md)。本轮没有大量样本、概率拟合或独立验证 Rand 的完整随机分布实现。

## 4. 家具和木材的基础值

木材完整父链为 WoodLog → ResourceVerbBase → ResourceBase。木材 HP 系数 .65、Beauty 系数 1、WorkToBuild 系数 .7；木材单价 1.2，非 smallVolume，VolumePerUnit 为 1。选定 Stat 还会处理自己的取整。下表为 Core 基础配置和木材计算值，不代表全部 DLC/Mod 组合。

| 家具 | 材料数 | 基础 HP → 木制最大 HP | 基础工作量 → 木制工作量 | 基础 Beauty | 基础 Comfort | 基础 Rest |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Bed | 45 | 140 → 91 | 800 → 560 | 1 | .75 | 1 |
| DiningChair | 45 | 100 → 65 | 8000 → 5600 | 8 | .70 | — |
| Table1x2c | 28 | 75 → 49 | 750 → 525 | .5 | 未定义 | — |
| HorseshoesPin | 10 | 75 → 49 | 100 → 70 | 未定义，缺省 0 | 未定义 | — |

`MaxHitPoints` 没有 StatPart_Quality，不能套用品质护甲或武器的其他倍率。成品当前 HP 的另一条规则是：

```text
finished.HitPoints = ceil(frame.HitPoints / frame.MaxHitPoints × finished.MaxHitPoints)
```

完整框架产生满血成品；受损框架完工不会自动修成满血。本次原版框架 23/23 → 木床 91/91，未实测受损框架分支。

## 5. 品质究竟影响哪些属性

| 品质 | Comfort 倍率 | 床 Rest 倍率 | Beauty 倍率 | MarketValue 倍率 | 市值正向增量上限 |
| --- | ---: | ---: | ---: | ---: | ---: |
| Awful | .76 | .86 | -.1 | .5 | 未设实际约束 |
| Poor | .88 | .92 | .5 | .75 | 未设实际约束 |
| Normal | 1 | 1 | 1 | 1 | 未设实际约束 |
| Good | 1.12 | 1.08 | 2 | 1.25 | 500 |
| Excellent | 1.24 | 1.14 | 3 | 1.5 | 1000 |
| Masterwork | 1.45 | 1.25 | 5 | 2.5 | 2000 |
| Legendary | 1.7 | 1.6 | 8 | 5 | 3000 |

`StatPart_Quality` 默认只对正的输入值应用 `value += min(value × factor − value, maxGain)`。不能把零 Beauty 乘出正值，也不能把高价传奇物体无限乘 5。通用 maxGain 缺省为 9,999,999，表中“未设实际约束”指这里没有专门的小上限。

木床 Comfort 依次为 `.57 / .66 / .75 / .84 / .93 / 1.0875 / 1.275`；餐椅依次 `.532 / .616 / .7 / .784 / .868 / 1.015 / 1.19`。这是家具额定属性；人物舒适需求的容量是另一层。床的 Rest 倍率是睡眠恢复速率修正，不能直接等同于少睡多少小时。BedRestEffectiveness 的 Stat min=.4、valueIfMissing=.8，床自己明确配置的 base=1。

Beauty 最后 `Mathf.RoundToInt`，恰好半数时取偶数。因此 Poor 木床 `1×.5 → 0`，Normal 小桌 `.5×1 → 0`，Masterwork 小桌 `.5×5 → 2`；不能一律向上取整。本表范围最大 Beauty 为餐椅 64，没有触及 Beauty 的绝对值超过 100 后五单位取整规则。

## 6. 市值、房间财富与殖民地财富

有 costStuffCount 的这类家具不走可计算配方分支，其基础市值为材料价值，加 `.0036 × max(WorkToMake, WorkToBuild)`（工作量超过 2 时），除产物数量 1。木床：

```text
base = 45 × 1.2 + 560 × .0036 = 56.016
Poor 满血木床 = 56.016 × .75 = 42.012
```

界面显示材料与劳动 `$56`、最终 `$42`，是显示格式，不代表内部计算只保留整数。Normal 木椅的相同基础计算为 74.16，小桌 35.49，马蹄铁柱 12.252（柱没有品质抽样）。超过 200 的最终市值还会按 5 取整；价格转换和交易议价另见[交易研究](66-trade-market-mechanisms.md)。

普通 `MarketValue` 继承品质 part 后，还有当前 HP 比例曲线：`(0,0), (.5,.1), (.6,.5), (.9,1)`。`MarketValueIgnoreHp` 继承相同基础与品质 part，却没有这个 Health part。

| 消费者 | 使用的 Stat | 品质影响 | 当前损伤影响 |
| --- | --- | --- | --- |
| 物品市值、RoomStatWorker_Wealth 房间财富 | MarketValue | 有 | 有 |
| WealthWatcher 的殖民地建筑财富 | MarketValueIgnoreHp | 有 | 无 |

这意味着损坏一张仍存在的高品质床会降低其市值和房间财富，却不会直接把它按同样折扣从殖民地建筑财富中扣除。拆除/销毁使实体消失是另一回事。证据 FQ13 分别指向既有 `economy/RimWorld.WealthWatcher.cs` 与 `environment/RimWorld.RoomStatWorker_Wealth.cs`；参见[叙事者与财富](63-storyteller-wealth-mechanisms.md)。

## 7. 持久化与作者边界

`CompQuality` 的新对象字段初值是 Normal，但 `PostExposeData` 对省略的 quality 使用 **Awful** 缺省。解释旧存档时必须先判定对象是否有品质组件：有组件而省略 quality、无组件而没有 quality，语义不同。保存/加载已有品质并不重新调用施工品质生成。

Frame 会调用 `CompArt.JustCreatedBy(worker)`，但该方法仅在 `CanShowArt` 为真时写 `authorNameInt`。本章床和椅需要至少 Excellent 才展示艺术，所以 Poor 木床不必保存作者名，更没有由此证明通用 creatorPawnId 字段。若 Web 为追踪增加 craftedBy，应标为额外设计。

## 8. 可复核入口与范围

```powershell
pwsh -File scripts/research/collect-furniture-quality-evidence.ps1
pwsh -File scripts/research/collect-native-furniture-quality-runtime.ps1
node scripts/research/verify-furniture-quality-evidence.mjs
node scripts/research/verify-furniture-quality-evidence.mjs --local
```

portable 检查已沉淀证据的结构、父链、状态关系和裁图；local 进一步核对 DLL、反编译器、派生文件、Defs、原档、原图、动作日志的 SHA 和原始 XPath 投影，不会启动游戏或回放键鼠。REA 的 67,108,864 字节 member 输出上限失败记录沿用既有证据，未盲目重试。

本轮没有原版验证灵感、艺术作者、高价 maxGain、损伤框架、多人换手、施工失败或所有品质；相应条目保持静态证据身份。[Web 适配与实现边界](102-furniture-quality-gameplay.md)独立记录。
