# 动物训练、主人跟随与协作：原版机制证据

本轮先搭训练到实际协作的玩法闭环。原版参数作为参考保留，Web 的训练耗时、间隔、概率与移动节奏可在机制稳定后再调整；显示“已训练”“正在搬运”并不能代替实际行动。

证据来自本机 `RimWorld 1.7.4980 rev60` 的 `Assembly-CSharp.dll` 与 Core XML，程序集 SHA-256 为 `eff7d97949f919fb2b151ebfb906e9be749b63410b7dbda78eeebb7972b245c3`。本轮重新调用 REA 托管检查，保留[身份摘要](evidence/animal-training-rea-managed.json)，再用已固定身份的 ILSpy 从 CIL 派生 C#；没有加载或执行游戏代码，没有运行游戏、浏览器或 GUI。

[类型清单](evidence/animal-training-manifest.json)保留 55 个派生类型的身份；[机制投影](evidence/animal-training-mechanisms.json)保存可重查的代码锚点、限定方法检查、25 个 XML 投影，以及动物普通/常驻思考树的实际祖先结构。完整派生 C#、DLL 和原版资源仅保留本地，不进入发布内容。XML 是选定 Core 字段，不能冒充已合并全部继承、DLC、模组和运行时修饰的有效 Def 数据库。

## 训练改变能力，能力再进入任务调度

`Pawn_TrainingTracker` 把三个概念分开保存：`wantedTrainables` 是接下来希望训练什么，`steps` 是累计与衰退中的进度，`learned` 是已经学会的能力。取消训练意愿只修改 wanted，不清空已有进度与能力。原版也没有用一个“所有动物劳动已解锁”开关替代它们。

| Core defName | 当前英文标签 | 训练等级要求 | 完成步数 | 前置 | 最小实际体型 |
| --- | --- | --- | --- | --- | --- |
| Tameness | tameness | None | 5 | 无 | 无额外门槛 |
| Obedience | guard | Intermediate | 3 | Tameness | 无额外门槛 |
| Release | attack | Intermediate | 2 | Obedience | 无额外门槛 |
| Rescue | rescue | Advanced | 2 | Obedience | 0.65 |
| Haul | haul | Advanced | 7 | Obedience | 0.40 |

开启一个训练项目会递归开启其前置的 wanted；关闭前置会递归关闭后继 wanted。`NextTrainableToTrain` 按 Def 的 `listPriority` 降序选择有需求且能继续训练的项目，本机对应 Tameness、Obedience、Release、Rescue、Haul。

`CanBeTrained` 要求自身未满，且所有前置已经 learned、同时没有待补的训练步数。这里有一个容易漏掉的细节：前置曾经学会但进度已经部分衰退时，仍能使用前置能力，却必须先补满前置，才能继续训练后继。

## 为什么选 LabradorRetriever

原版确有 `ThingDef` 与同名 `PawnKindDef` **`LabradorRetriever`**，位于 `Data/Core/Defs/ThingDefs_Races/Races_Animal_CatGroup.xml`。不要按文件名误判成猫，也不要使用未经核实的 `Labrador` defName。

| 字段 | 本机 Core 参考值 | 机制含义 |
| --- | --- | --- |
| trainability | Advanced | 满足四项协作技能的训练等级要求 |
| baseBodySize | 0.75 | 成年通常够救援和搬运的体型门槛 |
| Wildness | 0 | 普通最低驯养技能为 0，驯顺不自然衰退 |
| foodType | OmnivoreAnimal, OvivoreAnimal | 杂食并接受动物产品；没有 Plant 标志 |
| tradeTags | AnimalCommon, AnimalPet | 可进入匹配宠物售卖标签的贸易库存 |
| baseHungerRate / baseHealthScale | 0.4 / 1.0 | 原版种族参数，不能直接等同 Web 每秒耗粮或血量 |
| MoveSpeed | 5.0 | 原版移动基准 |
| ComfyTemperatureMin | -30 | 本物种显式值 |
| ComfyTemperatureMax | Core 默认 40 | 物种与 AnimalThingBase 没有覆写；其它修饰仍可能改变 |

`FoodTypeFlags.OmnivoreRoughAnimal` 才在 `OmnivoreAnimal` 上额外加入 Plant。拉布拉多不靠啃草维生；“食谱含植物来源原料”不等于“会吃地上的草”。Web 可以先使用现有粮食、肉、蛋、奶等已实现食物，但必须在数据上与可放牧的动物区分。

动物婴儿/少年体型因子分别为 0.2、0.5；本物种阶段年龄为 0、0.25、0.5 年。因此普通幼犬体型约 0.15、少年约 0.375，均不满足 Rescue/Haul 门槛，成年约 0.75 才满足。`CanAssignToTrain` 检查实际 BodySize 与训练等级，没有一条“所有训练必须成年”的统一判断；Obedience、Release 不应被误加同样的体型门槛。

`Hediff_Pregnant.DoBirthSpawn` 使用母体的 kind 与 faction 生成幼崽，并在成功出生后复制区域限制。`PawnGenerator` 为玩家阵营动物初始化满 Tameness 与其 wanted；这条出生路径没有复制父母的四项能力、主人或跟随开关。买入/驯服导致 `SetFaction(玩家)` 时也会补满 Tameness，不能据此假设四项协作已学会。

贸易是合法获得路径，但不是“每次商人必卖狗”。本机 Outlander 商队与定居点有包含 `AnimalPet` 的售卖生成器；`StockGenerator_Animals` 还检查野性、温度、可售标签及随机库存。`tradeTagsSell` 是商人卖给玩家的方向，不等同于商人买入同类动物的方向。

## 驯兽师必须实际准备、到达、喂食与尝试

`WorkGiver_Train` 扫描同阵营的动物，排除 Dryad、没有训练追踪器、没有下一项可训练项目或无法互动的目标。`WorkGiver_InteractAnimal` 要求可独占预留动物、动物未倒地、通常醒着且可进行日常互动；驯兽师的 Animals 技能需满足最低 handling stat。这个最低门槛与每次训练成功率是两套检查。

未准备好食物时，狱卒式的“凭空加进度”不会发生：先发 `TakeInventory` 任务取得食物，再安排 Train。库存检查累计可组成的喂食份数，需至少两份；地图备粮请求量为每份营养 × 2 × 4，也就是四次完整互动的参考备粮量。

食物必须由动物 `WillEat` 接受，库存准备还限制 preferability 不高于 `RawTasty`、非药物。地图找粮明确禁用站立植物、药物、尸体、营养膏分配器、禁用物和不合社会归属的来源。这个地图来源限制不能推广成全部库存路径都检查了完全相同的条件。原版并非“训练只能消耗粮食”；Web 暂只支持已实现的几类原始食物，应写成内容适配。

一次正常 Train 的顺序是：

1. 到达动物、等待可互动位置，进行第一段聊天。
2. 再接近并进行第二段聊天，然后实际喂食第一份。
3. 再接近并进行第三段聊天，然后实际喂食第二份。
4. 再检查可互动，记录 `lastAssignedInteractTime`，等待并执行 `TryTrain`。
5. 成功只给当前项目加一步；失败报告本次未进步。

原版每段聊天 270 ticks；每次喂食目标为 `min(food.MaxLevel × 0.15, 0.3)`，喂食延时按实际供给营养相对目标的比例调整。食物从库存分出、进入 carry、由 `FinalizeIngest(Animal)` 实际摄入，剩余携带物再回库存。整件摄入可能超过目标营养，不能把“目标份额”当成每轮精确无误差的库存扣减量。

失败发生在喂食后，**食物已消耗，互动冷却也已记录**，只是没有增加训练进度。途中取消不得返还已摄入部分；未消费的库存与携带物仍必须保留，不能因为任务失效消失。`feedNutritionLeft` 由 driver 保存；时间戳由 `Pawn_MindState` 保存。每次恢复都必须保持“只消费一次、只判定一次”的阶段语义。

`TryTrain` 的概率为 handler `TrainAnimalChance`，乘野性从 0→1 对应的 1.5→0.5，再在存在 Bond 时乘 5，最后 Clamp01。Core stat 的 Animals 技能因子为 `0.10 + 0.05 × level`，另有 Talking/Hearing/Manipulation 因子。虽然 TrainableDef 有 difficulty，**这段成功判定没有读取 difficulty**，不要自创“再除以难度”的原版公式。

原版训练间隔检查 `当前 tick < lastAssignedInteractTime + 15000`。Web 已规划的 `work=162`、`cooldown=3000` 等可作为不同模拟节奏下的实现参数，不必为了贴数字改掉现有整体节奏；食物、过程、失败和取消的语义更重要。

## 主人跟随与释放攻击

动物的 `Pawn_PlayerSettings` 保存 `Master`、`followDrafted`、`followFieldwork`。两个跟随布尔值默认均为 false。Obedience 学成且当前没有主人时，原版自动把训练者设为主人，但不会在 `Train` 中顺便打开两个跟随选项。

原版主人选择菜单遍历已出现在地图上的自由殖民者。`CanBeMaster` 默认要求 spawned、非囚犯，且有 Bond 或 Animals 技能达到最低 handling；`RespectedMaster` 还要求动物为玩家阵营、主人与它同阵营。`Master` setter 要求动物已经学会 Obedience，并在更换主人影响当前跟随时中断旧工作。

普通 Animal 思考树的顺序为玩家阵营 → learned Obedience → `ShouldFollowMaster` → 防卫主人、跟随主人、在主人附近游走。常规跟随条件是：

- 开启 `followDrafted`，主人被征召且可达。
- 或开启 `followFieldwork`，主人的 `lastJobTag` 为 `Fieldwork` 且可达；不是任意工作都触发。
- 还有主人被敌对携带者带走且携带者可达的特殊保卫分支。

实际跟随发出 `FollowClose`，而非名字相似的 `Follow`。普通半径 3，job 每 200 ticks 到期重评，driver 每约 30 ticks 检查路径，并用 1.2 倍半径做启动滞后，避免边界来回切换。主人走动时动物真的重新寻路，不应只在渲染层贴着主人瞬移。

**`animalsReleased` 属于主人 Pawn 的设置**。征召的主人可用群体释放开关；需有已经学会 Release 且当前满足跟随条件的动物。开启会通知动物并中断其当前 job；主人解除征召会清掉 animalsReleased。普通防卫范围以主人为中心为 5，主人的 release 开启且动物学会 Release 后扩为 50；跟随半径同时从 3 扩为 50。

防卫目标可优先采用主人当前有效、可达的近战威胁，即使双方不是阵营敌对，前提主人不处在精神状态；否则委托一般 `AIFightEnemy` 的视线、可达、威胁和自动目标检查。最终发出 `AttackMelee` 并调用 `TryMeleeAttack`，必须产生实际战斗结果。范围扩大不等于无条件攻击所有物体。

本机 1.7 还有 Odyssey 的 `AttackTarget` 训练与定向攻击 UI，但由独立 DLC/能力条件控制。它和 Core Release 不同，不能把“点击指定任何目标攻击”写成这四项 Core 训练自带的行为。

## 救援是搬运病人到床，不是瞬间治疗

普通树在跟随/防卫之后、部分基础需求之前检查 learned Rescue，半径为 75。`JobGiver_RescueNearby` 没有主人要求，也没有类似搬运的概率间隔；未选择主人不应禁用救援。

自动救援要求同阵营、病人希望被救、未禁用、附近 25 范围没有敌人，且动物可预留并抵达。`WantsToBeRescued` 首先要求倒地且不已在床上或充能，还排除远行安排、部分精神状态、宰杀目标等具体状态。它不是“血量不满就救援”，更不是“有伤就治疗”。

找到实际可用床后创建 `Rescue(patient, bed)`。`JobDriver_TakeToBed` 预留病人和床容量，走到病人，实际 StartCarryThing，再把同一个病人带到床并 TuckIntoBed；途中会因目标消失、床不再合适、病人不再倒地或失去携带关系等失败。结束回调尝试放下仍携带的实体。

Web 多层体素环境需要自己的可达路径与上下层关系，还需要保存动物携带病人与病人 `carriedBy` 的双向关系。病人不能同时在地面、动物手中和床上，也不能在救援完成时免费恢复健康。治疗与护理仍由已有医疗系统负责。

## 搬运是自主挑选实物与更好仓位

Animal 树的搬运分支位于基础需求之后：有阵营 → 概率机会 → 有 Manipulation → learned Haul → `JobGiver_Haul`。没有主人条件。Def 的说明也明确是偶尔自动搬运，不能直接指定具体物品。

Core 的 `mtbHours=1.5` 是平均机会参数；`ThinkNode_ChancePerHour` 每 2500 ticks 最多尝试一次，以该小时的动物随机种子做 MTB 判定，并把每个节点的尝试时间保存在 `mindState.thinkData`。不是严格每隔 1.5 小时必定搬一件。Web 可选择可复现的调度方式，但应注明与原版随机机会的差异。

`JobGiver_Haul` 从真正需要搬运的物体中选取可达对象，检查禁用、预留、容量以及更高优先级的仓位。共享 `HaulAIUtility` 还检查操作能力、火灾、战争迷雾、不能打断的进行中半成品，以及囚犯食物的社会归属。因此不能把刚送入牢房的口粮随手搬回仓库，也不能抢走另一项工作已经持有的材料。

`HaulToCell` 预留源物体和目的格，实际取起/拆分物品，带着它移动，再真实放入仓位。源 stack 变化时按可得部分处理；放置失败或中断要保留真实携带物。原版容量按 CarryingCapacity ÷ 每件体积并受 stackLimit 限制，不能把单一质量预算说成原版同一公式。

## 遗忘是缓慢失去进度，不是立即禁用能力

训练追踪器初始化时 `countDecayFrom=当前 tick`。rare tick 中，Suspended 或不在地图上的动物把基准向后推 250；Tameness 进度为零则把基准设为当前 tick；其余动物达到间隔且非 Dryad 时才处理一次衰退。

衰退从有进度且不作为其它有进度技能前置的“叶技能”中随机选择一项，减一步，并把基准设为当前 tick。某项已经 learned 时，只要还有一步，能力仍保留；只有减到零才清 learned。原版不在此处递归删除所有子技能，因为叶技能选择本身保护了仍被依赖的前置。

野性 0→1 对应 12→6 天的间隔。Tameness 还受单独限制：FenceBlocked 不衰退；否则野性需大于 0.101 才可衰退。拉布拉多驯顺不会自然退成野生，但已学的工作技能仍会衰退。若随机选到不能衰退的 Tameness，本次机会只更新时间，不减步数。

成功训练、补满技能不会在 `Train` 方法中重置 countDecayFrom；wanted 改变也不重置。保存时需要保留这个基准，不能每次读档获得一段全新的免衰退期。仅保存 steps 并以“steps 满了才 learned”重建会错误删除部分衰退后的有效能力。

## 所属关系、死亡、出售与读档

主人死亡经 `Pawn.Kill` → 基类 `Thing.Kill` 调用虚方法 `Destroy` → `Pawn.Destroy`，遍历存活动物并清除指向该主人的引用。动物自身死亡、受伤倒地、失去路径或被交易，也要与当前携带物和任务预留一起处理。

`Pawn.PreTraded` 在玩家买入时转玩家阵营，卖出时离开玩家阵营。检查到的这个方法不直接擦除训练与 Master；`Notify_FactionChanged` 自身只重置医疗与区域。`SetFaction` 还经过动态组件更新与 ClearMind。由于 `RespectedMaster` 检查玩家与同阵营条件，卖出后旧主人已经不再有效。Web 若立即清理旧 master ID 与跟随/释放任务，应表述为显式的一致性清理，而不是伪造原版在 PreTraded 中存在同样赋值。

恢复需要同时保留能力与任务事实：wanted/steps/learned、主人和跟随选项、主人 release 状态、遗忘基准、最近训练互动、搬运机会时间，以及实际取物、食物摄入、病人携带和任务完成阶段。已消费不可回滚，已落地不可再次发货，已成功的最后训练步骤不能重复结算。

## Web 机制验收要证明什么

先证明普通训练经过真实取粮、接近、喂食后才能增加进度；失败仍消耗合理的已摄入食物；撤销 wanted、目标死亡、征召驯兽师和路径中断能退出，并守住库存与携带物数量。学成 Obedience 后再证明主人选择与两个跟随条件实际改变动物行为。

随后分别证明 Release 造成真实接敌/伤害、Rescue 把倒地居民沿路搬到实际床位、Haul 把实际 stack 带进符合优先级与过滤规则的仓位。不能用按钮切换状态、直接给仓库总量加数、瞬移病人或攻击标签来替代这些结果。

回归至少包括两个动物争同一物品/病人、与殖民者工作共享预留、病人已被别人救走、床被占用、源 stack 部分耗尽、仓位满或失效、牢房口粮排除、取起前/搬运中/放置前存读档、主死/售出取消、幼体体型门槛以及 learned 与衰退步数分离。受控 headless 夹具、历史存档兼容与真实自然开局是不同证据，报告应各自说明。

## 可复查命令

```powershell
pwsh -NoProfile -File scripts/research/extract-animal-training.ps1 -Check
pwsh -NoProfile -File scripts/research/collect-animal-training-evidence.ps1 -Check
```

第一条重新从固定程序集派生全部选定类型，逐字比较并复查 manifest；第二条核对身份、类型哈希、代码锚点、限定方法与 XML 投影。两者都不运行原版游戏或 Web，也不构成运行时验收。
