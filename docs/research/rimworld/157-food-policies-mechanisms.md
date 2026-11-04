# 157 饮食政策、自动取食与代喂

本轮补的是一条日常管理链：**设置共享饮食政策 → 给居民或囚犯指派 → 为实际进食者筛选可用食物 → 走到食物并取用 → 自己吃、送进牢房或喂给卧床病人 → 数量、营养和物品位置真实变化 → 中断与存读档继续成立**。先把这条机制链搭起来，饥饿速度、优先级权重和食物营养留作后续平衡参数。

静态目标为本机 **RimWorld 1.7.4980 rev60**，`Assembly-CSharp.dll` SHA256：`eff7d97949f919fb2b151ebfb906e9be749b63410b7dbda78eeebb7972b245c3`。没有启动或操作原版、浏览器、preview、GUI，也没有截图。以下是安装包派生代码和 Core XML 证据，不代表做过原版交互验证。

[类型清单](evidence/food-policies-manifest.json)记录 37 个派生类型及哈希；[机制投影](evidence/food-policies-mechanisms.json)保留 123 个字面锚点、17 个限定方法检查、16 个 XML 投影和 8 种食物的完整选定 Core 父链。REA 身份复用[同一程序集的托管元数据](evidence/production-bills-rea-managed.json)，方法由固定 ILSpy 静态重建。完整派生 C#、游戏 DLL 和资源不发布。

## 谁持有政策，政策实际约束谁

| 载体 | 职责 | 保存内容 |
|---|---|---|
| `FoodPolicy : Policy` | 可改名、有 ID 的共享 `ThingFilter` | 政策及 filter 深度保存 |
| `FoodRestrictionDatabase` | 政策集合、默认、创建、复制和删除的基础操作 | 政策列表 |
| `Pawn_FoodRestrictionTracker` | 某人的当前政策、是否应当遵守 | 政策引用 `curRestriction` |
| `FoodUtility.WillEat` | 种族适食性、政策、思想或身份限制等综合判断 | 查询，不直接消耗食物 |
| `JobGiver_GetFood`、喂食/送食 WorkGiver | 找到具体目标，形成工作 | 实际 job 与食物/病人目标 |
| `JobDriver_Ingest`、`FoodFeedPatient`、`FoodDeliver` | 预留、走路、搬起、咀嚼、消费或落地 | 执行进度和真实物品 |

两个人选同一政策时，引用同一个 filter。修改政策影响后续筛选，不是每人各存一份独立副本。政策本身也不是口粮配额，不记录“每天最多吃几顿”，更不等于烹饪工单的原料筛选器。

原版食品追踪器按 Humanlike 条件创建。普通牲畜没有这套人类饮食政策；其食物来自种族食性、动物取食、圈舍与医疗喂食机制，不能把动物喂食界面和居民饮食政策混成一个开关。

默认政策是列表第一项。把某政策设为默认会交换列表顺序；尚无有效政策引用的人在 getter 中才取得当前默认，已有指派不自动覆盖。新 ID 是现有最大值加一；这不是全局物品 ID，也不是永不复用 ID 的保证。

删除先检查地图、商队和旅行运输中的活 Pawn，只要有人引用便拒绝。随后清理其它世界或临时 Pawn 的引用并移除政策，不删除食物。`TryDelete` 本身没有“最后一项不能删”的条件；空列表下 `DefaultFoodRestriction` 会创建新政策。Web 限制最后一项、限定政策数量和名称长度属于自己的 UI/存档约束。

## getter 与 eater 必须分开

食物搜索的两个角色是：**getter 负责到哪里拿、能不能走到、能不能预留；eater 负责吃什么、吃多少、得到什么营养与心情**。例如医生素食、病人允许肉食时，应按病人的政策选餐，而不是把医生的政策强加给病人。

`GetCurrentRespectedRestriction(getter)` 的实际边界：

1. 只有未销毁的人类，且自身为玩家阵营或 HostFaction 为玩家阵营，才可配置。
2. eater 不属于玩家阵营时，只有 getter 属于玩家阵营才返回该政策；getter 为 null 或非玩家时忽略。
3. eater 在精神状态时忽略政策。
4. 其余返回当前政策。这个方法没有 `Starving`、`Drafted` 或营养阈值例外。

| 场景 | getter | eater | 原版通常采用的政策 |
|---|---|---|---|
| 普通居民自己取食 | 本人 | 本人 | 本人的政策 |
| 医生喂普通居民 | 医生 | 病人 | 病人的政策 |
| 狱卒给囚犯送餐或床边喂食 | 玩家狱卒 | 囚犯 | 囚犯的政策 |
| 囚犯自己吃牢房里的食物 | 囚犯或 null | 囚犯 | 忽略殖民地给他的政策 |
| eater 处于精神状态 | 任意 | 精神状态者 | 忽略政策，其他适食性规则仍可存在 |
| 普通居民已饿到 Starving | 本人 | 本人 | 仍遵守政策 |
| 征召居民的普通政策查询 | 本人 | 本人 | 追踪器没有征召豁免 |

这意味着囚犯政策主要约束殖民地给他供应什么，不能直接解释成“囚犯绝不会吃政策禁用的现成食物”。牢房里已有食物是否足够，`WorkGiver_Warden_DeliverFood` 调用没有玩家 getter 的 `p.WillEat(foodSource)`；即使那是狱卒送餐政策不允许的食物，囚犯能自行吃时也可能阻止重复供餐。

禁止红叉和活动区是另外一组规则。`ForbidUtility.CaresAboutForbidden` 对征召、精神状态、Host 等有自己的例外；**征召忽略 forbidden，不能推导出征召同时忽略 FoodPolicy**。

## 原版初始政策不是“只能吃这个等级”

新政策首先允许抽象 `Nutrition > 0` 的 Def。初始集合在这个基础上删除部分项：

| 基础政策 | 主要过滤操作 |
|---|---|
| Lavish | 初始第一项，默认保留全部营养食物 |
| Fine | 排除 preferability ≥ MealLavish，InsectJelly 有例外 |
| Simple | 排除 preferability ≥ MealFine，保留 InsectJelly；额外禁 MealSurvivalPack |
| Paste | 排除 preferability ≥ MealSimple，代码显式豁免 MealNutrientPaste 和 InsectJelly |
| Raw | 排除 preferability ≥ MealAwful，额外禁 Chocolate |
| Nothing | `SetDisallowAll()`，真实空集合 |

因此名为 Simple 的政策并不是“只允许简单饭”，低档原料仍可保留；名为 Lavish 的政策也不是“只吃奢华饭”。没有匹配食物时普通搜索会失败，**饥饿不会偷偷清除政策**。患者或囚犯喂食 WorkGiver 还明确检查空集合并给 `NoFoodMatchingRestrictions` 原因。

Ideology 启用时才创建 Vegetarian、Carnivore、Cannibal 和 InsectMeat 政策，并配置特殊过滤器。Biotech 的 HemogenPack 另有默认排除。当前本机 Data 目录只有 Core、Odyssey；程序集含 DLC 类不证明本机已安装相应 XML 或已启用 DLC。本轮不伪造缺失的 Ideology XML 证据。

## 筛选成品类型，不自动递归筛选全部原料

`FoodPolicy.Allows(Thing)` 委托 `ThingFilter.Allows(Thing)`。它先检查最终 `ThingDef` 是否允许，再检查具体物品的可用特殊过滤器；普通 `Allows(ThingDef)` 只是 allowedDefs 集合成员判断。

由此可以区分三个问题：

- **不直接吃生肉**：禁用肉 Def，仍允许 MealSimple。这本身不禁止由肉烹制的 MealSimple。
- **不吃含肉的饭**：需要基于实例 `CompIngredients` 的饮食分类/特殊过滤，而不是只删肉 Def。
- **厨师不用肉做饭**：这是烹饪工单原料过滤，与 eater 的消费政策不同。

原版 `CompIngredients` 保存的是参与制作的原料 Def；拆分物品时复制，合并时有兼容性和来源保留规则。饮食特殊分类会查看这些来源：有任何肉原料可归 Meat；只有非肉且无动物产品可归 NonMeat；奶、蛋属于 AnimalProduct，可能得到 Any。素食/肉食不能简单映射成“动物来源一律算肉”。Cannibal 和 InsectMeat 特殊 worker 会检查人肉/虫肉来源。

`FoodUtility` 对 `IsProcessedFood` 另有特殊规则；不能仅凭中文“加工/烹饪过”就假定任意熟饭都走该分支。完整 DLC 饮食思想、动物崇拜、身份和基因限制不属于这一版有限食物种类过滤的自动承诺。

原版 food manager 隐藏耐久范围配置，也隐藏 `AllowFresh` 开关。公开一个熟食种类列表可以先建立管理闭环；如果 Web 要加入原料黑名单、素食筛选，应作为独立能力，并依赖保存下来的真实 meal provenance。

## 自动取食候选与选择

`JobGiver_GetFood` 在达到取食需求时，把本人同时作为 getter/eater 调用统一搜索。找不到就没有新的吃饭工作，不会凭空产生口粮。

搜索包含 getter 库存、地图食物、受支持的驮运动物库存回退，并可能返回营养膏机、采收或捕食工作。库存食物也执行 `eater.WillEat(thing, holder)`；不是搬进背包后就自动绕过政策。与自动衣物选择不同，**地图食物无需 `IsInAnyStorage()`**，散落在地面且可用的食物也可被选择。

地图候选需要同时满足：

1. 种族适食性、food need、食物偏好下界与上界、eater 政策及其他相应 `WillEat` 条件。
2. 有营养、`IngestibleNow`，不是干枯不可用对象；尸体、药物等受调用参数约束。
3. getter 对目标的 forbidden/活动区、房间社会归属、动物可见范围等条件。
4. 可为所需数量预留，且 getter 有实际可达路线。

Starving 会把 preference 下界放低到 DesperateOnly，并放松 `!desperate && IsNotFresh` 这道检查；政策、`IngestibleNow`、干枯、可达和预留等仍保留。因此不能把它写成“饿了就能吃任意腐烂餐”。普通人自动选尸体还有 malnutrition severity > .4 的单独条件，特殊 mutant/野人/动物分支另论。

该地图候选方法没有服装优化器中的 `IsBurning` 专门排除。Web 若避免走到火上取食，需要接入自己的火灾/寻路安全调度，并注明是安全机制选择，不能伪称此方法原样就有这道门槛。

候选分数考虑距离、吃下去的心情后果、食物定义偏移以及临近腐败等因素。库存比较有 −32 分，库存里 fresh 且距腐烂少于 30,000 ticks 的食物可更早取用。原版不是“永远吃最贵的”，也不是“优先吃自己手里所有东西”。Web 可以暂时沿用现有稳定排名，只要政策作为**允许条件**应用在同一份候选集上，不应假装新的政策顺便复刻了完整评分。

## 自吃、喂食和送餐是不同的物品流程

**自己吃**：预留真实 stack 数量 → 走到物品或从库存转到 carrier → 搬到用餐位置（未征召时）→ 咀嚼 → `FinalizeIngest` 调用真实物品的 `Ingested` → 按实际返回营养增加 eater 的 food need。征召状态的 driver 可以跳过寻找正常餐桌位置。

**喂病人**：WorkGiver 按 patient 的政策、饥饿和医学状态选食，预留病人和食物，取到实际食物后走到患者，按患者进行咀嚼/喂食和最终消费。喂食时间乘数为 1.5；病人得到营养，不是医生得到营养。

**喂卧床囚犯**：`WardenFeedUtility` 要求囚犯在床、允许供餐，且倒地或应医疗休息；狱卒使用同一个 `FeedPatient` job。普通医疗喂食给这些对象让路，避免重复护理。

**给能自行吃饭的囚犯送餐**：要求 prison cell、允许供餐、达到饥饿条件，且房间已有可吃食物不足。狱卒先取食物，再搬到牢房目标格并 `TryDropCarriedThing`。送到地上不直接加饱食度，之后由囚犯自己取食。Execution 不供餐；Release 只在囚犯倒地时允许带食物，这是 guest 状态规则而不是 food policy。

数量由 eater 的 `NutritionWanted` 估算并受每种食物最大单次摄入量约束。搜索/搬取计算使用 `RoundToInt`，实际 `Thing.IngestedCalculateAmounts` 使用 `CeilToInt` 并受实际物品约束，两层用途不能混成同一个“数学公式保证”。消费会拆分使用部分，全部吃完才从 carrier 移除并销毁。Web 的整数物品守恒、余量落地和营养累计应分别验证。

## 修改政策不会由原版 setter 强制中断当前一口饭

`CurrentFoodPolicy` setter 只是设置引用。当前的 `JobDriver_Ingest`、`JobDriver_FoodFeedPatient`、`JobDriver_FoodDeliver` 相关执行方法以及 `FinalizeIngest` 没有直接重新调用政策；`Thing.Ingested` 也检查物品可摄入性、消费、思想/效果和实际营养，没有直接重查政策。这些是限定方法的静态结论，不排除未覆盖的外部 job 中断或组件钩子。

因此“修改政策后立即取消不合规的取食/喂食任务”是合理的 Web 一致性设计，但需要明确为适配。取消时已经搬起的食物应保留在 carrier 或真实落地，预留释放，不能一边留物品一边加营养，也不能删掉食物。存档恢复同样要保存被谁搬、目标是自己还是患者、尚未消费的数量，防止重复喂食。

手动点击“食用”的原版菜单不查 `FoodPolicy` / `WillEat`，仍检查种族适食性、当前可吃、路径、身份或药物相关条件。接受后清除目标 forbidden，再创建 ordered Ingest。这个显式命令可以覆盖普通饮食政策；它与“居民饿了就自主绕政策”是不同入口。Web 的单次手动取食覆盖应绑定具体任务，而不是永久清空居民政策。

本轮 Web 将 `manualFoodOrder` 作为本次消费的政策覆盖，命令只接受可行动且 food < 100 的居民，以避免零消耗或无效工作。这道“尚未饱食”的 UI/命令门槛是 Web 适配；上述原版手动菜单没有相同的 `food < 100` 条件，不能从静态材料推导成原版禁止饱食者手动消费。

手动命令也可指定当前活动区外的食物，直接调用链为：

```text
FloatMenuOptionProvider_Ingest
  不读 IsForbidden / InAllowedArea，保留 CanReach
→ Pawn_JobTracker.TryTakeOrderedJob
  job.playerForced = true
→ Pawn_JobTracker.StartJob
  drafted 或 playerForced → newJob.ignoreForbidden = true
→ JobDriver_Ingest 的取物 goto
  FailOnDespawnedNullOrForbidden → FailOnForbidden
→ ToilFailConditions.FailOnForbidden
  ignoreForbidden → 先返回 Ongoing，不执行后面的 cell / thing forbidden 拒绝
```

这是**目标权限的覆盖**，不等于所有寻路偏好都消失。`PathUtility.GetAllowedArea` 在未征召且通常尊重禁止的 Pawn 上仍可能返回活动区，该查询不读取 `playerForced` / `ignoreForbidden`。此外，之后重新指派非空有效活动区时，`Pawn_PlayerSettings` setter 会对未征召且当前任务目标在区外者发 `InterruptForced`，这里没有手动任务豁免。Web 可以将这些作为三个独立决策：本次命令可越界、路线仍可偏好区内、后续改区时重新验证任务。

## 可核对的数值参考

以下来自本机版本，作为参数背景保留，不作为本轮优先调平的目标：

| 原版项目 | 值或规则 |
|---|---|
| 杂食/肉食欲取食阈值 | food level < .30 |
| Hungry / UrgentlyHungry | 欲取食阈值 × .8 / × .4；普通杂食约 .24 / .12 |
| 患者/囚犯供餐阈值 | 约 Hungry + .02，具体 giver 有 `<` / `≤` 差别 |
| Simple / Fine / SurvivalPack / Paste 营养 | .90 |
| Lavish 营养 | 1.00 |
| RawRice / Milk 营养 | .05 |
| EggChickenUnfertilized 营养 | .25 |
| 床边喂食时间 | 原进食时间 × 1.5 |
| 普通人自动允许尸体的 malnutrition 条件 | severity > .4 |

食物营养、preference、foodType 的投影沿各自完整选定 Core 父链读取最近的标量定义。该做法没有展开全部 XML 合并语义，也没有执行 mod patch、DLC 组合或 effective Def 数据库；不要把父链投影当完整运行时数据。

## Web 机制验收边界

当前闭环应能覆盖：共享政策可编辑与指派，空政策确实限制自取食和按政策供餐，库存与地面候选一致筛选，病人使用自己的政策，囚犯自吃与狱卒供餐的差异明确，真实行走和消费，取消/抢占后食物不消失，两个取食者不重复消费同一数量，存读档不复制食物或营养。旧档迁移默认全部允许可以保留旧 Web 行为，但这是兼容策略，不是原版迁移算法。

DLC 思想与饮食特殊过滤、婴儿喂养、营养膏机、驮运动物库存、贵族饮食、完整恶劣食物回退、手动强制食用等，应在实际完成时再声明；有限 kind filter 不等于这些模块已齐全。机制先完成，数值可单独调。

独立静态重建和检查命令：

```powershell
pwsh -File scripts/research/extract-food-policies.ps1
pwsh -File scripts/research/collect-food-policies-evidence.ps1
pwsh -File scripts/research/extract-food-policies.ps1 -Check
pwsh -File scripts/research/collect-food-policies-evidence.ps1 -Check
```

`-Check` 会重读程序集或选定 XML，重建派生文本并比对保留投影。它不执行目标游戏代码，也不替代原版交互验证和 Web 行为测试。
