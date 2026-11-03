# 69. 商队行为后续研究：口粮、需求、守备与离场

**状态：静态研究，未据此实现新功能，也未做本轮原版 UI 验证。** 本章补充 [66 章](66-trade-market-mechanisms.md)，为以后搭建玩法机制提供依据；暂停精细数值扩展，当前产品优先级转向动物、狩猎与肉类循环。

依据本机 RimWorld `1.7.4980 rev60`。复用既有派生代码；新增定向提取仅位于忽略目录 `.local-research/trade-behavior/`。没有修改 v21 源码、冻结 evidence 或第67/68章。以下“确认”均指当前静态调用链支持，不代表已观察到原版或项目运行行为。

## 1. 自带口粮到实际消费

- **确认：生成入口允许携带口粮。** 商人/护卫生成请求传入 `allowFood:true`；`PawnInventoryGenerator.GenerateInventoryFor` 据此调用 `GiveRandomFood`，按 PawnKind 的 `invNutrition` / `invFoodDef` 创建真实食物，调用 `TryAddItemNotForSale` 装入个人背包。它与驮兽承载的待售货物不是同一个库存来源。[S01–S03]
- **确认：非玩家角色优先吃自己的背包食物。** `FoodUtility.TryFindBestFoodSourceFor` 找到可吃的个人库存后，对非玩家派系直接返回；并非先去挑殖民地更高级的饭菜。食物不可用或没有库存时才继续搜索地图。[S04]
- **确认：食用有实体交割。** `JobDriver_Ingest` 从背包取到携带栏，执行咀嚼与 `FinalizeIngest`；后者调用实物 `Ingested`、增加食物需求值，实物按摄入数量拆分或销毁。不能只降低一个抽象“口粮天数”而让库存永不减少。[S05–S07]
- **限制：不能直接把驮兽商品当团队饭盒。** 当前 `FirstFoodInClosestPackAnimalInventory` 分支要求 getter、eater 都是 `IsColonist`，遍历的是殖民地动物；本次没有找到把这条分支用于来访商人的依据。[S04]

## 2. 能否吃殖民地食物

静态链允许出现这种情况，但有条件，不能写成“商人一定偷吃”或“绝不会吃”。普通地图食物搜索没有通用的“玩家所有物一律拒绝”判断；检查的是可食用、可达、预留、禁取、社会合适性等条件。普通食物的社会合适性主要限制监狱房间；营养膏机则另有同派系/HostFaction限制。[S04、S08、S09]

玩家设置的 `CompForbiddable` 标记由 `ForbidUtility.IsForbidden(Thing,Faction)` 仅对玩家派系生效；Pawn 检查还会考虑 HostFaction，因此不能把普通无玩家 HostFaction 的商人和玩家招待/囚禁的客人混用。来访者仍受自己的 duty 半径和 `Lord.extraForbiddenThings` 限制。后者包括商队刚卖给玩家的落地物品，不能与玩家禁止标记混为一谈。[S08、S23]

**待实机确认：** 没有个人口粮的正常商队，在守备范围内是否实际选取指定殖民地餐食，以及与监狱、桌椅、已售货物、不可达路径组合后的行为。本次未验证跨商人互取背包食物，也不把缺乏证据解释为绝对不存在。

## 3. 吃饭与睡眠不是同一个开关

`LordToil_DefendTraderCaravan` 的 `AllowSatisfyLongNeeds=false` 会让 `JobGiver_GetRest.GetPriority` 直接返回零；`JobGiver_GetFood` 没有这个 gate。Defend duty 先尝试战斗，再在 duty 范围内调用 `SatisfyBasicNeedsAndWork`，其中同时列有 GetFood/GetRest，但休息分支会受到上述 gate。这不是普通殖民者时间表的原样套用。[S11–S14]

`CustomWakeThreshold=.5` 表示已经睡着时采用较早的醒来阈值，也会影响能否入睡的上限；**不表示每晚自动睡到50%，更不是直接开启睡觉工作**。[S11、S15]

**必要例外：** `Need_Rest` 仍保留疲劳耗尽后的非自愿睡眠路径，直接启动 `LayDown` 并标记 `startInvoluntarySleep`。它不以 `AllowSatisfyLongNeeds` 为条件，但仍检查能否入睡、当前状态等，所以不能宣称商队永不睡觉。医疗卧床、特殊生命阶段和 DLC 状态不能用这一个结论概括。[S16]

`SatisfyBasicNeedsAndWork` 中出现 `JobGiver_Work`，并不足以证明商人会帮玩家建造、种田或搬运；本轮没有追认此能力。

## 4. 入场、守备、战斗与离场

| 环节 | 已确认的机制 |
|---|---|
| 入场 | Travel 分配前往集合点的 duty；全队满足到达/可达条件后发送到达消息，切入停留守备。 |
| 停留 | 商人和护卫负责 Defend；载畜 Follow 商人，受押送成员 Escort。战斗优先于普通需求。 |
| 途中遭伤 | 可切到临时守备；持续一段无伤时间后恢复 Travel。再次伤害重置计时，抓捕尝试或暴力失去成员也属于 harm 信号。 |
| 重要成员失去 | 商人或驮兽倒地、被捕、死亡有单独离场触发。 |
| 暴力损失 | Lord 对倒地、死亡、被捕计数，达到队伍累计获得成员数的一定比例后进入战斗撤离；不是按剩余健康百分比判断。 |
| 关系变敌 | 派系关系变更信号触发离场；“受到一次伤害”和“变成敌人”是不同事件。 |
| 危险温度 | 检查活着、在地图上且未倒地成员的热射病/低温症状态；不是仅看室外温度是否超过舒适区。 |
| 正常撤离 | 商人先退出；护卫会跟随/掩护载畜，遇到倒地或死亡载畜且存在敌对威胁时可就地守卫；另有退出超时回退。 |

以上来自商队状态图、专用 LordToil 和 Lord 事件入口。[S10、S11、S17–S21] 完整目标选择、掩护走位、多个离场条件同时满足时的优先关系尚未完成运行验证。

## 5. 受困不是原地永久等待

商队状态图检查成员是否能到地图边缘；出现受困成员时切到允许挖路的退出状态，唤醒成员并结束旧工作。`LordToil_ExitMap` 把 `canDig` 写入 duty；`JobGiver_ExitMap` 据此使用可穿越可破坏障碍的寻路，寻找第一个阻挡建筑，尝试产生 `DigUtility.PassBlockerJob`。出路重新满足条件后再转入战斗退出状态。[S10、S22]

**静态结论止于“尝试清障离场”。** 本次没有继续验证每种障碍、材料、挖掘能力、门禁或边界条件是否总能成功，也不承诺任意封闭空间必能逃出。

## 6. 实现时可采用的最小闭环

以后若继续深化商队，可依次做：个人口粮实体及消耗 → 饥饿时取食任务 → 守备/撤离时的需求优先关系 → 疲劳耗尽例外 → 受困提示与清障退出。先验证行为可见、物资守恒和存档连续，再校准数量、距离、时间及概率。商队专用状态保持独立，复用已经存在的食物、健康和战斗执行器。

本章没有新增独立算例；没有把派生代码当作原始源码，没有把静态分支当作实机完成证明。

## 来源索引

行号对应已记录派生文件，路径以项目 `.local-research/` 为根；原始 XML 路径以游戏安装目录为根。所有来源使用同一 Assembly SHA-256 `eff7d97949f919fb2b151ebfb906e9be749b63410b7dbda78eeebb7972b245c3`、ILSpy SHA-256 `587a18e18e13acfc7fd8783a44c24c7da0781dadf6b9fb9dd5e2e38a9cdfae78`。新增派生身份保存在本地 `trade-behavior/manifest.json`；下表记录本章实际引用的文件哈希，不依赖后续浮动行号。

<details>
<summary>展开来源文件、行号与哈希</summary>

| ID | 文件与行号 | SHA-256 |
|---|---|---|
| S01 | `trade/RimWorld.PawnGroupKindWorker_Trader.cs:79-145` | `25d7ec73091d700855033859fc42b5be2036d942227fa672c69143fb70fad8e5` |
| S02 | `trade-behavior/RimWorld.PawnInventoryGenerator.cs:11-79` | `a5950f3dc49e1b39a5706b3b4951f591e0d9b64340eb3963d3937ee2f974206e` |
| S03 | `Data/Core/Defs/PawnKindDefs_Humanlikes/PawnKinds_Outlander.xml:4-14` | `c21536e4c41b1bff0e70d48b110ed6aaea1d5ed5f7f8c93df9715c2a57e259a4` |
| S04 | `food/RimWorld.FoodUtility.cs:181-311,381-455,561-571` | `b8c118d3c34a0beae6940c17db6b2f8a6b17f4e453354105b9a14820b5895de8` |
| S05 | `food/RimWorld.JobDriver_Ingest.cs:103-168` | `278d66fed21ad28e41fb21c8af49f224a73c4163a26067431fe6eee0768ec3c6` |
| S06 | `food/RimWorld.Toils_Ingest.cs:405-437` | `2e10eef89dc2f5d216681188952eb0227d1dd04d459463256a162310c30d9bb7` |
| S07 | `trade/Verse.Thing.cs:2149-2203` | `70d1ee0904dd774e25fde1f63a4dfa6811a1befe868ea7ab1609542724c763cc` |
| S08 | `trade-behavior/RimWorld.ForbidUtility.cs:113-145,157-173,190-207` | `e36190372ca2bc9540ef40d3d6a3ee836f30c3da7ee6842dffa79c0da78fbf48` |
| S09 | `trade-behavior/RimWorld.SocialProperness.cs:8-40` | `f4f4cafcce45661638f5eefc3f97994a076dee0b397c3db1a1360bcdd5538d3d` |
| S10 | `trade/RimWorld.LordJob_TradeWithColony.cs:33-128` | `a6598fd4892ed55b9be03c20aae8a6fbbde830af360c336d89fca731f7438866` |
| S11 | `trade/RimWorld.LordToil_DefendTraderCaravan.cs:9-45` | `746f820d339dc837c981a485878d2bd6e4db8860a17d33f7795222657bb9c35c` |
| S12 | `housing/RimWorld.JobGiver_GetRest.cs:24-47` | `bc323e06492bcdf067e9dec5f9f8da9bd0645d320a85ec9aeebe1531c3b08957` |
| S13 | `food/RimWorld.JobGiver_GetFood.cs:25-47,51-127` | `c648efbdd091620603979d79de4c064f5a8174e7f6cf51950b6c19619a398a04` |
| S14a | `Data/Core/Defs/DutyDefs/Duties_Misc.xml:55-102,193-210,525-541` | `9bf1aa50460348e62d1a2f57a001b7086666839ab8824d488133b7f81967a88a` |
| S14b | `Data/Core/Defs/ThinkTreeDefs/SubTrees_Misc.xml:804-842` | `c287c0c2a97f151d86516cf058e2eb54b4d87f1bccf50bfa46faf8b26eba3071` |
| S15 | `housing/RimWorld.RestUtility.cs:562-610` | `e0f84f3a9d891e7c6130159b9dfd6751063147eb3e090effe854661171e3f73e` |
| S16 | `housing/RimWorld.Need_Rest.cs:99-158,167-232` | `279beb73f0d2340f01e49e0da4d8589d51b4c9567207542d5f10dc7a69b1864f` |
| S17 | `trade-behavior/Verse.AI.Group.LordToil_Travel.cs:24-56` | `e5a5ade42babfa4eef43a0cc1f809226fa4b0e3ea69fa7abf2a315f1f112261e` |
| S18 | `trade-behavior/Verse.AI.Group.Lord.cs:685-736,822-839` | `a4c592766e356bb857de4d8b4ef0e59b03e2140d31c198fa033429cf5857e3e4` |
| S19a | `trade-behavior/Verse.AI.Group.Trigger_TicksPassedWithoutHarm.cs:1-18` | `3bf611fe4fef07aeeec5fc9a27d9ab03662c835bf6e4c3d4dad890bbd8aa5e09` |
| S19b | `trade/Verse.AI.Group.Trigger_PawnHarmed.cs:62-80` | `dd3314054eb486358789d7eeddf9f58fab11c15ebc2b12164b1155de69e9a4fa` |
| S20a | `trade/Verse.AI.Group.Trigger_FractionPawnsLost.cs:1-20` | `16bcef0242d2246f6b1ac8b88208e13f7d95f94e2d3451c138c58a2cc7ec7964` |
| S20b | `trade/Verse.AI.Group.Trigger_ImportantTraderCaravanPeopleLost.cs:1-22` | `15970d420e047e92207075d1c90512c14323fe431ecd34099cdc4badc809e1cc` |
| S21a | `trade-behavior/Verse.AI.Group.Trigger_PawnExperiencingDangerousTemperatures.cs:1-33` | `991b9c26c12e44adbfbb1af9e71ae8b4d487a1f7a4a864925e8f61ff0cc112a0` |
| S21b | `trade/RimWorld.LordToil_ExitMapAndEscortCarriers.cs:29-142` | `ba7e97fcb6a20e51f02a4decedbcf9e96ada72f6d6dc0c9dd8bf0fb420f3a952` |
| S21c | `trade-behavior/Verse.AI.Group.Trigger_BecamePlayerEnemy.cs:1-19` | `ad2e78ea5126b34fbdd44aac2c9e30eb6da9f0979107f642ccd1b40d422f7993` |
| S22a | `trade-behavior/Verse.AI.Group.LordToil_ExitMap.cs:16-37` | `eb1635b3a3d2cce963e475afc65648a23a536214f19ccd52881c32e1332b2e85` |
| S22b | `trade-behavior/Verse.AI.JobGiver_ExitMap.cs:57-85` | `e45b6447c21a61e48cdda052ce8ea61ec167b08da094b0ce738986ea6276c47b` |
| S22c | `trade-behavior/Verse.AI.Group.Trigger_PawnCannotReachMapEdge.cs:1-20` | `d9d046aede1f0a0f5a16d6d987993fca674a35ff74d8e96a272768ebfd17a680` |
| S22d | `trade-behavior/Verse.AI.Group.Trigger_PawnCanReachMapEdge.cs:1-21` | `9e58c5313b64f401a3d077786e64a48737db0ffbd0692c72be4ac2f1488067c1` |
| S23 | `trade/RimWorld.Pawn_TraderTracker.cs:178-203` | `b57852d9a71cc3f748570a22b8e8fbd5222bae48cbf4fed652059d72d1996b6c` |

</details>
