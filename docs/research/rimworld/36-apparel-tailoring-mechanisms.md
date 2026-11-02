# 36 衣物保温、棉花与裁缝制作

本章把 [第 33 章生存与救护](33-survival-health-mechanisms.md) 的“无衣物人类温度基线”扩展为真实衣物实体，并追踪“播种棉花 → 收获 Cloth → 搬运材料 → 裁缝制作 → 穿戴/替换 → 穿着耗损”的链路。范围包括六种基础服装：Tuque、Parka、Duster、T-shirt、Button-down shirt、Pants；数值表采用 Cloth，其他材质仅在说明通用求值路径或木制工作台时涉及。

原件是 **RimWorld 1.7.4980 rev60**，DLL 为 `F:\SteamLibrary\steamapps\common\RimWorld\Assembly-CSharp.dll`，SHA256 `eff7d97949f919fb2b151ebfb906e9be749b63410b7dbda78eeebb7972b245c3`。ILSpy `11.2.0.10050` 的引擎 SHA256 为 `587a18e18e13acfc7fd8783a44c24c7da0781dadf6b9fb9dd5e2e38a9cdfae78`。分析脚本只读取程序集及 XML，不执行原版游戏。完整派生 C# 留在忽略目录 `.local-research`；发布的内容是规则、数值、定位和独立算例。

## 36.1 可实施合同

| 主题 | 原版确认规则 | 容易误用之处 |
|---|---|---|
| 隔热来源 | 材料 power × 成衣 multiplier，随后乘品质倍率 | 不是先把默认 0 乘品质再加材料 |
| 耐久与隔热 | 所选 Core 布衣无 HP 比例隔热折扣 | 剩 50% 耐久不意味着只剩 50% 保温 |
| 耐久上限 | 所选布衣 MaxHP 不随品质变化 | 不能把隔热品质倍率同时套到 HP |
| 温度叠加 | 最终 Cold 从舒适下限减去，Heat 向上限相加 | 不能只选外套，帽子/内衣/裤子也贡献 |
| 穿戴冲突 | 共享层且覆盖的实际身体组发生干涉才冲突 | 同层不必冲突；不同组名也可能覆盖同一部位 |
| 穿脱工时 | 每件 `int(EquipDelay×60)` 原版 ticks；换装总时长加入冲突旧衣 | 原版此等待没有 manipulation 倍率 |
| 穿着耗损 | Pawn tracker 每 60000 ticks 检查一次，默认随机舍入 .4 HP | 不是每件单独按穿着时长累计，也不是每天掉 4% |
| 棉花 | growDays=8；成熟无损基础产出 10 Cloth | 采收直接给 Cloth，没有本链中的纺纱中间物 |
| 裁缝台 | 手台 75 木/金属，3×1，基础速度 .5 | 材质、房间和温度还可改变建造/生产表现 |
| 制作技能 | 六件均无最低 Crafting 等级，workSkill=Crafting | Crafting 参与品质；普通制作速度读 GeneralLaborSpeed |
| 研究 | 台需 ComplexClothing；Parka 配方自身不要求该研究，其余五件要求 | 配方资格与能否建造工作台是两层 |

原版规则索引为 [apparel-claims.json](evidence/apparel-claims.json) 的 AP01–AP22。项目时间缩放、初始衣物、确定性抽样等取舍见 36.10；本章表格不代表项目运行验收。

## 36.2 六件 Cloth 成衣

材料数量来自 costStuffCount，工量来自 WorkToMake，穿脱时间来自 EquipDelay。基础父链为 `ApparelNoQualityBase → ApparelBase → ApparelMakeableBase`；Tuque 还经过 HatMakeableBase。下表隔热取 Normal 品质，且没有场景、基因、其他 Stat 或 Mod 修正。[AP15、AP19]

| 服装 / defName 后缀 | Cloth 数量 | WorkToMake | MaxHP | 穿/脱秒数 | Cold | Heat | 层 |
|---|---:|---:|---:|---:|---:|---:|---|
| Tuque | 20 | 1200 | 80 | .8 | 9 | 0 | Overhead |
| Parka | 80 | 8000 | 180 | 3 | 36 | 0 | Shell |
| Duster | 80 | 10000 | 200 | 3 | 10.8 | 15.3 | Shell |
| BasicShirt（T-shirt） | 40 | 1600 | 100 | 1.5 | 3.96 | 1.8 | OnSkin |
| CollarShirt（Button-down shirt） | 45 | 2700 | 100 | 1.5 | 4.68 | 1.8 | OnSkin |
| Pants | 40 | 1600 | 100 | 2 | 3.6 | 1.44 | OnSkin |

表中 defName 均带 `Apparel_` 前缀。Tuque 允许 Fabric，其余五件允许 Fabric、Leathery；本项目若只开放 Cloth，应标为材料范围简化。服装基础 HP 是各自定义，不能把 Cloth 资源本体的 MaxHP=80 赋给所有成衣。

所有六件配方默认一次产出 1 件。没有最低 Crafting 数值门槛，不等于角色一定能工作：仍需工作分配、未禁用的对应工作、可达工作台、有效 bill、研究与材料预约等。Parka 没有自己的 researchPrerequisite；其余五件的该字段为 ComplexClothing。公用 HandTailoringBench 本身仍有建造研究限制。[AP16]

## 36.3 材料、品质、HP 的实际求值顺序

Cloth 的 `StuffPower_Insulation_Cold=18`、`StuffPower_Insulation_Heat=18`。成衣各自的冷/热 multiplier 为：[AP01]

| 服装 | Cold multiplier | Heat multiplier |
|---|---:|---:|
| Tuque | .50 | 0 |
| Parka | 2.00 | 0 |
| Duster | .60 | .85 |
| BasicShirt | .22 | .10 |
| CollarShirt | .26 | .10 |
| Pants | .20 | .08 |

`StatWorker` 先取得 Stat 基值，再处理材料通用 statFactors/statOffsets 及材料的品质专属修正；随后 `FinalizeValue` 顺序调用 StatPart。`StatDef.PostLoad` 按 priority 从高到低稳定排序：隔热的 Stuff part 明确 priority=100，Quality part 的类默认 priority=0，因此先增加材料贡献，再应用品质。[AP01、AP21]

对本章 Cloth 成衣，没有额外隔热基值或材料通用隔热修正，可约简为：

```text
Cold = 18 * 成衣ColdMultiplier * 品质倍率
Heat = 18 * 成衣HeatMultiplier * 品质倍率
```

| 品质 | Awful | Poor | Normal | Good | Excellent | Masterwork | Legendary |
|---|---:|---:|---:|---:|---:|---:|---:|
| 隔热倍率 | .8 | .9 | 1 | 1.1 | 1.2 | 1.5 | 1.8 |
| 布 Parka 防寒 °C | 28.8 | 32.4 | 36 | 39.6 | 43.2 | 54 | 64.8 |
| 布 Parka MaxHP | 180 | 180 | 180 | 180 | 180 | 180 | 180 |

所读隔热定义及 multiplier Stat 都没有 HP 比例的 part，通用 worker 也没有对所有非 Pawn 物体统一施加 HP 折扣。**Normal 布 Parka 在 180、90 或 1 HP 时，仍存在且穿着便提供 36°C 防寒**；销毁、脱下或被替换后不再贡献。本章没有由此推断它的护甲、交易价值、心情或 AI 衣物评分也不受损坏影响。[AP02；A02]

MaxHitPoints 的 StatDef 没有品质 part，Cloth 也没有 HP/工量 factor、offset 或品质专属覆盖；因此本表的成衣 HP 不随品质提升。通用 MaxHP 最终值在严格大于 200 时先按 5 取整，随后取整数并限制最低 1；WorkToMake 严格大于 300 时按 5 取整。本章六件 Cloth 数值本身不受这些取整改变。其他材料有自己的 factor/offset，不能推广成“所有材质、Mod 的耐久都与品质无关”。[AP21]

例如一个合成测试的隔热基值为 2、材料贡献 9、Masterwork 倍率 1.5，正确顺序得 `(2+9)×1.5=16.5`，先乘品质再加材料会误得 12。A03 特意保留该差异，而不是只用基值为 0 的成衣样本检查。

## 36.4 穿上衣物后，人的温度范围怎样改变

普通无额外修正的人类基线为舒适 16..26°C，来源见第 33 章。`StatPart_GearStatOffset` 遍历实际已穿衣物，把其最终 Cold 及相应装备 offset 从下限减去，把 Heat 及相应 offset 加到上限。安全范围再向两侧各扩展 10°C。[AP03]

```text
舒适下限 = 16 - sum(各穿戴件最终Cold及相应offset)
舒适上限 = 26 + sum(各穿戴件最终Heat及相应offset)
安全范围 = [舒适下限-10, 舒适上限+10]
```

表中均为 Normal Cloth，且每行服装组合兼容：

| 组合 | 舒适温度 °C | 安全温度 °C |
|---|---|---|
| 无衣物 | 16..26 | 6..36 |
| T-shirt + Pants | 8.44..29.24 | -1.56..39.24 |
| 再加 Tuque | -.56..29.24 | -10.56..39.24 |
| 再加 Parka | -36.56..29.24 | -46.56..39.24 |
| 外套换成 Duster | -11.36..44.54 | -21.36..54.54 |

这里的 Parka 与 Duster 是替换关系，不能同时累加。最终舒适 Stat 的后处理 clamp、其他 Pawn 修正和安全区/恢复区区别仍按第 33 章。已有失温并非只要回到“安全区”就恢复；穿衣改变的是阈值，之后由健康 giver 重新判断。

## 36.5 穿戴层、覆盖部位与冲突

| 服装 | bodyPartGroups |
|---|---|
| Tuque | UpperHead |
| Parka | Torso、Neck、Shoulders、Arms |
| Duster | Torso、Neck、Shoulders、Arms、Legs |
| T-shirt | Torso、Shoulders |
| Button-down shirt | Torso、Neck、Shoulders、Arms |
| Pants | Legs |

`CanWearTogether` 首先查两件是否至少共享一层。不共享层直接兼容；共享层时，再看各自覆盖组在实际 BodyDef 部位上扩展出的干涉组，并双向检查。[AP04]

由此得到：Parka/Duster 同 Shell 且覆盖重叠，互斥；两种 shirt 同 OnSkin 且覆盖重叠，互斥；shirt/Pants 虽同 OnSkin，所选人类身体的覆盖不干涉，可以共穿；Tuque 与本表所有上衣裤子兼容。

不能把通用算法简化为“组名字相同才冲突”。Human 的 Head、Skull 等部位同时属于 UpperHead、FullHead 等组，因此两件同层衣服即使分别只写 UpperHead 与 FullHead，也可发生干涉。证据快照只提取 Human 的组归属，不复制整套器官和绘制数据；A05 用这些归属关系构造最小冲突见证。

`HasPartsToWear` 检查至少有一个未缺失部位属于衣服覆盖组，并非要求定义中的每个组都完好。后续 Wear 还检查可穿发展阶段、绑定装备等，并将实际 Apparel 实体加入 Pawn_ApparelTracker。游戏的自动服装优化、强制穿戴、锁定衣物、政策过滤和所有特殊种族规则未在本章完整重建；项目的手动穿脱或简化选衣不能称为原版完整衣柜 AI。[AP05]

## 36.6 穿脱、替换与实体位置

穿戴 Job 在开始时计算：[AP06]

```text
duration = int(新衣EquipDelay * 60)
         + sum(int(每件冲突旧衣EquipDelay * 60))
```

这里每件单独向零截断为整数。Tuque 无冲突为 48 ticks，Parka 与 Duster 相互替换为 360 ticks，即正常 60 TPS 下 6 秒；两种 shirt 替换为 180 ticks。移动到衣物或衣架、预约和其他等待另算。代码没有读取穿戴者 manipulation 来缩短或加长这段 Delay。

穿衣过程中会真实丢下冲突旧衣，结束时才穿上新衣。原版 `unequipBuffer` 累积 delta，在移除一件冲突衣物后没有扣除其用时，因此不能从总 duration 公式推断“每件旧衣必定严格串行耗完各自工时后才脱下”。对多件冲突时的中间帧顺序，应按原版实际 buffer 路径或另做运行观察。[AP07]

单独 RemoveApparel 等待 `int(EquipDelay×60)` 后，检查它仍属于此角色并 TryDrop 到地图；可选的搬去仓库是之后的独立路径。途中取消时，已经落地的旧衣可能保持落地；不能把换装简单描述成最后一帧原子替换两个 Stat。

项目需要明确衣物在地面 Cargo、携带容器和 worn 列表之间的唯一归属，失败或取消应保全实体、ID、材料、品质与 HP。不能在穿上时复制一个库存衣物，在脱下时凭定义重新生成一件满耐久衣物。该要求是项目资源一致性验收，静态分析本身不证明已实现。[AP18、AP20]

## 36.7 穿着耗损与保存

ApparelProperties 默认 `wearPerDay=.4`，本章六件及其父链均未覆盖。Pawn_ApparelTracker 的 rare tick 检查当前游戏 tick 与 `lastApparelWearoutTick`：小于 60000 则不处理；达到后，若 Pawn 不是 world pawn，对**此时穿着**的每件衣物执行 `RoundRandom(wearPerDay)` 点 Deterioration 伤害，然后把 timestamp 设为当前 tick。[AP08]

`RoundRandom(.4)` 等于随机值 `<.4` 时损失 1 HP，否则 0；随机值恰好 .4 不损失。长期期望是 .4 HP/日，并非每天实际扣小数 .4，也不是剩余 HP 的 .4 或 4%。户外物品的 DeteriorationRate 是另一条路径，不能拿 Cloth 本体的 4/日或衣物父类的 2/日替代穿着耗损。

时钟属于 Pawn 的衣物 tracker，不属于每件服装。一件刚穿上但恰逢 tracker 到期的衣服可能立刻接受这次抽样。若一次调用距离上次已过三天，所读函数仍只执行一次，并把 last 设为 now，没有逐日补三次的循环。world pawn 跳过本函数中的伤害后同样重设 timestamp；真实旅行、尸体和 Pawn 调度还需对应调用链，不能由这个局部函数推断所有离图环境永不耗损。

tracker 保存 wornApparel、lockedApparel 和 lastApparelWearoutTick；Wear job 保存 duration 与 unequipBuffer。项目若用每件累计穿着时间、固定 HP 递减、按日补量或基于 ID/天数的确定性抽样，都需要标注为适配。只记录每件穿着时长用于展示，与用它决定原版耗损事件是两回事。[AP20]

## 36.8 棉花与 Cloth 资源

棉花继承 `Plant_Cotton → PlantBase → PlantBaseNonEdible`。直接和继承值如下：[AP09、AP12]

| 参数 | 数值/规则 |
|---|---|
| growDays | 8 |
| MaxHitPoints | 85 |
| fertilityMin / sensitivity | .7 / 1 |
| sowWork / harvestWork | 170 / 200 |
| sowMinSkill | 类默认 0，无棉花覆盖 |
| sowTags | Ground、Hydroponic |
| harvestedThingDef / harvestYield | Cloth / 10 |
| harvestMinGrowth | 类默认 .65；实际检查严格 `growth>.65` |
| harvestFailable | 类默认 true |
| harvestAfterGrowth | 类默认 0，因此收获销毁 |

播种完成从 growth=.0001 开始。生长沿用植物系统，每个 long tick 2000 原版 ticks，连续活跃时基础增长 `2000/(60000×8)=1/240`，再乘肥力、温度、光照等。日内比例 `<.25` 或 `>.8` 休眠。8 growDays 是活跃满速累计时长；即使假设清醒的 55% 时间里光温均理想，连续估算也约为 `8/.55=14.55` 个日历日，实际还受长 tick 相位、太阳光、季节与 Mature `>.999` 门槛影响。[AP10；第 12、30 章]

手工提前采收超过 .65 便可能有收益，自动种植区通常等待成熟，二者不要混写。Plant.YieldNow 的未取整量为：[AP11]

```text
10 * (.5 + .5*inverseLerp(.65,1,growth))
   * (.5 + .5*HP/MaxHP)
   * cropYieldFactor
```

再经一次随机舍入。成熟但半血的基础期望为 7.5 Cloth，而不是 5。对可失败的人类采收，`Rand.Value>PlantHarvestYield` 时失败；若这个 Stat 大于 1，则把已经取整的产量乘该值，再随机舍入。工作完成会执行 PlantCollected，失败也不会保留一株可无限重试的成熟棉花。采收进度还按 `PlantWorkSpeed×lerp(3.3,1,growth)` 推进，表中的 harvestWork=200 不是所有生长状态下的固定秒数。

所选棉花的 harvestedThingDef 就是 Cloth。它直接在地图上生成 Cloth 实体，没有在这条数据/代码链中生成“棉纤维”、再经过纺纱台变布。Cloth 本体继承 ResourceBase 的 stackLimit=75，自身 MaxHP=80、MarketValue=1.5、Mass=.026，材质类别 Fabric；这些资源属性与成衣属性分开保存。

## 36.9 手工裁缝台、配方与品质

HandTailoringBench 的基本参数是：75 单位 Woody/Metallic 材料，尺寸 3×1，交互格偏移 `(0,0,-1)`，基础 WorkToBuild=2000、MaxHP=180、WorkTableWorkSpeedFactor=.5。WoodLog 的 WorkToBuild factor=.7、MaxHP factor=.65，因此木制手台为 **1400 建造工量、117 HP**。75 是材料数量，不因这两个 factor 改成 52.5。[AP13]

ComplexClothing 研究 baseCost=600、techLevel=Medieval、tags 包含 ClassicStart。标签不能独立证明所有剧本或项目开局都已解锁；项目的初始研究策略需要单独声明。

Implied recipe 由 ThingDef.recipeMaker 生成，材料使用 costStuffCount 与允许的 Stuff 类别，输出默认一件，workAmount 默认 -1 时回退到该材料下产品的 WorkToMake。Cloth 没有工量 factor，因此表 36.2 的工量可以直接使用。父类指定 workSkill=Crafting、workSpeedStat=GeneralLaborSpeed 和 UnfinishedApparel，未指定 skillRequirements。[AP15]

原版生产推进为 `GeneralLaborSpeed × WorkTableWorkSpeedFactor × delta`。GeneralLaborSpeed 还受全局工作速度、操作、视力等影响，但该 Stat 没有 Crafting 技能倍率；Crafting 在这条链中进入品质生成。[AP14、AP16]

手台基础 .5 之外，普通房间分类下：

| 条件 | 额外倍率 |
|---|---:|
| 室内房间且不是 Workshop | .8 |
| PsychologicallyOutdoors | .8 |
| 温度严格 `<9°C` 或 `>35°C` | .7 |

室内角色惩罚与户外判定通常互斥，不是户外同时再乘两次 .8；温度惩罚可继续叠加。所读 room-role checker 没有 DLC 开关。工作台设施、电力、场景等还走各自 Stat 路径，不能把所有实际速度固定为 .5。

假设最终 worker speed=1、台面速度=.5、材料已备齐，则六件原版制作时间依表顺序为：40、266.67、333.33、53.33、90、53.33 秒（60 TPS）。这不包含搬运、休息、工作中断，也不是项目时间。

成品由 `GenRecipe.MakeRecipeProducts` 创建，并以 dominantIngredient 的 def 作为 Stuff；有 CompQuality 时调用 `GenerateQualityCreatedByPawn(worker,Crafting)`。完成流程生成产品后消费物理材料，未完成物件保存已有材料与 workLeft。因此产品的材质、品质、实体位置不是一个 UI 标签。[AP18]

品质生成不是固定技能分桶。普通技能等级 0..20 对应 GaussianAsymmetric 中心值为：

```text
.7, 1.1, 1.5, 1.8, 2, 2.2, 2.4, 2.6, 2.8, 2.95,
3.1, 3.25, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 4, 4.1, 4.2
```

第一次用左右宽度 .6/.8，向零取整后限制为 0..5；若结果为 Masterwork=5，有 50% 分支用 .6/.95 再抽一次。创作灵感在此后加 2 级，最高 6；Ideology 生产角色还可另加等级。A17 验证的是给定随机输出后的截断/重抽/灵感分支，不声称复现原版随机流或统计分布。项目固定 Normal 或采用确定性技能分桶时必须明确为简化。[AP17]

## 36.10 项目适配和未覆盖范围

当前实现协作约定将穿脱与制作工时按 60→20 TPS 保持墙钟比例，而穿着耗损按 60000→12000 ticks/日保持日历比例。这是两种不同缩放：

| 行为 | 原版 | 拟定项目映射 |
|---|---|---|
| Tuque 穿戴 | .8×60=48 ticks | .8×20=16 ticks |
| 手台制作 Tuque，最终 worker=1/table=.5 | 1200/.5=2400 ticks | `(1200/3)/.5=800 ticks` |
| 穿着耗损检查 | 60000 ticks/日 | 12000 ticks/日 |

如果把制作也按日历比例换算，Tuque 会变成 480 ticks，和上述 800 不同。A19 将两者并列，避免把项目统一称为某个“原版 tick 等价比例”。长植物生长、天气疾病和其他已有时间模块也要沿各自已声明的日历约定接入。[AP22]

项目拟使用真实稳定 ID 的衣物实体、材料 Cloth、品质与 HP、Pawn.worn、地面/携带位置，并给新开局角色 T-shirt+Pants。该初始套装是项目平衡选择；旧存档不凭空补衣物，可保留无衣物基线。确定性耗损随机、alive-only 推进、装备槽位 UI、简化的身体组、有限材料与品质生成方式均属适配；最终行为由项目实现章及测试结果说明。

原版自动服装优化评分、完整衣柜政策、破损/裸露心情、护甲与战斗衣损、全部材料和服装、外星身体、DLC 特殊装备、完整研究开局解析均未在本次模块中重建。本章没有以“定义存在”替代“项目可操作”，也没有以静态 PASS 替代原版穿脱、裁缝或项目浏览器实测。

## 36.11 可复跑证据与校验

本章新增 **12 类型**，复用既有 **16 类型**，共 28 个引用类型。22 条规则绑定 **68 个代码定位、63 个 XML 定位**；13 个原始 XML 文件筛选 31 个记录，包含 **302 叶字段、12 属性节点、285 明确缺省检查**。19 个独立算例共 **162 个解析断言**；另有 **43 项篡改拒绝检查**。

| 文件 | 用途 |
|---|---|
| [apparel-types.json](evidence/apparel-types.json) | 新增派生类型清单 |
| [apparel-manifest.json](evidence/apparel-manifest.json) | 原件/分析器身份，类型指纹及行数 |
| [apparel-xml.json](evidence/apparel-xml.json) | 原始字段、属性、父名、选区及缺省 |
| [apparel-claims.json](evidence/apparel-claims.json) | AP01–AP22 规则与来源定位 |
| [apparel-cases.json](evidence/apparel-cases.json) | A01–A19 独立输入、期望和范围 |
| [apparel-validation.json](evidence/apparel-validation.json) | 原件 XML/DLL 和本地派生校验结果 |

在项目目录运行：

```powershell
node scripts/research/verify-apparel-evidence.mjs
node scripts/research/verify-apparel-evidence.mjs --local
./scripts/research/verify-apparel-evidence.ps1 -GameRoot 'F:/SteamLibrary/steamapps/common/RimWorld'
node scripts/research/test-apparel-verifier.mjs
```

Portable 验证器冻结整份已审阅 XML records 的规范 JSON 指纹，并核对来源路径、记录结构、主要数值、选定父链、算例输入指纹与独立模型。`--local` 额外验证 28 个派生源文件指纹和关键分支标记。PowerShell 再读原件 DLL/版本/13 份 XML，检查全部选定叶、属性、父名及缺省。这里的父链解析仅针对声明的路径；工作台等未选父类并未被冒称为完整解析。

需要重建派生文件时使用 [extract-apparel.ps1](../../../scripts/research/extract-apparel.ps1)：新增类型放入自己的组，缺少或不匹配的复用类型可重建，但必须匹配既有清单指纹，不改写旧清单。

```powershell
./scripts/research/extract-apparel.ps1 -GameRoot 'F:/SteamLibrary/steamapps/common/RimWorld' -DecompilerPath '../../tools/ilspy/lib/netstandard2.0/ICSharpCode.Decompiler.dll'
```

XML 收集器为 [collect-apparel-xml.ps1](../../../scripts/research/collect-apparel-xml.ps1)，规则/算例生成器为 [write-apparel-evidence.mjs](../../../scripts/research/write-apparel-evidence.mjs)。[拒绝测试](../../../scripts/research/test-apparel-verifier.mjs)只修改忽略目录 `test-results/apparel-verifier-negative` 中的 17 份元数据副本，验证器拒绝错误版本、来源/派生路径、越界行号、XML 继承/缺省/数值、品质顺序、HP折扣误解、身体组别名、耗损端点、采收及日历混淆；坏派生样本直接在副本中创建，测试可离线运行。

这些验证均不导入项目实现，不启动原版，不对全量 Mod Def 数据库或 RNG 分布作等价声明。原版运行记录与项目交付验收应保留为独立证据。
